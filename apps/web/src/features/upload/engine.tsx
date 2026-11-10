import { useEffect, useMemo, useReducer, useRef, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { uploadRequestSchema } from "@transfile/shared"
import { api, ApiError } from "@/lib/api"
import { keys } from "@/lib/keys"
import { readJson } from "@/lib/read"
import { uploadTargetSchema } from "@/lib/schemas"
import { UploadCancelled, uploadBytes } from "@/lib/transfer"
import { UploadContext, type UploadContextValue, type UploadOptions } from "@/features/upload/context"
import {
  initialUploadState,
  overallProgress,
  uploadReducer,
} from "@/features/upload/reducer"

const CONCURRENCY = 3
const claimed = new Set<string>()

type Waiter = {
  ids: string[]
  resolve: () => void
  reject: (error: Error) => void
}

function friendly(error: ApiError): string {
  if (error.status === 413) return "This account is out of space."
  if (error.status === 503) {
    return "Guest uploads are busy right now. Try again later or sign up."
  }
  if (error.status === 0) return "The connection dropped. You can retry."
  return error.message
}

function displayName(file: File): string {
  const name = file.name.trim()
  return name.length > 0 ? name : "file"
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState)
  const files = useRef(new Map<string, File>())
  const options = useRef(new Map<string, UploadOptions>())
  const aborts = useRef(new Map<string, () => void>())
  const stopped = useRef(new Set<string>())
  const waiters = useRef<Waiter[]>([])

  useEffect(() => {
    waiters.current = waiters.current.filter((waiter) => {
      const rows = waiter.ids.map((id) => state.items.find((item) => item.id === id))
      if (rows.some((row) => row === undefined)) return true
      const failed = rows.find((row) => row?.status === "error" || row?.status === "cancelled")
      if (failed) {
        waiter.reject(new Error(failed.error ?? "Upload failed"))
        return false
      }
      if (rows.every((row) => row?.status === "done")) {
        waiter.resolve()
        return false
      }
      return true
    })
  }, [state.items])

  useEffect(() => {
    const busy = state.items.some(
      (item) =>
        item.status === "queued" ||
        item.status === "uploading" ||
        item.status === "processing",
    )
    if (!busy) return
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", onLeave)
    return () => window.removeEventListener("beforeunload", onLeave)
  }, [state.items])

  async function runItem(id: string) {
    const file = files.current.get(id)
    const choice = options.current.get(id)
    if (!file || stopped.current.has(id)) {
      if (!stopped.current.has(id)) {
        dispatch({ type: "status", id, status: "error", error: "This file can't be uploaded" })
      }
      return
    }
    dispatch({ type: "status", id, status: "uploading", error: null })
    if (stopped.current.has(id)) {
      dispatch({ type: "cancel", id })
      return
    }
    try {
      const body = {
        name: displayName(file),
        size: file.size,
        ...(file.type ? { mime: file.type } : {}),
        ...(choice?.folderId ? { folderId: choice.folderId } : {}),
        ...(choice?.expiresInHours ? { expiresInHours: choice.expiresInHours } : {}),
      }
      const parsed = uploadRequestSchema.safeParse(body)
      if (!parsed.success) {
        throw new ApiError(400, "This file can't be uploaded")
      }
      const created = await readJson(
        "/api/files/upload-url",
        uploadTargetSchema,
        "Could not start the upload",
        { method: "POST", body: parsed.data },
      )
      if (stopped.current.has(id)) return
      const transfer = uploadBytes(
        created.upload.url,
        created.upload.method,
        file,
        created.upload.headers,
        (progress) => dispatch({ type: "progress", id, progress }),
      )
      aborts.current.set(id, transfer.abort)
      await transfer.done
      aborts.current.delete(id)
      if (stopped.current.has(id)) return
      dispatch({ type: "status", id, status: "processing", error: null })
      await api(`/api/files/${encodeURIComponent(created.file.id)}/complete`, { method: "POST" })
      if (stopped.current.has(id)) return
      dispatch({ type: "status", id, status: "done", error: null })
      void queryClient.invalidateQueries({ queryKey: keys.library })
      void queryClient.invalidateQueries({ queryKey: keys.usage })
    } catch (error) {
      if (error instanceof UploadCancelled) {
        dispatch({ type: "cancel", id })
        return
      }
      dispatch({
        type: "status",
        id,
        status: "error",
        error: error instanceof ApiError ? friendly(error) : "The connection dropped. You can retry.",
      })
    } finally {
      aborts.current.delete(id)
      claimed.delete(id)
    }
  }

  const runRef = useRef(runItem)
  useEffect(() => {
    runRef.current = runItem
  })

  useEffect(() => {
    const inFlight = state.items.filter(
      (item) => item.status === "uploading" || item.status === "processing",
    ).length
    let slots = CONCURRENCY - inFlight
    for (const item of state.items) {
      if (slots <= 0) break
      if (item.status !== "queued" || claimed.has(item.id)) continue
      claimed.add(item.id)
      slots -= 1
      void runRef.current(item.id)
    }
  }, [state.items])

  const value = useMemo<UploadContextValue>(() => {
    return {
      items: state.items,
      progress: overallProgress(state.items),
      enqueue(incoming, choice) {
        const ids: string[] = []
        for (const file of incoming) {
          const id = crypto.randomUUID()
          ids.push(id)
          files.current.set(id, file)
          options.current.set(id, choice ?? {})
          dispatch({
            type: "add",
            item: {
              id,
              name: displayName(file),
              size: file.size,
              status: "queued",
              progress: 0,
              error: null,
            },
          })
        }
        return new Promise<void>((resolve, reject) => {
          if (ids.length === 0) {
            resolve()
            return
          }
          waiters.current.push({ ids, resolve, reject })
        })
      },
      cancel(id) {
        stopped.current.add(id)
        aborts.current.get(id)?.()
        claimed.delete(id)
        dispatch({ type: "cancel", id })
      },
      retry(id) {
        stopped.current.delete(id)
        claimed.delete(id)
        dispatch({ type: "retry", id })
      },
      dismiss(id) {
        aborts.current.get(id)?.()
        files.current.delete(id)
        options.current.delete(id)
        dispatch({ type: "dismiss", id })
      },
    }
  }, [state.items])

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>
}

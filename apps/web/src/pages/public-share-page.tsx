import { useEffect, useState, type FormEvent } from "react"
import { COMMENT_MAX, createCommentSchema } from "@transfile/shared"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { PreviewThumb } from "@/components/product/preview-thumb"
import { LiveCountdown } from "@/components/product/expiry-chip"
import { FileTypeTile } from "@/components/files/file-type-tile"
import { EmptyState, ErrorState, LoadingBlock } from "@/components/product/states"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Surface } from "@/components/ui/surface"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { friendlyError, retryAfterSeconds } from "@/lib/errors"
import { formatBytes } from "@/lib/format"
import { readJson } from "@/lib/read"
import {
  accessGrantSchema,
  commentAckSchema,
  downloadTargetSchema,
  publicContentsSchema,
  publicMetaSchema,
  type PublicFile,
} from "@/lib/schemas"
import { startDownload } from "@/lib/transfer"

function accessHeader(access: string | null): HeadersInit | undefined {
  if (!access) return undefined
  return { "X-Share-Access": access }
}

export default function PublicSharePage() {
  const params = useParams()
  const token = params.token ?? ""
  const [access, setAccess] = useState<string | null>(null)
  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [lockSeconds, setLockSeconds] = useState(0)
  const [unlocking, setUnlocking] = useState(false)

  const meta = useQuery({
    queryKey: ["public-share", token, access ? "open" : "closed"] as const,
    enabled: token.length > 0,
    retry: false,
    queryFn: () =>
      readJson(`/api/s/${encodeURIComponent(token)}`, publicMetaSchema, "Could not open this link", {
        headers: accessHeader(access),
        trackSession: false,
      }),
  })

  const ready = meta.data && meta.data.requiresPassword === false ? meta.data : null
  const needsContents = ready !== null && ready.type !== "file"
  const contents = useQuery({
    queryKey: ["public-share", token, "contents", access ? "open" : "closed"] as const,
    enabled: needsContents,
    retry: false,
    queryFn: () =>
      readJson(
        `/api/s/${encodeURIComponent(token)}/contents`,
        publicContentsSchema,
        "Could not load these files",
        { headers: accessHeader(access), trackSession: false },
      ),
  })

  useEffect(() => {
    if (lockSeconds <= 0) return
    const timer = window.setInterval(() => {
      setLockSeconds((current) => (current > 0 ? current - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [lockSeconds])

  async function unlock(event: FormEvent) {
    event.preventDefault()
    setPasswordError(null)
    setUnlocking(true)
    try {
      const grant = await readJson(
        `/api/s/${encodeURIComponent(token)}/unlock`,
        accessGrantSchema,
        "Could not unlock this link",
        { method: "POST", body: { password }, trackSession: false },
      )
      setAccess(grant.accessToken)
      setPassword("")
    } catch (error) {
      const wait = retryAfterSeconds(error)
      if (wait !== null) {
        setLockSeconds(wait)
        setPasswordError("Too many attempts. Try again later.")
      } else if (error instanceof ApiError && error.status === 401) {
        setPasswordError("That password is not right")
      } else {
        setPasswordError(friendlyError(error))
      }
    } finally {
      setUnlocking(false)
    }
  }

  if (token.length === 0) {
    return <EmptyState title="Link not found" body="This link is not valid." />
  }
  if (meta.isPending) return <LoadingBlock label="Loading link" />
  if (meta.isError) {
    if (meta.error instanceof ApiError && meta.error.status === 404) {
      return <EmptyState title="Link not found" body="This link does not exist." />
    }
    if (meta.error instanceof ApiError && meta.error.status === 410) {
      return <EmptyState title="This link is no longer available" body="It may have expired, been revoked, or reached its download limit." />
    }
    return <ErrorState message={friendlyError(meta.error)} onRetry={() => void meta.refetch()} />
  }
  if (!meta.data) return null
  if (meta.data.requiresPassword && !ready) {
    return (
      <Surface radius="card" padding={20} className="mx-auto max-w-md bg-background">
        <h1 className="display-md">This link is locked</h1>
        <form className="mt-4 grid gap-3" onSubmit={(event) => void unlock(event)}>
          <Field label="Password" htmlFor="share-password" error={passwordError ?? undefined}>
            <Input
              id="share-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {lockSeconds > 0 ? (
            <p className="text-sm text-coral" role="status">
              Try again in {lockSeconds}s
            </p>
          ) : null}
          <Button type="submit" loading={unlocking} disabled={lockSeconds > 0}>
            Unlock
          </Button>
        </form>
      </Surface>
    )
  }

  if (!ready) return null
  const files: PublicFile[] =
    ready.type === "file"
      ? [
          {
            id: "file",
            name: ready.name,
            size: ready.size,
            mime: ready.mime,
            previewable: ready.previewable,
          },
        ]
      : (contents.data?.files ?? [])
  const totalSize = files.reduce((sum, file) => sum + file.size, 0)

  return (
    <div className="grid gap-8">
      <Surface radius="card" padding={20} className="bg-background">
        <h1 className="display-lg">{ready.type === "file" ? ready.name : (ready.title ?? ready.name)}</h1>
        {ready.message ? <p className="mt-3 text-base">{ready.message}</p> : null}
        <p className="mt-3 text-sm text-muted-foreground">
          <LiveCountdown expiresAt={ready.expiresAt} />
          {" · "}
          {files.length} {files.length === 1 ? "file" : "files"} · {formatBytes(totalSize)}
        </p>
        {needsContents && contents.isPending ? <div className="mt-4"><LoadingBlock label="Loading files" /></div> : null}
        {needsContents && contents.isError ? (
          <ErrorState message="Could not load these files" onRetry={() => void contents.refetch()} />
        ) : null}
        {files.length === 0 && !contents.isPending ? (
          <EmptyState title="No files" body="This link does not have any files yet." />
        ) : null}
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 rounded-inset bg-surface p-3">
              {file.previewable ? (
                <PreviewThumb
                  name={file.name}
                  mime={file.mime}
                  enabled
                  cacheKey={`public-${file.name}-${file.size}-${file.id}`}
                  path={
                    ready.type === "file"
                      ? `/api/s/${encodeURIComponent(token)}/preview-url`
                      : `/api/s/${encodeURIComponent(token)}/preview-url?fileId=${encodeURIComponent(file.id)}`
                  }
                  headers={accessHeader(access)}
                  trackSession={false}
                />
              ) : (
                <FileTypeTile name={file.name} mime={file.mime} size="md" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-ink">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
              <Button
                type="button"
                size="sm"
                aria-label={`Download ${file.name}`}
                onClick={() => void downloadFile(token, ready.type === "file" ? null : file.id, file.name, access)}
              >
                Download
              </Button>
            </li>
          ))}
        </ul>
      </Surface>
      {ready.allowComments ? <CommentBox token={token} access={access} /> : null}
      <Surface radius="card" padding={20} className="bg-brand text-brand-foreground">
        <h2 className="display-md">Send your own files</h2>
        <Button type="button" variant="dark" className="mt-4" asChild>
          <Link to="/">Start a transfer</Link>
        </Button>
      </Surface>
    </div>
  )
}

async function downloadFile(token: string, fileId: string | null, name: string, access: string | null) {
  try {
    const path = fileId
      ? `/api/s/${encodeURIComponent(token)}/download-url?fileId=${encodeURIComponent(fileId)}`
      : `/api/s/${encodeURIComponent(token)}/download-url`
    const target = await readJson(path, downloadTargetSchema, "Could not download this file", {
      headers: accessHeader(access),
      trackSession: false,
    })
    startDownload(target.url, name)
  } catch (error) {
    if (error instanceof ApiError && error.status === 410) {
      toast.error("This link is no longer available")
      return
    }
    toast.error(friendlyError(error, "Could not download this file"))
  }
}

function CommentBox({ token, access }: { token: string; access: string | null }) {
  const [name, setName] = useState("")
  const [message, setMessage] = useState("")
  const [website, setWebsite] = useState("")
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const parsed = createCommentSchema.safeParse({
      message,
      ...(name.trim() ? { name: name.trim() } : {}),
      website,
    })
    if (!parsed.success) {
      setError("Write a note")
      return
    }
    setPending(true)
    try {
      await readJson(
        `/api/s/${encodeURIComponent(token)}/comments`,
        commentAckSchema,
        "Could not send the note",
        {
          method: "POST",
          body: parsed.data,
          headers: accessHeader(access),
          trackSession: false,
        },
      )
      setSent(true)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 429) {
        setError("Too many notes. Try again later.")
      } else {
        setError(friendlyError(caught))
      }
    } finally {
      setPending(false)
    }
  }

  if (sent) {
    return (
      <Surface radius="card" padding={20} className="bg-background">
        <p className="display-md">Sent</p>
      </Surface>
    )
  }

  return (
    <Surface radius="card" padding={20} className="bg-background">
      <h2 className="display-md">Leave a note</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Leave a note for the sender. Only they can read it.
      </p>
      <form className="mt-4 grid gap-3" onSubmit={(event) => void submit(event)}>
        <Field label="Name" htmlFor="comment-name">
          <Input
            id="comment-name"
            value={name}
            placeholder="Optional"
            maxLength={50}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Message" htmlFor="comment-message" error={error ?? undefined}>
          <Textarea
            id="comment-message"
            value={message}
            maxLength={COMMENT_MAX}
            onChange={(event) => setMessage(event.target.value)}
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          {message.length}/{COMMENT_MAX}
        </p>
        <input
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
        <Button type="submit" loading={pending}>
          Send note
        </Button>
      </form>
    </Surface>
  )
}

import { ApiError } from "@/lib/api"
import { notifyUnauthorized } from "@/lib/unauthorized"

type TransferTarget = {
  url: string
  credentials: "include" | "omit"
}

function messageFromText(text: string, fallback: string): string {
  try {
    const payload = JSON.parse(text) as unknown
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string" &&
      payload.error.trim().length > 0
    ) {
      return payload.error
    }
  } catch {
    return fallback
  }
  return fallback
}

export function transferTarget(rawUrl: string): TransferTarget {
  const parsed = new URL(rawUrl, window.location.origin)
  if (parsed.pathname.startsWith("/api/")) {
    return {
      url: `${parsed.pathname}${parsed.search}`,
      credentials: "include",
    }
  }
  return { url: parsed.toString(), credentials: "omit" }
}

export class UploadCancelled extends Error {
  constructor() {
    super("Upload cancelled")
    this.name = "UploadCancelled"
  }
}

export function uploadBytes(
  rawUrl: string,
  method: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (progress: number) => void,
): { done: Promise<void>; abort: () => void } {
  const target = transferTarget(rawUrl)
  const xhr = new XMLHttpRequest()
  const done = new Promise<void>((resolve, reject) => {
    xhr.open(method, target.url)
    xhr.withCredentials = target.credentials === "include"
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === "content-length") continue
      xhr.setRequestHeader(name, value)
    }
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onabort = () => {
      reject(new UploadCancelled())
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100)
        resolve()
        return
      }
      if (xhr.status === 401 && target.credentials === "include") notifyUnauthorized()
      reject(new ApiError(xhr.status, messageFromText(xhr.responseText, uploadFailure(xhr.status))))
    }
    xhr.onerror = () => {
      reject(new ApiError(0, "The connection dropped. You can retry."))
    }
    xhr.send(file)
  })
  return {
    done,
    abort: () => {
      xhr.abort()
    },
  }
}

function uploadFailure(status: number): string {
  if (status === 413) return "This account is out of space."
  if (status === 503) return "Guest uploads are busy right now. Try again later or sign up."
  return "Upload failed"
}

export function putFile(
  rawUrl: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (progress: number) => void,
): Promise<void> {
  return uploadBytes(rawUrl, "PUT", file, headers, onProgress).done
}

export function startDownload(rawUrl: string, fileName: string): void {
  const target = transferTarget(rawUrl)
  const anchor = document.createElement("a")
  anchor.href = target.url
  anchor.rel = "noopener"
  if (target.credentials === "include") {
    anchor.download = fileName
  } else {
    anchor.target = "_blank"
  }
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

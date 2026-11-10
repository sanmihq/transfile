import { createContext, useContext } from "react"
import type { UploadItem } from "@/features/upload/reducer"

export type UploadOptions = {
  folderId?: string | null
  expiresInHours?: number
}

export type UploadContextValue = {
  items: UploadItem[]
  progress: number
  enqueue: (files: File[], options?: UploadOptions) => Promise<void>
  cancel: (id: string) => void
  retry: (id: string) => void
  dismiss: (id: string) => void
}

export const UploadContext = createContext<UploadContextValue | null>(null)

export function useUpload(): UploadContextValue {
  const value = useContext(UploadContext)
  if (!value) {
    throw new Error("Upload queue is unavailable")
  }
  return value
}

export type UploadStatus =
  | "queued"
  | "uploading"
  | "processing"
  | "done"
  | "error"
  | "cancelled"

export type UploadItem = {
  id: string
  name: string
  size: number
  status: UploadStatus
  progress: number
  error: string | null
}

export type UploadAction =
  | { type: "add"; item: UploadItem }
  | { type: "progress"; id: string; progress: number }
  | { type: "status"; id: string; status: UploadStatus; error?: string | null }
  | { type: "cancel"; id: string }
  | { type: "retry"; id: string }
  | { type: "dismiss"; id: string }

export type UploadState = {
  items: UploadItem[]
}

export const initialUploadState: UploadState = { items: [] }

function replace(items: UploadItem[], id: string, next: Partial<UploadItem>): UploadItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...next } : item))
}

export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case "add":
      return { items: [action.item, ...state.items] }
    case "progress":
      return { items: replace(state.items, action.id, { progress: action.progress }) }
    case "status":
      return {
        items: state.items.map((item) => {
          if (item.id !== action.id) return item
          return {
            ...item,
            status: action.status,
            error: action.error === undefined ? item.error : action.error,
            progress: action.status === "done" ? 100 : item.progress,
          }
        }),
      }
    case "cancel":
      return {
        items: replace(state.items, action.id, {
          status: "cancelled",
          error: null,
        }),
      }
    case "retry":
      return {
        items: replace(state.items, action.id, {
          status: "queued",
          progress: 0,
          error: null,
        }),
      }
    case "dismiss":
      return { items: state.items.filter((item) => item.id !== action.id) }
    default:
      return state
  }
}

export function overallProgress(items: readonly UploadItem[]): number {
  const active = items.filter((item) => item.status !== "cancelled")
  const total = active.reduce((sum, item) => sum + item.size, 0)
  if (total <= 0) return 0
  const loaded = active.reduce((sum, item) => {
    const progress = item.status === "done" ? 100 : item.progress
    return sum + item.size * (progress / 100)
  }, 0)
  return Math.round((loaded / total) * 100)
}

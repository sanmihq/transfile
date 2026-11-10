import { useLocation } from "react-router-dom"
import { FileTypeTile } from "@/components/files/file-type-tile"
import { AppIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Surface } from "@/components/ui/surface"
import { useUpload } from "@/features/upload/context"
import { formatBytes } from "@/lib/format"

const labels = {
  queued: "Waiting",
  uploading: "Uploading",
  processing: "Finishing",
  done: "Done",
  error: "Failed",
  cancelled: "Cancelled",
} as const

export function UploadDock() {
  const location = useLocation()
  const upload = useUpload()
  if (location.pathname === "/" || upload.items.length === 0) return null

  return (
    <Surface
      radius="card"
      padding={12}
      className="fixed right-4 bottom-24 z-40 w-[min(100%-2rem,22rem)] bg-background shadow-soft md:bottom-6"
      aria-label="Uploads"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-bold text-ink">Uploads</p>
        <p className="text-xs text-muted-foreground">{upload.progress}%</p>
      </div>
      <ul className="grid max-h-72 gap-2 overflow-auto">
        {upload.items.map((item) => (
          <li key={item.id} className="rounded-inset bg-surface p-2">
            <div className="flex items-center gap-2">
              <FileTypeTile name={item.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(item.size)} · {item.error ?? labels[item.status]}
                </p>
              </div>
              {item.status === "uploading" || item.status === "queued" || item.status === "processing" ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Cancel ${item.name}`}
                  onClick={() => upload.cancel(item.id)}
                >
                  <AppIcon name="close" size={16} />
                </Button>
              ) : null}
              {item.status === "error" ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Retry ${item.name}`}
                  onClick={() => upload.retry(item.id)}
                >
                  <AppIcon name="upload" size={16} />
                </Button>
              ) : null}
            </div>
            {item.status === "uploading" || item.status === "processing" ? (
              <Progress className="mt-2" value={item.progress} aria-label={`${item.name} progress`} />
            ) : null}
          </li>
        ))}
      </ul>
    </Surface>
  )
}

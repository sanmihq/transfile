import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FileTypeTile } from "@/components/files/file-type-tile"
import { keys } from "@/lib/keys"
import { readJson } from "@/lib/read"
import { downloadTargetSchema } from "@/lib/schemas"

export function PreviewThumb({
  name,
  mime,
  enabled,
  path,
  cacheKey,
  headers,
  trackSession,
}: {
  name: string
  mime?: string | null
  enabled: boolean
  path: string
  cacheKey: string
  headers?: HeadersInit
  trackSession?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const preview = useQuery({
    queryKey: keys.preview(cacheKey),
    enabled: enabled && !failed,
    staleTime: 60_000,
    queryFn: () =>
      readJson(path, downloadTargetSchema, "No preview", {
        headers,
        trackSession,
      }),
  })

  if (preview.data && !failed) {
    return (
      <img
        src={preview.data.url}
        alt=""
        loading="lazy"
        className="size-16 rounded-inset object-cover"
        onError={() => setFailed(true)}
      />
    )
  }

  return <FileTypeTile name={name} mime={mime} size="md" />
}

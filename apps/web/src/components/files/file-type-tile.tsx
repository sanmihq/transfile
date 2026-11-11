import { extensionLabel, getFileKind, type FileKind } from "@/components/files/file-kind"
import { AppIcon, type AppIconName } from "@/components/icons"
import { cn } from "@/lib/utils"

const kindIcon: Record<FileKind, AppIconName> = {
  image: "fileImage",
  video: "fileVideo",
  audio: "fileAudio",
  document: "fileText",
  sheet: "fileSheet",
  slides: "fileSlides",
  archive: "fileArchive",
  code: "fileCode",
  other: "file",
}

const kindInk: Record<FileKind, string> = {
  image: "text-brand",
  video: "text-lavender-ink",
  audio: "text-mint-ink",
  document: "text-coral",
  sheet: "text-mint-ink",
  slides: "text-coral",
  archive: "text-lavender-ink",
  code: "text-ink",
  other: "text-muted-foreground",
}

const sizeClass = {
  sm: "size-10",
  md: "size-16",
  lg: "size-24",
} as const

export function FileTypeTile({
  name,
  mime,
  size = "sm",
  className,
}: {
  name: string
  mime?: string | null
  size?: keyof typeof sizeClass
  className?: string
}) {
  const kind = getFileKind(name, mime)
  return (
    <span
      aria-label={`${extensionLabel(name)} file`}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-inset bg-background",
        sizeClass[size],
        kindInk[kind],
        className,
      )}
    >
      <AppIcon name={kindIcon[kind]} />
    </span>
  )
}

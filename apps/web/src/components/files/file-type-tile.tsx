import { extensionLabel, getFileKind, type FileKind } from "@/components/files/file-kind"
import { cn } from "@/lib/utils"

const kindClass: Record<FileKind, string> = {
  image: "bg-blush text-coral",
  video: "bg-brand-soft text-brand-strong",
  audio: "bg-lavender text-lavender-ink",
  document: "bg-lemon text-ink",
  sheet: "bg-mint text-mint-ink",
  slides: "bg-blush text-coral",
  archive: "bg-lavender text-lavender-ink",
  code: "bg-surface-strong text-ink",
  other: "bg-surface text-muted-foreground",
}

const sizeClass = {
  sm: "size-10 text-[10px]",
  md: "size-16 text-sm",
  lg: "size-24 text-base",
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
      className={cn(
        "flex shrink-0 items-center justify-center rounded-inset font-bold uppercase",
        sizeClass[size],
        kindClass[kind],
        className,
      )}
    >
      {extensionLabel(name)}
    </span>
  )
}

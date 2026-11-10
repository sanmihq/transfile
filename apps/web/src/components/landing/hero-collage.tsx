import { AppIcon } from "@/components/icons"
import { FileTypeTile } from "@/components/files/file-type-tile"

const photos = [
  { className: "left-6 top-8 h-40 w-32 -rotate-6 bg-blush", delay: "0s" },
  { className: "left-28 top-2 h-44 w-36 rotate-3 bg-brand-soft", delay: "0.6s" },
  { className: "right-6 top-16 h-36 w-28 rotate-6 bg-lemon", delay: "1.2s" },
]

export function HeroCollage() {
  return (
    <div className="relative mx-auto h-80 w-full max-w-md" aria-hidden="true">
      {photos.map((photo) => (
        <div
          key={photo.className}
          className={`float-card absolute rounded-card border-4 border-white shadow-soft ${photo.className}`}
          style={{ animationDelay: photo.delay }}
        />
      ))}
      <div className="absolute bottom-10 left-4 [--parent-pad:0px] [--parent-r:var(--r-card)]">
        <FileTypeTile name="frame.tif" size="md" />
      </div>
      <div className="absolute top-6 right-16 [--parent-pad:0px] [--parent-r:var(--r-card)]">
        <FileTypeTile name="poster.psd" size="md" />
      </div>
      <div className="absolute right-2 bottom-16 [--parent-pad:0px] [--parent-r:var(--r-card)]">
        <FileTypeTile name="clip.mov" size="md" />
      </div>
      <div className="absolute bottom-4 left-1/3 flex items-center gap-2 rounded-control bg-background px-3 py-2 shadow-soft">
        <AppIcon name="folder" size={18} />
        <span className="text-xs font-bold text-ink">Album</span>
      </div>
      <div className="absolute top-24 left-8 flex items-center gap-1 rounded-control bg-background px-2 py-1 shadow-soft">
        <AppIcon name="comment" size={14} />
        <span className="text-xs font-bold text-ink">3</span>
      </div>
    </div>
  )
}

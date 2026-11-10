import { useDropzone } from "react-dropzone"
import { AppIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Surface } from "@/components/ui/surface"
import { cn } from "@/lib/utils"

export function FileDropzone({
  disabled,
  onFiles,
}: {
  disabled?: boolean
  onFiles: (files: File[]) => void
}) {
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    multiple: true,
    noClick: true,
    disabled,
    onDrop: (files) => {
      if (files.length > 0) onFiles(files)
    },
  })

  return (
    <Surface
      {...getRootProps()}
      radius="card"
      padding={12}
      className={cn("bg-background", isDragActive && "bg-brand-tint")}
    >
      <div className="rounded-inset border border-dashed border-border px-6 py-10 text-center">
        <input {...getInputProps()} />
        <AppIcon name="upload" className="mx-auto block text-muted-foreground" />
        <h2 className="display-md mt-4">
          {isDragActive ? "Drop to upload" : "Drop files here"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Up to 100 MB each. They stay in your library until you delete them.
        </p>
        <Button type="button" variant="soft" className="mt-6" disabled={disabled} onClick={open}>
          <AppIcon name="plus" size={18} />
          Choose files
        </Button>
      </div>
    </Surface>
  )
}

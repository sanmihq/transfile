import { MAX_FOLDER_DEPTH, sanitizeFolderName } from "@transfile/shared"

export type DroppedFile = {
  file: File
  folders: string[]
}

function relativePathOf(file: File): string {
  const marked = file as File & { relativePath?: unknown; path?: unknown }
  const relative = typeof marked.relativePath === "string" ? marked.relativePath : ""
  const picked = typeof file.webkitRelativePath === "string" ? file.webkitRelativePath : ""
  const disk = typeof marked.path === "string" ? marked.path : ""
  const raw = relative.length > 0 ? relative : picked.length > 0 ? picked : disk
  return raw.replace(/\\/g, "/").replace(/^\.?\//, "")
}

export function folderSegments(file: File): string[] {
  const parts = relativePathOf(file).split("/").filter((part) => part.length > 0 && part !== ".")
  parts.pop()
  const names: string[] = []
  for (const part of parts) {
    const name = sanitizeFolderName(part)
    if (name.length > 0) names.push(name)
  }
  return names
}

export function droppedFiles(files: readonly File[]): DroppedFile[] {
  return files.map((file) => ({ file, folders: folderSegments(file) }))
}

export function folderDropTooDeep(currentDepth: number, files: readonly DroppedFile[]): boolean {
  return files.some((item) => currentDepth + item.folders.length > MAX_FOLDER_DEPTH)
}

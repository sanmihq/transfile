export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sheet"
  | "slides"
  | "archive"
  | "code"
  | "other"

const imageExt = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "tif", "tiff", "psd", "ai", "bmp", "svg"])
const videoExt = new Set(["mp4", "mov", "webm", "mkv", "avi"])
const audioExt = new Set(["mp3", "wav", "aac", "flac", "m4a", "ogg"])
const documentExt = new Set(["pdf", "doc", "docx", "rtf", "odt"])
const sheetExt = new Set(["xls", "xlsx", "csv", "ods"])
const slidesExt = new Set(["ppt", "pptx", "key"])
const archiveExt = new Set(["zip", "rar", "7z", "tar", "gz"])
const codeExt = new Set(["txt", "md", "json", "ts", "tsx", "js", "jsx", "css", "html", "py", "go", "rs"])

/**
 * Examples:
 * getFileKind("shot.psd", "") => image
 * getFileKind("clip.mov", "video/quicktime") => video
 * getFileKind("song.mp3", "audio/mpeg") => audio
 * getFileKind("brief.pdf", "application/pdf") => document
 * getFileKind("plan.xlsx", "") => sheet
 * getFileKind("deck.pptx", "") => slides
 * getFileKind("backup.zip", "") => archive
 * getFileKind("main.ts", "text/plain") => code
 * getFileKind("blob.bin", "application/octet-stream") => other
 */
export function getFileKind(name: string, mime: string | null | undefined): FileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  if (imageExt.has(ext)) return "image"
  if (videoExt.has(ext)) return "video"
  if (audioExt.has(ext)) return "audio"
  if (documentExt.has(ext)) return "document"
  if (sheetExt.has(ext)) return "sheet"
  if (slidesExt.has(ext)) return "slides"
  if (archiveExt.has(ext)) return "archive"
  if (codeExt.has(ext)) return "code"

  const type = mime ?? ""
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("video/")) return "video"
  if (type.startsWith("audio/")) return "audio"
  if (type === "application/pdf" || type.includes("word")) return "document"
  if (type.includes("sheet") || type.includes("excel")) return "sheet"
  if (type.includes("presentation") || type.includes("powerpoint")) return "slides"
  if (type.includes("zip") || type.includes("compressed")) return "archive"
  if (type.startsWith("text/")) return "code"
  return "other"
}

export function extensionLabel(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop() : ""
  const clean = (ext ?? "").toLowerCase()
  return clean.length > 0 ? `.${clean}` : ".file"
}

export function attachmentContentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName);
  const ascii =
    fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "file";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function inlineContentDisposition(fileName: string): string {
  return attachmentContentDisposition(fileName).replace(/^attachment/, "inline");
}

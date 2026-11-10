export const keys = {
  me: ["me"] as const,
  usage: ["usage"] as const,
  library: ["library"] as const,
  folder: (parentId: string | null) => ["library", "folder", parentId] as const,
  folderAll: ["library", "folders"] as const,
  shares: ["shares"] as const,
  activity: (shareId: string) => ["shares", shareId, "activity"] as const,
  comments: (shareId: string) => ["comments", shareId] as const,
  commentFeed: ["comments", "feed"] as const,
  notifications: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
  preview: (fileId: string) => ["preview", fileId] as const,
}

import { z } from "zod"

const dateValue = z.string()

export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
})

export const usageSchema = z.object({
  used: z.number(),
  quota: z.number(),
  fileCount: z.number(),
})

export const ownedFileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  size: z.number(),
  mime: z.string().nullable(),
  folderId: z.string().nullable(),
  createdAt: dateValue,
  expiresAt: dateValue.nullable(),
})

export const ownedFileListSchema = z.array(ownedFileSchema)

export const uploadTargetSchema = z.object({
  file: z.object({
    id: z.string().min(1),
    expiresAt: dateValue.nullable().optional(),
  }),
  upload: z.object({
    method: z.literal("PUT"),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()),
  }),
})

export const downloadTargetSchema = z.object({
  url: z.string().min(1),
})

export const folderSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  parentId: z.string().nullable(),
  createdAt: dateValue.optional(),
})

export const folderListSchema = z.object({
  folder: z.object({
    id: z.string(),
    name: z.string(),
    parentId: z.string().nullable(),
  }).nullable(),
  breadcrumbs: z.array(z.object({ id: z.string(), name: z.string() })),
  folders: z.array(folderSchema),
  files: z.array(ownedFileSchema),
})

export const folderAllSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    parentId: z.string().nullable(),
  }),
)

export const transferCreatedSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
})

export const shareSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["file", "folder", "transfer"]),
  kind: z.enum(["file", "folder", "transfer"]),
  targetName: z.string(),
  hasPassword: z.boolean(),
  expiresAt: dateValue,
  maxDownloads: z.number().nullable(),
  downloadCount: z.number(),
  createdAt: dateValue,
  status: z.enum(["active", "expired", "revoked", "exhausted"]),
  url: z.string().min(1),
  fileCount: z.number(),
  totalSize: z.number(),
  allowComments: z.boolean(),
  message: z.string().nullable(),
  commentCount: z.number(),
  unreadComments: z.number(),
})

export const shareListSchema = z.array(shareSchema)

export const shareCreatedSchema = z.object({
  share: shareSchema,
  url: z.string().min(1),
})

export const activityItemSchema = z.object({
  id: z.string(),
  type: z.enum(["opened", "unlocked", "unlock_failed", "downloaded", "commented"]),
  fileId: z.string().nullable(),
  country: z.string().nullable(),
  createdAt: dateValue,
})

export const activityListSchema = z.object({
  items: z.array(activityItemSchema),
})

export const commentSchema = z.object({
  id: z.string(),
  shareId: z.string(),
  fileId: z.string().nullable(),
  authorName: z.string().nullable(),
  body: z.string(),
  readAt: dateValue.nullable(),
  createdAt: dateValue,
  shareTitle: z.string(),
  fileName: z.string().nullable(),
})

export const commentListSchema = z.object({
  items: z.array(commentSchema),
})

export const notificationSchema = z.object({
  id: z.string(),
  type: z.enum([
    "share_opened",
    "file_downloaded",
    "share_locked",
    "comment_received",
    "share_expiring",
    "share_expired",
    "files_expired",
  ]),
  title: z.string(),
  body: z.string().nullable(),
  shareId: z.string().nullable(),
  fileId: z.string().nullable(),
  commentId: z.string().nullable(),
  readAt: dateValue.nullable(),
  createdAt: dateValue,
})

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number(),
})

export const unreadCountSchema = z.object({
  count: z.number(),
})

const publicBase = {
  expiresAt: dateValue,
  remainingDownloads: z.number().nullable(),
  allowComments: z.boolean(),
  message: z.string().nullable(),
}

export const publicMetaSchema = z.union([
  z.object({
    requiresPassword: z.literal(true),
    expiresAt: dateValue,
  }),
  z.object({
    requiresPassword: z.literal(false),
    type: z.literal("file"),
    name: z.string(),
    size: z.number(),
    mime: z.string().nullable(),
    previewable: z.boolean(),
    ...publicBase,
  }),
  z.object({
    requiresPassword: z.literal(false),
    type: z.enum(["folder", "transfer"]),
    name: z.string(),
    title: z.string().optional(),
    fileCount: z.number(),
    ...publicBase,
  }),
])

export const publicContentsSchema = z.object({
  folder: z.object({ id: z.string(), name: z.string() }),
  breadcrumbs: z.array(z.object({ id: z.string(), name: z.string() })),
  folders: z.array(z.object({ id: z.string(), name: z.string() })),
  files: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      size: z.number(),
      mime: z.string().nullable(),
      previewable: z.boolean(),
    }),
  ),
})

export const accessGrantSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: dateValue,
})

export const lockoutSchema = z.object({
  error: z.string().optional(),
  retryAfterSeconds: z.number().optional(),
})

export const commentAckSchema = z.object({
  ok: z.literal(true),
})

export type Me = z.infer<typeof meSchema>
export type Usage = z.infer<typeof usageSchema>
export type OwnedFile = z.infer<typeof ownedFileSchema>
export type FolderRow = z.infer<typeof folderSchema>
export type FolderList = z.infer<typeof folderListSchema>
export type ShareRecord = z.infer<typeof shareSchema>
export type ActivityItem = z.infer<typeof activityItemSchema>
export type CommentRecord = z.infer<typeof commentSchema>
export type NotificationRecord = z.infer<typeof notificationSchema>
export type PublicMeta = z.infer<typeof publicMetaSchema>
export type PublicFile = z.infer<typeof publicContentsSchema>["files"][number]

import { z } from "zod";
import {
  COMMENT_MAX,
  COMMENT_NAME_MAX,
  DEFAULT_EXPIRY_HOURS,
  MAX_EXPIRY_HOURS,
  MAX_FILE_BYTES,
  MAX_FILENAME_LENGTH,
  MAX_FOLDER_NAME_LENGTH,
  MAX_SHARE_DOWNLOADS,
  MESSAGE_MAX,
  SHARE_PASSWORD_MAX,
  SHARE_PASSWORD_MIN,
  TRANSFER_TITLE_MAX,
} from "./constants";

const fileNameSchema = z.string().trim().min(1).max(MAX_FILENAME_LENGTH);
const folderIdSchema = z.string().min(1).nullable();
const expiryHoursSchema = z.number().int().min(1).max(MAX_EXPIRY_HOURS);

export const uploadRequestSchema = z.object({
  name: fileNameSchema,
  size: z.number().int().min(1).max(MAX_FILE_BYTES),
  mime: z.string().max(255).optional(),
  folderId: folderIdSchema.optional(),
  expiresInHours: expiryHoursSchema.optional(),
});

export const updateFileSchema = z
  .object({
    name: fileNameSchema.optional(),
    folderId: folderIdSchema.optional(),
    expiresInHours: expiryHoursSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.folderId !== undefined ||
      value.expiresInHours !== undefined,
    {
      message: "At least one field is required",
    },
  );

export const listFilesQuerySchema = z.object({
  folderId: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value === "root" ? null : value,
    ),
});

const folderNameSchema = z.string().trim().min(1).max(MAX_FOLDER_NAME_LENGTH);

export const createFolderSchema = z.object({
  name: folderNameSchema,
  parentId: folderIdSchema.optional(),
});

export const updateFolderSchema = z
  .object({
    name: folderNameSchema.optional(),
    parentId: folderIdSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.parentId !== undefined, {
    message: "At least one field is required",
  });

export const listFolderQuerySchema = z.object({
  parentId: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value === "root" ? null : value,
    ),
});

export function sanitizeFolderName(name: string): string {
  const stripped = name
    .replace(/[/\\]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FOLDER_NAME_LENGTH);
  if (stripped === "." || stripped === "..") {
    return "";
  }
  return stripped;
}

export function sanitizeFileName(name: string): string {
  const stripped = name
    .replace(/[/\\]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FILENAME_LENGTH);
  return stripped.length > 0 ? stripped : "file";
}

const sharePasswordSchema = z
  .string()
  .min(SHARE_PASSWORD_MIN)
  .max(SHARE_PASSWORD_MAX);
const shareDownloadLimitSchema = z.number().int().min(1).max(MAX_SHARE_DOWNLOADS);
const shareMessageSchema = z.string().trim().max(MESSAGE_MAX);

export const createShareSchema = z
  .object({
    fileId: z.string().min(1).optional(),
    folderId: z.string().min(1).optional(),
    password: sharePasswordSchema.optional(),
    expiresInHours: expiryHoursSchema.default(DEFAULT_EXPIRY_HOURS),
    maxDownloads: shareDownloadLimitSchema.optional(),
    allowComments: z.boolean().default(true),
    message: shareMessageSchema.optional(),
  })
  .refine(
    (value) => (value.fileId !== undefined) !== (value.folderId !== undefined),
    { message: "Exactly one of fileId or folderId is required" },
  );

export const updateShareSchema = z
  .object({
    expiresInHours: expiryHoursSchema.optional(),
    maxDownloads: shareDownloadLimitSchema.nullable().optional(),
    password: sharePasswordSchema.nullable().optional(),
    allowComments: z.boolean().optional(),
    message: shareMessageSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.expiresInHours !== undefined ||
      value.maxDownloads !== undefined ||
      value.password !== undefined ||
      value.allowComments !== undefined ||
      value.message !== undefined,
    { message: "At least one field is required" },
  );

export const createTransferSchema = z.object({
  title: z.string().trim().min(1).max(TRANSFER_TITLE_MAX).optional(),
  message: shareMessageSchema.optional(),
});

export const createCommentSchema = z.object({
  message: z.string().trim().min(1).max(COMMENT_MAX),
  name: z.string().trim().min(1).max(COMMENT_NAME_MAX).optional(),
  fileId: z.string().min(1).optional(),
  website: z.string().optional(),
});

const cursorSchema = z
  .string()
  .optional()
  .refine((value) => value === undefined || !Number.isNaN(Date.parse(value)), {
    message: "Invalid cursor",
  });

const pageLimitSchema = z.coerce.number().int().min(1).max(50).default(20);

export const notificationListQuerySchema = z.object({
  limit: pageLimitSchema,
  before: cursorSchema,
});

export const notificationReadSchema = z.object({
  ids: z.array(z.string().min(1)).max(100).optional(),
});

export const commentListQuerySchema = z.object({
  shareId: z.string().min(1).optional(),
  fileId: z.string().min(1).optional(),
  unread: z.enum(["true", "false"]).optional(),
  limit: pageLimitSchema,
  before: cursorSchema,
});

export const commentReadSchema = z.object({
  ids: z.array(z.string().min(1)).max(100).optional(),
});

export const activityQuerySchema = z.object({
  limit: pageLimitSchema,
  before: cursorSchema,
});

export const previewQuerySchema = z.object({
  fileId: z.string().min(1).optional(),
});

export const unlockSchema = z.object({
  password: z.string().min(1).max(SHARE_PASSWORD_MAX),
});

export const publicContentsQuerySchema = z.object({
  folderId: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value === "root" ? null : value,
    ),
});

export const publicDownloadQuerySchema = z.object({
  fileId: z.string().min(1).optional(),
});

export const shareTokenSchema = z.string().min(1).max(2048);

import { z } from "zod";
import {
  DEFAULT_SHARE_HOURS,
  MAX_FILE_BYTES,
  MAX_FILE_EXPIRY_DAYS,
  MAX_FILENAME_LENGTH,
  MAX_FOLDER_NAME_LENGTH,
  MAX_SHARE_DOWNLOADS,
  MAX_SHARE_HOURS,
  SHARE_PASSWORD_MAX,
  SHARE_PASSWORD_MIN,
} from "./constants";

const fileNameSchema = z.string().trim().min(1).max(MAX_FILENAME_LENGTH);
const folderIdSchema = z.string().min(1).nullable();

const fileExpirySchema = z.number().int().min(1).max(MAX_FILE_EXPIRY_DAYS);

export const uploadRequestSchema = z.object({
  name: fileNameSchema,
  size: z.number().int().min(1).max(MAX_FILE_BYTES),
  mime: z.string().max(255).optional(),
  folderId: folderIdSchema.optional(),
  expiresInDays: fileExpirySchema.optional(),
});

export const updateFileSchema = z
  .object({
    name: fileNameSchema.optional(),
    folderId: folderIdSchema.optional(),
    expiresInDays: fileExpirySchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.folderId !== undefined ||
      value.expiresInDays !== undefined,
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
const shareHoursSchema = z.number().int().min(1).max(MAX_SHARE_HOURS);
const shareDownloadLimitSchema = z.number().int().min(1).max(MAX_SHARE_DOWNLOADS);

export const createShareSchema = z
  .object({
    fileId: z.string().min(1).optional(),
    folderId: z.string().min(1).optional(),
    password: sharePasswordSchema.optional(),
    expiresInHours: shareHoursSchema.default(DEFAULT_SHARE_HOURS),
    maxDownloads: shareDownloadLimitSchema.optional(),
  })
  .refine(
    (value) => (value.fileId !== undefined) !== (value.folderId !== undefined),
    { message: "Exactly one of fileId or folderId is required" },
  );

export const updateShareSchema = z
  .object({
    expiresInHours: shareHoursSchema.optional(),
    maxDownloads: shareDownloadLimitSchema.nullable().optional(),
    password: sharePasswordSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.expiresInHours !== undefined ||
      value.maxDownloads !== undefined ||
      value.password !== undefined,
    { message: "At least one field is required" },
  );

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

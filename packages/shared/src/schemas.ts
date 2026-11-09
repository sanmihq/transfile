import { z } from "zod";
import { MAX_FILE_BYTES, MAX_FILENAME_LENGTH } from "./constants";

const fileNameSchema = z.string().trim().min(1).max(MAX_FILENAME_LENGTH);
const folderIdSchema = z.string().min(1).nullable();

export const uploadRequestSchema = z.object({
  name: fileNameSchema,
  size: z.number().int().min(1).max(MAX_FILE_BYTES),
  mime: z.string().max(255).optional(),
  folderId: folderIdSchema.optional(),
});

export const updateFileSchema = z
  .object({
    name: fileNameSchema.optional(),
    folderId: folderIdSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.folderId !== undefined, {
    message: "At least one field is required",
  });

export const listFilesQuerySchema = z.object({
  folderId: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value === "root" ? null : value,
    ),
});

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

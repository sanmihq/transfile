import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

const now = () => new Date();

export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(now),
  },
  (table) => [
    index("folders_user_id_idx").on(table.userId),
    index("folders_parent_id_idx").on(table.parentId),
  ],
);

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    folderId: text("folder_id"),
    name: text("name").notNull(),
    r2Key: text("r2_key").notNull().unique(),
    size: integer("size").notNull().default(0),
    mime: text("mime"),
    status: text("status", { enum: ["pending", "ready"] })
      .notNull()
      .default("pending"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(now),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    index("files_user_id_idx").on(table.userId),
    index("files_folder_id_idx").on(table.folderId),
  ],
);

// A share targets exactly one of fileId or folderId. Enforced in application
// code with Zod, not in SQL.
export const shares = sqliteTable(
  "shares",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fileId: text("file_id").references(() => files.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => folders.id, {
      onDelete: "cascade",
    }),
    token: text("token").notNull().unique(),
    passwordHash: text("password_hash"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    maxDownloads: integer("max_downloads"),
    downloadCount: integer("download_count").notNull().default(0),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(now),
  },
  (table) => [
    index("shares_user_id_idx").on(table.userId),
    index("shares_expires_at_idx").on(table.expiresAt),
  ],
);

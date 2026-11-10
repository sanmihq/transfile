import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
    kind: text("kind", { enum: ["folder", "transfer"] })
      .notNull()
      .default("folder"),
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
    expiresAt: integer("expires_at", { mode: "timestamp" }),
  },
  (table) => [
    index("files_user_id_idx").on(table.userId),
    index("files_folder_id_idx").on(table.folderId),
    index("files_expires_at_idx").on(table.expiresAt),
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
    allowComments: integer("allow_comments", { mode: "boolean" }).notNull().default(true),
    message: text("message"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(now),
  },
  (table) => [
    index("shares_user_id_idx").on(table.userId),
    index("shares_expires_at_idx").on(table.expiresAt),
  ],
);

export const shareComments = sqliteTable(
  "share_comments",
  {
    id: text("id").primaryKey(),
    shareId: text("share_id")
      .notNull()
      .references(() => shares.id, { onDelete: "cascade" }),
    fileId: text("file_id"),
    authorName: text("author_name"),
    body: text("body").notNull(),
    visitorHash: text("visitor_hash").notNull(),
    readAt: integer("read_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(now),
  },
  (table) => [
    index("share_comments_share_id_idx").on(table.shareId),
    index("share_comments_visitor_idx").on(table.shareId, table.visitorHash, table.createdAt),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "share_opened",
        "file_downloaded",
        "share_locked",
        "comment_received",
        "share_expiring",
        "share_expired",
        "files_expired",
      ],
    }).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    shareId: text("share_id"),
    fileId: text("file_id"),
    commentId: text("comment_id"),
    dedupeKey: text("dedupe_key"),
    readAt: integer("read_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(now),
  },
  (table) => [
    uniqueIndex("notifications_user_dedupe_idx").on(table.userId, table.dedupeKey),
    index("notifications_user_read_idx").on(table.userId, table.readAt, table.createdAt),
  ],
);

export const shareEvents = sqliteTable(
  "share_events",
  {
    id: text("id").primaryKey(),
    shareId: text("share_id")
      .notNull()
      .references(() => shares.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["opened", "unlocked", "unlock_failed", "downloaded", "commented"],
    }).notNull(),
    fileId: text("file_id"),
    country: text("country"),
    visitorHash: text("visitor_hash"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(now),
  },
  (table) => [index("share_events_share_created_idx").on(table.shareId, table.createdAt)],
);

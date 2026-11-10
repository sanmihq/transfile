import { and, eq, isNull } from "drizzle-orm";
import { files, shares } from "../db/schema";
import { notExpired } from "./files";
import type { FolderDatabase } from "./folders";
import { getOwnedFolder, getSubtreeIds } from "./folders";

type ShareRow = typeof shares.$inferSelect;
type FileRow = typeof files.$inferSelect;

export type ShareTarget =
  | { type: "file"; file: FileRow }
  | { type: "folder"; folder: { id: string; name: string; parentId: string | null } };

export type ShareState = "active" | "expired" | "revoked" | "exhausted";

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function loadShareByToken(
  db: FolderDatabase,
  token: string,
): Promise<ShareRow | null> {
  const [share] = await db.select().from(shares).where(eq(shares.token, token)).limit(1);
  return share ?? null;
}

export function getShareState(share: ShareRow, now: Date): ShareState {
  if (share.revokedAt !== null) {
    return "revoked";
  }
  if (share.expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  if (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads) {
    return "exhausted";
  }
  return "active";
}

export async function resolveTarget(
  db: FolderDatabase,
  share: ShareRow,
): Promise<ShareTarget | null> {
  if (share.fileId !== null) {
    const [file] = await db
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, share.fileId),
          eq(files.userId, share.userId),
          eq(files.status, "ready"),
          isNull(files.deletedAt),
          notExpired(),
        ),
      )
      .limit(1);
    return file === undefined ? null : { type: "file", file };
  }
  if (share.folderId === null) {
    return null;
  }
  const folder = await getOwnedFolder(db, share.userId, share.folderId);
  return folder === null
    ? null
    : { type: "folder", folder: { id: folder.id, name: folder.name, parentId: folder.parentId } };
}

export async function isInSharedSubtree(
  db: FolderDatabase,
  share: ShareRow,
  folderId: string,
): Promise<boolean> {
  if (share.folderId === null) {
    return false;
  }
  const ids = await getSubtreeIds(db, share.userId, share.folderId);
  return ids.includes(folderId);
}

export async function passwordVersion(share: ShareRow): Promise<string> {
  if (share.passwordHash === null) {
    return "none";
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(share.passwordHash));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let index = 0; index < 8; index += 1) {
    hex += (bytes[index] ?? 0).toString(16).padStart(2, "0");
  }
  return hex;
}

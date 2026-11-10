import { eq } from "drizzle-orm";
import { notifications, user } from "../db/schema";
import type { FolderDatabase } from "./folders";

export type NotificationType =
  | "share_opened"
  | "file_downloaded"
  | "share_locked"
  | "comment_received"
  | "share_expiring"
  | "share_expired"
  | "files_expired";

export async function notify(
  db: FolderDatabase,
  userId: string,
  input: {
    type: NotificationType;
    title: string;
    body?: string | null;
    shareId?: string | null;
    fileId?: string | null;
    commentId?: string | null;
    dedupeKey: string;
  },
): Promise<void> {
  const [owner] = await db
    .select({ isAnonymous: user.isAnonymous })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!owner || owner.isAnonymous === true) {
    return;
  }
  await db
    .insert(notifications)
    .values({
      id: crypto.randomUUID(),
      userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      shareId: input.shareId ?? null,
      fileId: input.fileId ?? null,
      commentId: input.commentId ?? null,
      dedupeKey: input.dedupeKey,
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] });
}

export function hourBucket(now: Date): number {
  return Math.floor(now.getTime() / (60 * 60 * 1000));
}

export function minuteBucket(now: Date): number {
  return Math.floor(now.getTime() / (60 * 1000));
}

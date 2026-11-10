import { and, eq, gt } from "drizzle-orm";
import { shareEvents } from "../db/schema";
import type { FolderDatabase } from "./folders";
import { ownerIsGuest } from "./privacy";

export type ShareEventType = "opened" | "unlocked" | "unlock_failed" | "downloaded" | "commented";

const HOUR_MS = 60 * 60 * 1000;

export async function recordEvent(
  db: FolderDatabase,
  input: {
    ownerId: string;
    shareId: string;
    type: ShareEventType;
    fileId?: string | null;
    country: string | null;
    visitorHash?: string | null;
    now?: Date;
  },
): Promise<void> {
  if (await ownerIsGuest(db, input.ownerId)) {
    return;
  }
  const now = input.now ?? new Date();
  if (input.type === "opened" && input.visitorHash) {
    const [existing] = await db
      .select({ id: shareEvents.id })
      .from(shareEvents)
      .where(
        and(
          eq(shareEvents.shareId, input.shareId),
          eq(shareEvents.type, "opened"),
          eq(shareEvents.visitorHash, input.visitorHash),
          gt(shareEvents.createdAt, new Date(now.getTime() - HOUR_MS)),
        ),
      )
      .limit(1);
    if (existing) {
      return;
    }
  }
  await db.insert(shareEvents).values({
    id: crypto.randomUUID(),
    shareId: input.shareId,
    type: input.type,
    fileId: input.fileId ?? null,
    country: input.country,
    visitorHash: input.type === "opened" ? (input.visitorHash ?? null) : null,
    createdAt: now,
  });
}

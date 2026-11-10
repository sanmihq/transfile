import {
  EVENT_RETENTION_DAYS,
  GUEST_USER_RETENTION_DAYS,
  NOTIFICATION_RETENTION_DAYS,
  PENDING_UPLOAD_TTL_HOURS,
  SHARE_RETENTION_AFTER_END_DAYS,
  SOFT_DELETE_RETENTION_DAYS,
} from "@transfile/shared";
import { and, asc, eq, gte, gt, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import { files, folders, notifications, session, shareEvents, shares, user, verification } from "../db/schema";
import type { FolderDatabase } from "../lib/folders";
import { hourBucket, notify } from "../lib/notify";
import { getStorage } from "../storage";
import type { Storage } from "../storage/types";

// Free-plan subrequest and CPU limits are unverified. Keep these easy to change.
export const MAX_STORAGE_DELETES_PER_RUN = 40;
export const MAX_ROWS_PER_QUERY = 100;

const ID_CHUNK = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type CleanupReport = {
  expiredFiles: number;
  purgedFiles: number;
  purgedPending: number;
  deletedShares: number;
  deletedSessions: number;
  deletedVerifications: number;
  storageDeleteFailures: number;
  expiringNotifications: number;
  expiredShareNotifications: number;
  filesExpiredNotifications: number;
  purgedNotifications: number;
  purgedEvents: number;
  deletedEmptyTransfers: number;
  deletedGuestUsers: number;
  moreWork: boolean;
};

type StoredFile = { id: string; r2Key: string };

function changedRows(result: unknown): number {
  if (Array.isArray(result)) {
    return result.length;
  }
  if (typeof result !== "object" || result === null || !("meta" in result)) {
    return 0;
  }
  const meta = result.meta;
  if (typeof meta !== "object" || meta === null || !("changes" in meta)) {
    return 0;
  }
  return typeof meta.changes === "number" ? meta.changes : 0;
}

function failureText(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error";
  return message.replace(/https?:\/\/\S+/gi, "[redacted]");
}

function logPhaseFailure(phase: string, error: unknown): void {
  console.error(`cleanup phase ${phase} failed`, failureText(error));
}

async function deleteFileRows(db: FolderDatabase, ids: readonly string[]): Promise<void> {
  const statements: BatchItem<"sqlite">[] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const chunk = ids.slice(index, index + ID_CHUNK);
    statements.push(db.delete(files).where(inArray(files.id, chunk)));
  }
  const [first, ...rest] = statements;
  if (!first) {
    return;
  }
  await db.batch([first, ...rest]);
}

async function deleteStoredFiles(
  db: FolderDatabase,
  storage: Storage,
  rows: readonly StoredFile[],
  phase: string,
  report: CleanupReport,
): Promise<number> {
  const deletedIds: string[] = [];
  for (const row of rows) {
    try {
      await storage.delete(row.r2Key);
      deletedIds.push(row.id);
    } catch (error) {
      report.storageDeleteFailures += 1;
      logPhaseFailure(phase, error);
    }
  }
  if (deletedIds.length === 0) {
    return 0;
  }
  await deleteFileRows(db, deletedIds);
  return deletedIds.length;
}

export async function runCleanup(
  env: Env,
  now: Date,
  storageOverride?: Storage,
): Promise<CleanupReport> {
  const report: CleanupReport = {
    expiredFiles: 0,
    purgedFiles: 0,
    purgedPending: 0,
    deletedShares: 0,
    deletedSessions: 0,
    deletedVerifications: 0,
    storageDeleteFailures: 0,
    expiringNotifications: 0,
    expiredShareNotifications: 0,
    filesExpiredNotifications: 0,
    purgedNotifications: 0,
    purgedEvents: 0,
    deletedEmptyTransfers: 0,
    deletedGuestUsers: 0,
    moreWork: false,
  };
  const db = drizzle(env.DB);
  let storageResult: { ok: true; storage: Storage } | { ok: false; error: unknown } | undefined;
  let storageAttempts = 0;

  function loadStorage(): Storage {
    if (storageOverride) {
      return storageOverride;
    }
    if (storageResult === undefined) {
      try {
        storageResult = { ok: true, storage: getStorage(env) };
      } catch (error) {
        storageResult = { ok: false, error };
      }
    }
    if (!storageResult.ok) {
      throw storageResult.error;
    }
    return storageResult.storage;
  }

  try {
    const expired = await db
      .update(files)
      .set({ deletedAt: now })
      .where(
        and(
          isNull(files.deletedAt),
          eq(files.status, "ready"),
          isNotNull(files.expiresAt),
          lte(files.expiresAt, now),
        ),
      );
    report.expiredFiles = changedRows(expired);
  } catch (error) {
    logPhaseFailure("expireFiles", error);
  }

  try {
    const owners = await db
      .select({ userId: files.userId })
      .from(files)
      .innerJoin(user, eq(files.userId, user.id))
      .where(
        and(
          gte(files.deletedAt, new Date(now.getTime() - 2000)),
          lte(files.deletedAt, new Date(now.getTime() + 2000)),
          eq(files.status, "ready"),
          eq(user.isAnonymous, false),
        ),
      )
      .groupBy(files.userId)
      .limit(MAX_ROWS_PER_QUERY);
    for (const owner of owners) {
      await notify(db, owner.userId, {
        type: "files_expired",
        title: "Some files expired",
        dedupeKey: `fexp:${owner.userId}:${hourBucket(now)}`,
      });
      report.filesExpiredNotifications += 1;
    }
    if (owners.length >= MAX_ROWS_PER_QUERY) {
      report.moreWork = true;
    }
  } catch (error) {
    logPhaseFailure("filesExpiredNotice", error);
  }

  const retentionCutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_DAYS * DAY_MS);
  const phase2Limit = Math.min(MAX_STORAGE_DELETES_PER_RUN, MAX_ROWS_PER_QUERY);
  try {
    const rows = await db
      .select({ id: files.id, r2Key: files.r2Key })
      .from(files)
      .where(and(isNotNull(files.deletedAt), lte(files.deletedAt, retentionCutoff)))
      .orderBy(asc(files.deletedAt))
      .limit(phase2Limit);
    if (rows.length > 0) {
      const storage = loadStorage();
      storageAttempts += rows.length;
      report.purgedFiles = await deleteStoredFiles(db, storage, rows, "purgeDeletedFiles", report);
    }
  } catch (error) {
    logPhaseFailure("purgeDeletedFiles", error);
  }

  const pendingCutoff = new Date(now.getTime() - PENDING_UPLOAD_TTL_HOURS * HOUR_MS);
  const phase3Limit = Math.min(
    Math.max(0, MAX_STORAGE_DELETES_PER_RUN - storageAttempts),
    MAX_ROWS_PER_QUERY,
  );
  try {
    if (phase3Limit > 0) {
      const rows = await db
        .select({ id: files.id, r2Key: files.r2Key })
        .from(files)
        .where(
          and(
            eq(files.status, "pending"),
            isNull(files.deletedAt),
            lte(files.createdAt, pendingCutoff),
          ),
        )
        .orderBy(asc(files.createdAt))
        .limit(phase3Limit);
      if (rows.length > 0) {
        const storage = loadStorage();
        storageAttempts += rows.length;
        report.purgedPending = await deleteStoredFiles(
          db,
          storage,
          rows,
          "purgeStalePending",
          report,
        );
      }
    }
  } catch (error) {
    logPhaseFailure("purgeStalePending", error);
  }

  const shareCutoff = new Date(now.getTime() - SHARE_RETENTION_AFTER_END_DAYS * DAY_MS);
  try {
    const ended = or(
      lte(shares.expiresAt, shareCutoff),
      and(isNotNull(shares.revokedAt), lte(shares.revokedAt, shareCutoff)),
    );
    if (ended === undefined) {
      throw new Error("Failed to build share cleanup condition");
    }
    const deleted = await db.delete(shares).where(ended);
    report.deletedShares = changedRows(deleted);
  } catch (error) {
    logPhaseFailure("purgeEndedShares", error);
  }

  // session.expiresAt and verification.expiresAt are timestamp_ms. Pass Date objects.
  try {
    const deletedSessions = await db.delete(session).where(lt(session.expiresAt, now));
    report.deletedSessions = changedRows(deletedSessions);
    const deletedVerifications = await db
      .delete(verification)
      .where(lt(verification.expiresAt, now));
    report.deletedVerifications = changedRows(deletedVerifications);
  } catch (error) {
    logPhaseFailure("purgeAuthJunk", error);
  }

  const soon = new Date(now.getTime() + 6 * HOUR_MS);
  const recent = new Date(now.getTime() - 2 * HOUR_MS);
  try {
    const expiring = await db
      .select({ id: shares.id, userId: shares.userId })
      .from(shares)
      .innerJoin(user, eq(shares.userId, user.id))
      .where(
        and(
          isNull(shares.revokedAt),
          gt(shares.expiresAt, now),
          lte(shares.expiresAt, soon),
          eq(user.isAnonymous, false),
        ),
      )
      .limit(MAX_ROWS_PER_QUERY);
    for (const share of expiring) {
      await notify(db, share.userId, {
        type: "share_expiring",
        title: "A link expires soon",
        shareId: share.id,
        dedupeKey: `exp-soon:${share.id}`,
      });
      report.expiringNotifications += 1;
    }
    const expiredShares = await db
      .select({ id: shares.id, userId: shares.userId })
      .from(shares)
      .innerJoin(user, eq(shares.userId, user.id))
      .where(
        and(
          isNull(shares.revokedAt),
          lte(shares.expiresAt, now),
          gt(shares.expiresAt, recent),
          eq(user.isAnonymous, false),
        ),
      )
      .limit(MAX_ROWS_PER_QUERY);
    for (const share of expiredShares) {
      await notify(db, share.userId, {
        type: "share_expired",
        title: "A link expired",
        shareId: share.id,
        dedupeKey: `expired:${share.id}`,
      });
      report.expiredShareNotifications += 1;
    }
  } catch (error) {
    logPhaseFailure("shareExpiryNotices", error);
  }

  const notificationCutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
  const eventCutoff = new Date(now.getTime() - EVENT_RETENTION_DAYS * DAY_MS);
  try {
    const oldNotifications = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(lte(notifications.createdAt, notificationCutoff))
      .limit(MAX_ROWS_PER_QUERY);
    if (oldNotifications.length > 0) {
      await db.delete(notifications).where(
        inArray(
          notifications.id,
          oldNotifications.map((row) => row.id),
        ),
      );
      report.purgedNotifications = oldNotifications.length;
    }
    const oldEvents = await db
      .select({ id: shareEvents.id })
      .from(shareEvents)
      .where(lte(shareEvents.createdAt, eventCutoff))
      .limit(MAX_ROWS_PER_QUERY);
    if (oldEvents.length > 0) {
      await db.delete(shareEvents).where(
        inArray(
          shareEvents.id,
          oldEvents.map((row) => row.id),
        ),
      );
      report.purgedEvents = oldEvents.length;
    }
  } catch (error) {
    logPhaseFailure("purgeActivity", error);
  }

  try {
    const emptyTransfers = await db
      .select({ id: folders.id })
      .from(folders)
      .leftJoin(files, eq(files.folderId, folders.id))
      .where(
        and(eq(folders.kind, "transfer"), lte(folders.createdAt, pendingCutoff), isNull(files.id)),
      )
      .limit(MAX_ROWS_PER_QUERY);
    if (emptyTransfers.length > 0) {
      await db.delete(folders).where(
        inArray(
          folders.id,
          emptyTransfers.map((row) => row.id),
        ),
      );
      report.deletedEmptyTransfers = emptyTransfers.length;
    }
  } catch (error) {
    logPhaseFailure("purgeEmptyTransfers", error);
  }

  const guestCutoff = new Date(now.getTime() - GUEST_USER_RETENTION_DAYS * DAY_MS);
  try {
    const guests = await db
      .select({ id: user.id })
      .from(user)
      .leftJoin(files, eq(files.userId, user.id))
      .where(and(eq(user.isAnonymous, true), lte(user.createdAt, guestCutoff), isNull(files.id)))
      .limit(20);
    if (guests.length > 0) {
      await db.delete(user).where(
        inArray(
          user.id,
          guests.map((row) => row.id),
        ),
      );
      report.deletedGuestUsers = guests.length;
    }
  } catch (error) {
    logPhaseFailure("purgeGuestUsers", error);
  }

  report.moreWork = report.moreWork || storageAttempts >= MAX_STORAGE_DELETES_PER_RUN;
  console.log(JSON.stringify(report));
  return report;
}

import {
  PENDING_UPLOAD_TTL_HOURS,
  SHARE_RETENTION_AFTER_END_DAYS,
  SOFT_DELETE_RETENTION_DAYS,
} from "@transfile/shared";
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import { files, session, shares, verification } from "../db/schema";
import type { FolderDatabase } from "../lib/folders";
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

  report.moreWork = storageAttempts >= MAX_STORAGE_DELETES_PER_RUN;
  console.log(JSON.stringify(report));
  return report;
}

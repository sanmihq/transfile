import { MAX_ACTIVE_SHARES_PER_USER, activityQuerySchema, createShareSchema, updateShareSchema } from "@transfile/shared";
import { and, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { hashPassword } from "../auth/password";
import { files, folders, shareComments, shareEvents, shares } from "../db/schema";
import { addHours, cappedExpiry } from "../lib/expiry";
import { notExpired } from "../lib/files";
import type { FolderDatabase } from "../lib/folders";
import { getOwnedFolder } from "../lib/folders";
import { generateToken, getShareState, type ShareState } from "../lib/shares";
import { userIsGuest } from "../lib/privacy";
import type { AuthVariables } from "../middleware/auth";
import { requireAuth, requireMember } from "../middleware/auth";

type AppEnv = { Bindings: Env; Variables: AuthVariables };
type ShareRow = typeof shares.$inferSelect;

const ID_CHUNK = 50;

const sharesRouter = new Hono<AppEnv>();

function database(env: Env): FolderDatabase {
  return drizzle(env.DB);
}

async function readJson(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    chunks.push(ids.slice(index, index + ID_CHUNK));
  }
  return chunks;
}

function shareLink(origin: string, token: string): string {
  return `${origin}/s/${token}`;
}

async function targetNames(
  db: FolderDatabase,
  userId: string,
  rows: readonly ShareRow[],
): Promise<{
  files: Map<string, { name: string; size: number }>;
  folders: Map<string, { name: string; kind: "folder" | "transfer" }>;
}> {
  const fileIds = [
    ...new Set(rows.flatMap((row) => (row.fileId === null ? [] : [row.fileId]))),
  ];
  const folderIds = [
    ...new Set(rows.flatMap((row) => (row.folderId === null ? [] : [row.folderId]))),
  ];
  const fileNames = new Map<string, { name: string; size: number }>();
  const folderNames = new Map<string, { name: string; kind: "folder" | "transfer" }>();
  for (const ids of chunkIds(fileIds)) {
    const found = await db
      .select({ id: files.id, name: files.name, size: files.size })
      .from(files)
      .where(and(eq(files.userId, userId), inArray(files.id, ids), notExpired()));
    for (const file of found) {
      fileNames.set(file.id, { name: file.name, size: file.size });
    }
  }
  for (const ids of chunkIds(folderIds)) {
    const found = await db
      .select({ id: folders.id, name: folders.name, kind: folders.kind })
      .from(folders)
      .where(and(eq(folders.userId, userId), inArray(folders.id, ids)));
    for (const folder of found) {
      folderNames.set(folder.id, { name: folder.name, kind: folder.kind });
    }
  }
  return { files: fileNames, folders: folderNames };
}

async function folderStats(
  db: FolderDatabase,
  userId: string,
  folderIds: readonly string[],
): Promise<Map<string, { fileCount: number; totalSize: number }>> {
  const stats = new Map<string, { fileCount: number; totalSize: number }>();
  for (const ids of chunkIds(folderIds)) {
    const rows = await db
      .select({
        folderId: files.folderId,
        fileCount: sql<number>`count(*)`,
        totalSize: sql<number>`coalesce(sum(${files.size}), 0)`,
      })
      .from(files)
      .where(
        and(
          eq(files.userId, userId),
          inArray(files.folderId, ids),
          eq(files.status, "ready"),
          isNull(files.deletedAt),
          notExpired(),
        ),
      )
      .groupBy(files.folderId);
    for (const row of rows) {
      if (row.folderId !== null) {
        stats.set(row.folderId, {
          fileCount: Number(row.fileCount),
          totalSize: Number(row.totalSize),
        });
      }
    }
  }
  return stats;
}

async function commentStats(
  db: FolderDatabase,
  shareIds: readonly string[],
): Promise<Map<string, { commentCount: number; unreadComments: number }>> {
  const stats = new Map<string, { commentCount: number; unreadComments: number }>();
  for (const ids of chunkIds(shareIds)) {
    const rows = await db
      .select({
        shareId: shareComments.shareId,
        commentCount: sql<number>`count(*)`,
        unreadComments: sql<number>`coalesce(sum(case when ${shareComments.readAt} is null then 1 else 0 end), 0)`,
      })
      .from(shareComments)
      .where(inArray(shareComments.shareId, ids))
      .groupBy(shareComments.shareId);
    for (const row of rows) {
      stats.set(row.shareId, {
        commentCount: Number(row.commentCount),
        unreadComments: Number(row.unreadComments),
      });
    }
  }
  return stats;
}

function presentShare(
  share: ShareRow,
  names: {
    files: Map<string, { name: string; size: number }>;
    folders: Map<string, { name: string; kind: "folder" | "transfer" }>;
  },
  stats: Map<string, { fileCount: number; totalSize: number }>,
  comments: Map<string, { commentCount: number; unreadComments: number }>,
  origin: string,
  now: Date,
) {
  const folder = share.folderId === null ? undefined : names.folders.get(share.folderId);
  const file = share.fileId === null ? undefined : names.files.get(share.fileId);
  const kind = share.fileId !== null ? "file" : folder?.kind === "transfer" ? "transfer" : "folder";
  const folderStat = share.folderId === null ? undefined : stats.get(share.folderId);
  const comment = comments.get(share.id);
  return {
    id: share.id,
    type: kind,
    kind,
    targetName: file?.name ?? folder?.name ?? "Deleted item",
    hasPassword: share.passwordHash !== null,
    expiresAt: share.expiresAt,
    maxDownloads: share.maxDownloads,
    downloadCount: share.downloadCount,
    createdAt: share.createdAt,
    status: getShareState(share, now) satisfies ShareState,
    url: shareLink(origin, share.token),
    fileCount: kind === "file" ? (file ? 1 : 0) : (folderStat?.fileCount ?? 0),
    totalSize: kind === "file" ? (file?.size ?? 0) : (folderStat?.totalSize ?? 0),
    allowComments: share.allowComments,
    message: share.message,
    commentCount: comment?.commentCount ?? 0,
    unreadComments: comment?.unreadComments ?? 0,
  };
}

async function readyFilesInFolder(db: FolderDatabase, userId: string, folderId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        eq(files.folderId, folderId),
        eq(files.status, "ready"),
        isNull(files.deletedAt),
        notExpired(),
      ),
    );
  return Number(row?.total ?? 0);
}

async function alignTransferExpiry(
  db: FolderDatabase,
  userId: string,
  folderId: string,
  shareExpiresAt: Date,
): Promise<void> {
  const shareSeconds = Math.floor(shareExpiresAt.getTime() / 1000);
  const capSeconds = 72 * 60 * 60;
  await db
    .update(files)
    .set({
      expiresAt: sql`min(${shareSeconds}, ${files.createdAt} + ${capSeconds})`,
    })
    .where(and(eq(files.userId, userId), eq(files.folderId, folderId)));
}

async function ownedShare(
  db: FolderDatabase,
  userId: string,
  shareId: string,
): Promise<ShareRow | null> {
  const [share] = await db
    .select()
    .from(shares)
    .where(and(eq(shares.id, shareId), eq(shares.userId, userId)))
    .limit(1);
  return share ?? null;
}

sharesRouter.post("/", requireAuth, async (c) => {
  const user = c.get("user");
  const userId = user.id;
  const guest = userIsGuest(user);
  const db = database(c.env);
  const payload = await readJson(c.req.raw);
  if (payload === undefined) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const parsed = createShareSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }

  let transferFolderId: string | null = null;
  if (guest) {
    if (parsed.data.folderId === undefined) {
      return c.json({ error: "Not found" }, 404);
    }
    const folder = await getOwnedFolder(db, userId, parsed.data.folderId);
    if (!folder || folder.kind !== "transfer") {
      return c.json({ error: "Not found" }, 404);
    }
    if ((await readyFilesInFolder(db, userId, folder.id)) === 0) {
      return c.json({ error: "Add a file before sharing" }, 400);
    }
    transferFolderId = folder.id;
  } else if (parsed.data.fileId !== undefined) {
    const [file] = await db
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, parsed.data.fileId),
          eq(files.userId, userId),
          eq(files.status, "ready"),
          isNull(files.deletedAt),
          notExpired(),
        ),
      )
      .limit(1);
    if (!file) {
      return c.json({ error: "Not found" }, 404);
    }
  } else if (parsed.data.folderId !== undefined) {
    const folder = await getOwnedFolder(db, userId, parsed.data.folderId);
    if (!folder) {
      return c.json({ error: "Not found" }, 404);
    }
    if (folder.kind === "transfer" && (await readyFilesInFolder(db, userId, folder.id)) === 0) {
      return c.json({ error: "Add a file before sharing" }, 400);
    }
    if (folder.kind === "transfer") {
      transferFolderId = folder.id;
    }
  }

  const now = new Date();
  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(shares)
    .where(and(eq(shares.userId, userId), isNull(shares.revokedAt), gt(shares.expiresAt, now)));
  if (Number(countRow?.total ?? 0) >= MAX_ACTIVE_SHARES_PER_USER) {
    return c.json({ error: "Too many active links" }, 400);
  }

  const id = crypto.randomUUID();
  const token = generateToken();
  const expiresAt = cappedExpiry(now, addHours(now, parsed.data.expiresInHours));
  const passwordHash =
    parsed.data.password === undefined ? null : await hashPassword(parsed.data.password);
  const allowComments = guest ? false : parsed.data.allowComments;
  await db.insert(shares).values({
    id,
    userId,
    fileId: guest ? null : (parsed.data.fileId ?? null),
    folderId: guest ? transferFolderId : (parsed.data.folderId ?? null),
    token,
    passwordHash,
    expiresAt,
    maxDownloads: parsed.data.maxDownloads ?? null,
    allowComments,
    message: parsed.data.message ?? null,
    createdAt: now,
  });
  if (transferFolderId !== null) {
    await alignTransferExpiry(db, userId, transferFolderId, expiresAt);
  }

  const created = await ownedShare(db, userId, id);
  if (!created) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json(
    {
      share: await renderShare(db, userId, created, c.env.WEB_ORIGIN, now),
      url: shareLink(c.env.WEB_ORIGIN, token),
    },
    201,
  );
});

sharesRouter.get("/", requireMember, async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  const now = new Date();
  const rows = await db
    .select()
    .from(shares)
    .where(eq(shares.userId, userId))
    .orderBy(desc(shares.createdAt))
    .limit(200);
  return c.json(await renderShares(db, userId, rows, c.env.WEB_ORIGIN, now));
});

sharesRouter.get("/:id/activity", requireMember, async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  const parsed = activityQuerySchema.safeParse({
    limit: c.req.query("limit"),
    before: c.req.query("before"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const share = await ownedShare(db, userId, c.req.param("id"));
  if (!share) {
    return c.json({ error: "Not found" }, 404);
  }
  const before = parsed.data.before === undefined ? null : new Date(parsed.data.before);
  const rows = await db
    .select({
      id: shareEvents.id,
      type: shareEvents.type,
      fileId: shareEvents.fileId,
      country: shareEvents.country,
      createdAt: shareEvents.createdAt,
    })
    .from(shareEvents)
    .where(
      and(
        eq(shareEvents.shareId, share.id),
        before === null ? undefined : lt(shareEvents.createdAt, before),
      ),
    )
    .orderBy(desc(shareEvents.createdAt))
    .limit(parsed.data.limit);
  return c.json({ items: rows });
});

sharesRouter.patch("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const userId = user.id;
  const guest = userIsGuest(user);
  const db = database(c.env);
  const payload = await readJson(c.req.raw);
  if (payload === undefined) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const parsed = updateShareSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  if (guest && parsed.data.allowComments === true) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const share = await ownedShare(db, userId, c.req.param("id"));
  if (!share || share.revokedAt !== null) {
    return c.json({ error: "Not found" }, 404);
  }

  const now = new Date();
  const next: {
    expiresAt?: Date;
    maxDownloads?: number | null;
    passwordHash?: string | null;
    failedAttempts?: number;
    lockedUntil?: Date | null;
    allowComments?: boolean;
    message?: string | null;
  } = {};
  if (parsed.data.expiresInHours !== undefined) {
    next.expiresAt = cappedExpiry(share.createdAt, addHours(now, parsed.data.expiresInHours));
  }
  if (parsed.data.maxDownloads !== undefined) {
    next.maxDownloads = parsed.data.maxDownloads;
  }
  if (parsed.data.password !== undefined) {
    next.passwordHash =
      parsed.data.password === null ? null : await hashPassword(parsed.data.password);
    next.failedAttempts = 0;
    next.lockedUntil = null;
  }
  if (parsed.data.allowComments !== undefined) {
    next.allowComments = guest ? false : parsed.data.allowComments;
  }
  if (parsed.data.message !== undefined) {
    next.message = parsed.data.message;
  }
  await db
    .update(shares)
    .set(next)
    .where(and(eq(shares.id, share.id), eq(shares.userId, userId)));
  if (next.expiresAt !== undefined && share.folderId !== null) {
    const folder = await getOwnedFolder(db, userId, share.folderId);
    if (folder?.kind === "transfer") {
      await alignTransferExpiry(db, userId, folder.id, next.expiresAt);
    }
  }
  const updated = await ownedShare(db, userId, share.id);
  if (!updated) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json(await renderShare(db, userId, updated, c.env.WEB_ORIGIN, now));
});

sharesRouter.delete("/:id", requireMember, async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  const share = await ownedShare(db, userId, c.req.param("id"));
  if (!share) {
    return c.json({ error: "Not found" }, 404);
  }
  if (share.revokedAt === null) {
    await db
      .update(shares)
      .set({ revokedAt: new Date() })
      .where(and(eq(shares.id, share.id), eq(shares.userId, userId)));
  }
  return c.body(null, 204);
});

async function renderShare(
  db: FolderDatabase,
  userId: string,
  share: ShareRow,
  origin: string,
  now: Date,
) {
  const [rendered] = await renderShares(db, userId, [share], origin, now);
  if (!rendered) {
    throw new Error("Share could not be rendered");
  }
  return rendered;
}

async function renderShares(
  db: FolderDatabase,
  userId: string,
  rows: readonly ShareRow[],
  origin: string,
  now: Date,
) {
  const names = await targetNames(db, userId, rows);
  const folderIds = rows.flatMap((row) => (row.folderId === null ? [] : [row.folderId]));
  const stats = await folderStats(db, userId, folderIds);
  const comments = await commentStats(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((share) => presentShare(share, names, stats, comments, origin, now));
}

export { sharesRouter };

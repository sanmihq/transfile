import { MAX_ACTIVE_SHARES_PER_USER, createShareSchema, updateShareSchema } from "@transfile/shared";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { hashPassword } from "../auth/password";
import { files, folders, shares } from "../db/schema";
import type { FolderDatabase } from "../lib/folders";
import { getOwnedFolder } from "../lib/folders";
import { generateToken, getShareState, type ShareState } from "../lib/shares";
import type { AuthVariables } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";

type AppEnv = { Bindings: Env; Variables: AuthVariables };
type ShareRow = typeof shares.$inferSelect;

const ID_CHUNK = 50;

const sharesRouter = new Hono<AppEnv>();
sharesRouter.use("*", requireAuth);

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
): Promise<{ files: Map<string, string>; folders: Map<string, string> }> {
  const fileIds = [
    ...new Set(rows.flatMap((row) => (row.fileId === null ? [] : [row.fileId]))),
  ];
  const folderIds = [
    ...new Set(rows.flatMap((row) => (row.folderId === null ? [] : [row.folderId]))),
  ];
  const fileNames = new Map<string, string>();
  const folderNames = new Map<string, string>();
  for (const ids of chunkIds(fileIds)) {
    const found = await db
      .select({ id: files.id, name: files.name })
      .from(files)
      .where(and(eq(files.userId, userId), inArray(files.id, ids)));
    for (const file of found) {
      fileNames.set(file.id, file.name);
    }
  }
  for (const ids of chunkIds(folderIds)) {
    const found = await db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(and(eq(folders.userId, userId), inArray(folders.id, ids)));
    for (const folder of found) {
      folderNames.set(folder.id, folder.name);
    }
  }
  return { files: fileNames, folders: folderNames };
}

function presentShare(
  share: ShareRow,
  names: { files: Map<string, string>; folders: Map<string, string> },
  origin: string,
  now: Date,
) {
  const type = share.fileId !== null ? "file" : "folder";
  const targetName =
    type === "file"
      ? (names.files.get(share.fileId ?? "") ?? "Deleted item")
      : (names.folders.get(share.folderId ?? "") ?? "Deleted item");
  return {
    id: share.id,
    type,
    targetName,
    hasPassword: share.passwordHash !== null,
    expiresAt: share.expiresAt,
    maxDownloads: share.maxDownloads,
    downloadCount: share.downloadCount,
    createdAt: share.createdAt,
    status: getShareState(share, now) satisfies ShareState,
    url: shareLink(origin, share.token),
  };
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

sharesRouter.post("/", async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  const payload = await readJson(c.req.raw);
  if (payload === undefined) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const parsed = createShareSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }

  let targetName = "";
  if (parsed.data.fileId !== undefined) {
    const [file] = await db
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, parsed.data.fileId),
          eq(files.userId, userId),
          eq(files.status, "ready"),
          isNull(files.deletedAt),
        ),
      )
      .limit(1);
    if (!file) {
      return c.json({ error: "Not found" }, 404);
    }
    targetName = file.name;
  } else if (parsed.data.folderId !== undefined) {
    const folder = await getOwnedFolder(db, userId, parsed.data.folderId);
    if (!folder) {
      return c.json({ error: "Not found" }, 404);
    }
    targetName = folder.name;
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
  const expiresAt = new Date(now.getTime() + parsed.data.expiresInHours * 60 * 60 * 1000);
  const passwordHash =
    parsed.data.password === undefined ? null : await hashPassword(parsed.data.password);
  await db.insert(shares).values({
    id,
    userId,
    fileId: parsed.data.fileId ?? null,
    folderId: parsed.data.folderId ?? null,
    token,
    passwordHash,
    expiresAt,
    maxDownloads: parsed.data.maxDownloads ?? null,
  });

  const url = shareLink(c.env.WEB_ORIGIN, token);
  return c.json(
    {
      share: {
        id,
        type: parsed.data.fileId !== undefined ? "file" : "folder",
        targetName,
        hasPassword: passwordHash !== null,
        expiresAt,
        maxDownloads: parsed.data.maxDownloads ?? null,
        downloadCount: 0,
        createdAt: now,
        status: "active" as const,
      },
      url,
    },
    201,
  );
});

sharesRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  const now = new Date();
  const rows = await db
    .select()
    .from(shares)
    .where(eq(shares.userId, userId))
    .orderBy(desc(shares.createdAt))
    .limit(200);
  const names = await targetNames(db, userId, rows);
  return c.json(rows.map((share) => presentShare(share, names, c.env.WEB_ORIGIN, now)));
});

sharesRouter.patch("/:id", async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  const payload = await readJson(c.req.raw);
  if (payload === undefined) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const parsed = updateShareSchema.safeParse(payload);
  if (!parsed.success) {
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
  } = {};
  if (parsed.data.expiresInHours !== undefined) {
    next.expiresAt = new Date(now.getTime() + parsed.data.expiresInHours * 60 * 60 * 1000);
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
  await db
    .update(shares)
    .set(next)
    .where(and(eq(shares.id, share.id), eq(shares.userId, userId)));
  const updated = await ownedShare(db, userId, share.id);
  if (!updated) {
    return c.json({ error: "Not found" }, 404);
  }
  const names = await targetNames(db, userId, [updated]);
  return c.json(presentShare(updated, names, c.env.WEB_ORIGIN, now));
});

sharesRouter.delete("/:id", async (c) => {
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

export { sharesRouter };

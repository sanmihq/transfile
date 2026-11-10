import {
  MAX_UNLOCK_ATTEMPTS,
  UNLOCK_LOCKOUT_MINUTES,
  publicContentsQuerySchema,
  publicDownloadQuerySchema,
  shareTokenSchema,
  unlockSchema,
} from "@transfile/shared";
import { and, asc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { verifyPassword } from "../auth/password";
import { files, folders, shares } from "../db/schema";
import type { FolderDatabase } from "../lib/folders";
import { getAncestors, getOwnedFolder } from "../lib/folders";
import {
  ACCESS_GRANT_SECONDS,
  DOWNLOAD_GRANT_SECONDS,
  grantFileId,
  signGrant,
  verifyGrant,
} from "../lib/grants";
import {
  getShareState,
  isInSharedSubtree,
  loadShareByToken,
  passwordVersion,
  resolveTarget,
} from "../lib/shares";
import type { ShareTarget } from "../lib/shares";
import { attachmentContentDisposition } from "../storage/content-disposition";
import { requireFilesBinding } from "../storage/env";
import { getStorage, isS3Mode } from "../storage";

type ShareRow = typeof shares.$inferSelect;
type FileRow = typeof files.$inferSelect;

const UNAVAILABLE = "This link is no longer available";

const publicRouter = new Hono<{ Bindings: Env }>();

function database(env: Env): FolderDatabase {
  return drizzle(env.DB);
}

function originOf(requestUrl: string): string {
  return new URL(requestUrl).origin;
}

function noStore(
  c: { json: (body: unknown, status?: number, headers?: Record<string, string>) => Response },
  body: unknown,
  status: 200 | 400 | 401 | 404 | 410 | 429,
  extraHeaders?: Record<string, string>,
): Response {
  return c.json(body, status, { "Cache-Control": "no-store", ...extraHeaders });
}

async function readJson(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

type OpenShare =
  | { ok: true; db: FolderDatabase; share: ShareRow; target: ShareTarget }
  | { ok: false; response: Response };

async function openShare(
  c: { env: Env; req: { header: (name: string) => string | undefined }; json: (body: unknown, status?: number, headers?: Record<string, string>) => Response },
  token: string,
  requireAccess: boolean,
): Promise<OpenShare> {
  const parsed = shareTokenSchema.safeParse(token);
  if (!parsed.success) {
    return { ok: false, response: noStore(c, { error: "Not found" }, 404) };
  }
  const db = database(c.env);
  const share = await loadShareByToken(db, parsed.data);
  if (!share) {
    return { ok: false, response: noStore(c, { error: "Not found" }, 404) };
  }
  if (getShareState(share, new Date()) !== "active") {
    return { ok: false, response: noStore(c, { error: UNAVAILABLE }, 410) };
  }
  const target = await resolveTarget(db, share);
  if (!target) {
    return { ok: false, response: noStore(c, { error: UNAVAILABLE }, 410) };
  }
  if (requireAccess && share.passwordHash !== null) {
    const header = c.req.header("x-share-access");
    const allowed =
      header !== undefined &&
      (await verifyGrant(c.env, header, {
        purpose: "access",
        shareId: share.id,
        passwordVersion: await passwordVersion(share),
      }));
    if (!allowed) {
      return { ok: false, response: noStore(c, { error: "Password required" }, 401) };
    }
  }
  return { ok: true, db, share, target };
}

function metadata(share: ShareRow, target: ShareTarget) {
  const remainingDownloads =
    share.maxDownloads === null ? null : Math.max(0, share.maxDownloads - share.downloadCount);
  if (target.type === "file") {
    return {
      requiresPassword: false,
      type: "file" as const,
      name: target.file.name,
      size: target.file.size,
      mime: target.file.mime,
      expiresAt: share.expiresAt,
      remainingDownloads,
    };
  }
  return {
    requiresPassword: false,
    type: "folder" as const,
    name: target.folder.name,
    expiresAt: share.expiresAt,
    remainingDownloads,
  };
}

async function loadReadyFile(
  db: FolderDatabase,
  userId: string,
  fileId: string,
): Promise<FileRow | null> {
  const [file] = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
        eq(files.userId, userId),
        eq(files.status, "ready"),
        isNull(files.deletedAt),
      ),
    )
    .limit(1);
  return file ?? null;
}

async function fileInsideShare(
  db: FolderDatabase,
  share: ShareRow,
  fileId: string,
): Promise<FileRow | null> {
  if (share.fileId !== null) {
    if (fileId !== share.fileId) {
      return null;
    }
    return loadReadyFile(db, share.userId, share.fileId);
  }
  const file = await loadReadyFile(db, share.userId, fileId);
  if (!file || file.folderId === null) {
    return null;
  }
  if (!(await isInSharedSubtree(db, share, file.folderId))) {
    return null;
  }
  return file;
}

publicRouter.get("/:token", async (c) => {
  const opened = await openShare(c, c.req.param("token"), false);
  if (!opened.ok) {
    return opened.response;
  }
  if (opened.share.passwordHash !== null) {
    const header = c.req.header("x-share-access");
    const unlocked =
      header !== undefined &&
      (await verifyGrant(c.env, header, {
        purpose: "access",
        shareId: opened.share.id,
        passwordVersion: await passwordVersion(opened.share),
      }));
    if (!unlocked) {
      return noStore(c, { requiresPassword: true, expiresAt: opened.share.expiresAt }, 200);
    }
  }
  return noStore(c, metadata(opened.share, opened.target), 200);
});

publicRouter.post("/:token/unlock", async (c) => {
  const opened = await openShare(c, c.req.param("token"), false);
  if (!opened.ok) {
    return opened.response;
  }
  const payload = await readJson(c.req.raw);
  if (payload === undefined) {
    return noStore(c, { error: "Invalid request" }, 400);
  }
  const parsed = unlockSchema.safeParse(payload);
  if (!parsed.success) {
    return noStore(c, { error: "Invalid request" }, 400);
  }
  if (opened.share.passwordHash === null) {
    return noStore(c, { error: "No password required" }, 400);
  }
  const now = new Date();
  if (opened.share.lockedUntil !== null && opened.share.lockedUntil.getTime() > now.getTime()) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((opened.share.lockedUntil.getTime() - now.getTime()) / 1000),
    );
    return noStore(
      c,
      { error: "Too many attempts. Try again later.", retryAfterSeconds },
      429,
      { "Retry-After": String(retryAfterSeconds) },
    );
  }

  const matches = await verifyPassword({
    hash: opened.share.passwordHash,
    password: parsed.data.password,
  });
  if (!matches) {
    const lockedUntil = new Date(now.getTime() + UNLOCK_LOCKOUT_MINUTES * 60 * 1000);
    const lockedUntilSeconds = Math.floor(lockedUntil.getTime() / 1000);
    await opened.db
      .update(shares)
      .set({
        failedAttempts: sql`CASE WHEN ${shares.failedAttempts} + 1 >= ${MAX_UNLOCK_ATTEMPTS} THEN 0 ELSE ${shares.failedAttempts} + 1 END`,
        lockedUntil: sql`CASE WHEN ${shares.failedAttempts} + 1 >= ${MAX_UNLOCK_ATTEMPTS} THEN ${lockedUntilSeconds} ELSE ${shares.lockedUntil} END`,
      })
      .where(eq(shares.id, opened.share.id));
    return noStore(c, { error: "Incorrect password" }, 401);
  }

  await opened.db
    .update(shares)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(eq(shares.id, opened.share.id));
  const exp = Math.floor(now.getTime() / 1000) + ACCESS_GRANT_SECONDS;
  const accessToken = await signGrant(c.env, {
    v: 1,
    p: "access",
    s: opened.share.id,
    pv: await passwordVersion(opened.share),
    exp,
  });
  return noStore(c, { accessToken, expiresAt: new Date(exp * 1000) }, 200);
});

publicRouter.get("/:token/contents", async (c) => {
  const opened = await openShare(c, c.req.param("token"), true);
  if (!opened.ok) {
    return opened.response;
  }
  if (opened.target.type !== "folder" || opened.share.folderId === null) {
    return noStore(c, { error: "Invalid request" }, 400);
  }
  const parsed = publicContentsQuerySchema.safeParse({
    folderId: c.req.query("folderId"),
  });
  if (!parsed.success) {
    return noStore(c, { error: "Invalid request" }, 400);
  }
  const folderId = parsed.data.folderId ?? opened.share.folderId;
  if (!(await isInSharedSubtree(opened.db, opened.share, folderId))) {
    return noStore(c, { error: "Not found" }, 404);
  }
  const folder = await getOwnedFolder(opened.db, opened.share.userId, folderId);
  if (!folder) {
    return noStore(c, { error: "Not found" }, 404);
  }
  const ancestors = await getAncestors(opened.db, opened.share.userId, folder.id);
  const rootIndex = ancestors.findIndex((item) => item.id === opened.share.folderId);
  const breadcrumbs = rootIndex === -1 ? [] : ancestors.slice(rootIndex);
  const childFolders = await opened.db
    .select({ id: folders.id, name: folders.name })
    .from(folders)
    .where(and(eq(folders.userId, opened.share.userId), eq(folders.parentId, folder.id)))
    .orderBy(asc(folders.name));
  const childFiles = await opened.db
    .select({
      id: files.id,
      name: files.name,
      size: files.size,
      mime: files.mime,
    })
    .from(files)
    .where(
      and(
        eq(files.userId, opened.share.userId),
        eq(files.folderId, folder.id),
        eq(files.status, "ready"),
        isNull(files.deletedAt),
      ),
    )
    .orderBy(asc(files.name));
  return noStore(
    c,
    {
      folder: { id: folder.id, name: folder.name },
      breadcrumbs,
      folders: childFolders,
      files: childFiles,
    },
    200,
  );
});

publicRouter.get("/:token/download-url", async (c) => {
  const opened = await openShare(c, c.req.param("token"), true);
  if (!opened.ok) {
    return opened.response;
  }
  const parsed = publicDownloadQuerySchema.safeParse({
    fileId: c.req.query("fileId"),
  });
  if (!parsed.success) {
    return noStore(c, { error: "Invalid request" }, 400);
  }
  const requestedId =
    opened.share.fileId !== null ? opened.share.fileId : (parsed.data.fileId ?? null);
  if (requestedId === null) {
    return noStore(c, { error: "Not found" }, 404);
  }
  const file = await fileInsideShare(opened.db, opened.share, requestedId);
  if (!file) {
    return noStore(c, { error: "Not found" }, 404);
  }

  const counted = await opened.db
    .update(shares)
    .set({ downloadCount: sql`${shares.downloadCount} + 1` })
    .where(
      and(
        eq(shares.id, opened.share.id),
        isNull(shares.revokedAt),
        gt(shares.expiresAt, new Date()),
        or(isNull(shares.maxDownloads), lt(shares.downloadCount, shares.maxDownloads)),
      ),
    )
    .returning({ id: shares.id });
  if (counted.length === 0) {
    return noStore(c, { error: UNAVAILABLE }, 410);
  }

  if (isS3Mode(c.env)) {
    const download = await getStorage(c.env).createDownload({
      key: file.r2Key,
      fileId: file.id,
      fileName: file.name,
      origin: originOf(c.req.url),
    });
    return noStore(c, { url: download.url }, 200);
  }

  const grant = await signGrant(c.env, {
    v: 1,
    p: "download",
    s: opened.share.id,
    f: file.id,
    pv: await passwordVersion(opened.share),
    exp: Math.floor(Date.now() / 1000) + DOWNLOAD_GRANT_SECONDS,
  });
  return noStore(
    c,
    { url: `${originOf(c.req.url)}/api/s/${opened.share.token}/file/${grant}` },
    200,
  );
});

publicRouter.get("/:token/file/:grant", async (c) => {
  if (isS3Mode(c.env)) {
    return noStore(c, { error: "Not found" }, 404);
  }
  const opened = await openShare(c, c.req.param("token"), false);
  if (!opened.ok) {
    return opened.response;
  }
  const grant = c.req.param("grant");
  const fileId = grantFileId(grant);
  if (fileId === null) {
    return noStore(c, { error: "Not found" }, 404);
  }
  const valid = await verifyGrant(c.env, grant, {
    purpose: "download",
    shareId: opened.share.id,
    passwordVersion: await passwordVersion(opened.share),
    fileId,
  });
  if (!valid) {
    return noStore(c, { error: "Not found" }, 404);
  }
  const file = await fileInsideShare(opened.db, opened.share, fileId);
  if (!file) {
    return noStore(c, { error: "Not found" }, 404);
  }
  const object = await requireFilesBinding(c.env).get(file.r2Key);
  if (!object) {
    return noStore(c, { error: "Not found" }, 404);
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(object.size),
      "Cache-Control": "no-store",
      "Content-Disposition": attachmentContentDisposition(file.name),
    },
  });
});

export { publicRouter };

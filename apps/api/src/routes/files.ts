import {
  DEFAULT_EXPIRY_HOURS,
  MAX_FILE_BYTES,
  USER_QUOTA_BYTES,
  listFilesQuerySchema,
  sanitizeFileName,
  updateFileSchema,
  uploadRequestSchema,
} from "@transfile/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { files } from "../db/schema";
import { addHours, cappedExpiry } from "../lib/expiry";
import { notExpired } from "../lib/files";
import { getOwnedFolder } from "../lib/folders";
import { guestPoolLimit, guestPoolUsed, isPreviewable, userIsGuest } from "../lib/privacy";
import type { AuthVariables } from "../middleware/auth";
import { requireAuth, requireMember } from "../middleware/auth";
import { attachmentContentDisposition, inlineContentDisposition } from "../storage/content-disposition";
import { requireFilesBinding } from "../storage/env";
import { getStorage, isS3Mode } from "../storage";

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const filesRouter = new Hono<AppEnv>();

function database(env: Env) {
  return drizzle(env.DB);
}

function originOf(requestUrl: string): string {
  return new URL(requestUrl).origin;
}

function fileExpiry(hours: number | undefined, createdAt: Date, now: Date): Date {
  return cappedExpiry(createdAt, addHours(now, hours ?? DEFAULT_EXPIRY_HOURS));
}

async function readJson(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

async function folderBelongsToUser(
  env: Env,
  userId: string,
  folderId: string,
): Promise<boolean> {
  const folder = await getOwnedFolder(database(env), userId, folderId);
  return folder !== null;
}

async function usedBytes(env: Env, userId: string): Promise<number> {
  const [row] = await database(env)
    .select({
      used: sql<number>`coalesce(sum(${files.size}), 0)`,
    })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), notExpired()));
  return Number(row?.used ?? 0);
}

filesRouter.post("/upload-url", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const payload = await readJson(c.req.raw);
  if (payload === undefined) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const parsed = uploadRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }

  const name = sanitizeFileName(parsed.data.name);
  const folderId = parsed.data.folderId ?? null;
  if (folderId !== null && !(await folderBelongsToUser(c.env, userId, folderId))) {
    return c.json({ error: "Not found" }, 404);
  }

  const used = await usedBytes(c.env, userId);
  if (used + parsed.data.size > USER_QUOTA_BYTES) {
    return c.json({ error: "Storage quota exceeded" }, 413);
  }
  if (userIsGuest(c.get("user"))) {
    const poolUsed = await guestPoolUsed(database(c.env), new Date());
    if (poolUsed + parsed.data.size > guestPoolLimit(c.env)) {
      return c.json(
        { error: "Guest uploads are busy right now. Try again later or sign up." },
        503,
      );
    }
  }

  const fileId = crypto.randomUUID();
  const r2Key = `${userId}/${fileId}`;
  const mime =
    parsed.data.mime && parsed.data.mime.length > 0
      ? parsed.data.mime
      : "application/octet-stream";
  const now = new Date();
  const expiresAt = fileExpiry(parsed.data.expiresInHours, now, now);

  await database(c.env)
    .insert(files)
    .values({
      id: fileId,
      userId,
      folderId,
      name,
      r2Key,
      size: parsed.data.size,
      mime,
      status: "pending",
      createdAt: now,
      expiresAt,
    });

  const upload = await getStorage(c.env).createUpload({
    key: r2Key,
    fileId,
    size: parsed.data.size,
    mime,
    origin: originOf(c.req.url),
  });

  return c.json(
    {
      file: {
        id: fileId,
        name,
        size: parsed.data.size,
        status: "pending" as const,
        expiresAt,
      },
      upload,
    },
    201,
  );
});

filesRouter.put("/:id/content", requireAuth, async (c) => {
  if (isS3Mode(c.env)) {
    return c.json({ error: "Not found" }, 404);
  }
  const userId = c.get("user").id;
  const fileId = c.req.param("id");
  const [file] = await database(c.env)
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
        eq(files.userId, userId),
        eq(files.status, "pending"),
        isNull(files.deletedAt),
        notExpired(),
      ),
    )
    .limit(1);
  if (!file) {
    return c.json({ error: "Not found" }, 404);
  }

  const lengthHeader = c.req.header("content-length");
  if (lengthHeader === undefined) {
    return c.json({ error: "Content-Length required" }, 411);
  }
  const contentLength = Number(lengthHeader);
  if (!Number.isInteger(contentLength) || contentLength < 0) {
    return c.json({ error: "Invalid request" }, 400);
  }
  if (contentLength > file.size || contentLength > MAX_FILE_BYTES) {
    return c.json({ error: "Upload too large" }, 413);
  }

  const body = c.req.raw.body;
  if (body === null) {
    return c.json({ error: "Invalid request" }, 400);
  }

  await requireFilesBinding(c.env).put(file.r2Key, body, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  return c.body(null, 204);
});

filesRouter.post("/:id/complete", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const fileId = c.req.param("id");
  const [file] = await database(c.env)
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
        eq(files.userId, userId),
        eq(files.status, "pending"),
        isNull(files.deletedAt),
        notExpired(),
      ),
    )
    .limit(1);
  if (!file) {
    return c.json({ error: "Not found" }, 404);
  }

  const storage = getStorage(c.env);
  const head = await storage.head(file.r2Key);
  if (!head) {
    return c.json({ error: "Upload not found" }, 409);
  }
  if (head.size > MAX_FILE_BYTES || head.size !== file.size) {
    await storage.delete(file.r2Key);
    await database(c.env)
      .delete(files)
      .where(and(eq(files.id, file.id), eq(files.userId, userId)));
    return c.json({ error: "Size mismatch" }, 400);
  }

  await database(c.env)
    .update(files)
    .set({ status: "ready", size: head.size })
    .where(and(eq(files.id, file.id), eq(files.userId, userId)));

  return c.json({
    id: file.id,
    name: file.name,
    size: head.size,
    mime: file.mime,
    folderId: file.folderId,
    status: "ready" as const,
    createdAt: file.createdAt,
    expiresAt: file.expiresAt,
  });
});

filesRouter.get("/:id/download-url", requireMember, async (c) => {
  const userId = c.get("user").id;
  const fileId = c.req.param("id");
  const [file] = await database(c.env)
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
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
  const download = await getStorage(c.env).createDownload({
    key: file.r2Key,
    fileId: file.id,
    fileName: file.name,
    origin: originOf(c.req.url),
  });
  return c.json(download);
});

filesRouter.get("/:id/preview-url", requireMember, async (c) => {
  const userId = c.get("user").id;
  const fileId = c.req.param("id");
  const [file] = await database(c.env)
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
        eq(files.userId, userId),
        eq(files.status, "ready"),
        isNull(files.deletedAt),
        notExpired(),
      ),
    )
    .limit(1);
  if (!file || !isPreviewable(file.mime, file.size)) {
    return c.json({ error: "Not found" }, 404);
  }
  const preview = await getStorage(c.env).createPreview({
    key: file.r2Key,
    fileId: file.id,
    fileName: file.name,
    mime: file.mime ?? "application/octet-stream",
    origin: originOf(c.req.url),
  });
  return c.json(preview);
});

filesRouter.get("/:id/preview", requireMember, async (c) => {
  if (isS3Mode(c.env)) {
    return c.json({ error: "Not found" }, 404);
  }
  const userId = c.get("user").id;
  const fileId = c.req.param("id");
  const [file] = await database(c.env)
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
        eq(files.userId, userId),
        eq(files.status, "ready"),
        isNull(files.deletedAt),
        notExpired(),
      ),
    )
    .limit(1);
  if (!file || !isPreviewable(file.mime, file.size)) {
    return c.json({ error: "Not found" }, 404);
  }
  const object = await requireFilesBinding(c.env).get(file.r2Key);
  if (!object) {
    return c.json({ error: "Not found" }, 404);
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": file.mime ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Length": String(object.size),
      "Cache-Control": "no-store",
      "Content-Disposition": inlineContentDisposition(file.name),
    },
  });
});

filesRouter.get("/:id/content", requireMember, async (c) => {
  if (isS3Mode(c.env)) {
    return c.json({ error: "Not found" }, 404);
  }
  const userId = c.get("user").id;
  const fileId = c.req.param("id");
  const [file] = await database(c.env)
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
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

  const object = await requireFilesBinding(c.env).get(file.r2Key);
  if (!object) {
    return c.json({ error: "Not found" }, 404);
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(object.size),
      "Content-Disposition": attachmentContentDisposition(file.name),
    },
  });
});

filesRouter.get("/", requireMember, async (c) => {
  const userId = c.get("user").id;
  const parsed = listFilesQuerySchema.safeParse({
    folderId: c.req.query("folderId"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const folderId = parsed.data.folderId;
  if (folderId !== null && !(await folderBelongsToUser(c.env, userId, folderId))) {
    return c.json({ error: "Not found" }, 404);
  }

  const rows = await database(c.env)
    .select({
      id: files.id,
      name: files.name,
      size: files.size,
      mime: files.mime,
      folderId: files.folderId,
      createdAt: files.createdAt,
      expiresAt: files.expiresAt,
    })
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        eq(files.status, "ready"),
        isNull(files.deletedAt),
        notExpired(),
        folderId === null ? isNull(files.folderId) : eq(files.folderId, folderId),
      ),
    )
    .orderBy(desc(files.createdAt));
  return c.json(rows);
});

filesRouter.patch("/:id", requireMember, async (c) => {
  const userId = c.get("user").id;
  const fileId = c.req.param("id");
  const payload = await readJson(c.req.raw);
  if (payload === undefined) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const parsed = updateFileSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }

  const [file] = await database(c.env)
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
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

  const nextFolderId =
    parsed.data.folderId === undefined ? file.folderId : parsed.data.folderId;
  if (
    nextFolderId !== null &&
    !(await folderBelongsToUser(c.env, userId, nextFolderId))
  ) {
    return c.json({ error: "Not found" }, 404);
  }

  const nextName =
    parsed.data.name === undefined ? file.name : sanitizeFileName(parsed.data.name);
  const now = new Date();
  const expiresAt =
    parsed.data.expiresInHours === undefined
      ? file.expiresAt
      : cappedExpiry(file.createdAt, addHours(now, parsed.data.expiresInHours));
  await database(c.env)
    .update(files)
    .set({ name: nextName, folderId: nextFolderId, expiresAt })
    .where(and(eq(files.id, file.id), eq(files.userId, userId)));

  return c.json({
    id: file.id,
    name: nextName,
    size: file.size,
    mime: file.mime,
    folderId: nextFolderId,
    status: file.status,
    createdAt: file.createdAt,
    expiresAt,
  });
});

filesRouter.delete("/:id", requireMember, async (c) => {
  const userId = c.get("user").id;
  const fileId = c.req.param("id");
  const [file] = await database(c.env)
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
        eq(files.userId, userId),
        isNull(files.deletedAt),
        notExpired(),
      ),
    )
    .limit(1);
  if (!file) {
    return c.json({ error: "Not found" }, 404);
  }
  await database(c.env)
    .update(files)
    .set({ deletedAt: new Date() })
    .where(and(eq(files.id, file.id), eq(files.userId, userId)));
  return c.body(null, 204);
});

export const usageRouter = new Hono<AppEnv>();
usageRouter.get("/", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const [row] = await database(c.env)
    .select({
      used: sql<number>`coalesce(sum(${files.size}), 0)`,
      fileCount: sql<number>`count(*)`,
    })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), notExpired()));
  return c.json({
    used: Number(row?.used ?? 0),
    quota: USER_QUOTA_BYTES,
    fileCount: Number(row?.fileCount ?? 0),
  });
});

export { filesRouter };

import { commentListQuerySchema, commentReadSchema } from "@transfile/shared";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { files, folders, shareComments, shares } from "../db/schema";
import type { FolderDatabase } from "../lib/folders";
import type { AuthVariables } from "../middleware/auth";
import { requireMember } from "../middleware/auth";

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const commentsRouter = new Hono<AppEnv>();
commentsRouter.use("*", requireMember);

function database(env: Env): FolderDatabase {
  return drizzle(env.DB);
}

commentsRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const parsed = commentListQuerySchema.safeParse({
    shareId: c.req.query("shareId"),
    fileId: c.req.query("fileId"),
    unread: c.req.query("unread"),
    limit: c.req.query("limit"),
    before: c.req.query("before"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const db = database(c.env);
  if (parsed.data.shareId !== undefined) {
    const [owned] = await db
      .select({ id: shares.id })
      .from(shares)
      .where(and(eq(shares.id, parsed.data.shareId), eq(shares.userId, userId)))
      .limit(1);
    if (!owned) {
      return c.json({ error: "Not found" }, 404);
    }
  }
  const before = parsed.data.before === undefined ? null : new Date(parsed.data.before);
  const rows = await db
    .select({
      id: shareComments.id,
      shareId: shareComments.shareId,
      fileId: shareComments.fileId,
      authorName: shareComments.authorName,
      body: shareComments.body,
      readAt: shareComments.readAt,
      createdAt: shareComments.createdAt,
      shareFileId: shares.fileId,
      shareFolderId: shares.folderId,
    })
    .from(shareComments)
    .innerJoin(shares, eq(shareComments.shareId, shares.id))
    .where(
      and(
        eq(shares.userId, userId),
        parsed.data.shareId === undefined ? undefined : eq(shareComments.shareId, parsed.data.shareId),
        parsed.data.fileId === undefined ? undefined : eq(shareComments.fileId, parsed.data.fileId),
        parsed.data.unread === "true" ? isNull(shareComments.readAt) : undefined,
        before === null ? undefined : lt(shareComments.createdAt, before),
      ),
    )
    .orderBy(desc(shareComments.createdAt))
    .limit(parsed.data.limit);

  const fileIds = [
    ...new Set(
      rows.flatMap((row) => {
        const ids: string[] = [];
        if (row.fileId !== null) ids.push(row.fileId);
        if (row.shareFileId !== null) ids.push(row.shareFileId);
        return ids;
      }),
    ),
  ];
  const folderIds = [
    ...new Set(rows.flatMap((row) => (row.shareFolderId === null ? [] : [row.shareFolderId]))),
  ];
  const fileNames = new Map<string, string>();
  const folderNames = new Map<string, string>();
  if (fileIds.length > 0) {
    const found = await db
      .select({ id: files.id, name: files.name })
      .from(files)
      .where(and(eq(files.userId, userId), inArray(files.id, fileIds.slice(0, 50))));
    for (const file of found) fileNames.set(file.id, file.name);
  }
  if (folderIds.length > 0) {
    const found = await db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(and(eq(folders.userId, userId), inArray(folders.id, folderIds.slice(0, 50))));
    for (const folder of found) folderNames.set(folder.id, folder.name);
  }

  return c.json({
    items: rows.map((row) => ({
      id: row.id,
      shareId: row.shareId,
      fileId: row.fileId,
      authorName: row.authorName,
      body: row.body,
      readAt: row.readAt,
      createdAt: row.createdAt,
      shareTitle:
        (row.shareFileId !== null ? fileNames.get(row.shareFileId) : undefined) ??
        (row.shareFolderId !== null ? folderNames.get(row.shareFolderId) : undefined) ??
        "Deleted item",
      fileName: row.fileId === null ? null : (fileNames.get(row.fileId) ?? null),
    })),
  });
});

commentsRouter.post("/read", async (c) => {
  const userId = c.get("user").id;
  let payload: unknown = {};
  if ((c.req.header("content-length") ?? "0") !== "0") {
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request" }, 400);
    }
  }
  const parsed = commentReadSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const db = database(c.env);
  const now = new Date();
  const owned = db
    .select({ id: shareComments.id })
    .from(shareComments)
    .innerJoin(shares, eq(shareComments.shareId, shares.id))
    .where(eq(shares.userId, userId));
  if (parsed.data.ids === undefined) {
    const rows = await owned;
    const ids = rows.map((row) => row.id);
    for (let index = 0; index < ids.length; index += 50) {
      const chunk = ids.slice(index, index + 50);
      await db
        .update(shareComments)
        .set({ readAt: now })
        .where(and(inArray(shareComments.id, chunk), isNull(shareComments.readAt)));
    }
  } else if (parsed.data.ids.length > 0) {
    const rows = await db
      .select({ id: shareComments.id })
      .from(shareComments)
      .innerJoin(shares, eq(shareComments.shareId, shares.id))
      .where(and(eq(shares.userId, userId), inArray(shareComments.id, parsed.data.ids)));
    if (rows.length === 0) {
      return c.json({ ok: true });
    }
    await db
      .update(shareComments)
      .set({ readAt: now })
      .where(
        and(
          inArray(
            shareComments.id,
            rows.map((row) => row.id),
          ),
          isNull(shareComments.readAt),
        ),
      );
  }
  return c.json({ ok: true });
});

commentsRouter.delete("/:id", async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  const [row] = await db
    .select({ id: shareComments.id })
    .from(shareComments)
    .innerJoin(shares, eq(shareComments.shareId, shares.id))
    .where(and(eq(shareComments.id, c.req.param("id")), eq(shares.userId, userId)))
    .limit(1);
  if (!row) {
    return c.json({ error: "Not found" }, 404);
  }
  await db.delete(shareComments).where(eq(shareComments.id, row.id));
  return c.body(null, 204);
});

export { commentsRouter };

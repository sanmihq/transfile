import { createTransferSchema, sanitizeFolderName } from "@transfile/shared";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { files, folders } from "../db/schema";
import { assertNoSiblingNameClash, getOwnedFolder, type FolderDatabase } from "../lib/folders";
import type { AuthVariables } from "../middleware/auth";
import { requireAuth, requireMember } from "../middleware/auth";

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const transfersRouter = new Hono<AppEnv>();

function database(env: Env): FolderDatabase {
  return drizzle(env.DB);
}

function defaultTitle(now: Date): string {
  const label = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Transfer, ${label}`;
}

transfersRouter.post("/", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  let payload: unknown = {};
  if ((c.req.header("content-length") ?? "0") !== "0") {
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request" }, 400);
    }
  }
  const parsed = createTransferSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const now = new Date();
  const requested = sanitizeFolderName(parsed.data.title ?? defaultTitle(now));
  if (requested.length === 0) {
    return c.json({ error: "Invalid request" }, 400);
  }
  let name = requested;
  for (let attempt = 2; attempt <= 20; attempt += 1) {
    if (!(await assertNoSiblingNameClash(db, userId, null, name))) {
      break;
    }
    const suffix = ` ${attempt}`;
    name = `${requested.slice(0, Math.max(1, 100 - suffix.length))}${suffix}`;
  }
  if (await assertNoSiblingNameClash(db, userId, null, name)) {
    return c.json({ error: "A folder with this name already exists" }, 409);
  }
  const id = crypto.randomUUID();
  await db.insert(folders).values({
    id,
    userId,
    parentId: null,
    name,
    kind: "transfer",
    createdAt: now,
  });
  return c.json({ id, name }, 201);
});

transfersRouter.delete("/:id", requireMember, async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  const folder = await getOwnedFolder(db, userId, c.req.param("id"));
  if (!folder || folder.kind !== "transfer") {
    return c.json({ error: "Not found" }, 404);
  }
  await db
    .update(files)
    .set({ deletedAt: new Date() })
    .where(and(eq(files.userId, userId), eq(files.folderId, folder.id), isNull(files.deletedAt)));
  await db.delete(folders).where(and(eq(folders.id, folder.id), eq(folders.userId, userId)));
  return c.body(null, 204);
});

export { transfersRouter };

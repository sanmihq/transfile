import { notificationListQuerySchema, notificationReadSchema } from "@transfile/shared";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { notifications } from "../db/schema";
import type { FolderDatabase } from "../lib/folders";
import type { AuthVariables } from "../middleware/auth";
import { requireMember } from "../middleware/auth";

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const notificationsRouter = new Hono<AppEnv>();
notificationsRouter.use("*", requireMember);

function database(env: Env): FolderDatabase {
  return drizzle(env.DB);
}

notificationsRouter.get("/unread-count", async (c) => {
  const userId = c.get("user").id;
  const [row] = await database(c.env)
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return c.json({ count: Number(row?.count ?? 0) });
});

notificationsRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const parsed = notificationListQuerySchema.safeParse({
    limit: c.req.query("limit"),
    before: c.req.query("before"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const before = parsed.data.before === undefined ? null : new Date(parsed.data.before);
  const db = database(c.env);
  const items = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      shareId: notifications.shareId,
      fileId: notifications.fileId,
      commentId: notifications.commentId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        before === null ? undefined : lt(notifications.createdAt, before),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(parsed.data.limit);
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return c.json({ items, unreadCount: Number(row?.count ?? 0) });
});

notificationsRouter.post("/read", async (c) => {
  const userId = c.get("user").id;
  let payload: unknown = {};
  if ((c.req.header("content-length") ?? "0") !== "0") {
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request" }, 400);
    }
  }
  const parsed = notificationReadSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const now = new Date();
  const db = database(c.env);
  if (parsed.data.ids === undefined) {
    await db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  } else if (parsed.data.ids.length > 0) {
    await db
      .update(notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(notifications.userId, userId),
          inArray(notifications.id, parsed.data.ids),
          isNull(notifications.readAt),
        ),
      );
  }
  return c.json({ ok: true });
});

notificationsRouter.delete("/:id", async (c) => {
  const userId = c.get("user").id;
  const deleted = await database(c.env)
    .delete(notifications)
    .where(and(eq(notifications.id, c.req.param("id")), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });
  if (deleted.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.body(null, 204);
});

notificationsRouter.delete("/", async (c) => {
  await database(c.env).delete(notifications).where(eq(notifications.userId, c.get("user").id));
  return c.body(null, 204);
});

export { notificationsRouter };

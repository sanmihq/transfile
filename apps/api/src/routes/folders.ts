import {
  MAX_FOLDER_DEPTH,
  createFolderSchema,
  listFolderQuerySchema,
  sanitizeFolderName,
  updateFolderSchema,
} from "@transfile/shared";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  SUBTREE_ROW_CAP,
  assertNoSiblingNameClash,
  getAncestors,
  getDepth,
  getOwnedFolder,
  getSubtreeHeight,
  getSubtreeIds,
  type FolderDatabase,
} from "../lib/folders";
import { files, folders } from "../db/schema";
import type { AuthVariables } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const ID_CHUNK = 50;

const foldersRouter = new Hono<AppEnv>();
foldersRouter.use("*", requireAuth);

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

function folderView(folder: {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
}) {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    createdAt: folder.createdAt,
  };
}

foldersRouter.get("/all", async (c) => {
  const userId = c.get("user").id;
  const rows = await database(c.env)
    .select({
      id: folders.id,
      name: folders.name,
      parentId: folders.parentId,
    })
    .from(folders)
    .where(eq(folders.userId, userId))
    .orderBy(asc(folders.name))
    .limit(2000);
  return c.json(rows);
});

foldersRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  const parsed = listFolderQuerySchema.safeParse({
    parentId: c.req.query("parentId"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }

  const parentId = parsed.data.parentId;
  const current =
    parentId === null ? null : await getOwnedFolder(db, userId, parentId);
  if (parentId !== null && current === null) {
    return c.json({ error: "Not found" }, 404);
  }

  const breadcrumbs =
    current === null ? [] : await getAncestors(db, userId, current.id);
  const childFolders = await db
    .select({
      id: folders.id,
      name: folders.name,
      parentId: folders.parentId,
      createdAt: folders.createdAt,
    })
    .from(folders)
    .where(
      and(
        eq(folders.userId, userId),
        parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId),
      ),
    )
    .orderBy(asc(folders.name));
  const childFiles = await db
    .select({
      id: files.id,
      name: files.name,
      size: files.size,
      mime: files.mime,
      folderId: files.folderId,
      createdAt: files.createdAt,
    })
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        eq(files.status, "ready"),
        isNull(files.deletedAt),
        parentId === null ? isNull(files.folderId) : eq(files.folderId, parentId),
      ),
    )
    .orderBy(desc(files.createdAt));

  return c.json({
    folder:
      current === null
        ? null
        : { id: current.id, name: current.name, parentId: current.parentId },
    breadcrumbs,
    folders: childFolders,
    files: childFiles,
  });
});

foldersRouter.post("/", async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  const payload = await readJson(c.req.raw);
  if (payload === undefined) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const parsed = createFolderSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }

  const name = sanitizeFolderName(parsed.data.name);
  if (name.length === 0) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const parentId = parsed.data.parentId ?? null;
  if (parentId !== null && (await getOwnedFolder(db, userId, parentId)) === null) {
    return c.json({ error: "Not found" }, 404);
  }

  const depth = (await getDepth(db, userId, parentId)) + 1;
  if (depth > MAX_FOLDER_DEPTH) {
    return c.json({ error: "Folder nesting too deep" }, 400);
  }
  if (await assertNoSiblingNameClash(db, userId, parentId, name)) {
    return c.json({ error: "A folder with this name already exists" }, 409);
  }

  const [created] = await db
    .insert(folders)
    .values({
      id: crypto.randomUUID(),
      userId,
      parentId,
      name,
    })
    .returning();
  if (!created) {
    return c.json({ error: "Internal error" }, 500);
  }
  return c.json(folderView(created), 201);
});

foldersRouter.patch("/:id", async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  const payload = await readJson(c.req.raw);
  if (payload === undefined) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const parsed = updateFolderSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }

  const folder = await getOwnedFolder(db, userId, c.req.param("id"));
  if (!folder) {
    return c.json({ error: "Not found" }, 404);
  }

  let nextName = folder.name;
  if (parsed.data.name !== undefined) {
    nextName = sanitizeFolderName(parsed.data.name);
    if (nextName.length === 0) {
      return c.json({ error: "Invalid request" }, 400);
    }
  }

  const nextParentId =
    parsed.data.parentId === undefined ? folder.parentId : parsed.data.parentId;
  if (parsed.data.parentId !== undefined) {
    if (
      nextParentId !== null &&
      (await getOwnedFolder(db, userId, nextParentId)) === null
    ) {
      return c.json({ error: "Not found" }, 404);
    }
    if (nextParentId !== null) {
      const subtreeIds = await getSubtreeIds(db, userId, folder.id);
      if (subtreeIds.includes(nextParentId)) {
        return c.json(
          { error: "Cannot move a folder into itself or its own subfolder" },
          400,
        );
      }
    }
    const nextDepth =
      (await getDepth(db, userId, nextParentId)) +
      (await getSubtreeHeight(db, userId, folder.id));
    if (nextDepth > MAX_FOLDER_DEPTH) {
      return c.json({ error: "Folder nesting too deep" }, 400);
    }
  }

  if (
    await assertNoSiblingNameClash(db, userId, nextParentId, nextName, folder.id)
  ) {
    return c.json({ error: "A folder with this name already exists" }, 409);
  }

  const [updated] = await db
    .update(folders)
    .set({ name: nextName, parentId: nextParentId })
    .where(and(eq(folders.id, folder.id), eq(folders.userId, userId)))
    .returning();
  if (!updated) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json(folderView(updated));
});

foldersRouter.delete("/:id", async (c) => {
  const userId = c.get("user").id;
  const db = database(c.env);
  const folder = await getOwnedFolder(db, userId, c.req.param("id"));
  if (!folder) {
    return c.json({ error: "Not found" }, 404);
  }

  const subtreeIds = await getSubtreeIds(db, userId, folder.id);
  if (subtreeIds.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }
  if (subtreeIds.length >= SUBTREE_ROW_CAP) {
    return c.json({ error: "Folder is too large to delete" }, 400);
  }

  const deletedAt = new Date();
  const statements: BatchItem<"sqlite">[] = [];
  for (const ids of chunkIds(subtreeIds)) {
    statements.push(
      db
        .update(files)
        .set({ deletedAt })
        .where(
          and(
            eq(files.userId, userId),
            inArray(files.folderId, ids),
            isNull(files.deletedAt),
          ),
        ),
    );
  }
  for (const ids of chunkIds(subtreeIds)) {
    statements.push(
      db
        .delete(folders)
        .where(and(eq(folders.userId, userId), inArray(folders.id, ids))),
    );
  }

  const [first, ...rest] = statements;
  if (!first) {
    return c.json({ error: "Not found" }, 404);
  }
  await db.batch([first, ...rest]);
  return c.body(null, 204);
});

export { foldersRouter };

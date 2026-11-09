import { MAX_FOLDER_DEPTH } from "@transfile/shared";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { folders } from "../db/schema";

export type FolderDatabase = ReturnType<typeof drizzle>;

export const SUBTREE_ROW_CAP = 5000;

type FolderRow = typeof folders.$inferSelect;

export async function getOwnedFolder(
  db: FolderDatabase,
  userId: string,
  folderId: string,
): Promise<FolderRow | null> {
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
    .limit(1);
  return folder ?? null;
}

export async function getAncestors(
  db: FolderDatabase,
  userId: string,
  folderId: string,
): Promise<{ id: string; name: string }[]> {
  const maxRows = MAX_FOLDER_DEPTH + 1;
  return db.all<{ id: string; name: string }>(sql`
    WITH RECURSIVE ancestors(id, name, parent_id, depth) AS (
      SELECT id, name, parent_id, 1
      FROM folders
      WHERE id = ${folderId} AND user_id = ${userId}
      UNION ALL
      SELECT parent.id, parent.name, parent.parent_id, ancestors.depth + 1
      FROM folders AS parent
      INNER JOIN ancestors ON parent.id = ancestors.parent_id
      WHERE parent.user_id = ${userId} AND ancestors.depth < ${maxRows}
    )
    SELECT id, name FROM ancestors ORDER BY depth DESC
  `);
}

export async function getDepth(
  db: FolderDatabase,
  userId: string,
  folderId: string | null,
): Promise<number> {
  if (folderId === null) {
    return 0;
  }
  const ancestors = await getAncestors(db, userId, folderId);
  return ancestors.length;
}

export async function getSubtreeIds(
  db: FolderDatabase,
  userId: string,
  folderId: string,
): Promise<string[]> {
  const rows = await db.all<{ id: string }>(sql`
    WITH RECURSIVE subtree(id) AS (
      SELECT id
      FROM folders
      WHERE id = ${folderId} AND user_id = ${userId}
      UNION ALL
      SELECT child.id
      FROM folders AS child
      INNER JOIN subtree ON child.parent_id = subtree.id
      WHERE child.user_id = ${userId}
      LIMIT ${SUBTREE_ROW_CAP}
    )
    SELECT id FROM subtree
  `);
  return rows.map((row) => row.id);
}

export async function getSubtreeHeight(
  db: FolderDatabase,
  userId: string,
  folderId: string,
): Promise<number> {
  const [row] = await db.all<{ height: number | null }>(sql`
    WITH RECURSIVE subtree(id, height) AS (
      SELECT id, 1
      FROM folders
      WHERE id = ${folderId} AND user_id = ${userId}
      UNION ALL
      SELECT child.id, subtree.height + 1
      FROM folders AS child
      INNER JOIN subtree ON child.parent_id = subtree.id
      WHERE child.user_id = ${userId} AND subtree.height < ${SUBTREE_ROW_CAP}
    )
    SELECT max(height) AS height FROM subtree
  `);
  return Number(row?.height ?? 0);
}

export async function assertNoSiblingNameClash(
  db: FolderDatabase,
  userId: string,
  parentId: string | null,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.userId, userId),
        sql`lower(${folders.name}) = lower(${name})`,
        parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId),
        excludeId === undefined ? undefined : ne(folders.id, excludeId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

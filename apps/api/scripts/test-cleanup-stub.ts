import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import { runCleanup } from "../src/cron/cleanup.ts";
import { files, user } from "../src/db/schema.ts";
import type { Storage } from "../src/storage/types.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

function bindingsFrom(value: unknown): Env {
  if (typeof value !== "object" || value === null || !("DB" in value)) {
    throw new Error("Local DB binding missing");
  }
  return value as Env;
}

async function applyMigrations(database: D1Database): Promise<void> {
  const directory = join(root, "drizzle");
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    const statements = readFileSync(join(directory, name), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) {
      await database.prepare(statement).run();
    }
  }
}

const failingStorage: Storage = {
  async createUpload() {
    throw new Error("unused");
  },
  async createDownload() {
    throw new Error("unused");
  },
  async head() {
    return null;
  },
  async delete() {
    throw new Error("storage delete failed");
  },
};

const proxy = await getPlatformProxy({
  configPath: join(root, "wrangler.jsonc"),
  envFiles: [],
  persist: false,
  remoteBindings: false,
});

let failed = false;
try {
  const env = bindingsFrom(proxy.env);
  await applyMigrations(env.DB);
  const db = drizzle(env.DB);
  const now = new Date();
  const userId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const old = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
  await db.insert(user).values({
    id: userId,
    name: "stub",
    email: `${userId}@example.com`,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(files).values({
    id: fileId,
    userId,
    name: "stub",
    r2Key: `${userId}/${fileId}`,
    size: 4,
    mime: "application/octet-stream",
    status: "ready",
    createdAt: old,
    deletedAt: old,
  });

  const report = await runCleanup(env, now, failingStorage);
  const [row] = await db.select({ id: files.id }).from(files).where(eq(files.id, fileId)).limit(1);
  if (!row || report.storageDeleteFailures !== 1 || report.purgedFiles !== 0) {
    console.log("FAIL storage failure keeps the row");
    failed = true;
  } else {
    console.log("PASS storage failure keeps the row");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.log(`FAIL storage failure keeps the row ${message.replace(/https?:\/\/\S+/gi, "[redacted]")}`);
  failed = true;
} finally {
  await proxy.dispose();
}

if (failed) {
  process.exit(1);
}

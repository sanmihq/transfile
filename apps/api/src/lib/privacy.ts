import { GUEST_POOL_BYTES, PREVIEW_MAX_BYTES, PREVIEW_MIMES } from "@transfile/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { files, user } from "../db/schema";
import { notExpired } from "./files";
import type { FolderDatabase } from "./folders";

declare global {
  interface Env {
    TURNSTILE_SECRET?: string;
    GUEST_POOL_BYTES?: string;
  }
}

const textEncoder = new TextEncoder();

export function userIsGuest(account: { isAnonymous?: boolean | null }): boolean {
  return account.isAnonymous === true;
}

export function guestPoolLimit(env: { GUEST_POOL_BYTES?: string }): number {
  const raw = env.GUEST_POOL_BYTES?.trim() ?? "";
  if (raw.length === 0) {
    return GUEST_POOL_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return GUEST_POOL_BYTES;
  }
  return parsed;
}

export async function guestPoolUsed(db: FolderDatabase, now: Date): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`coalesce(sum(${files.size}), 0)` })
    .from(files)
    .innerJoin(user, eq(files.userId, user.id))
    .where(and(eq(user.isAnonymous, true), isNull(files.deletedAt), notExpired(now)));
  return Number(row?.used ?? 0);
}

export async function ownerIsGuest(db: FolderDatabase, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ isAnonymous: user.isAnonymous })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.isAnonymous === true;
}

export function requestCountry(request: Request): string | null {
  const withCf = request as Request & { cf?: { country?: unknown } };
  const country = withCf.cf?.country;
  if (typeof country !== "string" || !/^[A-Za-z]{2}$/.test(country)) {
    return null;
  }
  return country.toUpperCase();
}

export function clientIp(header: string | undefined): string {
  const value = header?.trim() ?? "";
  return value.length > 0 ? value : "local";
}

export async function visitorHash(
  secret: string,
  ip: string,
  userAgent: string,
  shareId: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(`${ip}|${userAgent}|${shareId}`),
  );
  const bytes = new Uint8Array(signature).slice(0, 16);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function isPreviewable(mime: string | null, size: number): boolean {
  if (mime === null || size <= 0 || size > PREVIEW_MAX_BYTES) {
    return false;
  }
  return (PREVIEW_MIMES as readonly string[]).includes(mime);
}

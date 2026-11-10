export type ShareEnv = {
  SHARE_SECRET?: string;
};

declare global {
  interface Env {
    SHARE_SECRET?: string;
  }
}

export type GrantPurpose = "access" | "download" | "preview";

export type GrantPayload = {
  v: 1;
  p: GrantPurpose;
  s: string;
  f?: string;
  pv: string;
  exp: number;
};

export const ACCESS_GRANT_SECONDS = 30 * 60;
export const DOWNLOAD_GRANT_SECONDS = 5 * 60;

const textEncoder = new TextEncoder();

export function requireShareSecret(env: ShareEnv): string {
  const secret = env.SHARE_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error("SHARE_SECRET must be at least 32 characters");
  }
  return secret;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function isGrantPayload(value: unknown): value is GrantPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.v !== 1 || (record.p !== "access" && record.p !== "download" && record.p !== "preview")) {
    return false;
  }
  if (typeof record.s !== "string" || record.s.length === 0) {
    return false;
  }
  if (typeof record.pv !== "string" || record.pv.length === 0) {
    return false;
  }
  if (typeof record.exp !== "number" || !Number.isInteger(record.exp)) {
    return false;
  }
  if (record.f !== undefined && (typeof record.f !== "string" || record.f.length === 0)) {
    return false;
  }
  return true;
}

function readPayload(token: string): { payload: GrantPayload; segment: string; signature: Uint8Array } | null {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator !== token.lastIndexOf(".")) {
    return null;
  }
  const segment = token.slice(0, separator);
  const signature = base64UrlToBytes(token.slice(separator + 1));
  const payloadBytes = base64UrlToBytes(segment);
  if (signature === null || payloadBytes === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (!isGrantPayload(parsed)) {
      return null;
    }
    return { payload: parsed, segment, signature };
  } catch {
    return null;
  }
}

export async function signGrant(env: ShareEnv, payload: GrantPayload): Promise<string> {
  const segment = bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(requireShareSecret(env)),
    textEncoder.encode(segment),
  );
  return `${segment}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyGrant(
  env: ShareEnv,
  token: string,
  expected: {
    purpose: GrantPurpose;
    shareId: string;
    passwordVersion: string;
    fileId?: string;
  },
): Promise<boolean> {
  const parsed = readPayload(token);
  if (parsed === null) {
    return false;
  }
  const signatureValid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(requireShareSecret(env)),
    toArrayBuffer(parsed.signature),
    textEncoder.encode(parsed.segment),
  );
  if (!signatureValid) {
    return false;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.payload.exp <= nowSeconds) {
    return false;
  }
  if (parsed.payload.p !== expected.purpose || parsed.payload.s !== expected.shareId) {
    return false;
  }
  if (parsed.payload.pv !== expected.passwordVersion) {
    return false;
  }
  if (expected.fileId !== undefined && parsed.payload.f !== expected.fileId) {
    return false;
  }
  if (
    (expected.purpose === "download" || expected.purpose === "preview") &&
    parsed.payload.f === undefined
  ) {
    return false;
  }
  return true;
}

export function grantFileId(token: string): string | null {
  return readPayload(token)?.payload.f ?? null;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

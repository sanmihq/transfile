// Better Auth's default hasher is too expensive for the free Workers CPU
// limit (~10ms). PBKDF2-SHA-256 at 100000 iterations is the maximum Workers allows.

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: ITERATIONS,
    },
    keyMaterial,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveKey(password, salt);
  return `pbkdf2$${ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = left.length === right.length ? 0 : 1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const parts = hash.split("$");
  if (parts.length !== 4) {
    return false;
  }
  const [algorithm, iterations, saltBase64, hashBase64] = parts;
  if (
    algorithm !== "pbkdf2" ||
    iterations !== String(ITERATIONS) ||
    saltBase64 === undefined ||
    hashBase64 === undefined
  ) {
    return false;
  }
  const salt = base64ToBytes(saltBase64);
  const expected = base64ToBytes(hashBase64);
  if (
    salt === null ||
    expected === null ||
    salt.length !== SALT_BYTES ||
    expected.length !== KEY_BYTES
  ) {
    return false;
  }
  const actual = await deriveKey(password, salt);
  return constantTimeEqual(actual, expected);
}

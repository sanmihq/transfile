import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";

const here = dirname(fileURLToPath(import.meta.url));
const varsPath = resolve(here, "../.dev.vars");
const required = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET"];

function parseDevVars(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    values[key] = trimmed.slice(separator + 1).trim();
  }
  return values;
}

function normalizeEndpoint(value) {
  const withoutProtocol = value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const pathStart = withoutProtocol.indexOf("/");
  return pathStart === -1 ? withoutProtocol : withoutProtocol.slice(0, pathStart);
}

function encodeKey(key) {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function safeDetail(error) {
  const message = error instanceof Error ? error.message : "request failed";
  if (/https?:|x-amz|credential|secret/i.test(message)) return "request failed";
  return message;
}

const objectKey = process.argv[2];
if (!objectKey) {
  console.log("FAIL missing key");
  process.exit(1);
}

const env = parseDevVars(readFileSync(varsPath, "utf8"));
const endpoint = env.S3_ENDPOINT ? normalizeEndpoint(env.S3_ENDPOINT) : "";
const region = (env.S3_REGION ?? "").trim() || (endpoint.split(".")[1] ?? "");
const missing = required.filter((name) => !env[name] || env[name].trim() === "");
if (!region) missing.push("S3_REGION");
if (missing.length > 0) {
  console.log(`FAIL credentials missing ${missing.join(", ")}`);
  process.exit(1);
}

const client = new AwsClient({
  accessKeyId: env.S3_ACCESS_KEY_ID.trim(),
  secretAccessKey: env.S3_SECRET_ACCESS_KEY.trim(),
  service: "s3",
  region,
});
const bucket = env.S3_BUCKET.trim();
const objectUrl = new URL(
  `https://${endpoint}/${encodeURIComponent(bucket)}/${encodeKey(objectKey)}`,
);

try {
  const head = await client.fetch(objectUrl, { method: "HEAD" });
  await head.body?.cancel();
  console.log(String(head.status));
} catch (error) {
  console.log(`FAIL ${safeDetail(error)}`);
  process.exit(1);
}

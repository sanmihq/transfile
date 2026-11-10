import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";

// Keep URL building and signing in step with S3Storage in src/storage/s3.ts.

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

function signedHeaderNames(url) {
  const value = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
  return new Set(value.split(";").filter((name) => name.length > 0));
}

const failed = [];

function safeDetail(error) {
  const message = error instanceof Error ? error.message : "request failed";
  if (/https?:|x-amz|credential|secret/i.test(message)) return "request failed";
  return message;
}

function report(name, ok, detail = "") {
  if (ok) {
    console.log(`PASS ${name}`);
    return;
  }
  console.log(`FAIL ${name}${detail ? ` ${detail}` : ""}`);
  failed.push(name);
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
const key = `healthcheck/${crypto.randomUUID()}.txt`;
const objectUrl = new URL(
  `https://${endpoint}/${encodeURIComponent(bucket)}/${encodeKey(key)}`,
);
const body = Buffer.alloc(64, 7);

let uploadHeaders = {};
let putUrl = "";
try {
  const putTarget = new URL(objectUrl);
  putTarget.searchParams.set("X-Amz-Expires", "600");
  const unsignedPut = putTarget.toString();
  let signedPut;
  try {
    signedPut = await client.sign(
      new Request(unsignedPut, {
        method: "PUT",
        headers: { "content-length": String(body.length) },
      }),
      { aws: { signQuery: true, allHeaders: true } },
    );
    if (!signedHeaderNames(signedPut.url).has("content-length")) {
      signedPut = await client.sign(new Request(unsignedPut, { method: "PUT" }), {
        aws: { signQuery: true },
      });
    }
  } catch {
    signedPut = await client.sign(new Request(unsignedPut, { method: "PUT" }), {
      aws: { signQuery: true },
    });
  }
  putUrl = signedPut.url;
  if (signedHeaderNames(putUrl).has("content-length")) {
    uploadHeaders = { "Content-Length": String(body.length) };
  }
  const put = await fetch(putUrl, { method: "PUT", headers: uploadHeaders, body });
  await put.arrayBuffer();
  report("presigned PUT", put.status >= 200 && put.status < 300, `status=${put.status}`);
} catch (error) {
  report("presigned PUT", false, safeDetail(error));
}

let headLength = "";
try {
  const head = await client.fetch(objectUrl, { method: "HEAD" });
  headLength = head.headers.get("content-length") ?? "";
  await head.body?.cancel();
  report(
    "signed HEAD size is 64",
    head.status === 200 && headLength === "64",
    `status=${head.status} content-length=${headLength || "missing"}`,
  );
} catch (error) {
  report("signed HEAD size is 64", false, safeDetail(error));
}

try {
  const getTarget = new URL(objectUrl);
  getTarget.searchParams.set("X-Amz-Expires", "300");
  getTarget.searchParams.set(
    "response-content-disposition",
    "attachment; filename=\"healthcheck.txt\"; filename*=UTF-8''healthcheck.txt",
  );
  getTarget.searchParams.set("response-content-type", "application/octet-stream");
  const signedGet = await client.sign(new Request(getTarget, { method: "GET" }), {
    aws: { signQuery: true },
  });
  const downloaded = await fetch(signedGet.url);
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  const disposition = downloaded.headers.get("content-disposition") ?? "(absent)";
  const matches = downloaded.status === 200 && bytes.equals(body);
  report("presigned GET bytes match", matches, `status=${downloaded.status}`);
  console.log(`Content-Disposition: ${disposition}`);
} catch (error) {
  report("presigned GET bytes match", false, safeDetail(error));
}

let deletedOk = false;
try {
  const deleted = await client.fetch(objectUrl, { method: "DELETE" });
  await deleted.body?.cancel();
  deletedOk = deleted.status === 204 || deleted.status === 200 || deleted.status === 404;
  report("signed DELETE", deletedOk, `status=${deleted.status}`);
} catch (error) {
  report("signed DELETE", false, safeDetail(error));
}

try {
  const after = await client.fetch(objectUrl, { method: "HEAD" });
  await after.body?.cancel();
  report("HEAD after delete is 404", after.status === 404, `status=${after.status}`);
} catch (error) {
  report("HEAD after delete is 404", false, safeDetail(error));
}

if (failed.length > 0) process.exit(1);

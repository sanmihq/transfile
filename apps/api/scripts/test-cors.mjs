import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";

// Presigning matches S3Storage in src/storage/s3.ts.

const here = dirname(fileURLToPath(import.meta.url));
const varsPath = resolve(here, "../.dev.vars");
const required = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET"];
const origin = process.argv[2] && process.argv[2].trim() !== "" ? process.argv[2].trim() : "http://localhost:5173";

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

function safeDetail(error) {
  const message = error instanceof Error ? error.message : "request failed";
  if (/https?:|x-amz|credential|secret/i.test(message)) return "request failed";
  return message;
}

const failed = [];
const missingHeaders = [];

function report(name, ok, detail = "") {
  if (ok) {
    console.log(`PASS ${name}`);
    return;
  }
  console.log(`FAIL ${name}${detail ? ` ${detail}` : ""}`);
  failed.push(name);
}

function headerValue(response, name) {
  return response.headers.get(name) ?? "";
}

function originMatches(value) {
  return value.trim() === origin;
}

function methodsAllowPut(value) {
  return value.split(",").some((part) => part.trim().toUpperCase() === "PUT" || part.trim() === "*");
}

function methodsAllowGet(value) {
  return value.split(",").some((part) => part.trim().toUpperCase() === "GET" || part.trim() === "*");
}

function headersAllowContentType(value) {
  const parts = value.split(",").map((part) => part.trim().toLowerCase());
  return parts.includes("*") || parts.includes("content-type");
}

function noteMissing(label) {
  missingHeaders.push(label);
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
} catch (error) {
  report("presign PUT", false, safeDetail(error));
}

if (putUrl) {
  try {
    const preflight = await fetch(putUrl, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    await preflight.arrayBuffer();
    const allowOrigin = headerValue(preflight, "access-control-allow-origin");
    const allowMethods = headerValue(preflight, "access-control-allow-methods");
    const allowHeaders = headerValue(preflight, "access-control-allow-headers");
    const originOk = originMatches(allowOrigin);
    const methodsOk = methodsAllowPut(allowMethods);
    const headersOk = headersAllowContentType(allowHeaders);
    if (!originOk) noteMissing("PUT preflight Access-Control-Allow-Origin");
    if (!methodsOk) noteMissing("PUT preflight Access-Control-Allow-Methods PUT");
    if (!headersOk) noteMissing("PUT preflight Access-Control-Allow-Headers content-type");
    report(
      "PUT preflight",
      originOk && methodsOk && headersOk,
      `status=${preflight.status} origin=${originOk} methods=${methodsOk} headers=${headersOk}`,
    );
  } catch (error) {
    report("PUT preflight", false, safeDetail(error));
    noteMissing("PUT preflight response");
  }

  try {
    const putHeaders = { Origin: origin };
    if (signedHeaderNames(putUrl).has("content-length")) {
      putHeaders["Content-Length"] = String(body.length);
    }
    const put = await fetch(putUrl, { method: "PUT", headers: putHeaders, body });
    await put.arrayBuffer();
    const allowOrigin = headerValue(put, "access-control-allow-origin");
    const originOk = originMatches(allowOrigin);
    if (!originOk) noteMissing("PUT Access-Control-Allow-Origin");
    report(
      "PUT allows origin",
      put.status >= 200 && put.status < 300 && originOk,
      `status=${put.status} origin=${originOk}`,
    );
  } catch (error) {
    report("PUT allows origin", false, safeDetail(error));
    noteMissing("PUT Access-Control-Allow-Origin");
  }
}

let getUrl = "";
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
  getUrl = signedGet.url;
} catch (error) {
  report("presign GET", false, safeDetail(error));
}

if (getUrl) {
  try {
    const downloaded = await fetch(getUrl, { headers: { Origin: origin } });
    await downloaded.arrayBuffer();
    const allowOrigin = headerValue(downloaded, "access-control-allow-origin");
    const originOk = originMatches(allowOrigin);
    if (!originOk) noteMissing("GET Access-Control-Allow-Origin");
    report(
      "GET allows origin",
      downloaded.status === 200 && originOk,
      `status=${downloaded.status} origin=${originOk}`,
    );
  } catch (error) {
    report("GET allows origin", false, safeDetail(error));
    noteMissing("GET Access-Control-Allow-Origin");
  }

  try {
    const preflight = await fetch(getUrl, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    await preflight.arrayBuffer();
    const allowOrigin = headerValue(preflight, "access-control-allow-origin");
    const allowMethods = headerValue(preflight, "access-control-allow-methods");
    const originOk = originMatches(allowOrigin);
    const methodsOk = methodsAllowGet(allowMethods);
    if (!originOk) noteMissing("GET preflight Access-Control-Allow-Origin");
    if (!methodsOk) noteMissing("GET preflight Access-Control-Allow-Methods GET");
    report(
      "GET preflight",
      originOk && methodsOk,
      `status=${preflight.status} origin=${originOk} methods=${methodsOk}`,
    );
  } catch (error) {
    report("GET preflight", false, safeDetail(error));
    noteMissing("GET preflight response");
  }
}

try {
  const deleted = await client.fetch(objectUrl, { method: "DELETE" });
  await deleted.body?.cancel();
  const ok = deleted.status === 204 || deleted.status === 200 || deleted.status === 404;
  report("signed DELETE", ok, `status=${deleted.status}`);
} catch (error) {
  report("signed DELETE", false, safeDetail(error));
}

if (missingHeaders.length > 0) {
  console.log("CORS NOT CONFIGURED");
  for (const item of missingHeaders) console.log(`missing: ${item}`);
}

if (failed.length > 0 || missingHeaders.length > 0) process.exit(1);

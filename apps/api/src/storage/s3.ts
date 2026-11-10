import { AwsClient } from "aws4fetch";
import { attachmentContentDisposition } from "./content-disposition";
import type { StorageEnv } from "./env";
import type { Storage, UploadTarget } from "./types";

const PUT_EXPIRES_SECONDS = 600;
const GET_EXPIRES_SECONDS = 300;

type S3Config = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export function normalizeS3Endpoint(value: string): string {
  const withoutProtocol = value.trim().replace(/^https?:\/\//i, "");
  const withoutSlash = withoutProtocol.replace(/\/+$/, "");
  const pathStart = withoutSlash.indexOf("/");
  return pathStart === -1 ? withoutSlash : withoutSlash.slice(0, pathStart);
}

export function regionFromS3Endpoint(endpoint: string): string {
  return endpoint.split(".")[1] ?? "";
}

function requireS3Config(env: StorageEnv): S3Config {
  const endpoint = env.S3_ENDPOINT ? normalizeS3Endpoint(env.S3_ENDPOINT) : "";
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim() ?? "";
  const bucket = env.S3_BUCKET?.trim() ?? "";
  const region = env.S3_REGION?.trim() || (endpoint ? regionFromS3Endpoint(endpoint) : "");
  const missing: string[] = [];
  if (!endpoint) missing.push("S3_ENDPOINT");
  if (!region) missing.push("S3_REGION");
  if (!accessKeyId) missing.push("S3_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("S3_SECRET_ACCESS_KEY");
  if (!bucket) missing.push("S3_BUCKET");
  if (missing.length > 0) {
    throw new Error(`S3 storage requires ${missing.join(", ")}`);
  }
  return { endpoint, region, accessKeyId, secretAccessKey, bucket };
}

function encodeObjectKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export class S3Storage implements Storage {
  private readonly client: AwsClient;
  private readonly endpoint: string;
  private readonly bucket: string;

  constructor(env: StorageEnv) {
    const config = requireS3Config(env);
    this.endpoint = config.endpoint;
    this.bucket = config.bucket;
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: config.region,
    });
  }

  async createUpload(args: {
    key: string;
    fileId: string;
    size: number;
    mime: string;
    origin: string;
  }): Promise<UploadTarget> {
    const url = this.objectUrl(args.key);
    url.searchParams.set("X-Amz-Expires", String(PUT_EXPIRES_SECONDS));
    const signed = await this.signPut(url, args.size);
    const signedNames = signedHeaderNames(signed.url);
    const headers: Record<string, string> = {};
    if (signedNames.has("content-length")) {
      headers["Content-Length"] = String(args.size);
    }
    if (signedNames.has("content-type")) {
      headers["Content-Type"] = args.mime;
    }
    return { method: "PUT", url: signed.url, headers };
  }

  async createDownload(args: {
    key: string;
    fileId: string;
    fileName: string;
    origin: string;
  }): Promise<{ url: string }> {
    const url = this.objectUrl(args.key);
    url.searchParams.set("X-Amz-Expires", String(GET_EXPIRES_SECONDS));
    url.searchParams.set(
      "response-content-disposition",
      attachmentContentDisposition(args.fileName),
    );
    url.searchParams.set("response-content-type", "application/octet-stream");
    const signed = await this.client.sign(new Request(url, { method: "GET" }), {
      aws: { signQuery: true },
    });
    return { url: signed.url };
  }

  async head(key: string): Promise<{ size: number } | null> {
    const response = await this.client.fetch(this.objectUrl(key), { method: "HEAD" });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`S3 HEAD failed with status ${response.status}`);
    }
    const length = response.headers.get("content-length");
    await response.body?.cancel();
    if (length === null || !/^\d+$/.test(length)) {
      throw new Error("S3 HEAD response is missing Content-Length");
    }
    return { size: Number(length) };
  }

  async delete(key: string): Promise<void> {
    const response = await this.client.fetch(this.objectUrl(key), { method: "DELETE" });
    await response.body?.cancel();
    if (response.status === 204 || response.status === 200 || response.status === 404) {
      return;
    }
    throw new Error(`S3 DELETE failed with status ${response.status}`);
  }

  private objectUrl(key: string): URL {
    return new URL(
      `https://${this.endpoint}/${encodeURIComponent(this.bucket)}/${encodeObjectKey(key)}`,
    );
  }

  private async signPut(url: URL, size: number): Promise<Request> {
    const unsigned = url.toString();
    try {
      const signed = await this.client.sign(
        new Request(unsigned, {
          method: "PUT",
          headers: { "content-length": String(size) },
        }),
        { aws: { signQuery: true, allHeaders: true } },
      );
      if (signedHeaderNames(signed.url).has("content-length")) {
        return signed;
      }
    } catch {
      // Content-Length could not be attached to the request to sign.
    }
    // aws4fetch treats content-length as unsignable unless allHeaders is set,
    // and some S3 providers reject a signed Content-Length. When it is not in
    // the signature, the browser is not told to send it. Object size is
    // enforced by the HEAD check in POST /api/files/:id/complete.
    return this.client.sign(new Request(unsigned, { method: "PUT" }), {
      aws: { signQuery: true },
    });
  }
}

function signedHeaderNames(url: string): Set<string> {
  const value = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
  return new Set(value.split(";").filter((name) => name.length > 0));
}

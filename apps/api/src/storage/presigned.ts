import { AwsClient } from "aws4fetch";
import { attachmentContentDisposition } from "./content-disposition";
import type { Storage, UploadTarget } from "./types";

const PUT_EXPIRES_SECONDS = 600;
const GET_EXPIRES_SECONDS = 300;

function requireR2Config(env: Env): {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
} {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucketName = env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      "Presigned storage requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME",
    );
  }
  return { accountId, accessKeyId, secretAccessKey, bucketName };
}

function objectUrl(accountId: string, bucketName: string, key: string): URL {
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(
    `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${encodedKey}`,
  );
}

export class PresignedStorage implements Storage {
  private readonly client: AwsClient;
  private readonly accountId: string;
  private readonly bucketName: string;
  private readonly files: Env["FILES"];

  constructor(env: Env) {
    const config = requireR2Config(env);
    this.accountId = config.accountId;
    this.bucketName = config.bucketName;
    this.files = env.FILES;
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }

  async createUpload(args: {
    key: string;
    fileId: string;
    size: number;
    mime: string;
    origin: string;
  }): Promise<UploadTarget> {
    const url = objectUrl(this.accountId, this.bucketName, args.key);
    url.searchParams.set("X-Amz-Expires", String(PUT_EXPIRES_SECONDS));
    const signed = await this.client.sign(
      new Request(url, {
        method: "PUT",
        headers: { "content-type": args.mime },
      }),
      { aws: { signQuery: true } },
    );
    return {
      method: "PUT",
      url: signed.url,
      headers: { "content-type": args.mime },
    };
  }

  async createDownload(args: {
    key: string;
    fileId: string;
    fileName: string;
    origin: string;
  }): Promise<{ url: string }> {
    const url = objectUrl(this.accountId, this.bucketName, args.key);
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
    const object = await this.files.head(key);
    if (!object) {
      return null;
    }
    return { size: object.size };
  }

  async delete(key: string): Promise<void> {
    await this.files.delete(key);
  }
}

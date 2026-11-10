import type { StorageEnv } from "./env";
import { S3Storage } from "./s3";
import type { Storage } from "./types";
import { WorkerStorage } from "./worker";

// TODO: production has no Cloudflare R2 bucket. Remove the FILES binding from
// wrangler.jsonc in the deploy task once STORAGE_MODE=s3 is live.

export function isS3Mode(env: StorageEnv): boolean {
  return env.STORAGE_MODE === "s3" || env.STORAGE_MODE === "presigned";
}

export function getStorage(env: StorageEnv): Storage {
  if (isS3Mode(env)) {
    return new S3Storage(env);
  }
  return new WorkerStorage(env);
}

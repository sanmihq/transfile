// Local wrangler still provides FILES. Production S3 mode will not, so every
// read of the binding goes through this optional view instead of the generated
// Env, which still lists FILES until the R2 binding is removed from wrangler.
export type StorageEnv = {
  STORAGE_MODE?: string;
  FILES?: R2Bucket;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_BUCKET?: string;
};

export function requireFilesBinding(env: StorageEnv): R2Bucket {
  if (!env.FILES) {
    throw new Error("Worker storage requires the FILES binding");
  }
  return env.FILES;
}

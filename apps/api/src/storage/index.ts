import { PresignedStorage } from "./presigned";
import type { Storage } from "./types";
import { WorkerStorage } from "./worker";

export function getStorage(env: Env): Storage {
  if (env.STORAGE_MODE === "presigned") {
    return new PresignedStorage(env);
  }
  return new WorkerStorage(env);
}

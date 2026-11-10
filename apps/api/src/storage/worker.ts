import { requireFilesBinding, type StorageEnv } from "./env";
import type { Storage, UploadTarget } from "./types";

export class WorkerStorage implements Storage {
  private readonly files: R2Bucket;

  constructor(env: StorageEnv) {
    this.files = requireFilesBinding(env);
  }

  createUpload(args: {
    key: string;
    fileId: string;
    size: number;
    mime: string;
    origin: string;
  }): Promise<UploadTarget> {
    return Promise.resolve({
      method: "PUT",
      url: `${args.origin}/api/files/${args.fileId}/content`,
      headers: {},
    });
  }

  createDownload(args: {
    key: string;
    fileId: string;
    fileName: string;
    origin: string;
  }): Promise<{ url: string }> {
    return Promise.resolve({
      url: `${args.origin}/api/files/${args.fileId}/content`,
    });
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

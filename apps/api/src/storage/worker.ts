import type { Storage, UploadTarget } from "./types";

export class WorkerStorage implements Storage {
  constructor(private readonly env: Env) {}

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
    const object = await this.env.FILES.head(key);
    if (!object) {
      return null;
    }
    return { size: object.size };
  }

  async delete(key: string): Promise<void> {
    await this.env.FILES.delete(key);
  }
}

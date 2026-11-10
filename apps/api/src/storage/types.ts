export interface UploadTarget {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
}

export interface Storage {
  createUpload(args: {
    key: string;
    fileId: string;
    size: number;
    mime: string;
    origin: string;
  }): Promise<UploadTarget>;
  createDownload(args: {
    key: string;
    fileId: string;
    fileName: string;
    origin: string;
  }): Promise<{ url: string }>;
  createPreview(args: {
    key: string;
    fileId: string;
    fileName: string;
    mime: string;
    origin: string;
  }): Promise<{ url: string }>;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
}

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const USER_QUOTA_BYTES = 100 * 1024 * 1024;
export const MAX_FILENAME_LENGTH = 255;
export const MAX_FOLDER_NAME_LENGTH = 100;
export const MAX_FOLDER_DEPTH = 20;
export const MAX_EXPIRY_HOURS = 72;
export const DEFAULT_EXPIRY_HOURS = 72;
export const MAX_SHARE_DOWNLOADS = 1000;
export const SHARE_PASSWORD_MIN = 6;
export const SHARE_PASSWORD_MAX = 128;
export const MAX_UNLOCK_ATTEMPTS = 5;
export const UNLOCK_LOCKOUT_MINUTES = 15;
export const MAX_ACTIVE_SHARES_PER_USER = 200;
export const SOFT_DELETE_RETENTION_DAYS = 1;
export const PENDING_UPLOAD_TTL_HOURS = 2;
export const SHARE_RETENTION_AFTER_END_DAYS = 7;
export const GUEST_POOL_BYTES = 2 * 1024 * 1024 * 1024;
export const COMMENT_MAX = 1000;
export const COMMENT_NAME_MAX = 50;
export const MESSAGE_MAX = 500;
export const TRANSFER_TITLE_MAX = 100;
export const COMMENTS_PER_VISITOR_PER_HOUR = 5;
export const COMMENTS_PER_SHARE_MAX = 100;
export const NOTIFICATION_RETENTION_DAYS = 30;
export const EVENT_RETENTION_DAYS = 30;
export const GUEST_USER_RETENTION_DAYS = 14;
export const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
export const PREVIEW_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export type PreviewMime = (typeof PREVIEW_MIMES)[number];

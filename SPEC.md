# Transfile

## Stack
React+Vite, Tailwind, shadcn/ui, TanStack Query, Hono (Workers), Zod,
D1 + Drizzle, R2, Better Auth, Cron Triggers.

## Limits
Max file 100 MB. Per-user quota 1 GB. Default share expiry 7 days, max 30.

## Auth
Better Auth with email/password (Google/GitHub later). Better Auth owns the
user, session, account and verification tables. App tables reference user.id.
Test password hashing against the free Worker CPU limit early.

## App tables
folders(id, user_id, parent_id NULL, name, created_at)
files(id, user_id, folder_id NULL, name, r2_key, size, mime,
      status[pending|ready], created_at, deleted_at NULL)
shares(id, file_id OR folder_id, token, password_hash NULL,
       expires_at, max_downloads NULL, download_count, revoked_at NULL)

## API
Auth routes handled by Better Auth (/api/auth/*)
GET /folders/:id?   POST /folders   PATCH|DELETE /folders/:id
POST /files/upload-url        → pending row + presigned PUT
POST /files/:id/complete      → verify size in R2, mark ready
GET  /files/:id/download-url  PATCH|DELETE /files/:id
POST /shares   GET /shares   DELETE /shares/:id
GET  /s/:token (public metadata)   POST /s/:token/unlock   GET /s/:token/download

## Cron (hourly)
Delete expired shares; purge soft-deleted files >7 days from R2 + DB;
remove stale `pending` uploads.

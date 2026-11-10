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
      status[pending|ready], created_at, deleted_at NULL, expires_at NULL)
shares(id, file_id OR folder_id, token, password_hash NULL,
       expires_at, max_downloads NULL, download_count, revoked_at NULL)

## API
Auth routes handled by Better Auth (/api/auth/*)
GET /api/folders?parentId=   GET /api/folders/all   POST /api/folders
PATCH|DELETE /api/folders/:id
POST /api/files/upload-url        → pending row + upload URL
POST /api/files/:id/complete      → verify size in storage, mark ready
GET  /api/files/:id/download-url  PATCH|DELETE /api/files/:id
GET  /api/usage
POST /api/shares   GET /api/shares   PATCH|DELETE /api/shares/:id
GET  /api/s/:token                         public metadata
POST /api/s/:token/unlock                  exchange a password for an access token
GET  /api/s/:token/contents                folder share listing
GET  /api/s/:token/download-url            counts one download, returns a URL
GET  /api/s/:token/file/:grant             worker-mode bytes only

Share links store the raw token so an owner can copy the same URL again.
Password-protected links use a short-lived HMAC access token in the
X-Share-Access header instead of a cookie, so the grant is not sent cross-site.
Five failed unlocks lock that share for 15 minutes. Download grants last 5
minutes and do not increment the counter again when the bytes are fetched.

## Cron (hourly)
Mark ready files past expiresAt as soft-deleted. After 7 days, delete their
storage objects and then their rows. Remove pending uploads older than 2
hours. Delete shares that expired or were revoked more than 7 days ago, and
delete expired Better Auth sessions and verifications. Each run is bounded
and safe to repeat.

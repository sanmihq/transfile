# Transfile

## Stack
React+Vite, Tailwind, shadcn/ui, TanStack Query, Hono (Workers), Zod,
D1 + Drizzle, R2, Better Auth, Cron Triggers.

## Limits
Max file 100 MB. Per-account storage 100 MB. Every file and every link lives
at most 72 hours (1..72, default 72). Extending never passes createdAt + 72h.
Guests share a 2 GB pool. Soft-deleted files are purged after 1 day. Pending
uploads older than 2 hours are removed. Ended shares are removed after 7 days.
Notifications and activity events are kept for 30 days. Guest accounts with no
files are removed after 14 days.

## Auth
Better Auth with email/password (Google/GitHub later) and the anonymous plugin
for guests. Better Auth owns the user, session, account and verification
tables. App tables reference user.id. Guests can upload into a transfer and
create a link. They cannot list, track, read comments, or see notifications.
Linking a guest to a new account moves their folders, files, shares and
notifications before the guest user is deleted.

## App tables
folders(id, user_id, parent_id NULL, name, kind[folder|transfer], created_at)
files(id, user_id, folder_id NULL, name, r2_key, size, mime,
      status[pending|ready], created_at, deleted_at NULL, expires_at)
shares(id, file_id OR folder_id, token, password_hash NULL,
       expires_at, max_downloads NULL, download_count, revoked_at NULL,
       allow_comments, message NULL)
share_comments(id, share_id, file_id NULL, author_name NULL, body,
               visitor_hash, read_at NULL, created_at)
notifications(id, user_id, type, title, body NULL, share_id NULL,
              file_id NULL, comment_id NULL, dedupe_key NULL, read_at NULL,
              created_at)
share_events(id, share_id, type, file_id NULL, country NULL,
             visitor_hash NULL, created_at)

Transfer folders are hidden from folder listings. A transfer is shared as one
link. visitor_hash is stored only to dedupe opens and rate-limit comments. It
is never returned. Comment bodies are returned only to the owner.

## API
Auth routes handled by Better Auth (/api/auth/*).
POST /api/auth/sign-in/anonymous is rate-limited and checks Turnstile when a
secret is configured.
POST /api/transfers   DELETE /api/transfers/:id
POST /api/files/upload-url        → pending row + upload URL
PUT  /api/files/:id/content       worker-mode upload bytes
POST /api/files/:id/complete      → verify size in storage, mark ready
GET  /api/files/:id/download-url  GET /api/files/:id/preview-url
GET  /api/files/:id/preview       worker-mode inline image
PATCH|DELETE /api/files/:id      GET /api/files
GET  /api/usage
POST /api/shares   GET /api/shares   PATCH|DELETE /api/shares/:id
GET  /api/shares/:id/activity
GET  /api/notifications   GET /api/notifications/unread-count
POST /api/notifications/read   DELETE /api/notifications   DELETE /api/notifications/:id
GET  /api/comments   POST /api/comments/read   DELETE /api/comments/:id
GET  /api/s/:token                         public metadata
POST /api/s/:token/unlock                  exchange a password for an access token
GET  /api/s/:token/contents                folder or transfer listing
GET  /api/s/:token/download-url            counts one download, returns a URL
GET  /api/s/:token/file/:grant             worker-mode bytes only
GET  /api/s/:token/preview-url             image preview, does not count
GET  /api/s/:token/preview/:grant          worker-mode inline image
POST /api/s/:token/comments                stores a private note for the owner

Guests may call transfer create, upload-url, content, complete, share create
and update, and usage. Share create for a guest must target their transfer and
forces comments off. Everything else that reads or changes an owner's library
requires a real account. Missing ownership is 404. A guest on a member route
is 403.

Share links store the raw token so an owner can copy the same URL again.
Password-protected links use a short-lived HMAC access token in the
X-Share-Access header instead of a cookie, so the grant is not sent cross-site.
Five failed unlocks lock that share for 15 minutes. Download grants last 5
minutes and do not increment the counter again when the bytes are fetched.
Preview grants are separate and do not increment the counter. There is no
public route that lists comments.

## Cron (hourly)
Mark ready files past expiresAt as soft-deleted, then tell each member once
per hour. Notify members about links ending within 6 hours and links that
ended in the last 2 hours. After 1 day, delete soft-deleted storage objects
and then their rows. Remove pending uploads older than 2 hours, empty
transfers older than that, and guest users older than 14 days who own no file
rows. Delete shares that expired or were revoked more than 7 days ago, and
delete expired Better Auth sessions and verifications. Purge notifications
and events older than 30 days. Each phase is bounded and safe to repeat.

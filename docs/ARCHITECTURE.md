# Architecture

Transfile is a pnpm workspace. `apps/web` is the React app. `apps/api` is a Cloudflare Worker. `packages/shared` holds Zod schemas and the numeric limits both sides import.

## System

```mermaid
flowchart LR
  browser[Browser]
  api[Hono_on_Workers]
  d1[(D1)]
  storage[R2_or_S3]
  browser -->|"/api proxied in dev"| api
  api --> d1
  api --> storage
  browser -->|"s3 mode: presigned PUT and GET"| storage
```

`STORAGE_MODE=worker` (the local default) keeps file bytes in the Worker's R2 binding. The browser then talks only to the API. `STORAGE_MODE=s3` (alias `presigned`) signs URLs with `aws4fetch` against an S3-compatible bucket. The browser uploads and downloads those URLs directly. See `docs/storage-setup.md`.

Auth is Better Auth at `/api/auth/*`, with email and password plus the anonymous plugin for guests. App tables reference `user.id`.

## Upload

The browser asks for an upload URL, sends the bytes, then asks the API to compare the stored object with the size it recorded.

```mermaid
flowchart TD
  start[Browser selects a file]
  url["POST /api/files/upload-url"]
  pending[Insert pending file row]
  mode{STORAGE_MODE}
  workerPut["PUT /api/files/:id/content"]
  s3Put[PUT presigned URL]
  complete["POST /api/files/:id/complete"]
  head[HEAD the stored object]
  match{Size matches the row and is at most 100 MB}
  ready[Mark the file ready]
  drop[Delete the object and the row]
  start --> url --> pending --> mode
  mode -->|worker| workerPut --> complete
  mode -->|s3| s3Put --> complete
  complete --> head --> match
  match -->|yes| ready
  match -->|no| drop
```

In s3 mode the PUT signature can include `Content-Length` for the declared size. Presigned uploads expire after 10 minutes and downloads after 5 minutes (`apps/api/src/storage/s3.ts`). Completion always re-reads the object size from storage. A mismatch is a 400 and the object is deleted.

A transfer is a folder with `kind = transfer`. The send page creates one, uploads into it, then creates a share for that folder.

## Public share and download

```mermaid
flowchart TD
  open["GET /api/s/:token"]
  state{Link state}
  missing[404]
  gone[410]
  gate[Password form]
  ready[File or folder metadata]
  unlock["POST /api/s/:token/unlock"]
  grant[HMAC access token in memory]
  list["GET /api/s/:token/contents"]
  dl["GET /api/s/:token/download-url"]
  bytes{STORAGE_MODE}
  s3get[Presigned GET]
  workerget["GET /api/s/:token/file/:grant"]
  open --> state
  state -->|unknown token| missing
  state -->|expired revoked or exhausted| gone
  state -->|password set| gate
  state -->|no password and active| ready
  gate --> unlock --> grant --> ready
  ready --> list
  ready --> dl --> bytes
  bytes -->|s3| s3get
  bytes -->|worker| workerget
```

Password links do not set a cookie. The browser keeps the access token in React state and sends `X-Share-Access`. Access grants last 30 minutes. Download grants last 5 minutes and do not increment the counter again when the bytes are fetched. The counter moves once, in `download-url`, with a conditional update so two parallel downloads cannot both pass a limit of one.

Preview URLs are a separate grant and do not count as downloads. Previews allow png, jpeg, webp, gif, and avif, up to 10 MB. SVG is not included.

## Data model

Better Auth owns `user`, `session`, `account`, and `verification`. The app tables are in `apps/api/src/db/schema.ts`. A share points at a file or a folder, not both; that rule is enforced in Zod, not by a SQL check.

```mermaid
erDiagram
  user ||--o{ session : has
  user ||--o{ account : has
  user ||--o{ folders : owns
  user ||--o{ files : owns
  user ||--o{ shares : owns
  user ||--o{ notifications : receives
  folders ||--o{ files : contains
  folders ||--o{ shares : folder_or_transfer
  files ||--o{ shares : file_share
  shares ||--o{ share_comments : receives
  shares ||--o{ share_events : records
```

`folders.kind` is `folder` or `transfer`. Transfer folders are omitted from folder listings. `files.status` is `pending` or `ready`. `share_events.visitor_hash` is stored for open dedupe and is not returned by the activity route. `share_comments.visitor_hash` is stored for the comment rate limit and is not returned. Neither table has an IP column. `session.ip_address` does exist, because that column comes from Better Auth.

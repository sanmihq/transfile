# Transfile

Send a file, get a link, and have both disappear on a schedule.

## What it does

- A send page for guests and signed-in members: add files, optional title, message, password, expiry, and download limit, then copy a link or a QR code.
- Guest sessions created on the first send, not on page load. Signing up or in afterwards keeps that guest's transfers.
- A member library at `/files` with folders, upload, rename, move, delete, expiry, and image previews.
- Share links for a file, a folder, or a transfer. Owners can edit, revoke, and read activity and comments at `/links`.
- A public page at `/s/:token` with a password gate, per-file download, and an optional note to the sender.
- An inbox and a notification bell for members.
- An hourly cleanup job for expired files, ended links, pending uploads, old notifications, and idle guest accounts.

Diagrams are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Product limits are in [SPEC.md](SPEC.md).

## Screenshots

These files are not in the repo yet. Capture them into `docs/screenshots/` using the names below.

![Send page](docs/screenshots/send.png)

![Link ready, with QR code](docs/screenshots/success.png)

![Public download page](docs/screenshots/public.png)

![Links page with activity](docs/screenshots/links.png)

![Inbox](docs/screenshots/inbox.png)

![Files page](docs/screenshots/files.png)

Capture checklist:

- [ ] `docs/screenshots/send.png` — send page with files selected, before Get link
- [ ] `docs/screenshots/success.png` — success state with the link field and QR code
- [ ] `docs/screenshots/public.png` — public download page after unlock
- [ ] `docs/screenshots/links.png` — links page with one link's activity open
- [ ] `docs/screenshots/inbox.png` — inbox
- [ ] `docs/screenshots/files.png` — files page with at least one folder and one file

## Why I built it

The interesting constraint is the free Cloudflare Worker tier: a short CPU budget, so hashing, cleanup, and file bytes cannot all sit inside the request. Files are private by default (password, expiry, and no public comment list) and nothing is meant to live longer than 72 hours.

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Web | React 19, Vite, React Router | The UI is a single client app. |
| UI | Tailwind CSS, Radix via shadcn, TanStack Query | Styling, accessible primitives, and request caching. |
| Forms and validation | Zod in `@transfile/shared` | The API and the web app parse the same schemas. |
| API | Hono on Cloudflare Workers | One Worker serves HTTP and the hourly cron. |
| Auth | Better Auth | Email and password, sessions, and anonymous guests. Share passwords use the same PBKDF2 helpers. |
| Database | Cloudflare D1 and Drizzle | SQLite on the Worker, with SQL migrations in `apps/api/drizzle`. |
| Files | R2 binding, or S3 via `aws4fetch` | Local dev uses the R2 simulator. `STORAGE_MODE=s3` signs direct uploads. |
| Upload UI | `react-dropzone` | The send page and the files page share one queue. |

## Architecture

The browser calls the Worker for metadata and for a URL. In s3 mode the bytes go straight to storage. Completion checks the stored size before a file becomes downloadable. Public links exchange a password for a short HMAC token, then a download URL that counts once.

Details, including the upload, public-download, and table diagrams, are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security and privacy

These are implemented and covered by the smoke scripts under `apps/api/scripts`.

- Routes that touch a file, folder, or share check ownership. A missing or other owner's row is 404, not 403. A guest calling a member-only route is 403.
- The declared upload size is checked again with a `HEAD` after the bytes land. A mismatch deletes the object. In s3 mode the presigned PUT can bind `Content-Length` to that declared size.
- Account passwords and share passwords are PBKDF2-SHA-256 at 100,000 iterations, compared in constant time. That is the ceiling Workers allow, and it stays inside the free CPU budget. Better Auth's default hasher does not.
- Five failed unlocks lock that share for 15 minutes.
- A download limit is a single conditional update. A second download past the limit gets 410, including two requests at once.
- Password links return an HMAC access token (30 minutes) for the `X-Share-Access` header. Download and preview grants last 5 minutes. Fetching the bytes does not increment the counter again. Changing the password invalidates older tokens.
- Anonymous sign-in is rate-limited. When `TURNSTILE_SECRET` is set, the Worker checks the `X-Turnstile-Token` header with Cloudflare. Guests share one storage pool (2 GB unless `GUEST_POOL_BYTES` overrides it) and get 503 when it is full.
- Visitors can post a comment. There is no public route that lists comments. The owner reads them from `/api/comments`.
- Share activity and comments do not store IP addresses. They store an HMAC of the IP, user agent, and share id, and activity may store a country code. Better Auth's `session` table still has an `ip_address` column.
- The hourly cron soft-deletes expired files, purges storage after one day, drops pending uploads after two hours, removes ended shares after seven days, and deletes old notifications, events, empty transfers, and idle guest users. Each pass is capped (at most 40 storage deletes and 100 rows per query) so a large backlog takes several hours instead of one long invocation.

## Limits and trade-offs

| Limit | Value |
| --- | --- |
| File size | 100 MB |
| Account storage | 100 MB |
| Link and file lifetime | 1 to 72 hours, default 72. A change cannot pass `createdAt + 72h`. |
| Guest pool | 2 GB shared, overridable with `GUEST_POOL_BYTES` |
| Active links per account | 200 |
| Folder depth | 20 |
| Share password | 6 to 128 characters |
| Account password | 8 to 128 characters |
| Comment | 1,000 characters, 5 per visitor per hour, 100 per link |
| Image preview | png, jpeg, webp, gif, avif, up to 10 MB |

Known limitations:

- `STORAGE_MODE=worker` streams bytes through the Worker. Direct, presigned transfers exist only in s3 mode.
- Local HTTP with an empty Turnstile secret skips the check. An HTTPS site with an empty secret refuses anonymous sign-in.
- `request.cf.country` is empty in local development, so activity often has no country.
- The free-plan CPU and subrequest ceilings are not measured here. The cron caps and the PBKDF2 choice are the mitigations in the code.
- The web app has no host configuration. See Deployment.

## Getting started

You need Node.js and pnpm 10.6.0 (`packageManager` in the root `package.json`). Wrangler is installed with the API package and provides local D1 and R2.

```sh
pnpm install
```

Copy the env template. Fill in secrets locally. Do not commit `apps/api/.dev.vars`.

PowerShell:

```powershell
Copy-Item "apps\api\.dev.vars.example" "apps\api\.dev.vars"
```

macOS and Linux:

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

| Name | Where | Purpose |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | API | Session signing secret |
| `BETTER_AUTH_URL` | API | Public origin of the API. `https` turns on secure cookies and, if Turnstile's secret is empty, blocks anonymous sign-in |
| `WEB_ORIGIN` | API | Allowed browser origin |
| `STORAGE_MODE` | API | `worker` or `s3` (`presigned` is an alias) |
| `S3_ENDPOINT` | API | S3 host, no scheme and no trailing slash |
| `S3_REGION` | API | Region. Optional when it is the endpoint host's second label |
| `S3_ACCESS_KEY_ID` | API | S3 access key id |
| `S3_SECRET_ACCESS_KEY` | API | S3 secret key |
| `S3_BUCKET` | API | Bucket name |
| `SHARE_SECRET` | API | HMAC secret for share grants. At least 32 characters |
| `TURNSTILE_SECRET` | API | Turnstile secret. Empty on an `http` site skips verification |
| `GUEST_POOL_BYTES` | API | Optional guest pool size in bytes |
| `VITE_TURNSTILE_SITE_KEY` | Web | Optional Turnstile site key. If unset, the app uses Cloudflare's published dummy key |

Apply the SQL migrations in `apps/api/drizzle` to the local D1 database named `transfile-db`. Wrangler asks you to confirm.

```sh
pnpm --filter api exec wrangler d1 migrations apply transfile-db --local
```

Start the API and the web app in two terminals. The Vite dev server proxies `/api` to `http://localhost:8787`. The smoke scripts use that port and `http://localhost:5173`.

```sh
pnpm dev:api
pnpm dev:web
```

`pnpm dev:api` runs `wrangler dev --test-scheduled`, which also exposes the cron trigger for local tests.

## Testing

Web unit tests:

```sh
pnpm --filter web test
```

`vitest run` covers `getFileKind`, `formatBytes`, expiry countdown formatting, and the upload queue reducer. It does not cover the API.

Also available: `pnpm --filter web lint`, `pnpm --filter web build`, and `pnpm --filter api typecheck`. The root `pnpm test` script is a stub and exits with an error.

API smoke tests are PowerShell scripts. They expect the API on port 8787. From the repo root:

```powershell
powershell -File apps/api/scripts/smoke-files.ps1
powershell -File apps/api/scripts/smoke-folders.ps1
powershell -File apps/api/scripts/smoke-shares.ps1
powershell -File apps/api/scripts/smoke-cron.ps1
powershell -File apps/api/scripts/smoke-v2.ps1
```

On macOS or Linux, run the same paths with `pwsh -File` if PowerShell is installed. There is no bash port.

| Script | What it covers |
| --- | --- |
| `smoke-files.ps1` | Upload, complete, download hash, rename, delete, the 100 MB cap, a PUT larger than the declared size, and cross-account 404s |
| `smoke-folders.ps1` | Nested folders, breadcrumbs, move rules, depth 20, and cross-account 404s |
| `smoke-shares.ps1` | Public metadata, password unlock, lockout after five failures, atomic download limits, revoke, expiry, folder subtree bounds, and cross-account 404s |
| `smoke-cron.ps1` | Soft-delete, retention purge, pending uploads, ended shares, expired sessions, a failed storage delete that keeps the row, and the 40-delete cap |
| `smoke-v2.ps1` | Guest send, hidden transfers, the 72-hour cap, private comments, notifications, activity without an IP field, previews, account linking, and the guest pool |

`smoke-cron-s3.ps1` repeats the cleanup checks against a real bucket. It needs `STORAGE_MODE=s3` and the `S3_*` variables. `apps/api/scripts/test-s3.mjs`, `test-cors.mjs`, and `s3-head.mjs` also read those variables from `apps/api/.dev.vars`. None of the smoke scripts run in CI.

Not covered without real credentials: s3 uploads, B2 CORS, and a live Turnstile site. Local worker-mode runs do not exercise presigned URLs.

## Deployment

Not deployed yet.

The API can be deployed with `pnpm --filter api deploy`, which runs `wrangler deploy --minify` using `apps/api/wrangler.jsonc` (D1 binding `DB`, R2 binding `FILES`, cron `0 * * * *`). The web app builds with `pnpm --filter web build` and has no hosting config in this repo. Production file bytes are described in [docs/storage-setup.md](docs/storage-setup.md).

## Project structure

```text
transfile/
  apps/web/          React app
  apps/api/          Worker, Drizzle migrations, smoke scripts
  packages/shared/   Zod schemas and limits
  docs/              Architecture, storage notes, UI references
  SPEC.md            Product limits and routes
  package.json       Workspace scripts
  pnpm-workspace.yaml
```

## Roadmap

- Google and GitHub sign-in. The auth setup has a TODO and does not register those providers.
- A host for the static web build, and a recorded production deploy.
- A `LICENSE` file. See below.

## Credits

Icons in the app are [Heroicons](https://heroicons.com) (MIT, Tailwind Labs).

[Fraunces](https://github.com/undercasetype/Fraunces) and [Geist](https://github.com/vercel/geist-font) are self-hosted through Fontsource and licensed under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL).

There is no `LICENSE` file. The root `package.json` currently says `"license": "ISC"`. Choose a license and add a `LICENSE` file before publishing the repo.

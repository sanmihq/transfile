# Storage setup (Backblaze B2)

Production file bytes live in a private Backblaze B2 bucket, reached through its S3-compatible API. Local development stays on `STORAGE_MODE=worker` and the simulated R2 binding.

## Bucket and application key

1. Create a private B2 bucket. Leave it private.
2. Create an application key restricted to that bucket, with read and write.
3. Copy the S3 endpoint from the bucket or key page. It is a host only, for example `s3.eu-central-003.backblazeb2.com`, with no `https://` and no trailing slash.

## Worker variables

These values are secrets and must never be committed.

| Variable | Purpose |
| --- | --- |
| `S3_ENDPOINT` | S3 host, such as `s3.eu-central-003.backblazeb2.com` |
| `S3_REGION` | Region, such as `eu-central-003`. Optional when it is the endpoint host's second label |
| `S3_ACCESS_KEY_ID` | B2 application key id |
| `S3_SECRET_ACCESS_KEY` | B2 application key |
| `S3_BUCKET` | Bucket name |

Set `STORAGE_MODE=s3` in production. `presigned` is still accepted as an alias. Local `.dev.vars` keeps `STORAGE_MODE=worker`.

## CORS

The browser uploads and downloads directly against the bucket. Apply this rule, also saved as `docs/b2-cors.json`:

```json
[
  {
    "corsRuleName": "transfile-web",
    "allowedOrigins": ["http://localhost:5173"],
    "allowedOperations": ["s3_put", "s3_get", "s3_head"],
    "allowedHeaders": ["*"],
    "exposeHeaders": ["ETag"],
    "maxAgeSeconds": 3600
  }
]
```

Add the production web origin to `allowedOrigins` at deploy time.

If the B2 web console cannot accept custom rules, apply the file with the B2 CLI. Verify this command against current Backblaze docs before running it:

```text
b2 bucket update --cors-rules docs/b2-cors.json <bucketName>
```

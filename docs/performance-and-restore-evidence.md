# Performance and restore evidence — 2026-10-02

## Current Debian origin

Requests to `192.168.4.177:3100` return the running photo app. The Cloudflare hostname is routed to that origin, so the currently slow version is already on the Debian VM. The measurements below were taken directly on the LAN, bypassing Cloudflare edge timing:

| Route | TTFB | Total | Response bytes |
| --- | ---: | ---: | ---: |
| `/` | 0.029 s | 0.044 s | 384,101 |
| `/grid` | 0.428 s | 0.439 s | 384,362 |
| `/library` | 0.751 s | 0.837 s | 3,043,319 |
| `/api/ready` | 0.049 s | 0.050 s | 5 |

The home and grid documents each include 60 image references, and `/library` includes 1,730. In the running image all of those references use `/_next/image`, so the server optimizer fetches and transforms MinIO originals on demand.

## Candidate image

The candidate was built on the Mac for `linux/amd64` and run locally against the disposable PostgreSQL and Redis containers. The Mac is ARM64, so Docker runs this image under emulation; these timings are useful for comparing routes but are not a benchmark of Debian's native CPU.

| Route | TTFB | Total | Response bytes |
| --- | ---: | ---: | ---: |
| `/grid` | 0.029 s | 0.041 s | 375,397 |
| `/full` | 0.028 s | 0.029 s | 303,459 |
| `/library` | 0.152 s | 0.184 s | 3,063,456 |
| `/api/ready` | 0.125 s | 0.126 s | 5 |

The candidate keeps the 1,730 library folder thumbnails but passes only the fields each thumbnail renders. This reduced the candidate library response from 4,569,456 bytes before that change to 3,063,456 bytes after it (about 33%). The library response remains roughly 3 MB, similar to the existing origin. The candidate uses direct MinIO `-sm.jpg`, `-md.jpg`, and `-lg.jpg` derivatives instead of Next's optimizer; the rendered library has zero `/_next/image` references and its thumbnail `<img>` tags are lazy-loaded. The home, grid, full, and library routes are pre-rendered with five-minute revalidation.

The final local image tag is `exif-photo-blog:bed62077`, built from branch commit `bed62077`. It is Linux/amd64 and 856,823,113 bytes before transfer compression. `/api/ready` returned HTTP 200. The image and restricted runtime `.env` are under `/private/tmp` and are not in Git.

## Snapshot restore

The supplied cluster snapshot reports PostgreSQL 15.8 and `pg_dump` 15.15. A public-schema-only custom archive was restored into PostgreSQL 16.14 in a new disposable database with the same `pg_restore --clean --if-exists --no-owner --no-privileges --role=...` pattern used by the deployment runbook. The app role restored successfully.

| Table | Snapshot rows | Restored rows |
| --- | ---: | ---: |
| `public.photos` | 441 | 441 |
| `public.albums` | 7 | 7 |
| `public.album_photo` | 93 | 93 |

The snapshot initially had neither `public.library` nor legacy `public.about`. The app's query migration created `public.library` on the disposable build copy; the filtered archive and role-based restore preserved that table. The production database has not been touched.

## Still required before cutover

- Inventory the current Debian containers, data paths, free disk, and backup configuration over SSH.
- Load `exif-photo-blog:bed62077`, restore the verified public archive into the new Compose database, and run the candidate on `192.168.4.177:3100`.
- Verify external admin login, photo CRUD, presigned MinIO upload/CORS, feeds, sharing, and restart behavior.
- Confirm encrypted off-host backups and a MinIO object restore drill before retiring any managed services.

The Debian SSH key currently configured for this task is rejected. A temporary task key is awaiting one-time installation through the Codex terminal; no password or private key is stored in this repository.

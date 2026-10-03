# Deploying the photo blog on the Debian Proxmox VM

The intended runtime is Docker Compose on Debian VM 103 (`192.168.4.177`); MinIO and its existing bucket stay on nasy. The supplied snapshot is a Supabase cluster backup, so restore and verify an app-only copy before using it for either image generation or production. Keep the original managed services and backups until the restore drill and cutover checks pass.

## Current target inventory

- Proxmox VM 103 runs Debian 12 and had address `192.168.4.177` in the 2026-09-23 screenshot. The guest was configured with 4 vCPUs and 16 GiB RAM at that time. The Proxmox host is a 4-core i5-7500 with 31 GiB RAM; the screenshot showed 23.5 GiB host RAM in use and 2.18 GiB swap in use. Recheck live capacity before resizing the guest; the host looked memory constrained despite spare VM capacity being possible.
- The Cloudflare Tunnel route is `photo.devincunningham.com` to `http://192.168.4.177:3100`. Compose binds the web container to that VM address and port. Keep the host firewall limited to the tunnel connector and trusted LAN administration.
- MinIO remains on nasy. Keep the public object hostname and bucket unchanged so URLs already stored in PostgreSQL continue to work. The MinIO hostname shown in the existing tunnel is `minio.devincunningham.com`.
- Build the web image on the Mac for `linux/amd64`; do not run Next.js's production build on the VM or on nasy. This avoids competing for the VM's memory and produces the architecture used by Debian.
- Confirm Docker Engine, Compose support, persistent data paths, and free disk on Debian before importing the application database. The data path and current deployment status are still to be inventoried.

## Services and ports

- `web` runs the Next.js standalone Node server as UID 1001. Port 3000 inside the container is published as `192.168.4.177:3100`, matching the Cloudflare Tunnel origin.
- `postgres` and `redis` are reachable only on the Compose bridge network. Neither publishes a host port. Redis also requires a password and keeps its protected mode enabled.
- `postgres` data is stored under `${APP_DATA_ROOT}/postgres`; Next.js cache is stored under `${APP_DATA_ROOT}/next-cache`.
- The browser and app keep using the existing public MinIO hostname and bucket. PostgreSQL and Redis URLs inside the app use the Compose service names.

Set a unique random hexadecimal `REDIS_PASSWORD` in the restricted runtime `.env` file. Compose uses it to authenticate Redis and constructs the app's private `REDIS_URL`; there is no separate URL value to keep in sync.

Next.js standalone output needs `.next/standalone/server.js`, plus `public` and `.next/static`; the Dockerfile copies those files and starts the server with `HOSTNAME=0.0.0.0` and port 3000, as described in the [Next.js standalone output guide](https://nextjs.org/docs/app/api-reference/config/next-config-js/output). Home, grid, full, and library pages revalidate every five minutes and are invalidated by the app's existing admin actions. All six photo/category/OG generation switches are enabled in `.env.example`; `ops/build-image.sh` refuses to build unless all six are on, `NEXT_PUBLIC_DISABLE_BLUR=1`, and a disposable build database URL is provided through a BuildKit secret. With blur disabled, the app omits stored base64 blur images from page payloads; the original photos and MinIO derivatives are unchanged. The resulting image does not contain the database URL. Static generation defaults to two workers to fit the Mac's Docker memory; lower `NEXT_BUILD_WORKERS` to 1 if the local database is killed during a build. Photo and category static-param generation is capped at 1,000 entries by the app.

## Before first deployment

1. Record Debian's CPU architecture, available RAM and disk, Docker/Compose versions, persistent data path, firewall rules, and Cloudflare Tunnel connector status.
2. Inspect the source database version, public schema tables/extensions/triggers, counts for `photos`, `albums`, `album_photo`, and `library` or legacy `about`, database size, and the hostnames in stored photo URLs. Do not place photo metadata or credentials in the report.
3. Take an encrypted off-NAS source database backup. Restore it into a disposable PostgreSQL instance and verify counts before using the copy with this app. Confirm a MinIO snapshot/backup and restore one object under a separate test key.
4. Select a PostgreSQL image tag matching the observed source major version and a pinned Redis version. The blank `POSTGRES_IMAGE` and `REDIS_IMAGE` values in `.env.example` intentionally prevent Compose from starting until these choices are filled in.
5. Confirm the existing MinIO object hostname resolves from both a remote browser and the app container with a valid certificate. Check public GET and presigned browser PUT, bucket policy, and CORS for the photo domain.

The upstream app runs query-time schema migrations. Always test the newer code against a restored copy first. Inspect schema ownership, RLS, extensions, triggers, functions, grants, and any references to Supabase-managed roles/schemas before deciding how to restore `public` and assign the app role. Use Supabase's filtered CLI dump, not an unfiltered raw dump: its [restore guide](https://supabase.com/docs/guides/self-hosting/restore-from-platform) excludes managed internals and recommends direct or session-pooler connections.

## Prepare secrets and build

1. Copy the sample and keep the real file outside Git:

   ```sh
   cp .env.example .env
   chmod 600 .env
   ```

2. Fill every blank and `CHANGE_ME` value. Keep PostgreSQL on the source major version. Use unique URL-safe hex values for the PostgreSQL and Redis passwords because Compose constructs `POSTGRES_URL` and `REDIS_URL`; generate each with `openssl rand -hex 32`. Generate `AUTH_SECRET` with `openssl rand -base64 32`. Store the runtime file in a permission-restricted location on Debian. Set `AUTH_TRUST_HOST=true` only after verifying the Cloudflare Tunnel forwards the intended public `Host` and `X-Forwarded-Proto` headers.
3. Fill the existing MinIO hostname and bucket, current admin credentials, and desired public presentation settings. `NEXT_PUBLIC_*` values are public and compiled into the image. They are Docker build arguments, so changes to them require rebuilding the web image.
4. Keep `EXIF_LOCAL_ONLY=1` for the local-only launch. It suppresses OpenAI, AI Gateway, Google Places, and configured external page scripts even if credentials are present. No Vercel, Supabase, Upstash, or third-party analytics variables are needed. Public social links only open when a visitor chooses them.
5. Create `${APP_DATA_ROOT}/postgres` and `${APP_DATA_ROOT}/next-cache`. Ensure the selected PostgreSQL image can write its data directory and UID 1001 can write `next-cache`. On the Mac, put the URL for an isolated, restored build copy in a mode-600 file; for the local snapshot restore shown here the temporary URL is `postgresql://postgres@host.docker.internal:55432/postgres?sslmode=disable`. Then build the x86_64 image:

   ```sh
   umask 077
   printf '%s\n' 'postgresql://postgres@host.docker.internal:55432/postgres?sslmode=disable' > /private/tmp/exif-photo-build-db-url
   BUILD_DATABASE_URL_FILE=/private/tmp/exif-photo-build-db-url ./ops/build-image.sh
   ```

   Do not substitute the production database URL. Copy the resulting image to Debian with `docker save`, transfer it over the already-authorized SSH path, and run `docker load` there. Compose only runs the imported image; it does not build on the server. Remove the temporary URL file and local snapshot container after the build and restore checks.

The first PostgreSQL start initializes the database and creates the non-superuser `APP_DB_USER`. The init script only runs for a new, empty data directory. Do not delete or reinitialize a populated PostgreSQL directory to change credentials.

## Database export and restore drill

Use a **direct** or **session-pooler** Supabase URL for migration export, not the current transaction pooler on port 6543. Keep connection strings in a private shell environment or secret manager. Supabase CLI's filtered schema and data exports can be produced separately:

```sh
supabase db dump --db-url "$SUPABASE_DB_URL" --schema public --file schema.sql
supabase db dump --db-url "$SUPABASE_DB_URL" --schema public --data-only --use-copy --file data.sql
```

Encrypt the original and final dumps and copy them off the VM. The supplied `db_cluster-10-02-2026@20-08-00.backup.gz` is a full Supabase cluster dump, not an app-only dump. Do not restore it unmodified into the Debian app database: it includes Supabase roles, schemas, and extensions. Restore a disposable copy, verify the app's `public` tables and records, then create a filtered app-only archive with `pg_dump --schema=public --no-owner --no-acl`. Restore that archive into an empty target database and verify counts and representative URLs. Before importing, inspect extension, owner, grant, trigger, and managed-role dependencies. The Supabase migration guide includes an example restore using one transaction and `session_replication_role=replica` for data import. Use that only after confirming the dump's triggers and role requirements.

For backups created by the local Compose database, use:

```sh
ops/backup-postgres.sh /path/to/private-backups
ops/restore-postgres-to-new-db.sh /path/to/private-backups/exif-photo-blog-public-<timestamp>.dump exif_restore_drill
```

The restore helper refuses the configured application database and restores into a new disposable database. It handles the helper's PostgreSQL custom-format archive, not the plain SQL files emitted by Supabase CLI. Test actual Supabase exports separately in a disposable instance, then verify:

```sql
SELECT current_setting('server_version');
SELECT pg_size_pretty(pg_database_size(current_database()));
SELECT extname FROM pg_extension ORDER BY extname;
SELECT count(*) FROM public.photos;
SELECT count(*) FROM public.albums;
SELECT count(*) FROM public.album_photo;
SELECT count(*) FROM public.library;
```

Use `about` instead of `library` if the inspected source has only the legacy table. Reconcile representative records and URL hostnames privately. Run the app's database connection check, exercise query-time migrations on the copy, and record restore duration before proceeding.

## Start the staging copy

After restoring the verified database copy and configuring a test MinIO bucket or disposable test prefix, start the app:

```sh
sh ops/compose.sh up -d web
sh ops/compose.sh ps
sh ops/compose.sh logs --tail=100 web
curl --fail http://127.0.0.1:3000/api/ready
```

`/api/ready` returns only `ready` or `not ready` and checks PostgreSQL and Redis. Run the public and admin checklist from the handoff against the staging copy: normal browsing, category/library/photo pages, original and optimized images, OG images, feeds, sitemap, sign-in/out, denied unauthenticated upload, upload with EXIF, edit, album assignment, delete, cache invalidation, restart, and service-unavailable behavior. Test from an external browser. Do not treat a public MinIO bucket as a privacy boundary.

The rate limiter is an exact sliding window backed by a single Redis Lua script. Its sorted-set entries are bounded by the configured token limit and expire with the window. External AI/Places requests fail closed if Redis is absent, unreachable, or over limit. Redis state itself is disposable.

## Cloudflare Tunnel and MinIO

Cloudflare Tunnel terminates public HTTPS for `photo.devincunningham.com` and forwards to `http://192.168.4.177:3100`. Verify the tunnel forwards the controlled public `Host` and `X-Forwarded-Proto: https` headers before enabling `AUTH_TRUST_HOST=true`. Set request/body timeouts and body size for the app's request path. Photo bytes use browser-direct MinIO presigned PUT, so verify MinIO CORS and size limits separately.

Keep PostgreSQL, Redis, Docker, and MinIO administration ports private. Confirm split DNS or NAT reflection lets the app container reach the same public MinIO hostname with a valid certificate. Existing MinIO URLs in PostgreSQL must remain valid after cutover.

## Cache and routine updates

The Next.js runtime image cache persists in `${APP_DATA_ROOT}/next-cache`. The configured minimum image-cache TTL is seven days; the default maintenance ceiling is 2 GiB. Schedule the following Debian cron or systemd task (adjust the ceiling after measuring expected use) and monitor cache disk separately from PostgreSQL and source photos:

```sh
cd /path/to/compose-project
sh ops/compose.sh exec -T web node /app/ops/prune-next-image-cache.mjs
```

For an app update, create a database backup and record the running image tag. Build the selected branch on the Mac against a disposable database, transfer and load the new image on Debian, update `WEB_IMAGE_TAG`, then:

```sh
docker compose up -d --no-build web
docker compose ps
docker compose logs --tail=100 web
```

Keep one known-good image and a matching database snapshot. Schedule encrypted off-NAS PostgreSQL backups, MinIO object/snapshot backups, disk alerts, certificate-renewal checks, and recurring restore drills. Cache files can be rebuilt; source photo objects and database backups need separate protection.

## Cutover and rollback

1. Lower DNS TTL and announce/freeze admin writes.
2. Take the final consistent Supabase dump and encrypted off-host copy. Stop source writes before the final dump; do not run Vercel and Debian as simultaneous writers.
3. Filter and restore the final dump into the production Debian database using the verified procedure. Reconcile table counts and URL hostnames. Load and start the exact image already tested against the staging copy.
4. Test through a hosts-file override or staging hostname over valid HTTPS. Verify login, upload, edit, delete, image rendering, feeds, and sharing; confirm no normal requests to Vercel, Supabase, or Upstash.
5. Enable the prepared Cloudflare Tunnel route for `photo.devincunningham.com` to `192.168.4.177:3100` and watch app, tunnel, disk, and service logs. Keep Supabase read-only, backups, and the last known-good image until the agreed observation window and restore drill pass.
6. Roll back by pointing the tunnel route to the last usable endpoint and restoring the matching database snapshot/image pair. Vercel is currently paused and must not be considered an immediate fallback. If Debian accepted uploads after the rollback snapshot, reconcile those objects/records before switching writers.

Do not retire the old managed services until the public acceptance checks, off-NAS backup, and restore drill pass. Record CPU, memory, database size, image-cache use, upload behavior, and proxy timeouts under representative traffic before setting the observation window.

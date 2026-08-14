# Cloud operations

Atarang's browser Library remains canonical. The cloud stack stores temporary job results, durable job metadata, and a content-addressed cache of successful operator-authorized YouTube source audio for deduplication.

## Static frontend and how it finds a backend

The web build is purely static: `apps/web/build.ts` emits only files, no server
process. There is no build flag for the backend and no runtime config file —
the app finds out whether it has one by asking.

- **Detection, not configuration.** At startup the app probes
  `/api/v1/capabilities` on its own origin and on `DEFAULT_BACKEND_ORIGIN`
  (`apps/web/src/features/separation/cloudAvailability.ts`), taking the first
  that answers. `/capabilities` requires the deployment key, so the probe
  carries none and reads the resulting 401 as proof a backend is there. A static
  host answers the same path with the SPA shell — a 200 that means the opposite
  of what its status says — so the probe rejects HTML and accepts only a 401 or
  a JSON content type.
- **The Compose deployment needs no setup.** Caddy reverse-proxies `/api/*`, so
  the same-origin probe succeeds and cloud works as it always has.
- **`DEFAULT_BACKEND_ORIGIN` is a checked-in constant, not a secret and not an
  env var.** It is a hostname, and whether it answers *is* the detection. A
  LAN-only backend resolves publicly but routes nowhere off the LAN, so one
  static bundle offers cloud to its operator and hides it from everyone else.
  Leave it empty to only ever use the page's own origin. Changing it also
  changes the `connect-src` in the generated `dist/_headers`, because `build.ts`
  reads the same constant.
- **The deployment key is runtime-only.** It is a secret, so it is never in the
  bundle. It stays in browser session storage and is entered in Settings → Cloud
  processing, where the detected address can also be overridden for a session.
- **Cross-origin backends.** Set the API's `ATARANG_PUBLIC_ORIGIN` to the
  frontend origin; it drives CORS, and a backend that will not accept this
  frontend's origin fails the probe, which is the correct answer. Nothing
  assumes a specific host — Cloudflare Workers is one target, as is any static
  file host that reads `_headers` (Cloudflare Pages, Netlify) or can be
  configured to send the same headers.
- **No backend at all.** Cloud separation and YouTube fetching do not disappear;
  the Studio separation sheet, the Library YouTube section and Settings → Cloud
  processing each say the feature runs on a self-hosted server and link the
  repository.
- **A backend that is there but failing.** The UI keeps these apart: nothing
  answered ("Could not reach your server…"), the key was rejected ("The
  deployment key was rejected…"), the server errored ("Your server answered with
  an error…"), and YouTube switched off ("This server has YouTube fetching
  turned off."). In-flight jobs keep their existing error handling; nothing is
  imported unless verified.

## Deploying the static frontend to Cloudflare Workers

`bun run cfdeploy` builds and runs `wrangler deploy`. There is no Worker script:
`wrangler.jsonc` declares assets only, because static asset requests are free
and unmetered while anything invoking a Worker is billed and answers 429 once
the free tier is spent — which here would mean model weights failing to
download. The browser separation model ships as ordinary static assets (largest
piece is ~21 MiB against a 25 MiB per-file limit), staged into `dist/models/`
by `build.ts` from `model-files/`; run `bun models/web/download.ts` first or the
deployment has no browser separation.

`build.ts` writes `dist/_headers` with the cross-origin isolation headers,
Content-Security-Policy and immutable caching for the content-hashed prefixes.
Without `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`,
`crossOriginIsolated` is false and separation, four-stem playback, metronome,
count-in and recording all refuse to start.

## Before building

1. Generate `uv.lock` with Python 3.12 and uv, then require `uv lock --check` in CI.
2. Place the official `htdemucs` checkpoint at `models/server/htdemucs.th`. Supply its reviewed SHA-256 as both the image build argument and `MODEL_ARTIFACT_SHA256`; the image build fails on a mismatch.
3. Run `cd infra/compose && ./create-env.sh .env`, or fill `.env` from `.env.example` with random secrets. Do not commit it. Set `YOUTUBE_ENABLED=true` only for an operator-approved deployment; the dedicated acquisition container pins yt-dlp plus its challenge solver, uses Deno with restricted permissions, accepts only normalized YouTube video URLs, and has separate egress.
4. Run the benchmark corpus on the actual Ryzen CPU and candidate NVIDIA devices. CPU is eligible at warm p95 RTF ≤1.5; CUDA at p95 RTF ≤0.5, <80% VRAM, and zero OOM/device resets. Concurrency remains one until the concurrency-two gate passes.

## Start and inspect

CPU: `docker compose -f infra/compose/compose.yaml -f infra/compose/compose.cpu.yaml --profile cpu up -d --build`.

CUDA: replace the second file/profile with `compose.cuda.yaml` and `cuda`. Run exactly one worker profile initially. Only Caddy publishes host port `${HOST_HTTP_PORT:-4173}`; the default `SITE_ADDRESS=:80` is intended for TLS termination by an existing reverse proxy. Verify `/api/v1/health/ready`, `/api/v1/version`, an upload canary, one authorized YouTube canary, source-cache reuse, result import, and explicit result purge.

## Access model

The shipped service is a private, single-operator deployment. A high-entropy deployment key authorizes job creation and is held only in browser session storage; unguessable per-job capability tokens authorize job access. Do not expose this mode as a public multi-user service. Public operation requires user identity and sessions, per-user job ownership, rate and concurrency limits, abuse controls, audit/consent records, administrative revocation, and a deliberate policy for source-cache sharing between users.

## Retention and recovery

Run `atarang-cleanup` hourly. Incomplete uploads expire after 30 minutes, failed/cancelled sources within one hour, and results after 24 hours. Successful operator-authorized YouTube acquisitions are content-addressed and retained in the dedicated source cache for reuse; deleting a job never deletes that cache entry. Alert when cleanup lags two hours or database rows disagree with S3 inventory. `infra/backup/backup.sh` backs up PostgreSQL and resolved configuration but deliberately excludes expiring job media; decide separately whether the persistent source cache belongs in host backups. Test restore weekly into a new Compose project before traffic is switched.

Drain workers before rollback. Roll back by immutable image digest only while the Alembic schema is backward-compatible. Never roll back across a destructive migration.

`infra/release/release-images.sh` is the fail-closed promotion path: it checks both locks and the model checksum, runs web gates, emits SBOM/provenance attestations through BuildKit, pushes the four images, and signs/verifies each immutable digest with Cosign. Archive its digest output with benchmark, migration, pressure, restore, and rollback evidence.

## Incus VM boundary

Install the same Compose project inside an Incus VM. For CUDA, pass the physical GPU to that VM and treat it as exclusively owned during operation and host maintenance. No native Incus service variant is supported.

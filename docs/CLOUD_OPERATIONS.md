# Cloud operations

Atarang's browser Library remains canonical. The cloud stack stores temporary job results, durable job metadata, and a content-addressed cache of successful operator-authorized YouTube source audio for deduplication.

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

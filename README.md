# Atarang Web

Desktop-first, local-first music practice PWA. The repository follows the architecture and phased gates in `IMPLEMENTATION_PLAN.md`.

```sh
bun install
bun run dev --host 0.0.0.0
bun run typecheck
bun test
bun run build
bun run preview
```

The production preview binds to `0.0.0.0:4173` and sends COOP/COEP headers required for `SharedArrayBuffer`.

Cloud deployment source lives under `services/api`, `services/worker`, and `infra/compose`. It requires a generated, committed `uv.lock`, a checksum-pinned `models/server/htdemucs.th` build input, and target-hardware benchmark evidence before use. See `docs/CLOUD_OPERATIONS.md`.

After API contract changes, regenerate the committed OpenAPI snapshot with `uv run --package atarang-api python services/api/scripts/export_openapi.py`; CI should fail if regeneration produces a diff.

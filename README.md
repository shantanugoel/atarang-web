# Atarang Web

Desktop-first, local-first music practice PWA. The repository follows the architecture and phased gates in `IMPLEMENTATION_PLAN.md`.

```sh
bun install
bun run dev            # cross-origin isolated on :3000, rebuilds on save
bun run typecheck
bun test
bun run build
bun run preview
```

Both `dev` and `preview` send the COOP/COEP headers that `SharedArrayBuffer` requires; without them separation, four-stem playback, metronome, count-in and recording all refuse to start. `dev` binds `0.0.0.0:3000` and rebuilds on save (reload the tab); `preview` binds `0.0.0.0:4173`.

Browser separation needs the model weights. Run `bun models/web/download.ts` once — the build stages `model-files/` into `dist/models/htdemucs-web-onnx/` so `dev` and `preview` serve the same paths the container image publishes.

Cloud deployment source lives under `services/api`, `services/worker`, and `infra/compose`. It requires a generated, committed `uv.lock`, a checksum-pinned `models/server/htdemucs.th` build input, and target-hardware benchmark evidence before use. See `docs/CLOUD_OPERATIONS.md`.

After API contract changes, regenerate the committed OpenAPI snapshot with `uv run --package atarang-api python services/api/scripts/export_openapi.py`; CI should fail if regeneration produces a diff.

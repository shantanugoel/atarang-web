# Runtime dependency and provenance inventory

| Dependency | Pin / range | License | Purpose |
|---|---|---|---|
| React / React DOM | `^19.1.1` | MIT | UI runtime |
| React Router | `^7.8.0` | MIT | Client routing |
| Zustand | `^5.0.7` | MIT | Studio control state |
| idb | `^8.0.3` | ISC | IndexedDB transactions |
| Mediabunny | `1.53.0` | MPL-2.0 | Bounded media decode/probe |
| fft.js | `4.0.4` | MIT | Spectral-flux beat analysis |
| Signalsmith Stretch | upstream commit `57b93f4e9206a089a45387eaa39bdc9f310d3308` | MIT | Independent time/pitch DSP; vendored notice is in `apps/web/src/vendor/signalsmith-stretch/` |
| Phosphor Icons React | `^2.1.10` | MIT | Interface icons |
| AJV | `^8.17.1` | MIT | JSON Schema validation |
| ONNX Runtime Web | `1.27.0` | MIT | Probe-gated browser inference runtime |
| FastAPI / Starlette | `0.139.2` / locked transitive | MIT / BSD-3-Clause | Cloud control API |
| SQLAlchemy / psycopg | `2.0.51` / `3.3.4` | MIT | PostgreSQL jobs, leases, and migrations |
| boto3 | `1.43.53` | Apache-2.0 | S3-compatible temporary object storage |
| Demucs | `4.1.0` | MIT | Pinned four-stem worker implementation |
| PyTorch / torchaudio | `2.8.0` | BSD-style | Locked CPU and CUDA inference runtimes |
| PostgreSQL container | `18.4-alpine` | PostgreSQL License | Durable queue and job metadata |
| Caddy container | `2.11.4-alpine` | Apache-2.0 | TLS, static web, and API proxy |
| MinIO server | `RELEASE.2025-10-15T17-29-55Z` | AGPL-3.0 | Private Compose S3-compatible temporary storage; distribution/SBOM review required |
| Prometheus | `3.13.1-distroless` | Apache-2.0 | Optional internal metrics collection |

Transitive production licenses must be regenerated and reviewed before a release image is signed. Browser model weights are not bundled: their artifact manifest, source, checksum and license require separate approval before download is exposed. Server workers accept the reviewed `htdemucs` checkpoint only as a build input and fail closed when its configured checksum differs.

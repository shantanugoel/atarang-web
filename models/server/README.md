# Server model build input

Place the reviewed official four-stem `htdemucs` checkpoint here as `htdemucs.th`; it is deliberately not committed because it is not the browser model. Build both worker images with `MODEL_ARTIFACT_SHA256` set to the independently verified checkpoint SHA-256. The Dockerfiles copy it to Demucs signature `955717e8` and fail the build if the bytes differ.

The worker network is internal and cannot download or replace weights at startup.

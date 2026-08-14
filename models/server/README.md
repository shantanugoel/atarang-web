# Server model build input

The worker Dockerfiles download the reviewed official four-stem `htdemucs`
checkpoint from the pinned upstream URL during the image build. Set
`MODEL_ARTIFACT_SHA256` to the independently verified checkpoint SHA-256; the
build fails if the downloaded bytes differ. The Dockerfiles install it at
Demucs signature `955717e8`.

The worker network is internal and cannot download or replace weights at
startup.

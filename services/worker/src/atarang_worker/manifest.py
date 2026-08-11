from datetime import UTC, datetime
from uuid import UUID

from atarang_api.ids import uuid7 as uuid7

STEMS = ("vocals", "drums", "bass", "other")
SHA_LENGTH = 64


def is_sha(value: object) -> bool:
    return isinstance(value, str) and len(value) == SHA_LENGTH and all(
        character in "0123456789abcdef" for character in value
    )


def validate_manifest(manifest: dict) -> None:
    if manifest.get("schema") != "atarang.separation/1":
        raise ValueError("result_integrity_failed")
    try:
        separation_id = UUID(manifest["separationId"])
        original_id = UUID(manifest["original"]["originalId"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("result_integrity_failed") from error
    if separation_id.version != 7 or original_id.version != 7:
        raise ValueError("result_integrity_failed")
    original = manifest["original"]
    if (
        not is_sha(original.get("contentSha256"))
        or original.get("sampleRate") != 44_100
        or original.get("channels") not in (1, 2)
        or not isinstance(original.get("durationFrames"), int)
        or original["durationFrames"] <= 0
    ):
        raise ValueError("result_integrity_failed")
    model = manifest.get("model", {})
    if (
        model.get("modelId") != "htdemucs-4stem"
        or not is_sha(model.get("artifactSha256"))
        or model.get("upstream") != "facebookresearch/demucs htdemucs"
        or model.get("license") != "MIT"
    ):
        raise ValueError("result_integrity_failed")
    pipeline = manifest.get("pipeline", {})
    if (
        pipeline.get("implementation") != "server-pytorch"
        or pipeline.get("segmentFrames") != 308_700
        or pipeline.get("overlapFrames") != 77_175
        or pipeline.get("shifts") != 1
    ):
        raise ValueError("result_integrity_failed")
    stems = manifest.get("stems", [])
    if [stem.get("kind") for stem in stems] != list(STEMS):
        raise ValueError("result_integrity_failed")
    for stem in stems:
        if (
            stem.get("sampleRate") != original["sampleRate"]
            or stem.get("channels") != 2
            or stem.get("durationFrames") != original["durationFrames"]
            or not stem.get("variants")
            or not str(stem.get("blobId", "")).startswith("sha256:")
            or not is_sha(str(stem.get("blobId", ""))[7:])
        ):
            raise ValueError("result_integrity_failed")
        for variant in stem["variants"]:
            if (
                variant.get("encoding") not in {"flac", "pcm-f32le-wav"}
                or variant.get("byteLength", 0) <= 0
                or not is_sha(variant.get("sha256"))
            ):
                raise ValueError("result_integrity_failed")
    provenance = manifest.get("provenance", {})
    if provenance.get("mode") != "cloud" or not provenance.get("createdAt"):
        raise ValueError("result_integrity_failed")


def created_at() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")

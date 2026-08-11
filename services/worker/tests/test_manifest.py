from atarang_worker.manifest import STEMS, uuid7, validate_manifest


def test_uuid7_version_and_variant():
    value = uuid7()
    assert value.version == 7
    assert value.variant == "specified in RFC 4122"


def test_manifest_requires_exact_stem_order():
    sha = "a" * 64
    manifest = {
        "schema": "atarang.separation/1",
        "separationId": str(uuid7()),
        "original": {
            "originalId": str(uuid7()), "contentSha256": sha, "sourceMediaType": "audio/wav",
            "sampleRate": 44100, "channels": 2, "durationFrames": 44100,
        },
        "model": {"modelId": "htdemucs-4stem", "artifactSha256": sha,
                  "upstream": "facebookresearch/demucs htdemucs", "license": "MIT"},
        "pipeline": {"implementation": "server-pytorch", "segmentFrames": 308700,
                     "overlapFrames": 77175, "shifts": 1},
        "stems": [
            {"kind": kind, "blobId": f"sha256:{sha}", "sampleRate": 44100, "channels": 2,
             "durationFrames": 44100,
             "variants": [{"encoding": "flac", "byteLength": 1, "sha256": sha}]}
            for kind in STEMS
        ],
        "provenance": {"mode": "cloud", "createdAt": "2026-08-10T00:00:00Z"},
    }
    validate_manifest(manifest)
    manifest["stems"][0]["kind"] = "drums"
    try:
        validate_manifest(manifest)
    except ValueError as error:
        assert str(error) == "result_integrity_failed"
    else:
        raise AssertionError("invalid stem order was accepted")

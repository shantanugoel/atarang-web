import asyncio
import hashlib
import json
import os
import signal
import sys
import tempfile
import time
import wave
from collections.abc import AsyncIterator
from pathlib import Path

from atarang_api.config import Settings
from atarang_api.objects import ObjectStore
from atarang_api.repository import PostgresRepository
from atarang_api.schemas import JobState

from .manifest import STEMS, created_at, uuid7, validate_manifest


async def file_chunks(path: Path, size: int = 1024 * 1024) -> AsyncIterator[bytes]:
    with path.open("rb") as source:
        while chunk := source.read(size):
            yield chunk


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


async def probe_audio(path: Path, config: Settings, expected_frames: int) -> None:
    process = await asyncio.create_subprocess_exec(
        config.ffprobe_bin,
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate,channels,duration_ts,time_base",
        "-of",
        "json",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await process.communicate()
    if process.returncode:
        raise ValueError("result_integrity_failed")
    try:
        stream = json.loads(stdout)["streams"][0]
        numerator, denominator = (int(value) for value in stream["time_base"].split("/"))
        frames = round(int(stream["duration_ts"]) * numerator / denominator * 44_100)
        valid = int(stream["sample_rate"]) == 44_100 and int(stream["channels"]) == 2 and frames == expected_frames
    except (KeyError, IndexError, TypeError, ValueError, ZeroDivisionError):
        valid = False
    if not valid:
        raise ValueError("result_integrity_failed")


async def checked_process(
    command: list[str], repository: PostgresRepository, job_id, worker_id: str,
    terminal_code: str | None = None,
) -> None:
    with tempfile.TemporaryFile() as errors:
        started = time.monotonic()
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=errors,
            start_new_session=True,
        )
        while True:
            try:
                await asyncio.wait_for(process.wait(), timeout=15)
                if process.returncode:
                    errors.seek(0)
                    error_summary = errors.read(64 * 1024).lower()
                    if b"out of memory" in error_summary or b"cuda error" in error_summary:
                        raise RuntimeError("worker_oom")
                    if terminal_code:
                        raise ValueError(terminal_code)
                    raise RuntimeError(
                        json.dumps(
                            {
                                "command": Path(command[0]).name,
                                "exitCode": process.returncode,
                            }
                        )
                    )
                return
            except TimeoutError:
                if time.monotonic() - started > 7_200:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        await asyncio.wait_for(process.wait(), timeout=10)
                    except TimeoutError:
                        os.killpg(process.pid, signal.SIGKILL)
                    raise ValueError("queue_timeout")
                row = await repository.get(job_id)
                if not row or row.state == JobState.CANCEL_REQUESTED:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        await asyncio.wait_for(process.wait(), timeout=10)
                    except TimeoutError:
                        os.killpg(process.pid, signal.SIGKILL)
                    raise ValueError("cancelled")
                if not await repository.heartbeat(job_id, worker_id, row.progress, row.stage):
                    os.killpg(process.pid, signal.SIGTERM)
                    raise ValueError("worker_lease_lost")


async def process_job(
    row,
    repository: PostgresRepository,
    objects: ObjectStore,
    config: Settings,
) -> None:
    if not config.model_artifact_sha256 or len(config.model_artifact_sha256) != 64:
        raise ValueError("model_integrity_failed")
    if not row.byte_length or not row.content_sha256 or not row.media_type or (not row.upload_id and not row.source_object_key):
        raise ValueError("invalid_source")
    scratch = Path(config.worker_scratch_root) / str(row.id) / f"attempt-{row.attempt}"
    scratch.mkdir(parents=True, exist_ok=False)
    source = scratch / "source.bin"
    digest = hashlib.sha256()
    with source.open("wb") as output:
        object_keys = [row.source_object_key] if row.source_object_key else [part.object_key for part in await repository.parts(row.upload_id)]
        for object_key in object_keys:
            async for chunk in objects.stream(object_key):
                digest.update(chunk)
                output.write(chunk)
    if source.stat().st_size != row.byte_length or digest.hexdigest() != row.content_sha256:
        raise ValueError("result_integrity_failed")

    normalized = scratch / "source.wav"
    await checked_process(
        [
            config.ffmpeg_bin,
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(source),
            "-ar",
            "44100",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            str(normalized),
        ],
        repository,
        row.id,
        config.worker_id,
        "unsupported_format",
    )
    with wave.open(str(normalized), "rb") as reader:
        duration_frames = reader.getnframes()
    if duration_frames > config.max_duration_seconds * 44_100:
        raise ValueError("media_too_large")
    await repository.worker_advance(
        row.id, config.worker_id, JobState.SEPARATING, progress=0.2
    )
    separated = scratch / "separated"
    await checked_process(
        [
            sys.executable,
            "-m",
            "demucs.separate",
            "--name",
            "htdemucs",
            "--device",
            config.worker_class,
            "--shifts",
            "1",
            "--overlap",
            "0.25",
            "--segment",
            "7",
            "--out",
            str(separated),
            str(normalized),
        ],
        repository,
        row.id,
        config.worker_id,
    )
    await repository.worker_advance(
        row.id, config.worker_id, JobState.PACKAGING, progress=0.85
    )

    input_directory = separated / "htdemucs" / normalized.stem
    manifest_stems: list[dict] = []
    result_variants: list[dict] = []
    requested_variants = json.loads(row.requested_variants)
    for stem in STEMS:
        variants: list[dict] = []
        blob_checksum = ""
        for encoding in requested_variants:
            extension = "flac" if encoding == "flac" else "wav"
            codec = "flac" if encoding == "flac" else "pcm_f32le"
            media_type = "audio/flac" if encoding == "flac" else "audio/wav"
            output_path = scratch / f"{stem}.{extension}"
            await checked_process(
                [
                    config.ffmpeg_bin,
                    "-nostdin",
                    "-v",
                    "error",
                    "-i",
                    str(input_directory / f"{stem}.wav"),
                    "-af",
                    f"apad=whole_len={duration_frames}",
                    "-frames:a",
                    str(duration_frames),
                    "-ar",
                    "44100",
                    "-ac",
                    "2",
                    "-c:a",
                    codec,
                    str(output_path),
                ],
                repository,
                row.id,
                config.worker_id,
                "result_integrity_failed",
            )
            await probe_audio(output_path, config, duration_frames)
            checksum = sha256_file(output_path)
            blob_checksum = blob_checksum or checksum
            object_key, byte_length = await objects.put_result(
                row.id,
                f"attempt-{row.attempt}/{output_path.name}",
                file_chunks(output_path),
                checksum,
            )
            variant = {
                "encoding": encoding,
                "mediaType": media_type,
                "byteLength": byte_length,
                "sha256": checksum,
            }
            variants.append(variant)
            result_variants.append(
                {
                    "stem": stem,
                    **variant,
                    "downloadPath": f"/api/v1/jobs/{row.id}/result/{stem}/{encoding}",
                    "objectKey": object_key,
                }
            )
        manifest_stems.append(
            {
                "kind": stem,
                "blobId": f"sha256:{blob_checksum}",
                "sampleRate": 44_100,
                "channels": 2,
                "durationFrames": duration_frames,
                "variants": variants,
            }
        )
    manifest = {
        "schema": "atarang.separation/1",
        "separationId": str(uuid7()),
        "original": {
            "originalId": str(uuid7()),
            "contentSha256": row.content_sha256,
            "sourceMediaType": row.media_type,
            "sampleRate": 44_100,
            "channels": 2,
            "durationFrames": duration_frames,
        },
        "model": {
            "modelId": "htdemucs-4stem",
            "artifactVersion": row.model_id,
            "artifactSha256": config.model_artifact_sha256,
            "upstream": "facebookresearch/demucs htdemucs",
            "license": "MIT",
        },
        "pipeline": {
            "implementation": "server-pytorch",
            "implementationVersion": config.implementation_version,
            "decodeVersion": "ffmpeg-pinned-image",
            "preprocessVersion": "stereo-44100-s16/1",
            "segmentFrames": 308_700,
            "overlapFrames": 77_175,
            "shifts": 1,
            "postprocessVersion": "length-normalize-flac/1",
        },
        "stems": manifest_stems,
        "provenance": {"mode": "cloud", "createdAt": created_at()},
    }
    validate_manifest(manifest)
    await repository.publish_result(row.id, config.worker_id, manifest, result_variants)

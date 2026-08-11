import asyncio
import hashlib
import json
import os
import signal
import tempfile
import time
from collections.abc import AsyncIterator
from pathlib import Path

from atarang_api.config import settings
from atarang_api.objects import FilesystemObjectStore, S3ObjectStore
from atarang_api.repository import PostgresRepository
from atarang_api.schemas import JobState


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


async def media_duration_us(path: Path) -> int:
    process = await asyncio.create_subprocess_exec(
        settings.ffprobe_bin,
        "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    output, _ = await process.communicate()
    if process.returncode:
        raise ValueError("unsupported_format")
    try:
        duration_us = round(float(json.loads(output)["format"]["duration"]) * 1_000_000)
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("unsupported_format") from error
    if duration_us <= 0 or duration_us > settings.max_duration_seconds * 1_000_000:
        raise ValueError("media_too_large")
    return duration_us


async def acquire(row, repository: PostgresRepository, objects) -> None:
    if not row.source_key or not row.source_locator:
        raise ValueError("invalid_youtube_url")
    cached = await repository.cached_source(row.source_key)
    if cached:
        await repository.publish_youtube_source(
            row.id, settings.youtube_acquisition_worker_id,
            key=cached.key, object_key=cached.object_key,
            content_sha256=cached.content_sha256, byte_length=cached.byte_length,
            media_type=cached.media_type, duration_us=cached.duration_us,
            title=cached.title, artist=cached.artist,
        )
        return

    with tempfile.TemporaryDirectory(prefix="atarang-youtube-") as directory:
        scratch = Path(directory)
        command = [
            settings.ytdlp_bin,
            "--no-playlist", "--no-progress", "--no-warnings", "--no-part",
            "--cache-dir", "/tmp/yt-dlp-cache", "--retries", "5", "--fragment-retries", "5",
            "--format", "bestaudio/best",
            "--js-runtimes", "deno",
            "--extract-audio", "--audio-format", "mp3", "--audio-quality", "0",
            "--max-filesize", str(settings.max_source_bytes),
            "--match-filter", f"duration <= {settings.max_duration_seconds}",
            "--print-json", "--output", str(scratch / "source.%(ext)s"),
            row.source_locator,
        ]
        with tempfile.TemporaryFile() as errors:
            started_at = time.monotonic()
            process = await asyncio.create_subprocess_exec(
                *command, stdout=asyncio.subprocess.PIPE, stderr=errors, start_new_session=True
            )
            while process.returncode is None:
                try:
                    await asyncio.wait_for(process.wait(), timeout=5)
                except TimeoutError:
                    if time.monotonic() - started_at > 20 * 60:
                        os.killpg(process.pid, signal.SIGTERM)
                        await process.wait()
                        raise ValueError("youtube_acquisition_timed_out")
                    current = await repository.get(row.id)
                    if not current or current.state == JobState.CANCEL_REQUESTED:
                        os.killpg(process.pid, signal.SIGTERM)
                        await process.wait()
                        raise ValueError("cancelled")
            stdout = await process.stdout.read() if process.stdout else b""
            if process.returncode:
                errors.seek(0)
                detail = errors.read(64 * 1024).lower()
                if b"larger than max-filesize" in detail or b"does not pass filter" in detail:
                    raise ValueError("media_too_large")
                if b"sign in" in detail or b"confirm you\'re not a bot" in detail or b"http error 403" in detail:
                    raise ValueError("youtube_temporarily_unavailable")
                raise ValueError("youtube_acquisition_failed")
        media = scratch / "source.mp3"
        if not media.is_file() or media.stat().st_size <= 0 or media.stat().st_size > settings.max_source_bytes:
            raise ValueError("media_too_large")
        try:
            metadata = json.loads(stdout.splitlines()[-1])
        except (IndexError, json.JSONDecodeError):
            metadata = {}
        duration_us = await media_duration_us(media)
        checksum = sha256_file(media)
        object_key, byte_length = await objects.put_source(row.source_key, file_chunks(media), checksum)
        title = str(metadata.get("title") or f"YouTube {row.source_key.split(':')[1]}")[:255]
        artist = str(metadata.get("artist") or metadata.get("uploader") or "YouTube")[:255]
        await repository.publish_youtube_source(
            row.id, settings.youtube_acquisition_worker_id,
            key=row.source_key, object_key=object_key, content_sha256=checksum,
            byte_length=byte_length, media_type="audio/mpeg", duration_us=duration_us,
            title=title, artist=artist,
        )


async def serve() -> None:
    repository = PostgresRepository(settings)
    objects = S3ObjectStore(settings) if settings.object_backend == "s3" else FilesystemObjectStore(settings.object_root)
    if isinstance(objects, S3ObjectStore):
        await objects.ensure_buckets()
    try:
        while True:
            row = await repository.claim_youtube(settings.youtube_acquisition_worker_id, lease_seconds=900)
            if not row:
                await asyncio.sleep(2)
                continue
            try:
                await acquire(row, repository, objects)
            except ValueError as error:
                code = str(error)
                current = await repository.get(row.id)
                target = JobState.CANCELLED if code == "cancelled" or (current and current.state == JobState.CANCEL_REQUESTED) else JobState.FAILED
                try:
                    await repository.change(row.id, target, stage=target.value, error_code=code)
                except ValueError:
                    pass
    finally:
        await repository.close()


def run() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    run()

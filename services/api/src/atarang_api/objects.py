import asyncio
import hashlib
import os
import shutil
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Protocol
from uuid import UUID

import boto3

from .config import Settings


class ObjectStore(Protocol):
    async def ready(self) -> bool: ...

    async def write_part(
        self, upload_id: UUID, part_number: int, chunks: AsyncIterator[bytes], expected_length: int,
        expected_sha256: str,
    ) -> tuple[str, int]: ...

    async def stream(
        self, object_key: str, chunk_size: int = 1024 * 1024, start: int = 0,
        end: int | None = None,
    ): ...

    async def size(self, object_key: str) -> int: ...

    async def put_result(
        self, job_id: UUID, name: str, chunks: AsyncIterator[bytes], expected_sha256: str
    ) -> tuple[str, int]: ...

    async def put_source(
        self, key: str, chunks: AsyncIterator[bytes], expected_sha256: str
    ) -> tuple[str, int]: ...

    async def delete_job(self, job_id: UUID, upload_id: UUID | None) -> None: ...

    async def delete_source(self, upload_id: UUID) -> None: ...


class FilesystemObjectStore:
    def __init__(self, root: str):
        self.root = Path(root)

    async def ready(self) -> bool:
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            return self.root.is_dir() and os.access(self.root, os.W_OK)
        except OSError:
            return False

    async def write_part(
        self,
        upload_id: UUID,
        part_number: int,
        chunks: AsyncIterator[bytes],
        expected_length: int,
        expected_sha256: str,
    ) -> tuple[str, int]:
        directory = self.root / "staging" / str(upload_id)
        directory.mkdir(parents=True, exist_ok=True)
        final = directory / f"{part_number:04d}-{expected_sha256}.part"
        temporary = directory / f".{part_number:04d}.{os.getpid()}.tmp"
        digest, size = hashlib.sha256(), 0
        try:
            with temporary.open("wb") as output:
                async for chunk in chunks:
                    size += len(chunk)
                    if size > expected_length:
                        raise ValueError("upload_part_too_large")
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if size != expected_length or digest.hexdigest() != expected_sha256:
                raise ValueError("upload_part_integrity_failed")
            os.replace(temporary, final)
            return str(final.relative_to(self.root)), size
        finally:
            temporary.unlink(missing_ok=True)

    def open_part(self, object_key: str):
        path = self._path(object_key)
        return path.open("rb")

    def _path(self, object_key: str) -> Path:
        path = (self.root / object_key).resolve()
        if self.root.resolve() not in path.parents:
            raise ValueError("invalid_object_key")
        return path

    async def put_result(
        self, job_id: UUID, name: str, chunks: AsyncIterator[bytes], expected_sha256: str
    ) -> tuple[str, int]:
        directory = self.root / "results" / str(job_id)
        directory.mkdir(parents=True, exist_ok=True)
        final = directory / name
        final.parent.mkdir(parents=True, exist_ok=True)
        temporary = final.parent / f".{final.name}.{os.getpid()}.tmp"
        digest, size = hashlib.sha256(), 0
        try:
            with temporary.open("wb") as output:
                async for chunk in chunks:
                    digest.update(chunk)
                    size += len(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if digest.hexdigest() != expected_sha256:
                raise ValueError("result_integrity_failed")
            os.replace(temporary, final)
            return str(final.relative_to(self.root)), size
        finally:
            temporary.unlink(missing_ok=True)

    async def put_source(
        self, key: str, chunks: AsyncIterator[bytes], expected_sha256: str
    ) -> tuple[str, int]:
        safe_key = hashlib.sha256(key.encode()).hexdigest()
        directory = self.root / "sources"
        directory.mkdir(parents=True, exist_ok=True)
        final = directory / f"{safe_key}-{expected_sha256}.media"
        temporary = directory / f".{safe_key}.{os.getpid()}.tmp"
        digest, size = hashlib.sha256(), 0
        try:
            with temporary.open("wb") as output:
                async for chunk in chunks:
                    digest.update(chunk)
                    size += len(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if digest.hexdigest() != expected_sha256:
                raise ValueError("source_integrity_failed")
            os.replace(temporary, final)
            return str(final.relative_to(self.root)), size
        finally:
            temporary.unlink(missing_ok=True)

    async def stream(
        self, object_key: str, chunk_size: int = 1024 * 1024, start: int = 0,
        end: int | None = None,
    ):
        with self._path(object_key).open("rb") as source:
            source.seek(start)
            remaining = None if end is None else end - start + 1
            while remaining is None or remaining > 0:
                chunk = source.read(chunk_size if remaining is None else min(chunk_size, remaining))
                if not chunk:
                    break
                yield chunk
                if remaining is not None:
                    remaining -= len(chunk)

    async def size(self, object_key: str) -> int:
        return self._path(object_key).stat().st_size

    async def delete_job(self, job_id: UUID, upload_id: UUID | None) -> None:
        targets = [self.root / "results" / str(job_id)]
        if upload_id:
            targets.append(self.root / "staging" / str(upload_id))
        for target in targets:
            resolved = target.resolve()
            if self.root.resolve() not in resolved.parents:
                raise ValueError("invalid_object_key")
            shutil.rmtree(resolved, ignore_errors=True)

    async def delete_source(self, upload_id: UUID) -> None:
        target = (self.root / "staging" / str(upload_id)).resolve()
        if self.root.resolve() not in target.parents:
            raise ValueError("invalid_object_key")
        shutil.rmtree(target, ignore_errors=True)


class S3ObjectStore:
    """S3-compatible storage; keys include the bucket as their first path segment."""

    def __init__(self, config: Settings):
        self.config = config
        self.client = boto3.client(
            "s3",
            endpoint_url=config.s3_endpoint_url,
            aws_access_key_id=config.s3_access_key,
            aws_secret_access_key=config.s3_secret_key,
            region_name=config.s3_region,
        )

    async def ensure_buckets(self) -> None:
        for bucket in (
            self.config.s3_staging_bucket,
            self.config.s3_results_bucket,
            self.config.s3_quarantine_bucket,
            self.config.s3_sources_bucket,
        ):
            try:
                await asyncio.to_thread(self.client.head_bucket, Bucket=bucket)
            except Exception:
                await asyncio.to_thread(self.client.create_bucket, Bucket=bucket)
        for bucket, days in (
            (self.config.s3_staging_bucket, 1),
            (self.config.s3_results_bucket, 2),
            (self.config.s3_quarantine_bucket, 7),
        ):
            await asyncio.to_thread(
                self.client.put_bucket_lifecycle_configuration,
                Bucket=bucket,
                LifecycleConfiguration={
                    "Rules": [
                        {
                            "ID": "atarang-expiry-safety-net",
                            "Status": "Enabled",
                            "Filter": {"Prefix": ""},
                            "Expiration": {"Days": days},
                            "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1},
                        }
                    ]
                },
            )

    async def ready(self) -> bool:
        try:
            await asyncio.to_thread(
                self.client.head_bucket, Bucket=self.config.s3_staging_bucket
            )
            await asyncio.to_thread(
                self.client.head_bucket, Bucket=self.config.s3_results_bucket
            )
            return True
        except Exception:
            return False

    async def write_part(
        self,
        upload_id: UUID,
        part_number: int,
        chunks: AsyncIterator[bytes],
        expected_length: int,
        expected_sha256: str,
    ) -> tuple[str, int]:
        key = f"{upload_id}/{part_number:04d}-{expected_sha256}.part"
        descriptor = f"{self.config.s3_staging_bucket}/{key}"
        digest, size = hashlib.sha256(), 0
        temporary = tempfile.NamedTemporaryFile(prefix="atarang-upload-", delete=False)
        path = Path(temporary.name)
        try:
            with temporary:
                async for chunk in chunks:
                    size += len(chunk)
                    if size > expected_length:
                        raise ValueError("upload_part_too_large")
                    digest.update(chunk)
                    temporary.write(chunk)
                temporary.flush()
                os.fsync(temporary.fileno())
            if size != expected_length or digest.hexdigest() != expected_sha256:
                raise ValueError("upload_part_integrity_failed")
            await asyncio.to_thread(
                self.client.upload_file, str(path), self.config.s3_staging_bucket, key
            )
            return descriptor, size
        finally:
            path.unlink(missing_ok=True)

    def _split(self, object_key: str) -> tuple[str, str]:
        bucket, separator, key = object_key.partition("/")
        allowed = {
            self.config.s3_staging_bucket,
            self.config.s3_results_bucket,
            self.config.s3_quarantine_bucket,
            self.config.s3_sources_bucket,
        }
        if not separator or bucket not in allowed or not key or ".." in key.split("/"):
            raise ValueError("invalid_object_key")
        return bucket, key

    async def stream(
        self, object_key: str, chunk_size: int = 1024 * 1024, start: int = 0,
        end: int | None = None,
    ):
        bucket, key = self._split(object_key)
        options = {"Bucket": bucket, "Key": key}
        if start or end is not None:
            options["Range"] = f"bytes={start}-{'' if end is None else end}"
        response = await asyncio.to_thread(self.client.get_object, **options)
        body = response["Body"]
        try:
            while chunk := await asyncio.to_thread(body.read, chunk_size):
                yield chunk
        finally:
            await asyncio.to_thread(body.close)

    async def size(self, object_key: str) -> int:
        bucket, key = self._split(object_key)
        response = await asyncio.to_thread(self.client.head_object, Bucket=bucket, Key=key)
        return int(response["ContentLength"])

    async def put_result(
        self, job_id: UUID, name: str, chunks: AsyncIterator[bytes], expected_sha256: str
    ) -> tuple[str, int]:
        key = f"{job_id}/{name}"
        descriptor = f"{self.config.s3_results_bucket}/{key}"
        digest, size = hashlib.sha256(), 0
        temporary = tempfile.NamedTemporaryFile(prefix="atarang-result-", delete=False)
        path = Path(temporary.name)
        try:
            with temporary:
                async for chunk in chunks:
                    digest.update(chunk)
                    size += len(chunk)
                    temporary.write(chunk)
                temporary.flush()
                os.fsync(temporary.fileno())
            if digest.hexdigest() != expected_sha256:
                raise ValueError("result_integrity_failed")
            await asyncio.to_thread(
                self.client.upload_file, str(path), self.config.s3_results_bucket, key
            )
            return descriptor, size
        finally:
            path.unlink(missing_ok=True)

    async def put_source(
        self, key: str, chunks: AsyncIterator[bytes], expected_sha256: str
    ) -> tuple[str, int]:
        safe_key = hashlib.sha256(key.encode()).hexdigest()
        object_name = f"{safe_key}-{expected_sha256}.media"
        descriptor = f"{self.config.s3_sources_bucket}/{object_name}"
        temporary = tempfile.NamedTemporaryFile(prefix="atarang-source-", delete=False)
        path = Path(temporary.name)
        digest, size = hashlib.sha256(), 0
        try:
            with temporary:
                async for chunk in chunks:
                    digest.update(chunk)
                    size += len(chunk)
                    temporary.write(chunk)
                temporary.flush()
                os.fsync(temporary.fileno())
            if digest.hexdigest() != expected_sha256:
                raise ValueError("source_integrity_failed")
            await asyncio.to_thread(self.client.upload_file, str(path), self.config.s3_sources_bucket, object_name)
            return descriptor, size
        finally:
            path.unlink(missing_ok=True)

    async def delete_job(self, job_id: UUID, upload_id: UUID | None) -> None:
        prefixes = [(self.config.s3_results_bucket, f"{job_id}/")]
        if upload_id:
            prefixes.append((self.config.s3_staging_bucket, f"{upload_id}/"))
        for bucket, prefix in prefixes:
            response = await asyncio.to_thread(
                self.client.list_objects_v2, Bucket=bucket, Prefix=prefix
            )
            objects = [{"Key": item["Key"]} for item in response.get("Contents", [])]
            if objects:
                await asyncio.to_thread(
                    self.client.delete_objects,
                    Bucket=bucket,
                    Delete={"Objects": objects, "Quiet": True},
                )

    async def delete_source(self, upload_id: UUID) -> None:
        response = await asyncio.to_thread(
            self.client.list_objects_v2,
            Bucket=self.config.s3_staging_bucket,
            Prefix=f"{upload_id}/",
        )
        objects = [{"Key": item["Key"]} for item in response.get("Contents", [])]
        if objects:
            await asyncio.to_thread(
                self.client.delete_objects,
                Bucket=self.config.s3_staging_bucket,
                Delete={"Objects": objects, "Quiet": True},
            )

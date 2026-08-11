import asyncio
import json
import shutil
from pathlib import Path

from atarang_api.config import settings
from atarang_api.objects import FilesystemObjectStore, S3ObjectStore
from atarang_api.repository import PostgresRepository
from atarang_api.schemas import JobState

from .pipeline import process_job


async def serve() -> None:
    repository = PostgresRepository(settings)
    objects = (
        S3ObjectStore(settings)
        if settings.object_backend == "s3"
        else FilesystemObjectStore(settings.object_root)
    )
    if isinstance(objects, S3ObjectStore):
        await objects.ensure_buckets()
    try:
        while True:
            row = await repository.claim(settings.worker_id)
            if not row:
                await asyncio.sleep(2)
                continue
            try:
                await process_job(row, repository, objects, settings)
                if row.source_kind == "upload" and row.upload_id:
                    await objects.delete_source(row.upload_id)
                    await repository.mark_source_deleted(row.id)
                print(json.dumps({"event": "job_completed", "jobId": str(row.id), "attempt": row.attempt, "workerClass": settings.worker_class}))
            except ValueError as error:
                code = str(error)
                if code == "worker_lease_lost":
                    continue
                target = JobState.CANCELLED if code == "cancelled" else JobState.FAILED
                current = await repository.get(row.id)
                if current and current.state == JobState.CANCEL_REQUESTED:
                    target = JobState.CANCELLED
                elif code == "queue_timeout" and current and current.attempt < 2:
                    target = JobState.QUEUED
                try:
                    await repository.change(
                        row.id,
                        target,
                        stage=target.value,
                        error_code=None if target == JobState.QUEUED else code,
                    )
                except ValueError:
                    pass
            except Exception as error:
                code = "worker_oom" if str(error) == "worker_oom" else "separation_failed"
                print(json.dumps({"event": "job_failed", "jobId": str(row.id), "errorClass": type(error).__name__, "errorCode": code}))
                try:
                    current = await repository.get(row.id)
                    target = (
                        JobState.QUEUED
                        if current and current.attempt < 2
                        else JobState.FAILED
                    )
                    await repository.change(
                        row.id,
                        target,
                        stage=target.value,
                        error_code=None if target == JobState.QUEUED else code,
                    )
                except ValueError:
                    pass
            finally:
                shutil.rmtree(
                    Path(settings.worker_scratch_root) / str(row.id), ignore_errors=True
                )
    finally:
        await repository.close()


def run() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    run()

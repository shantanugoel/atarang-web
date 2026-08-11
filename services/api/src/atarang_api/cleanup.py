import asyncio
from datetime import UTC, datetime

from .config import settings
from .objects import FilesystemObjectStore, S3ObjectStore
from .repository import PostgresRepository
from .schemas import JobState


async def cleanup_once() -> int:
    repository = PostgresRepository(settings)
    objects = S3ObjectStore(settings) if settings.object_backend == "s3" else FilesystemObjectStore(settings.object_root)
    removed = 0
    try:
        await repository.purge_old_events(datetime.now(UTC))
        for row in await repository.purge_candidates(datetime.now(UTC)):
            if row.state in {JobState.CREATED, JobState.AWAITING_UPLOAD}:
                await objects.delete_job(row.id, row.upload_id)
                await repository.change(row.id, JobState.EXPIRED, stage="expired")
            elif row.state == JobState.READY and row.result_expires_at and row.result_expires_at > datetime.now(UTC):
                if row.upload_id:
                    await objects.delete_source(row.upload_id)
                await repository.mark_source_deleted(row.id)
            else:
                if row.state != JobState.DELETING:
                    row = await repository.change(row.id, JobState.DELETING, stage="deleting")
                await objects.delete_job(row.id, row.upload_id)
                await repository.change(row.id, JobState.EXPIRED, stage="expired")
            removed += 1
    finally:
        await repository.close()
    return removed


def run() -> None:
    print(asyncio.run(cleanup_once()))


if __name__ == "__main__":
    run()

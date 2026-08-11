import json
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from .config import Settings
from .ids import uuid7
from .models import JobEventRow, JobRow, SourceArtifactRow, UploadPartRow
from .schemas import CreateJobRequest, InitializeUploadRequest, JobState, JobView
from .transitions import TransitionSnapshot, transition
from .youtube import normalize_youtube_url, youtube_source_key


TOKEN_HASHER = PasswordHasher(time_cost=3, memory_cost=65_536, parallelism=2)


def token_hash(token: str) -> str:
    return TOKEN_HASHER.hash(token)


def token_matches(encoded: str, token: str) -> bool:
    try:
        return TOKEN_HASHER.verify(encoded, token)
    except (VerificationError, InvalidHashError):
        return False


def view(row: JobRow) -> JobView:
    return JobView.model_validate(row, from_attributes=True)


class PostgresRepository:
    def __init__(self, config: Settings):
        self.engine = create_async_engine(config.database_url, pool_pre_ping=True)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.config = config

    async def close(self) -> None:
        await self.engine.dispose()

    async def ready(self) -> bool:
        try:
            async with self.sessions() as session:
                await session.execute(select(1))
            return True
        except Exception:
            return False

    async def create_job(
        self, request: CreateJobRequest, idempotency_key: str, capability_hash: str
    ) -> tuple[JobRow, bool]:
        async with self.sessions() as session, session.begin():
            existing = await session.scalar(
                select(JobRow).where(JobRow.idempotency_key == idempotency_key)
            )
            if existing:
                return existing, False
            admitted = await session.scalar(
                select(func.count()).select_from(JobRow).where(
                    JobRow.state.not_in(
                        [
                            JobState.READY,
                            JobState.FAILED,
                            JobState.CANCELLED,
                            JobState.DELETING,
                            JobState.EXPIRED,
                        ]
                    )
                )
            )
            if (admitted or 0) >= 3:
                raise ValueError("rate_limited")
            now = datetime.now(UTC)
            source_locator = None
            source_key = None
            initial_state = JobState.CREATED
            initial_stage = "created"
            if request.source.kind == "youtube":
                video_id, source_locator = normalize_youtube_url(request.source.url)
                source_key = youtube_source_key(video_id)
                initial_state = JobState.ACQUIRING_YOUTUBE
                initial_stage = "acquiring_youtube"
            row = JobRow(
                id=uuid7(),
                upload_id=None,
                idempotency_key=idempotency_key,
                capability_token_hash=capability_hash,
                state=initial_state,
                progress=0,
                stage=initial_stage,
                attempt=0,
                byte_length=request.source.size if request.source.kind == "upload" else None,
                duration_us=None,
                content_sha256=request.source.sha256 if request.source.kind == "upload" else None,
                media_type=None,
                model_id=request.model_artifact_id,
                source_kind=request.source.kind,
                source_locator=source_locator,
                source_key=source_key,
                source_object_key=None,
                source_title=None,
                source_artist=None,
                requested_variants=json.dumps(
                    []
                    if request.processing_mode == "browser"
                    else request.requested_output_variants
                ),
                source_expires_at=now
                + timedelta(seconds=self.config.incomplete_upload_ttl_seconds),
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            await session.flush()
            session.add(
                JobEventRow(
                    job_id=row.id,
                    event="created",
                    payload=json.dumps({"state": row.state}),
                    created_at=now,
                )
            )
            return row, True

    async def claim_youtube(self, worker_id: str, lease_seconds: int = 120) -> JobRow | None:
        now = datetime.now(UTC)
        async with self.sessions() as session, session.begin():
            row = await session.scalar(
                select(JobRow)
                .where(
                    JobRow.state == JobState.ACQUIRING_YOUTUBE,
                    or_(JobRow.lease_owner.is_(None), JobRow.lease_expires_at < now),
                )
                .order_by(JobRow.created_at)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if not row:
                return None
            row.lease_owner = worker_id
            row.lease_expires_at = now + timedelta(seconds=lease_seconds)
            row.progress = max(row.progress, 0.02)
            row.stage = "acquiring_youtube"
            row.updated_at = now
            return row

    async def cached_source(self, key: str) -> SourceArtifactRow | None:
        async with self.sessions() as session:
            return await session.get(SourceArtifactRow, key)

    async def publish_youtube_source(
        self,
        job_id: UUID,
        worker_id: str,
        *,
        key: str,
        object_key: str,
        content_sha256: str,
        byte_length: int,
        media_type: str,
        duration_us: int,
        title: str,
        artist: str,
    ) -> JobRow:
        now = datetime.now(UTC)
        async with self.sessions() as session, session.begin():
            row = await session.scalar(select(JobRow).where(JobRow.id == job_id).with_for_update())
            if not row or row.state != JobState.ACQUIRING_YOUTUBE or row.lease_owner != worker_id or not row.lease_expires_at or row.lease_expires_at <= now:
                raise ValueError("worker_lease_lost")
            artifact = await session.get(SourceArtifactRow, key)
            cache_hit = artifact is not None
            if not artifact:
                artifact = SourceArtifactRow(
                    key=key,
                    object_key=object_key,
                    content_sha256=content_sha256,
                    byte_length=byte_length,
                    media_type=media_type,
                    duration_us=duration_us,
                    title=title,
                    artist=artist,
                    created_at=now,
                    last_used_at=now,
                )
                session.add(artifact)
            else:
                artifact.last_used_at = now
            fetch_only = not json.loads(row.requested_variants)
            current = TransitionSnapshot(
                JobState(row.state), row.progress, row.stage, row.attempt
            )
            if fetch_only:
                next_value = transition(
                    current, JobState.READY, progress=1, stage="ready"
                )
                row.result_expires_at = now + timedelta(
                    seconds=self.config.result_ttl_seconds
                )
            else:
                validating = transition(
                    current, JobState.VALIDATING, progress=0.04, stage="validating"
                )
                next_value = transition(
                    validating, JobState.QUEUED, progress=0.05, stage="queued"
                )
            row.state, row.progress, row.stage = (
                next_value.state,
                next_value.progress,
                next_value.stage,
            )
            row.source_object_key = artifact.object_key
            row.content_sha256 = artifact.content_sha256
            row.byte_length = artifact.byte_length
            row.media_type = artifact.media_type
            row.duration_us = artifact.duration_us
            row.source_title = artifact.title
            row.source_artist = artifact.artist
            row.source_expires_at = now + timedelta(days=3650)
            row.lease_owner = None
            row.lease_expires_at = None
            row.updated_at = now
            session.add(JobEventRow(job_id=row.id, event="state", payload=json.dumps({"state": row.state, "progress": row.progress, "stage": row.stage, "sourceCacheHit": cache_hit}), created_at=now))
            return row

    async def initialize_upload(
        self, job_id: UUID, request: InitializeUploadRequest
    ) -> JobRow:
        async with self.sessions() as session, session.begin():
            row = await session.scalar(select(JobRow).where(JobRow.id == job_id).with_for_update())
            if not row:
                raise KeyError(job_id)
            if row.source_kind != "upload":
                raise ValueError("invalid_source")
            if row.state == JobState.AWAITING_UPLOAD and row.upload_id:
                if (
                    row.byte_length != request.total_bytes
                    or row.content_sha256 != request.content_sha256
                    or row.media_type != request.media_type
                ):
                    raise ValueError("upload_part_conflict")
                return row
            next_value = transition(
                TransitionSnapshot(JobState(row.state), row.progress, row.stage, row.attempt),
                JobState.AWAITING_UPLOAD,
                stage="awaiting_upload",
            )
            row.state, row.stage = next_value.state, next_value.stage
            row.upload_id = uuid7()
            row.byte_length = request.total_bytes
            row.content_sha256 = request.content_sha256
            row.media_type = request.media_type
            row.updated_at = datetime.now(UTC)
            return row

    async def get(self, job_id: UUID) -> JobRow | None:
        async with self.sessions() as session:
            return await session.get(JobRow, job_id)

    async def authenticate(self, job_id: UUID, provided_token: str) -> JobRow | None:
        row = await self.get(job_id)
        return row if row and token_matches(row.capability_token_hash, provided_token) else None

    async def put_part(
        self, upload_id: UUID, part_number: int, byte_length: int, sha256: str, object_key: str
    ) -> None:
        async with self.sessions() as session, session.begin():
            existing = await session.scalar(
                select(UploadPartRow).where(
                    UploadPartRow.upload_id == upload_id,
                    UploadPartRow.part_number == part_number,
                )
            )
            if existing:
                if existing.sha256 != sha256 or existing.byte_length != byte_length:
                    raise ValueError("upload_part_conflict")
                return
            session.add(
                UploadPartRow(
                    upload_id=upload_id,
                    part_number=part_number,
                    byte_length=byte_length,
                    sha256=sha256,
                    object_key=object_key,
                    created_at=datetime.now(UTC),
                )
            )

    async def parts(self, upload_id: UUID) -> Sequence[UploadPartRow]:
        async with self.sessions() as session:
            result = await session.scalars(
                select(UploadPartRow)
                .where(UploadPartRow.upload_id == upload_id)
                .order_by(UploadPartRow.part_number)
            )
            return result.all()

    async def part(self, upload_id: UUID, part_number: int) -> UploadPartRow | None:
        async with self.sessions() as session:
            return await session.scalar(
                select(UploadPartRow).where(
                    UploadPartRow.upload_id == upload_id,
                    UploadPartRow.part_number == part_number,
                )
            )

    async def change(
        self,
        job_id: UUID,
        target: JobState,
        *,
        progress: float | None = None,
        stage: str | None = None,
        error_code: str | None = None,
    ) -> JobRow:
        async with self.sessions() as session, session.begin():
            row = await session.scalar(select(JobRow).where(JobRow.id == job_id).with_for_update())
            if not row:
                raise KeyError(job_id)
            next_value = transition(
                TransitionSnapshot(JobState(row.state), row.progress, row.stage, row.attempt),
                target,
                progress=progress,
                stage=stage,
            )
            row.state, row.progress, row.stage = (
                next_value.state,
                next_value.progress,
                next_value.stage,
            )
            row.error_code = error_code
            row.updated_at = datetime.now(UTC)
            if target in {
                JobState.QUEUED,
                JobState.READY,
                JobState.FAILED,
                JobState.CANCELLED,
                JobState.DELETING,
                JobState.EXPIRED,
            }:
                row.lease_owner = None
                row.lease_expires_at = None
            if target == JobState.READY:
                row.result_expires_at = row.updated_at + timedelta(
                    seconds=self.config.result_ttl_seconds
                )
            if target == JobState.EXPIRED:
                row.content_sha256 = None
                row.media_type = None
                row.result_manifest = None
                row.result_variants = None
                if row.upload_id:
                    await session.execute(
                        delete(UploadPartRow).where(UploadPartRow.upload_id == row.upload_id)
                    )
            session.add(
                JobEventRow(
                    job_id=row.id,
                    event="state",
                    payload=json.dumps(
                        {"state": row.state, "progress": row.progress, "stage": row.stage}
                    ),
                    created_at=row.updated_at,
                )
            )
            return row

    async def publish_result(
        self, job_id: UUID, worker_id: str, manifest: dict, variants: list[dict]
    ) -> JobRow:
        async with self.sessions() as session, session.begin():
            row = await session.scalar(select(JobRow).where(JobRow.id == job_id).with_for_update())
            if not row:
                raise KeyError(job_id)
            if (
                row.lease_owner != worker_id
                or not row.lease_expires_at
                or row.lease_expires_at <= datetime.now(UTC)
            ):
                raise ValueError("worker_lease_lost")
            next_value = transition(
                TransitionSnapshot(JobState(row.state), row.progress, row.stage, row.attempt),
                JobState.READY,
                progress=1,
                stage="ready",
            )
            row.state, row.progress, row.stage = (
                next_value.state,
                next_value.progress,
                next_value.stage,
            )
            row.result_manifest = json.dumps(manifest, separators=(",", ":"), sort_keys=True)
            row.result_variants = json.dumps(variants, separators=(",", ":"), sort_keys=True)
            row.updated_at = datetime.now(UTC)
            row.result_expires_at = row.updated_at + timedelta(seconds=self.config.result_ttl_seconds)
            row.lease_owner = None
            row.lease_expires_at = None
            session.add(
                JobEventRow(
                    job_id=row.id,
                    event="state",
                    payload=json.dumps({"state": row.state, "progress": 1, "stage": "ready"}),
                    created_at=row.updated_at,
                )
            )
            return row

    async def events(self, job_id: UUID, after: int) -> Sequence[JobEventRow]:
        async with self.sessions() as session:
            result = await session.scalars(
                select(JobEventRow)
                .where(JobEventRow.job_id == job_id, JobEventRow.id > after)
                .order_by(JobEventRow.id)
                .limit(100)
            )
            return result.all()

    async def claim(self, worker_id: str, lease_seconds: int = 60) -> JobRow | None:
        now = datetime.now(UTC)
        async with self.sessions() as session, session.begin():
            row = await session.scalar(
                select(JobRow)
                .where(
                    or_(
                        JobRow.state == JobState.QUEUED,
                        JobRow.state.in_(
                            [JobState.PREPROCESSING, JobState.SEPARATING, JobState.PACKAGING]
                        )
                        & (JobRow.lease_expires_at < now - timedelta(seconds=60)),
                    ),
                    JobRow.attempt < 2,
                )
                .order_by(JobRow.created_at)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if not row:
                return None
            row.state = JobState.PREPROCESSING
            row.stage = "preprocessing"
            row.progress = 0.1
            row.attempt += 1
            row.lease_owner = worker_id
            row.lease_expires_at = now + timedelta(seconds=lease_seconds)
            row.updated_at = now
            session.add(
                JobEventRow(
                    job_id=row.id,
                    event="claimed",
                    payload=json.dumps({"attempt": row.attempt}),
                    created_at=now,
                )
            )
            return row

    async def heartbeat(
        self, job_id: UUID, worker_id: str, progress: float, stage: str, lease_seconds: int = 60
    ) -> bool:
        now = datetime.now(UTC)
        async with self.sessions() as session, session.begin():
            row = await session.scalar(select(JobRow).where(JobRow.id == job_id).with_for_update())
            if (
                not row
                or row.state
                not in {JobState.PREPROCESSING, JobState.SEPARATING, JobState.PACKAGING}
                or row.lease_owner != worker_id
                or progress < row.progress
                or not 0 <= progress <= 1
            ):
                return False
            row.progress = progress
            row.stage = stage
            row.lease_expires_at = now + timedelta(seconds=lease_seconds)
            row.updated_at = now
            return True

    async def worker_advance(
        self, job_id: UUID, worker_id: str, target: JobState, progress: float
    ) -> JobRow:
        now = datetime.now(UTC)
        async with self.sessions() as session, session.begin():
            row = await session.scalar(select(JobRow).where(JobRow.id == job_id).with_for_update())
            if not row or row.lease_owner != worker_id or not row.lease_expires_at or row.lease_expires_at <= now:
                raise ValueError("worker_lease_lost")
            next_value = transition(
                TransitionSnapshot(JobState(row.state), row.progress, row.stage, row.attempt),
                target,
                progress=progress,
                stage=target.value,
            )
            row.state, row.progress, row.stage = (
                next_value.state,
                next_value.progress,
                next_value.stage,
            )
            row.updated_at = now
            session.add(
                JobEventRow(
                    job_id=row.id,
                    event="state",
                    payload=json.dumps(
                        {"state": row.state, "progress": row.progress, "stage": row.stage}
                    ),
                    created_at=now,
                )
            )
            return row

    async def purge_candidates(self, now: datetime) -> Sequence[JobRow]:
        async with self.sessions() as session:
            result = await session.scalars(
                select(JobRow).where(
                    or_(
                        JobRow.state.in_([JobState.CREATED, JobState.AWAITING_UPLOAD])
                        & (JobRow.source_expires_at <= now),
                        (JobRow.state == JobState.READY) & (JobRow.result_expires_at <= now),
                        (JobRow.state == JobState.READY)
                        & (JobRow.source_kind == "upload")
                        & (JobRow.source_deleted_at.is_(None)),
                        JobRow.state.in_([JobState.FAILED, JobState.CANCELLED])
                        & (JobRow.updated_at <= now - timedelta(hours=1)),
                        JobRow.state == JobState.DELETING,
                    )
                )
            )
            return result.all()

    async def mark_source_deleted(self, job_id: UUID) -> None:
        async with self.sessions() as session, session.begin():
            row = await session.scalar(select(JobRow).where(JobRow.id == job_id).with_for_update())
            if row:
                row.source_deleted_at = datetime.now(UTC)
                row.updated_at = row.source_deleted_at

    async def purge_old_events(self, now: datetime) -> int:
        async with self.sessions() as session, session.begin():
            result = await session.execute(
                delete(JobEventRow).where(JobEventRow.created_at < now - timedelta(days=30))
            )
            return result.rowcount or 0

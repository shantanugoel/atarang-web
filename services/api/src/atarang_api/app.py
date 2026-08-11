import asyncio
import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, settings
from .objects import FilesystemObjectStore, ObjectStore, S3ObjectStore
from .repository import PostgresRepository, token_hash, view
from .schemas import (
    CapabilityView,
    CompleteUploadRequest,
    CreateJobRequest,
    CreateJobResponse,
    ErrorBody,
    ErrorEnvelope,
    InitializeUploadRequest,
    JobState,
    JobView,
    PartHeaders,
    ResultView,
    UploadPlan,
)

RANGE = re.compile(r"^bytes (\d+)-(\d+)/(\d+)$")
API = "/api/v1"
LOGGER = logging.getLogger("atarang.api")


def problem(
    code: str,
    message: str,
    *,
    stage: str,
    retryable: bool,
    http_status: int,
    correlation_id: UUID | None = None,
):
    body = ErrorEnvelope(
        error=ErrorBody(
            code=code,
            message=message,
            retryable=retryable,
            stage=stage,
            correlation_id=correlation_id or uuid4(),
        )
    )
    return JSONResponse(
        status_code=http_status, content=body.model_dump(mode="json", by_alias=True)
    )


def capability_token(config: Settings, idempotency_key: str) -> str:
    return hmac.new(
        config.deployment_key.encode(), idempotency_key.encode(), hashlib.sha256
    ).hexdigest()


def create_app(
    config: Settings = settings,
    repository: PostgresRepository | None = None,
    object_store: ObjectStore | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        owned = repository is None
        app.state.repository = repository or PostgresRepository(config)
        app.state.objects = object_store or (
            S3ObjectStore(config)
            if config.object_backend == "s3"
            else FilesystemObjectStore(config.object_root)
        )
        if isinstance(app.state.objects, S3ObjectStore):
            await app.state.objects.ensure_buckets()
        yield
        if owned:
            await app.state.repository.close()

    app = FastAPI(
        title="Atarang API",
        version="0.1.0",
        lifespan=lifespan,
        default_response_class=JSONResponse,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[config.public_origin.rstrip("/")],
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Content-Range",
            "Idempotency-Key",
            "Last-Event-ID",
            "Range",
            "X-Atarang-Key",
            "X-Content-Sha256",
        ],
        expose_headers=["X-Correlation-Id", "Digest", "Content-Length", "Content-Range"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        request.state.correlation_id = uuid4()
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Correlation-Id"] = str(request.state.correlation_id)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        key = (request.method, response.status_code)
        app.state.request_metrics[key] = app.state.request_metrics.get(key, [0, 0.0])
        app.state.request_metrics[key][0] += 1
        app.state.request_metrics[key][1] += time.perf_counter() - started
        LOGGER.info(
            json.dumps(
                {
                    "event": "http_request",
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "durationMs": round((time.perf_counter() - started) * 1000, 2),
                    "correlationId": str(request.state.correlation_id),
                },
                separators=(",", ":"),
            )
        )
        return response

    app.state.request_metrics = {}

    async def deployment_auth(x_atarang_key: str = Header(default="")) -> None:
        if not secrets.compare_digest(x_atarang_key, config.deployment_key):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")

    async def job_auth(request: Request, job_id: UUID):
        authorization = request.headers.get("authorization", "")
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
        row = await request.app.state.repository.authenticate(
            job_id, authorization.removeprefix("Bearer ")
        )
        if not row:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
        return row

    @app.exception_handler(ValueError)
    async def value_error_handler(request: Request, error: ValueError):
        code = str(error) if str(error).replace("_", "").isalnum() else "invalid_source"
        response_status = 429 if code == "rate_limited" else 409 if code.endswith("conflict") else 400
        return problem(
            code,
            "The request could not be validated.",
            stage="validating",
            retryable=code == "rate_limited",
            http_status=response_status,
            correlation_id=request.state.correlation_id,
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(request: Request, error: HTTPException):
        code = "retention_expired" if error.status_code == 410 else "invalid_source"
        return problem(
            code,
            "The request is not authorized or no longer available.",
            stage="request",
            retryable=False,
            http_status=error.status_code,
            correlation_id=request.state.correlation_id,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, _error: RequestValidationError):
        return problem(
            "invalid_source",
            "The request could not be validated.",
            stage="validating",
            retryable=False,
            http_status=422,
            correlation_id=request.state.correlation_id,
        )

    @app.exception_handler(Exception)
    async def internal_error_handler(request: Request, error: Exception):
        LOGGER.exception(
            json.dumps(
                {
                    "event": "internal_error",
                    "errorClass": type(error).__name__,
                    "correlationId": str(request.state.correlation_id),
                }
            )
        )
        return problem(
            "internal_error",
            "The server could not complete this request.",
            stage="request",
            retryable=True,
            http_status=500,
            correlation_id=request.state.correlation_id,
        )

    @app.get(f"{API}/health/live")
    async def live():
        return {"status": "ok"}

    @app.get(f"{API}/health/ready")
    async def ready(request: Request):
        if not await request.app.state.repository.ready() or not await request.app.state.objects.ready():
            return problem("storage_unavailable", "A dependency is unavailable.", stage="ready", retryable=True, http_status=503)
        return {"status": "ready"}

    @app.get(f"{API}/version")
    async def version():
        return {
            "webRevision": config.web_revision,
            "apiRevision": config.api_revision,
            "workerRevision": config.implementation_version,
            "schema": 1,
            "modelArtifact": "atarang-htdemucs-server-1",
            "modelSha256": config.model_artifact_sha256 or "not-configured",
            "ort": "1.27.0",
            "ffmpeg": "worker-image-pinned",
            "ytDlp": "2026.7.4" if config.youtube_enabled and config.youtube_acquisition_compiled else "disabled",
        }

    @app.get(f"{API}/metrics", include_in_schema=False)
    async def metrics():
        lines = ["# TYPE atarang_api_requests_total counter", "# TYPE atarang_api_request_duration_seconds_sum counter"]
        for (method, code), (count, duration) in sorted(app.state.request_metrics.items()):
            labels = f'method="{method}",code="{code}"'
            lines.append(f"atarang_api_requests_total{{{labels}}} {count}")
            lines.append(f"atarang_api_request_duration_seconds_sum{{{labels}}} {duration:.6f}")
        return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")

    @app.get(
        f"{API}/capabilities",
        response_model=CapabilityView,
        dependencies=[Depends(deployment_auth)],
    )
    async def capabilities():
        return CapabilityView(
            cloud_enabled=config.cloud_enabled,
            model_id="htdemucs-4stem",
            upload_part_bytes=config.upload_part_bytes,
            max_source_bytes=config.max_source_bytes,
            max_duration_seconds=config.max_duration_seconds,
            source_retention_seconds=config.incomplete_upload_ttl_seconds,
            result_retention_seconds=config.result_ttl_seconds,
            youtube_enabled=config.youtube_enabled and config.youtube_acquisition_compiled,
            youtube_legal_notice_version=config.youtube_legal_notice_version,
            accepted_media_types=[
                "audio/wav", "audio/flac", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/webm"
            ],
            model_artifact_ids=["atarang-htdemucs-server-1"],
            cpu_worker_available=config.cpu_worker_available,
            cuda_worker_available=config.cuda_worker_available,
        )

    @app.post(f"{API}/jobs", response_model=CreateJobResponse, dependencies=[Depends(deployment_auth)])
    async def create_job(
        request: CreateJobRequest,
        raw: Request,
        idempotency_key: str = Header(min_length=16, max_length=128),
    ):
        if request.source.kind == "youtube" and not (
            config.youtube_enabled and config.youtube_acquisition_compiled
        ):
            return problem("youtube_disabled", "YouTube acquisition is disabled.", stage="creating", retryable=False, http_status=403)
        if request.source.kind == "upload" and request.source.size > config.max_source_bytes:
            return problem("media_too_large", "The source exceeds this deployment's limits.", stage="creating", retryable=False, http_status=413)
        token = capability_token(config, idempotency_key)
        row, _created = await raw.app.state.repository.create_job(
            request, idempotency_key, token_hash(token)
        )
        return CreateJobResponse(
            job_id=row.id,
            capability_token=token,
            state=JobState(row.state),
        )

    @app.post(f"{API}/jobs/{{job_id}}/uploads", response_model=UploadPlan)
    async def initialize_upload(job_id: UUID, body: InitializeUploadRequest, request: Request):
        row = await job_auth(request, job_id)
        if row.source_expires_at <= datetime.now(UTC):
            await request.app.state.repository.change(job_id, JobState.EXPIRED, stage="expired")
            raise HTTPException(status_code=410)
        if body.total_bytes > config.max_source_bytes:
            return problem("media_too_large", "The source exceeds this deployment's limits.", stage="uploading", retryable=False, http_status=413)
        if (row.byte_length and row.byte_length != body.total_bytes) or (
            row.content_sha256 and row.content_sha256 != body.content_sha256
        ):
            return problem("invalid_source", "The declared upload identity changed.", stage="uploading", retryable=False, http_status=409)
        row = await request.app.state.repository.initialize_upload(job_id, body)
        return UploadPlan(
            upload_id=row.upload_id,
            part_size=config.upload_part_bytes,
            source_expires_at=row.source_expires_at,
        )

    @app.put(f"{API}/jobs/{{job_id}}/uploads/{{upload_id}}/parts/{{part_number}}")
    async def put_part(
        job_id: UUID,
        upload_id: UUID,
        part_number: int,
        request: Request,
        content_range: str = Header(),
        x_content_sha256: str = Header(pattern=r"^[0-9a-f]{64}$"),
    ):
        row = await job_auth(request, job_id)
        if row.state != JobState.AWAITING_UPLOAD or row.upload_id != upload_id or row.source_expires_at <= datetime.now(UTC):
            return problem("upload_expired", "This upload is no longer active.", stage="uploading", retryable=False, http_status=409)
        match = RANGE.match(content_range)
        if not match:
            raise ValueError("invalid_content_range")
        headers = PartHeaders(
            start=int(match.group(1)), end=int(match.group(2)), total=int(match.group(3)), sha256=x_content_sha256
        )
        expected = headers.end - headers.start + 1
        if part_number < 0 or headers.total != row.byte_length or headers.start != part_number * config.upload_part_bytes or expected > config.upload_part_bytes:
            raise ValueError("invalid_content_range")
        existing = await request.app.state.repository.part(upload_id, part_number)
        if existing:
            if existing.sha256 != headers.sha256 or existing.byte_length != expected:
                raise ValueError("upload_part_conflict")
            return Response(status_code=204)
        object_key, written = await request.app.state.objects.write_part(
            upload_id, part_number, request.stream(), expected, headers.sha256
        )
        await request.app.state.repository.put_part(
            upload_id, part_number, written, headers.sha256, object_key
        )
        return Response(status_code=204)

    @app.post(f"{API}/jobs/{{job_id}}/uploads/{{upload_id}}/complete", response_model=JobView)
    async def complete_upload(job_id: UUID, upload_id: UUID, body: CompleteUploadRequest, request: Request):
        row = await job_auth(request, job_id)
        if row.state != JobState.AWAITING_UPLOAD or row.upload_id != upload_id or row.source_expires_at <= datetime.now(UTC):
            return problem("upload_expired", "This upload is no longer active.", stage="uploading", retryable=False, http_status=409)
        parts = await request.app.state.repository.parts(upload_id)
        if len(parts) != body.part_count or [part.part_number for part in parts] != list(range(body.part_count)) or sum(part.byte_length for part in parts) != row.byte_length:
            return problem("upload_incomplete", "Not every upload part is present.", stage="uploading", retryable=True, http_status=409)
        digest = hashlib.sha256()
        for part in parts:
            async for chunk in request.app.state.objects.stream(part.object_key):
                digest.update(chunk)
        if digest.hexdigest() != body.content_sha256 or body.content_sha256 != row.content_sha256:
            return problem("result_integrity_failed", "The uploaded source checksum differs.", stage="uploading", retryable=False, http_status=422)
        await request.app.state.repository.change(
            job_id, JobState.VALIDATING, progress=0.02, stage="validating"
        )
        return view(
            await request.app.state.repository.change(
                job_id, JobState.QUEUED, progress=0.05, stage="queued"
            )
        )

    @app.get(f"{API}/jobs/{{job_id}}", response_model=JobView)
    async def get_job(job_id: UUID, request: Request):
        return view(await job_auth(request, job_id))

    @app.get(f"{API}/jobs/{{job_id}}/events")
    async def events(job_id: UUID, request: Request, last_event_id: int = Header(default=0, alias="Last-Event-ID")):
        await job_auth(request, job_id)
        async def stream():
            cursor = last_event_id
            idle_seconds = 0
            for _ in range(1_800):
                if await request.is_disconnected():
                    return
                values = await request.app.state.repository.events(job_id, cursor)
                if values:
                    idle_seconds = 0
                    for event in values:
                        cursor = event.id
                        yield f"id: {event.id}\nevent: {event.event}\ndata: {event.payload}\n\n"
                else:
                    idle_seconds += 1
                    if idle_seconds >= 15:
                        idle_seconds = 0
                        yield ": keepalive\n\n"
                await asyncio.sleep(1)
        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.post(f"{API}/jobs/{{job_id}}/cancel", response_model=JobView)
    async def cancel(job_id: UUID, request: Request):
        row = await job_auth(request, job_id)
        if row.state in {
            JobState.CANCEL_REQUESTED,
            JobState.CANCELLED,
            JobState.FAILED,
            JobState.READY,
            JobState.DELETING,
            JobState.EXPIRED,
        }:
            return view(row)
        row = await request.app.state.repository.change(
            job_id, JobState.CANCEL_REQUESTED, stage="cancelling"
        )
        if JobState(row.state) == JobState.CANCEL_REQUESTED and row.lease_owner is None:
            row = await request.app.state.repository.change(
                job_id,
                JobState.CANCELLED,
                stage="cancelled",
                error_code="cancelled",
            )
        return view(row)

    @app.get(f"{API}/jobs/{{job_id}}/result", response_model=ResultView)
    async def result(job_id: UUID, request: Request):
        row = await job_auth(request, job_id)
        if row.state == JobState.EXPIRED or (
            row.result_expires_at and row.result_expires_at <= datetime.now(UTC)
        ):
            raise HTTPException(status_code=410)
        if row.state != JobState.READY or not row.result_manifest or not row.result_variants:
            return problem("result_integrity_failed", "The result is not ready.", stage=row.stage, retryable=True, http_status=409)
        return ResultView(
            manifest=json.loads(row.result_manifest), variants=json.loads(row.result_variants)
        )

    @app.get(f"{API}/jobs/{{job_id}}/source")
    async def download_source(job_id: UUID, request: Request):
        row = await job_auth(request, job_id)
        if row.state != JobState.READY or row.source_kind != "youtube" or not row.source_object_key or not row.content_sha256 or not row.byte_length:
            raise HTTPException(status_code=404)
        name = re.sub(r"[^A-Za-z0-9._ -]+", "", row.source_title or "youtube-audio").strip()[:120] or "youtube-audio"
        return StreamingResponse(
            request.app.state.objects.stream(row.source_object_key),
            media_type=row.media_type or "application/octet-stream",
            headers={
                "Content-Length": str(row.byte_length),
                "Content-Disposition": f'attachment; filename="{name}.mp3"',
                "Digest": f"SHA-256={base64.b64encode(bytes.fromhex(row.content_sha256)).decode()}",
                "Cache-Control": "private, no-store",
            },
        )

    @app.get(f"{API}/jobs/{{job_id}}/result/{{stem}}/{{encoding}}")
    async def download_result(
        job_id: UUID, stem: str, encoding: str, request: Request, range_header: str | None = Header(default=None, alias="Range")
    ):
        row = await job_auth(request, job_id)
        if (
            row.state != JobState.READY
            or not row.result_variants
            or not row.result_expires_at
            or row.result_expires_at <= datetime.now(UTC)
        ):
            raise HTTPException(status_code=410)
        match = next(
            (
                item
                for item in json.loads(row.result_variants)
                if item["stem"] == stem and item["encoding"] == encoding
            ),
            None,
        )
        if not match:
            raise HTTPException(status_code=404)
        total = await request.app.state.objects.size(match["objectKey"])
        start, end, response_status = 0, total - 1, 200
        if range_header:
            range_match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header)
            if not range_match or (not range_match.group(1) and not range_match.group(2)):
                return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
            if range_match.group(1):
                start = int(range_match.group(1))
                end = int(range_match.group(2)) if range_match.group(2) else total - 1
            else:
                suffix = int(range_match.group(2))
                start = max(0, total - suffix)
            if start > end or start >= total:
                return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
            end = min(end, total - 1)
            response_status = 206
        response_headers = {
            "Content-Length": str(end - start + 1),
            "Digest": f"SHA-256={base64.b64encode(bytes.fromhex(match['sha256'])).decode()}",
            "Accept-Ranges": "bytes",
        }
        if response_status == 206:
            response_headers["Content-Range"] = f"bytes {start}-{end}/{total}"
        return StreamingResponse(
            request.app.state.objects.stream(match["objectKey"], start=start, end=end),
            media_type=match["mediaType"],
            headers=response_headers,
            status_code=response_status,
        )

    @app.delete(f"{API}/jobs/{{job_id}}", response_model=JobView)
    async def delete_job(job_id: UUID, request: Request):
        row = await job_auth(request, job_id)
        if row.state == JobState.EXPIRED:
            return view(row)
        if row.state != JobState.DELETING:
            if row.state not in {JobState.READY, JobState.FAILED, JobState.CANCELLED}:
                row = await request.app.state.repository.change(
                    job_id, JobState.CANCEL_REQUESTED, stage="cancelling"
                )
                return view(row)
            row = await request.app.state.repository.change(
                job_id, JobState.DELETING, stage="deleting"
            )
        await request.app.state.objects.delete_job(row.id, row.upload_id)
        return view(
            await request.app.state.repository.change(
                job_id, JobState.EXPIRED, stage="expired"
            )
        )

    return app


app = create_app()

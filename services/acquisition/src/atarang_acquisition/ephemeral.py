"""A YouTube fetch that keeps nothing.

The full stack records a job in Postgres and stages the audio in S3, so a fetch
survives a restart and the next listener reuses what an earlier one paid for.
This service keeps the job in a dict and the audio in a temp file, and forgets
both once the browser has taken its copy — which is all a browser-side
separation ever needed. The HTTP contract is the subset of the real API that
`runYouTubeSeparation` speaks, so the web app cannot tell the two apart until it
asks for server-side stems, which this deployment does not have.

Separate process, separate compose file: this replaces the api + acquisition +
postgres + object stack, it does not talk to it.
"""

import asyncio
import hmac
import json
import os
import secrets
import signal
import tempfile
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from atarang_api.config import settings
from atarang_api.schemas import (
    CapabilityView,
    CreateJobRequest,
    CreateJobResponse,
    ErrorBody,
    ErrorEnvelope,
    JobState,
    JobView,
)
from atarang_api.youtube import normalize_youtube_url

API = "/api/v1"
# A fetch nobody collected is a temp file nobody will delete. Half an hour is
# long past the point where the browser that asked for it is still waiting.
JOB_TTL = timedelta(minutes=30)
FETCH_TIMEOUT_SECONDS = 20 * 60
# One host, one yt-dlp at a time plus one waiting. Without a cap a held
# deployment key is an unbounded process spawner; with it, the second tab waits.
MAX_ACTIVE = 2


@dataclass
class Job:
    token: str
    state: JobState = JobState.ACQUIRING_YOUTUBE
    stage: str = "acquiring_youtube"
    progress: float = 0.1
    error_code: str | None = None
    title: str | None = None
    artist: str | None = None
    media: Path | None = None
    byte_length: int | None = None
    scratch: tempfile.TemporaryDirectory | None = None
    process: asyncio.subprocess.Process | None = None
    task: asyncio.Task | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))


def problem(code: str, message: str, *, http_status: int, stage: str = "acquiring_youtube"):
    body = ErrorEnvelope(
        error=ErrorBody(
            code=code, message=message, retryable=False, stage=stage, correlation_id=uuid4()
        )
    )
    return JSONResponse(status_code=http_status, content=body.model_dump(mode="json", by_alias=True))


def view(job_id: UUID, job: Job) -> JobView:
    return JobView(
        id=job_id,
        state=job.state,
        progress=job.progress,
        stage=job.stage,
        attempt=1,
        error_code=job.error_code,
        created_at=job.created_at,
        updated_at=job.updated_at,
        source_expires_at=job.created_at + JOB_TTL,
        source_title=job.title,
        source_artist=job.artist,
        media_type="audio/mpeg" if job.media else None,
        byte_length=job.byte_length,
    )


def settle(job: Job, state: JobState, *, error_code: str | None = None) -> None:
    job.state = state
    job.stage = state.value
    job.progress = 1.0 if state == JobState.READY else job.progress
    job.error_code = error_code
    job.updated_at = datetime.now(UTC)


async def fetch(job: Job, locator: str) -> None:
    """Download one video's audio as mp3 into the job's own scratch directory."""
    job.scratch = tempfile.TemporaryDirectory(prefix="atarang-youtube-")
    scratch = Path(job.scratch.name)
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
        locator,
    ]
    with tempfile.TemporaryFile() as errors:
        # Its own session, so a timeout or a cancel takes the ffmpeg yt-dlp
        # spawned with it rather than leaving it holding the scratch directory.
        job.process = await asyncio.create_subprocess_exec(
            *command, stdout=asyncio.subprocess.PIPE, stderr=errors, start_new_session=True
        )
        try:
            await asyncio.wait_for(job.process.wait(), timeout=FETCH_TIMEOUT_SECONDS)
        except TimeoutError:
            kill(job)
            await job.process.wait()
            raise ValueError("youtube_acquisition_timed_out") from None
        stdout = await job.process.stdout.read() if job.process.stdout else b""
        if job.process.returncode:
            errors.seek(0)
            detail = errors.read(64 * 1024).lower()
            if b"larger than max-filesize" in detail or b"does not pass filter" in detail:
                raise ValueError("media_too_large")
            if b"sign in" in detail or b"confirm you're not a bot" in detail or b"http error 403" in detail:
                raise ValueError("youtube_temporarily_unavailable")
            raise ValueError("youtube_acquisition_failed")

    media = scratch / "source.mp3"
    if not media.is_file() or not 0 < media.stat().st_size <= settings.max_source_bytes:
        raise ValueError("media_too_large")
    try:
        metadata = json.loads(stdout.splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        metadata = {}
    job.media = media
    job.byte_length = media.stat().st_size
    job.title = str(metadata.get("title") or "YouTube audio")[:255]
    job.artist = str(metadata.get("artist") or metadata.get("uploader") or "YouTube")[:255]
    settle(job, JobState.READY)


def kill(job: Job) -> None:
    if job.process and job.process.returncode is None:
        with suppress(ProcessLookupError):
            os.killpg(job.process.pid, signal.SIGTERM)


def discard(jobs: dict[UUID, Job], job_id: UUID) -> None:
    job = jobs.pop(job_id, None)
    if not job:
        return
    if job.task:
        job.task.cancel()
    kill(job)
    if job.scratch:
        job.scratch.cleanup()


def create_app(config=settings) -> FastAPI:
    jobs: dict[UUID, Job] = {}

    async def sweep() -> None:
        while True:
            await asyncio.sleep(60)
            deadline = datetime.now(UTC) - JOB_TTL
            for job_id in [i for i, job in jobs.items() if job.created_at < deadline]:
                discard(jobs, job_id)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        sweeper = asyncio.create_task(sweep())
        yield
        sweeper.cancel()
        for job_id in list(jobs):
            discard(jobs, job_id)

    app = FastAPI(title="Atarang YouTube", version="0.2.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        # Same reasoning as the API service: the key authenticates, the origin
        # does not, and the static frontend can be served from anywhere.
        allow_origins=["*"],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Atarang-Key"],
        expose_headers=["Content-Length"],
    )

    async def deployment_auth(x_atarang_key: str = Header(default="")) -> None:
        if not secrets.compare_digest(x_atarang_key, config.deployment_key):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")

    def job_auth(request: Request, job_id: UUID) -> Job:
        authorization = request.headers.get("authorization", "")
        job = jobs.get(job_id)
        if not job or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
        if not secrets.compare_digest(authorization.removeprefix("Bearer "), job.token):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
        return job

    @app.exception_handler(HTTPException)
    async def http_error_handler(request: Request, error: HTTPException):
        return problem(str(error.detail), "The request was refused.", http_status=error.status_code)

    @app.get(f"{API}/health/live")
    @app.get(f"{API}/health/ready")
    async def health():
        return {"status": "ok"}

    @app.get(f"{API}/capabilities", response_model=CapabilityView, dependencies=[Depends(deployment_auth)])
    async def capabilities():
        return CapabilityView(
            cloud_enabled=True,
            model_id="htdemucs-4stem",
            upload_part_bytes=config.upload_part_bytes,
            max_source_bytes=config.max_source_bytes,
            max_duration_seconds=config.max_duration_seconds,
            source_retention_seconds=int(JOB_TTL.total_seconds()),
            result_retention_seconds=0,
            youtube_enabled=True,
            youtube_legal_notice_version=config.youtube_legal_notice_version,
            accepted_media_types=["audio/mpeg"],
            model_artifact_ids=["atarang-htdemucs-server-1"],
            cpu_worker_available=False,
            cuda_worker_available=False,
            max_active_jobs=MAX_ACTIVE,
            max_queued_jobs=0,
        )

    @app.post(f"{API}/jobs", response_model=CreateJobResponse, dependencies=[Depends(deployment_auth)])
    async def create_job(body: CreateJobRequest, idempotency_key: str = Header(min_length=16, max_length=128)):
        if body.source.kind != "youtube":
            return problem("upload_unsupported", "This deployment fetches from YouTube only.", http_status=400, stage="creating")
        # Nothing here separates anything; saying so at creation beats a job
        # that reaches ready and then has no stems to hand over.
        if body.processing_mode != "browser":
            return problem("cloud_separation_unavailable", "This deployment fetches audio; separate it in the browser.", http_status=403, stage="creating")
        try:
            _, locator = normalize_youtube_url(body.source.url)
        except ValueError:
            return problem("invalid_youtube_url", "That is not a YouTube video URL.", http_status=400, stage="creating")
        if sum(job.state == JobState.ACQUIRING_YOUTUBE for job in jobs.values()) >= MAX_ACTIVE:
            return problem("too_many_active_jobs", "This deployment is already fetching. Try again shortly.", http_status=429, stage="creating")

        job_id = uuid4()
        job = Job(token=hmac.new(config.deployment_key.encode(), job_id.bytes, "sha256").hexdigest())
        jobs[job_id] = job

        async def run() -> None:
            try:
                await fetch(job, locator)
            except asyncio.CancelledError:
                kill(job)
                raise
            except ValueError as error:
                settle(job, JobState.FAILED, error_code=str(error))
            except Exception:
                settle(job, JobState.FAILED, error_code="youtube_acquisition_failed")

        job.task = asyncio.create_task(run())
        return CreateJobResponse(job_id=job_id, capability_token=job.token, state=job.state)

    @app.get(f"{API}/jobs/{{job_id}}", response_model=JobView)
    async def get_job(request: Request, job_id: UUID):
        return view(job_id, job_auth(request, job_id))

    @app.get(f"{API}/jobs/{{job_id}}/source")
    async def download_source(request: Request, job_id: UUID):
        job = job_auth(request, job_id)
        if job.state != JobState.READY or not job.media:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="source_unavailable")
        return FileResponse(job.media, media_type="audio/mpeg", filename="source.mp3")

    @app.post(f"{API}/jobs/{{job_id}}/cancel", response_model=JobView)
    async def cancel(request: Request, job_id: UUID):
        job = job_auth(request, job_id)
        if job.state == JobState.ACQUIRING_YOUTUBE:
            if job.task:
                job.task.cancel()
            kill(job)
            settle(job, JobState.CANCELLED, error_code="cancelled")
        return view(job_id, job)

    @app.delete(f"{API}/jobs/{{job_id}}", response_model=JobView)
    async def delete_job(request: Request, job_id: UUID):
        job = job_auth(request, job_id)
        deleted = view(job_id, job)
        discard(jobs, job_id)
        deleted.state = JobState.DELETING
        deleted.stage = "deleting"
        return deleted

    return app


app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")


if __name__ == "__main__":
    run()

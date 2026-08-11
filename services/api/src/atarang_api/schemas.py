from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class JobState(StrEnum):
    CREATED = "created"
    AWAITING_UPLOAD = "awaiting_upload"
    ACQUIRING_YOUTUBE = "acquiring_youtube"
    VALIDATING = "validating"
    QUEUED = "queued"
    PREPROCESSING = "preprocessing"
    SEPARATING = "separating"
    PACKAGING = "packaging"
    READY = "ready"
    FAILED = "failed"
    CANCEL_REQUESTED = "cancel_requested"
    CANCELLED = "cancelled"
    DELETING = "deleting"
    EXPIRED = "expired"


class UploadSource(ApiModel):
    kind: Literal["upload"]
    file_name: str | None = Field(default=None, max_length=255)
    size: int = Field(gt=0, le=1_073_741_824)
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class YouTubeSource(ApiModel):
    kind: Literal["youtube"]
    url: str = Field(min_length=12, max_length=2048)


JobSource = Annotated[UploadSource | YouTubeSource, Field(discriminator="kind")]


class CreateJobRequest(ApiModel):
    source: JobSource
    processing_mode: Literal["server", "browser"] = "server"
    model_artifact_id: Literal["atarang-htdemucs-server-1"] = "atarang-htdemucs-server-1"
    requested_output_variants: list[Literal["flac", "pcm-f32le-wav"]] = Field(
        default_factory=lambda: ["flac"], min_length=1, max_length=2
    )

    @model_validator(mode="after")
    def browser_processing_requires_youtube(self) -> "CreateJobRequest":
        if self.processing_mode == "browser" and self.source.kind != "youtube":
            raise ValueError("browser processing mode is only available for YouTube acquisition")
        return self


class CreateJobResponse(ApiModel):
    job_id: UUID
    capability_token: str
    state: JobState


class InitializeUploadRequest(ApiModel):
    total_bytes: int = Field(gt=0, le=1_073_741_824)
    media_type: str = Field(min_length=3, max_length=100)
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class UploadPlan(ApiModel):
    upload_id: UUID
    part_size: int
    source_expires_at: datetime


class CompleteUploadRequest(ApiModel):
    part_count: int = Field(gt=0, le=128)
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class JobView(ApiModel):
    id: UUID
    state: JobState
    progress: float = Field(ge=0, le=1)
    stage: str
    attempt: int
    error_code: str | None = None
    created_at: datetime
    updated_at: datetime
    source_expires_at: datetime
    result_expires_at: datetime | None = None
    source_title: str | None = None
    source_artist: str | None = None
    media_type: str | None = None
    byte_length: int | None = None
    retryable: bool = False


class ResultVariant(ApiModel):
    stem: Literal["vocals", "drums", "bass", "other"]
    encoding: Literal["flac", "pcm-f32le-wav"]
    media_type: str
    byte_length: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    download_path: str


class ResultView(ApiModel):
    manifest: dict
    variants: list[ResultVariant]


class CapabilityView(ApiModel):
    cloud_enabled: bool
    model_id: Literal["htdemucs-4stem"]
    upload_part_bytes: int
    max_source_bytes: int
    max_duration_seconds: int
    source_retention_seconds: int
    result_retention_seconds: int
    youtube_enabled: bool = False
    youtube_legal_notice_version: str
    accepted_media_types: list[str]
    model_artifact_ids: list[str]
    cpu_worker_available: bool
    cuda_worker_available: bool
    max_active_jobs: int = 1
    max_queued_jobs: int = 2


class ErrorBody(ApiModel):
    code: str
    message: str
    retryable: bool
    stage: str
    correlation_id: UUID
    details: dict[str, int | float | bool] = Field(default_factory=dict)


class ErrorEnvelope(ApiModel):
    error: ErrorBody


class PartHeaders(ApiModel):
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    total: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def ordered(self) -> "PartHeaders":
        if self.end < self.start or self.end - self.start + 1 > 64 * 1024 * 1024:
            raise ValueError("invalid content range")
        return self

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ATARANG_", extra="ignore")

    database_url: str = "postgresql+psycopg://atarang:atarang@postgres/atarang"
    deployment_key: str = Field(default="development-only-change-me", min_length=16)
    public_origin: str = "http://localhost:4173"
    object_root: str = "/var/lib/atarang/objects"
    object_backend: str = "filesystem"
    s3_endpoint_url: str = "http://object:9000"
    s3_access_key: str = "atarang"
    s3_secret_key: str = "development-object-secret"
    s3_region: str = "us-east-1"
    s3_staging_bucket: str = "staging"
    s3_results_bucket: str = "results"
    s3_quarantine_bucket: str = "quarantine"
    s3_sources_bucket: str = "sources"
    youtube_enabled: bool = False
    youtube_acquisition_compiled: bool = False
    cloud_enabled: bool = True
    cpu_worker_available: bool = True
    cuda_worker_available: bool = False
    youtube_legal_notice_version: str = "disabled-v1"
    max_source_bytes: int = 1_073_741_824
    max_duration_seconds: int = 1_200
    upload_part_bytes: int = 16 * 1024 * 1024
    incomplete_upload_ttl_seconds: int = 1_800
    result_ttl_seconds: int = 86_400
    worker_id: str = "worker-unconfigured"
    worker_class: str = "cpu"
    worker_scratch_root: str = "/tmp/atarang-worker"
    implementation_version: str = "development"
    api_revision: str = "development"
    web_revision: str = "development"
    model_artifact_sha256: str | None = None
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    ytdlp_bin: str = "yt-dlp"
    youtube_acquisition_worker_id: str = "youtube-acquisition-1"


settings = Settings()

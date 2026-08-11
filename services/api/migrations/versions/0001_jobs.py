"""Create durable jobs, upload parts and replayable events."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_jobs"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("upload_id", postgresql.UUID(as_uuid=True), nullable=True, unique=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False, unique=True),
        sa.Column("capability_token_hash", sa.Text(), nullable=False),
        sa.Column("state", sa.String(32), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False, server_default="0"),
        sa.Column("stage", sa.String(32), nullable=False, server_default="uploading"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("byte_length", sa.BigInteger()),
        sa.Column("duration_us", sa.BigInteger()),
        sa.Column("content_sha256", sa.String(64)),
        sa.Column("media_type", sa.String(100)),
        sa.Column("model_id", sa.String(96), nullable=False),
        sa.Column("source_kind", sa.String(16), nullable=False),
        sa.Column("requested_variants", sa.Text(), nullable=False),
        sa.Column("error_code", sa.String(64)),
        sa.Column("lease_owner", sa.String(128)),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True)),
        sa.Column("source_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_deleted_at", sa.DateTime(timezone=True)),
        sa.Column("result_expires_at", sa.DateTime(timezone=True)),
        sa.Column("result_manifest", sa.Text()),
        sa.Column("result_variants", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("progress >= 0 AND progress <= 1", name="jobs_progress_bounded"),
        sa.CheckConstraint("attempt >= 0 AND attempt <= 2", name="jobs_attempt_bounded"),
        sa.CheckConstraint(
            "state IN ('created','awaiting_upload','acquiring_youtube','validating','queued','preprocessing','separating','packaging','ready','failed','cancel_requested','cancelled','deleting','expired')",
            name="jobs_state_known",
        ),
        sa.CheckConstraint(
            "content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'",
            name="jobs_source_sha256_valid",
        ),
    )
    op.create_index("ix_jobs_state", "jobs", ["state"])
    op.create_index("ix_jobs_lease", "jobs", ["state", "lease_expires_at", "attempt"])
    op.create_table(
        "upload_parts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("upload_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("part_number", sa.Integer(), nullable=False),
        sa.Column("byte_length", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("upload_id", "part_number"),
    )
    op.create_index("ix_upload_parts_upload_id", "upload_parts", ["upload_id"])
    op.create_table(
        "job_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("jobs.id"), nullable=False),
        sa.Column("event", sa.String(32), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_job_events_job_id", "job_events", ["job_id"])


def downgrade() -> None:
    op.drop_table("job_events")
    op.drop_table("upload_parts")
    op.drop_index("ix_jobs_lease", table_name="jobs")
    op.drop_table("jobs")

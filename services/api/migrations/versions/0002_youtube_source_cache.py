"""Add normalized YouTube source acquisition and persistent deduplication cache."""
from alembic import op
import sqlalchemy as sa

revision = "0002_youtube_source_cache"
down_revision = "0001_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("source_locator", sa.Text()))
    op.add_column("jobs", sa.Column("source_key", sa.String(128)))
    op.add_column("jobs", sa.Column("source_object_key", sa.Text()))
    op.add_column("jobs", sa.Column("source_title", sa.String(255)))
    op.add_column("jobs", sa.Column("source_artist", sa.String(255)))
    op.create_index("ix_jobs_source_key", "jobs", ["source_key"])
    op.create_table(
        "source_artifacts",
        sa.Column("key", sa.String(128), primary_key=True),
        sa.Column("object_key", sa.Text(), nullable=False, unique=True),
        sa.Column("content_sha256", sa.String(64), nullable=False, unique=True),
        sa.Column("byte_length", sa.BigInteger(), nullable=False),
        sa.Column("media_type", sa.String(100), nullable=False),
        sa.Column("duration_us", sa.BigInteger(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("artist", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("content_sha256 ~ '^[0-9a-f]{64}$'", name="source_artifacts_sha256_valid"),
        sa.CheckConstraint("byte_length > 0 AND duration_us > 0", name="source_artifacts_dimensions_valid"),
    )


def downgrade() -> None:
    op.drop_table("source_artifacts")
    op.drop_index("ix_jobs_source_key", table_name="jobs")
    op.drop_column("jobs", "source_artist")
    op.drop_column("jobs", "source_title")
    op.drop_column("jobs", "source_object_key")
    op.drop_column("jobs", "source_key")
    op.drop_column("jobs", "source_locator")

"""card source (series) fields and card_images

Revision ID: 003
Revises: 002
Create Date: 2026-11-20 00:00:00.000000

Additive only: new nullable columns on cards, has_image with a server default, and a new table.
Existing cards keep working unchanged (source_* stay NULL, has_image = false).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("cards", sa.Column("source_type", sa.Text(), nullable=True))
    op.add_column("cards", sa.Column("source_title", sa.Text(), nullable=True))
    op.add_column("cards", sa.Column("source_season", sa.Integer(), nullable=True))
    op.add_column("cards", sa.Column("source_episode", sa.Integer(), nullable=True))
    op.add_column("cards", sa.Column("source_timecode_ms", sa.Integer(), nullable=True))
    op.add_column("cards", sa.Column("source_line", sa.Text(), nullable=True))
    op.add_column("cards", sa.Column("source_context", postgresql.JSONB(), nullable=True))
    op.add_column("cards", sa.Column("has_image", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.create_table(
        "card_images",
        sa.Column("card_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("mime", sa.Text(), nullable=False, server_default="image/jpeg"),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("card_images")
    for col in ("has_image", "source_context", "source_line", "source_timecode_ms",
                "source_episode", "source_season", "source_title", "source_type"):
        op.drop_column("cards", col)

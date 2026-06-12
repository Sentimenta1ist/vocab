"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-06-12 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cards",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("word", sa.Text(), nullable=False),
        sa.Column("example_1", sa.Text(), nullable=False),
        sa.Column("example_2", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("translation", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False, server_default="new"),
        sa.Column("ease_factor", sa.Float(), nullable=False, server_default="2.5"),
        sa.Column("interval_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("repetitions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_review_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("word", name="uq_cards_word"),
        sa.CheckConstraint(
            "category IN ('new','learning','learned')", name="ck_cards_category"
        ),
    )
    op.create_index("ix_cards_word", "cards", ["word"])
    op.create_index(
        "ix_cards_due",
        "cards",
        ["next_review_at"],
        postgresql_where=sa.text("category IN ('learning','learned')"),
    )


def downgrade() -> None:
    op.drop_index("ix_cards_due", table_name="cards")
    op.drop_index("ix_cards_word", table_name="cards")
    op.drop_table("cards")

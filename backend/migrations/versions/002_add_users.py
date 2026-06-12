"""add users table and user_id to cards

Revision ID: 002
Revises: 001
Create Date: 2026-06-12 00:00:00.000001

Notes on upgrading an existing deployment:
  Any pre-existing cards (from before auth was added) will have user_id = NULL and
  will not be visible through the API (all queries filter by user_id). They can be
  safely deleted with: DELETE FROM cards WHERE user_id IS NULL;
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Users table
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    # 2. Drop old global word uniqueness (per-user uniqueness replaces it)
    op.drop_constraint("uq_cards_word", "cards", type_="unique")

    # 3. Add user_id column (nullable so existing rows survive)
    op.add_column(
        "cards",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )

    # 4. FK + index on user_id
    op.create_foreign_key(
        "fk_cards_user_id",
        "cards",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_cards_user_id", "cards", ["user_id"])

    # 5. New composite unique constraint (per-user word uniqueness)
    op.create_unique_constraint("uq_cards_user_word", "cards", ["user_id", "word"])


def downgrade() -> None:
    op.drop_constraint("uq_cards_user_word", "cards", type_="unique")
    op.drop_index("ix_cards_user_id", table_name="cards")
    op.drop_constraint("fk_cards_user_id", "cards", type_="foreignkey")
    op.drop_column("cards", "user_id")
    op.create_unique_constraint("uq_cards_word", "cards", ["word"])
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

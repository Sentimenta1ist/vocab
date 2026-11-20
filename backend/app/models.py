import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, LargeBinary, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class Card(Base):
    __tablename__ = "cards"
    __table_args__ = (
        # Per-user uniqueness — two users can study the same word independently
        UniqueConstraint("user_id", "word", name="uq_cards_user_word"),
        CheckConstraint("category IN ('new','learning','learned')", name="ck_cards_category"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,   # nullable to keep existing rows valid during migration
        index=True,
    )
    word: Mapped[str] = mapped_column(String, nullable=False, index=True)

    example_1: Mapped[str] = mapped_column(String, nullable=False)
    example_2: Mapped[str] = mapped_column(String, nullable=False)
    explanation: Mapped[str] = mapped_column(String, nullable=False)
    translation: Mapped[str] = mapped_column(String, nullable=False)

    category: Mapped[str] = mapped_column(String, nullable=False, default="new")

    # Where the word came from (all NULL for cards added by hand). Today only 'series' (Series Vocab extension).
    source_type: Mapped[str | None] = mapped_column(String, nullable=True)
    source_title: Mapped[str | None] = mapped_column(String, nullable=True)
    source_season: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_episode: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_timecode_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_line: Mapped[str | None] = mapped_column(String, nullable=True)
    # {"before": [...], "after": [...], "picked": "...", "kind": "phrasal verb", "url": "..."}
    source_context: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    has_image: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))

    # SM-2 fields
    ease_factor: Mapped[float] = mapped_column(Float, nullable=False, default=2.5)
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    repetitions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    def touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc)


class CardImage(Base):
    """Screenshot for a card, kept out of `cards` so list queries never load the bytes."""
    __tablename__ = "card_images"

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True
    )
    mime: Mapped[str] = mapped_column(String, nullable=False, default="image/jpeg")
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

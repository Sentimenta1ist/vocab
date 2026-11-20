from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


# ── Auth ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    email: str
    created_at: datetime


# ── Cards ──────────────────────────────────────────────────────────────────

class CardCreate(BaseModel):
    word: str = Field(..., min_length=1, max_length=200)

    @field_validator("word", mode="before")
    @classmethod
    def strip_word(cls, v: object) -> object:
        # Strip before length validation so a whitespace-only value (e.g. " ")
        # fails min_length instead of sneaking through as a blank card.
        return v.strip() if isinstance(v, str) else v


class CardUpdate(BaseModel):
    example_1: Optional[str] = None
    example_2: Optional[str] = None
    explanation: Optional[str] = None
    translation: Optional[str] = None


class RegenerateRequest(BaseModel):
    # None = regenerate entire card; a field name = regenerate only that field
    field: Optional[Literal["example_1", "example_2", "explanation", "translation"]] = None


class ReviewRequest(BaseModel):
    rating: Literal["again", "good", "easy"]


class CardResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    word: str
    example_1: str
    example_2: str
    explanation: str
    translation: str
    category: str
    ease_factor: float
    interval_days: int
    repetitions: int
    next_review_at: Optional[datetime]
    last_reviewed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    source_type: Optional[str] = None
    source_title: Optional[str] = None
    source_season: Optional[int] = None
    source_episode: Optional[int] = None
    source_timecode_ms: Optional[int] = None
    source_line: Optional[str] = None
    source_context: Optional[dict] = None
    has_image: bool = False


class StatsResponse(BaseModel):
    total: int
    new: int
    learning: int
    learned: int
    due_review: int    # learning/learned cards with next_review_at <= now
    due_session: int   # total cards in next study session (review + capped new)


# ── Intake from the Series Vocab extension ─────────────────────────────────

class SeriesSource(BaseModel):
    type: Literal["series"] = "series"
    title: Optional[str] = Field(None, max_length=200)
    season: Optional[int] = Field(None, ge=0, le=1000)
    episode: Optional[int] = Field(None, ge=0, le=10000)
    timecode_ms: Optional[int] = Field(None, ge=0)
    line: str = Field(..., min_length=1, max_length=1000)
    context_before: list[str] = Field(default_factory=list, max_length=5)
    context_after: list[str] = Field(default_factory=list, max_length=5)
    url: Optional[str] = Field(None, max_length=1000)


class SeriesIngest(BaseModel):
    """A card with the explanation already written (no LLM call on our side)."""
    word: str = Field(..., min_length=1, max_length=200)
    picked: Optional[str] = Field(None, max_length=200)
    kind: Optional[str] = Field(None, max_length=40)
    explanation: str = Field(..., min_length=1, max_length=2000)
    example: str = Field("", max_length=1000)
    translation: str = Field(..., min_length=1, max_length=500)
    source: SeriesSource
    screenshot_jpeg_b64: Optional[str] = None

    @field_validator("word", mode="before")
    @classmethod
    def strip_word(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v

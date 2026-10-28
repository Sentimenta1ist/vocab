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


class StatsResponse(BaseModel):
    total: int
    new: int
    learning: int
    learned: int
    due_review: int    # learning/learned cards with next_review_at <= now
    due_session: int   # total cards in next study session (review + capped new)

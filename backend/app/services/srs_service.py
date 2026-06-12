"""
Simplified SM-2 spaced repetition algorithm.

Rating → SM-2 quality mapping:
  again → q=0  (failed recall — reset interval, no ease_factor change)
  good  → q=4  (correct recall — neutral ease_factor, growing intervals)
  easy  → q=5  (trivial recall — ease_factor increases by 0.1)

SM-2 ease_factor formula (applied only on good/easy):
  new_ef = ef + 0.1 − (5 − q) × (0.08 + (5 − q) × 0.02)
  q=4 → delta = 0   (stable: consistent "good" keeps the same interval growth rate)
  q=5 → delta = 0.1 (boosts future intervals slightly)

Interval progression on success:
  rep 0 → 1 day
  rep 1 → 6 days
  rep 2+ → round(prev_interval × ease_factor)

Category transitions:
  new       → first review places it in "learning"
  learning  → "learned" once interval >= LEARNED_THRESHOLD_DAYS
  learned   → back to "learning" on "again"

next_review_at is set to midnight (00:00) of the target day in the user's local
timezone, so all of a day's cards become available together rather than
trickling in throughout the day.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.models import Card

LEARNED_THRESHOLD_DAYS = 21
MIN_EASE_FACTOR = 1.3

RATING_QUALITY: dict[str, int] = {"again": 0, "good": 4, "easy": 5}


def compute_next_review(card: Card, rating: str, tz: str) -> dict:
    """Return a dict of fields to update on the card after a review."""
    q = RATING_QUALITY[rating]
    now_utc = datetime.now(timezone.utc)

    if rating == "again":
        new_interval = 1
        new_repetitions = 0
        new_ease_factor = card.ease_factor  # no penalty on failure
        new_category = "learning"
    else:
        # SM-2 interval
        if card.repetitions == 0:
            new_interval = 1
        elif card.repetitions == 1:
            new_interval = 6
        else:
            new_interval = round(card.interval_days * card.ease_factor)

        # SM-2 ease factor
        delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
        new_ease_factor = max(MIN_EASE_FACTOR, card.ease_factor + delta)

        new_repetitions = card.repetitions + 1
        new_category = "learned" if new_interval >= LEARNED_THRESHOLD_DAYS else "learning"

    next_review_at = _midnight_utc(new_interval, tz)

    return {
        "ease_factor": round(new_ease_factor, 4),
        "interval_days": new_interval,
        "repetitions": new_repetitions,
        "category": new_category,
        "next_review_at": next_review_at,
        "last_reviewed_at": now_utc,
    }


def _midnight_utc(days_from_now: int, tz: str) -> datetime:
    """Return the UTC timestamp for midnight of (today + days_from_now) in the given timezone."""
    user_tz = ZoneInfo(tz)
    target_local = datetime.now(user_tz) + timedelta(days=days_from_now)
    midnight_local = target_local.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight_local.astimezone(timezone.utc)

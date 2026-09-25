from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm import client as llm
from app.models import Card
from app.schemas import CardUpdate, StatsResponse
from app.services import srs_service


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

async def _get_or_404(db: AsyncSession, card_id: UUID, user_id: UUID) -> Card:
    """Fetch a card by id that belongs to the given user; 404 if missing or not owned."""
    result = await db.execute(
        select(Card).where(Card.id == card_id, Card.user_id == user_id)
    )
    card = result.scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


def _normalize_word(word: str) -> str:
    return word.strip().lower()


# ------------------------------------------------------------------
# Card CRUD
# ------------------------------------------------------------------

async def create_card(db: AsyncSession, word: str, user_id: UUID) -> Card:
    normalized = _normalize_word(word)

    existing = await db.execute(
        select(Card).where(Card.word == normalized, Card.user_id == user_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"You already have a card for '{normalized}'. Open it to study or edit.",
        )

    content = await llm.generate_card(normalized)

    card = Card(
        user_id=user_id,
        word=normalized,
        example_1=content.example_1,
        example_2=content.example_2,
        explanation=content.explanation,
        translation=content.translation,
    )
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return card


async def list_cards(
    db: AsyncSession,
    user_id: UUID,
    category: Optional[str] = None,
) -> list[Card]:
    query = select(Card).where(Card.user_id == user_id)
    if category:
        query = query.where(Card.category == category)
    query = query.order_by(Card.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_card(db: AsyncSession, card_id: UUID, user_id: UUID) -> Card:
    return await _get_or_404(db, card_id, user_id)


async def get_due_cards(db: AsyncSession, new_cap: int, user_id: UUID) -> list[Card]:
    """
    Returns cards due for study:
    - learning/learned cards where next_review_at <= now
    - new cards (up to new_cap, ordered oldest-first)
    """
    now = datetime.now(timezone.utc)

    review_result = await db.execute(
        select(Card)
        .where(
            Card.user_id == user_id,
            Card.category.in_(["learning", "learned"]),
            Card.next_review_at <= now,
        )
        .order_by(Card.next_review_at)
    )
    review_cards = list(review_result.scalars().all())

    new_result = await db.execute(
        select(Card)
        .where(Card.user_id == user_id, Card.category == "new")
        .order_by(Card.created_at)
        .limit(new_cap)
    )
    new_cards = list(new_result.scalars().all())

    return review_cards + new_cards


async def update_card(db: AsyncSession, card_id: UUID, body: CardUpdate, user_id: UUID) -> Card:
    card = await _get_or_404(db, card_id, user_id)
    changed = False
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(card, field, value)
        changed = True
    if changed:
        card.touch()
        await db.commit()
        await db.refresh(card)
    return card


async def regenerate_card(
    db: AsyncSession, card_id: UUID, field: Optional[str], user_id: UUID
) -> Card:
    card = await _get_or_404(db, card_id, user_id)

    if field is None:
        content = await llm.generate_card(card.word)
        card.example_1 = content.example_1
        card.example_2 = content.example_2
        card.explanation = content.explanation
        card.translation = content.translation
    else:
        new_value = await llm.regenerate_field(card.word, field)
        setattr(card, field, new_value)

    card.touch()
    await db.commit()
    await db.refresh(card)
    return card


async def delete_card(db: AsyncSession, card_id: UUID, user_id: UUID) -> None:
    card = await _get_or_404(db, card_id, user_id)
    await db.delete(card)
    await db.commit()


# ------------------------------------------------------------------
# Review
# ------------------------------------------------------------------

async def review_card(
    db: AsyncSession, card_id: UUID, rating: str, tz: str, user_id: UUID
) -> Card:
    card = await _get_or_404(db, card_id, user_id)
    updates = srs_service.compute_next_review(card, rating, tz)
    for key, value in updates.items():
        setattr(card, key, value)
    card.touch()
    await db.commit()
    await db.refresh(card)
    return card


# ------------------------------------------------------------------
# Stats
# ------------------------------------------------------------------

async def get_stats(db: AsyncSession, new_cap: int, user_id: UUID) -> StatsResponse:
    now = datetime.now(timezone.utc)

    rows = await db.execute(
        select(Card.category, func.count(Card.id))
        .where(Card.user_id == user_id)
        .group_by(Card.category)
    )
    counts: dict[str, int] = {row[0]: row[1] for row in rows}

    new_count = counts.get("new", 0)
    learning_count = counts.get("learning", 0)
    learned_count = counts.get("learned", 0)
    total = new_count + learning_count + learned_count

    due_review_result = await db.execute(
        select(func.count(Card.id)).where(
            Card.user_id == user_id,
            Card.category.in_(["learning", "learned"]),
            Card.next_review_at <= now,
        )
    )
    due_review = due_review_result.scalar_one()

    capped_new = min(new_count, new_cap)

    return StatsResponse(
        total=total,
        new=new_count,
        learning=learning_count,
        learned=learned_count,
        due_review=due_review,
        due_session=due_review + capped_new,
    )

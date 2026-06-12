from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User
from app.schemas import CardCreate, CardResponse, CardUpdate, RegenerateRequest, StatsResponse
from app.services import card_service
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/cards", tags=["cards"])


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StatsResponse:
    return await card_service.get_stats(db, settings.new_cards_daily_cap, current_user.id)


@router.get("/due", response_model=list[CardResponse])
async def get_due_cards(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[CardResponse]:
    return await card_service.get_due_cards(db, settings.new_cards_daily_cap, current_user.id)


@router.get("", response_model=list[CardResponse])
async def list_cards(
    category: Optional[Literal["new", "learning", "learned"]] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[CardResponse]:
    return await card_service.list_cards(db, current_user.id, category)


@router.post("", response_model=CardResponse, status_code=201)
async def create_card(
    body: CardCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CardResponse:
    return await card_service.create_card(db, body.word, current_user.id)


@router.get("/{card_id}", response_model=CardResponse)
async def get_card(
    card_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CardResponse:
    return await card_service.get_card(db, card_id, current_user.id)


@router.patch("/{card_id}", response_model=CardResponse)
async def update_card(
    card_id: UUID,
    body: CardUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CardResponse:
    return await card_service.update_card(db, card_id, body, current_user.id)


@router.post("/{card_id}/regenerate", response_model=CardResponse)
async def regenerate_card(
    card_id: UUID,
    body: RegenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CardResponse:
    return await card_service.regenerate_card(db, card_id, body.field, current_user.id)


@router.delete("/{card_id}", status_code=204)
async def delete_card(
    card_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    await card_service.delete_card(db, card_id, current_user.id)

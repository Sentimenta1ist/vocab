from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User
from app.schemas import CardResponse, ReviewRequest
from app.services import card_service
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/cards", tags=["review"])


@router.post("/{card_id}/review", response_model=CardResponse)
async def review_card(
    card_id: UUID,
    body: ReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CardResponse:
    return await card_service.review_card(
        db, card_id, body.rating, settings.timezone, current_user.id
    )

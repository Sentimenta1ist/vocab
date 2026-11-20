"""Card intake from the Series Vocab browser extension.

Auth is a shared secret (`INGEST_TOKEN`) in the `X-Ingest-Token` header, not a user login: the extension's
local server pushes cards for one configured user (`INGEST_USER_EMAIL`). The explanation arrives ready,
so no LLM call happens here.
"""
import base64
import binascii
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.limiter import limiter
from app.models import Card, CardImage, User
from app.schemas import CardResponse, SeriesIngest

router = APIRouter(prefix="/ingest", tags=["ingest"])

JPEG_MAGIC = b"\xff\xd8\xff"


async def ingest_user(
    x_ingest_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not settings.ingest_token or not settings.ingest_user_email:
        raise HTTPException(status_code=404, detail="Not Found")
    if not x_ingest_token or not hmac.compare_digest(x_ingest_token, settings.ingest_token):
        raise HTTPException(status_code=401, detail="Invalid ingest token")
    user = (
        await db.execute(select(User).where(User.email == settings.ingest_user_email.strip().lower()))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=500, detail="INGEST_USER_EMAIL does not match any user")
    return user


def _decode_image(b64: str) -> bytes:
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail="screenshot_jpeg_b64 is not valid base64")
    if not raw.startswith(JPEG_MAGIC):
        raise HTTPException(status_code=422, detail="screenshot must be a JPEG")
    if len(raw) > settings.ingest_max_image_bytes:
        raise HTTPException(status_code=413, detail="screenshot too large")
    return raw


@router.post("/series", response_model=CardResponse, status_code=201)
@limiter.limit("60/minute")
async def ingest_series(
    request: Request,
    body: SeriesIngest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(ingest_user),
) -> CardResponse:
    word = body.word.strip().lower()
    image = _decode_image(body.screenshot_jpeg_b64) if body.screenshot_jpeg_b64 else None

    existing = await db.execute(select(Card).where(Card.word == word, Card.user_id == user.id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"You already have a card for '{word}'.")

    src = body.source
    card = Card(
        user_id=user.id,
        word=word,
        example_1=src.line,              # the line from the series is the first example
        example_2=body.example or src.line,
        explanation=body.explanation,
        translation=body.translation,
        source_type="series",
        source_title=src.title,
        source_season=src.season,
        source_episode=src.episode,
        source_timecode_ms=src.timecode_ms,
        source_line=src.line,
        source_context={
            "before": src.context_before, "after": src.context_after,
            "picked": body.picked, "kind": body.kind, "url": src.url,
        },
        has_image=image is not None,
    )
    db.add(card)
    await db.flush()
    if image is not None:
        db.add(CardImage(card_id=card.id, mime="image/jpeg", data=image))
    await db.commit()
    await db.refresh(card)
    return card

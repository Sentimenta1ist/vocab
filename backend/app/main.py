import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routes.auth import router as auth_router
from app.routes.cards import router as cards_router
from app.routes.review import router as review_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    yield


app = FastAPI(title="Vocab SRS", version="1.0.0", lifespan=lifespan)

app.include_router(auth_router, prefix="/api")
app.include_router(cards_router, prefix="/api")
app.include_router(review_router, prefix="/api")


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "ok"}


# Static frontend — must be mounted last so API routes take priority
app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")

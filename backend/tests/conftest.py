import os

# Settings are read at import time; tests never reach a real database or Gemini
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("GOOGLE_API_KEY", "test-key")
os.environ.setdefault("JWT_SECRET", "test-secret-" + "x" * 32)
os.environ.setdefault("FRONTEND_DIR", "/nonexistent")

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.limiter import limiter
from app.main import app


class _EmptyResult:
    def scalar_one_or_none(self):
        return None


class _EmptyDb:
    """Every lookup finds nothing; anything that writes would fail loudly."""

    async def execute(self, *_args, **_kwargs):
        return _EmptyResult()


@pytest.fixture
def client():
    async def empty_db():
        yield _EmptyDb()

    app.dependency_overrides[get_db] = empty_db
    limiter.reset()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()

"""Migration 003 and the series intake endpoint against a real Postgres.

Runs only when VOCAB_TEST_DB_URL is set (it is wiped), e.g.:
  podman run -d --name vocab-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_USER=test \
    -e POSTGRES_DB=vocab_test -p 55432:5432 postgres:16-alpine
  VOCAB_TEST_DB_URL=postgresql+asyncpg://test:test@localhost:55432/vocab_test \
  DATABASE_URL=$VOCAB_TEST_DB_URL pytest backend/tests/test_ingest_db.py
"""
import asyncio
import base64
import os
import subprocess
import sys
from pathlib import Path

import pytest

DB_URL = os.environ.get("VOCAB_TEST_DB_URL")
pytestmark = pytest.mark.skipif(
    not DB_URL or os.environ.get("DATABASE_URL") != DB_URL,
    reason="set VOCAB_TEST_DB_URL and DATABASE_URL to the same throwaway database",
)

BACKEND = Path(__file__).resolve().parent.parent
TOKEN = "ingest-test-token"
EMAIL = "me@example.com"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 2000


def alembic(*args):
    r = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL": DB_URL})
    assert r.returncode == 0, r.stderr[-2000:]


def sql(query, *args, fetch=False):
    import asyncpg

    async def run():
        conn = await asyncpg.connect(DB_URL.replace("postgresql+asyncpg://", "postgresql://"))
        try:
            return await (conn.fetch(query, *args) if fetch else conn.execute(query, *args))
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def migrated():
    """Old schema (002) with a hand-made card, then upgrade to head: the old card must survive."""
    sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    alembic("upgrade", "002")
    from app.services.auth_service import hash_password

    sql("INSERT INTO users(email, password_hash) VALUES ($1, $2)", EMAIL, hash_password("password123"))
    sql("""INSERT INTO cards(user_id, word, example_1, example_2, explanation, translation, category)
           SELECT id, 'old word', 'e1', 'e2', 'expl', 'перевод', 'learning' FROM users""")
    alembic("upgrade", "head")
    yield


def test_migration_keeps_existing_cards(migrated):
    rows = sql("SELECT word, category, source_type, has_image FROM cards", fetch=True)
    assert [(r["word"], r["category"], r["source_type"], r["has_image"]) for r in rows] == [
        ("old word", "learning", None, False)
    ]


def test_migration_downgrade_and_back(migrated):
    alembic("downgrade", "002")
    assert sql("SELECT count(*) AS n FROM cards", fetch=True)[0]["n"] == 1
    alembic("upgrade", "head")
    assert sql("SELECT count(*) AS n FROM card_images", fetch=True)[0]["n"] == 0


@pytest.fixture(scope="module")
def client(migrated):
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.limiter import limiter
    from app.main import app

    settings.ingest_token = TOKEN
    settings.ingest_user_email = EMAIL
    limiter.reset()
    with TestClient(app) as c:
        yield c


def body(word="pick up the pace", image=True):
    return {
        "word": word, "picked": "pick up", "kind": "idiom",
        "explanation": "To go faster.", "example": "Pick up the pace or we'll be late.", "translation": "ускориться",
        "source": {"type": "series", "title": "The Mentalist", "season": 1, "episode": 1, "timecode_ms": 61234,
                   "line": "We need to pick up the pace.", "context_before": ["a"], "context_after": ["b"]},
        "screenshot_jpeg_b64": base64.b64encode(JPEG).decode() if image else None,
    }


def login(client):
    tok = client.post("/api/auth/login", json={"email": EMAIL, "password": "password123"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def test_ingest_requires_token(client):
    assert client.post("/api/ingest/series", json=body()).status_code == 401
    assert client.post("/api/ingest/series", json=body(), headers={"X-Ingest-Token": "nope"}).status_code == 401


def test_ingest_creates_card_with_image_and_it_is_due(client):
    r = client.post("/api/ingest/series", json=body(), headers={"X-Ingest-Token": TOKEN})
    assert r.status_code == 201, r.text
    card = r.json()
    assert card["word"] == "pick up the pace" and card["category"] == "new" and card["has_image"] is True
    assert card["example_1"] == "We need to pick up the pace."
    assert card["example_2"].startswith("Pick up the pace")
    assert card["source_type"] == "series" and card["source_season"] == 1 and card["source_timecode_ms"] == 61234
    assert card["source_context"]["before"] == ["a"] and card["source_context"]["kind"] == "idiom"

    h = login(client)
    img = client.get(f"/api/cards/{card['id']}/image", headers=h)
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg" and img.content == JPEG
    assert client.get(f"/api/cards/{card['id']}/image").status_code in (401, 403)
    due = client.get("/api/cards/due", headers=h).json()
    assert card["id"] in [c["id"] for c in due]


def test_ingest_duplicate_is_409(client):
    r = client.post("/api/ingest/series", json=body(), headers={"X-Ingest-Token": TOKEN})
    assert r.status_code == 409


def test_ingest_without_image_and_bad_image(client):
    r = client.post("/api/ingest/series", json=body("look into", image=False), headers={"X-Ingest-Token": TOKEN})
    assert r.status_code == 201 and r.json()["has_image"] is False
    bad = body("show off")
    bad["screenshot_jpeg_b64"] = base64.b64encode(b"\x89PNG....").decode()
    assert client.post("/api/ingest/series", json=bad, headers={"X-Ingest-Token": TOKEN}).status_code == 422


def test_old_card_still_listed(client):
    words = [c["word"] for c in client.get("/api/cards", headers=login(client)).json()]
    assert "old word" in words


def test_deleting_card_deletes_image(client):
    h = login(client)
    card = next(c for c in client.get("/api/cards", headers=h).json() if c["word"] == "pick up the pace")
    assert client.delete(f"/api/cards/{card['id']}", headers=h).status_code == 204
    assert sql("SELECT count(*) AS n FROM card_images", fetch=True)[0]["n"] == 0

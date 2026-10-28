import pytest
from fastapi import HTTPException

from app.llm import gemini


def test_register_closed_by_default(client):
    resp = client.post("/api/auth/register", json={"email": "a@example.com", "password": "password123"})
    assert resp.status_code == 403


def test_login_rate_limited(client):
    statuses = [
        client.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong-pass"}).status_code
        for _ in range(11)
    ]
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429


def test_rate_limit_is_per_client_ip(client):
    for _ in range(10):
        client.post(
            "/api/auth/login",
            json={"email": "a@example.com", "password": "wrong-pass"},
            headers={"cf-connecting-ip": "203.0.113.1"},
        )
    other = client.post(
        "/api/auth/login",
        json={"email": "a@example.com", "password": "wrong-pass"},
        headers={"cf-connecting-ip": "203.0.113.2"},
    )
    assert other.status_code == 401


def test_login_rejects_oversized_password(client):
    resp = client.post("/api/auth/login", json={"email": "a@example.com", "password": "x" * 200})
    assert resp.status_code == 422


def test_docs_disabled_by_default(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_cors_never_allows_credentials(client):
    resp = client.options(
        "/api/auth/login",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert resp.headers.get("access-control-allow-credentials") != "true"


def test_daily_llm_limit(monkeypatch):
    monkeypatch.setattr(gemini.settings, "daily_llm_limit", 3)
    monkeypatch.setattr(gemini, "_usage_day", None)
    monkeypatch.setattr(gemini, "_usage_count", 0)
    for _ in range(3):
        gemini._consume_daily_budget()
    with pytest.raises(HTTPException) as exc:
        gemini._consume_daily_budget()
    assert exc.value.status_code == 429


def test_daily_llm_limit_resets_next_day(monkeypatch):
    monkeypatch.setattr(gemini.settings, "daily_llm_limit", 1)
    monkeypatch.setattr(gemini, "_usage_day", "2000-01-01")
    monkeypatch.setattr(gemini, "_usage_count", 1)
    gemini._consume_daily_budget()
    assert gemini._usage_count == 1

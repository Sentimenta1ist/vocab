# Vocab SRS

Personal English vocabulary app with AI-generated cards and spaced repetition (SM-2).

**Stack:** FastAPI · PostgreSQL · Groq (OpenAI-compatible LLM) · PWA (installable on iPhone)

---

## Deploy to Coolify via GitHub

### 1. Push to GitHub

```bash
git init && git add -A && git commit -m "init"
git remote add origin https://github.com/you/vocab.git
git push -u origin main
```

### 2. Create a new resource in Coolify

- **Source:** GitHub → select this repo
- **Build pack:** Docker Compose
- **Docker Compose file:** `docker-compose.yml`

### 3. Set environment variables

In Coolify → Environment Variables, add every key from `.env.example`:

| Variable | Required | Notes |
|---|---|---|
| `GROQ_API_KEY` | ✅ | From [Groq Console](https://console.groq.com/keys) |
| `POSTGRES_PASSWORD` | ✅ | Strong random string |
| `DATABASE_URL` | ✅ | `postgresql+asyncpg://vocab:<password>@postgres:5432/vocab` |
| `LLM_MODEL` | — | Default `llama-3.1-8b-instant` |
| `TIMEZONE` | — | Default `Europe/Dublin` |
| `NEW_CARDS_DAILY_CAP` | — | Default `20` |
| `POSTGRES_DB` | — | Default `vocab` |
| `POSTGRES_USER` | — | Default `vocab` |
| `PORT` | — | Coolify sets this automatically |

> **Important:** `DATABASE_URL` must use the service name `postgres` (as in the compose file) — not `localhost`.

### 4. Health check

Coolify health check URL: `http://<host>:<port>/health`

The endpoint returns `{"status": "ok"}` when the app is up.

### 5. Migrations

Alembic migrations run automatically on every container start (`entrypoint.sh` runs `alembic upgrade head` before uvicorn). No manual steps needed on first deploy or after updates.

---

## Local development

```bash
cp .env.example .env
# Edit .env — set GROQ_API_KEY and POSTGRES_PASSWORD

docker compose up --build
```

App is at `http://localhost:8000`.

To iterate on the backend without rebuilding the image:

```bash
cd backend
pip install -r requirements.txt
# export env vars from .env, then:
uvicorn app.main:app --reload --port 8000
```

---

## Project layout

```
backend/
  app/
    main.py          # FastAPI app, mounts static frontend
    config.py        # All settings via env vars (pydantic-settings)
    database.py      # Async SQLAlchemy engine + session
    models.py        # Card ORM model
    schemas.py       # Pydantic request/response types
    routes/
      cards.py       # CRUD + regenerate endpoints
      review.py      # SRS review endpoint
    services/
      card_service.py   # Business logic
      srs_service.py    # SM-2 algorithm
    llm/
      client.py      # OpenAI-compatible LLM client (Groq)
  migrations/        # Alembic
frontend/            # Vanilla JS PWA (no build step)
Dockerfile           # Multi-stage, Python 3.12-slim
docker-compose.yml   # app + postgres services
```

## API reference

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/cards/stats` | Category counts + due count |
| GET | `/api/cards/due` | Cards due for study (review + capped new) |
| GET | `/api/cards?category=` | List cards, optional filter |
| POST | `/api/cards` | Add word → triggers LLM generation |
| GET | `/api/cards/{id}` | Get single card |
| PATCH | `/api/cards/{id}` | Edit fields manually |
| POST | `/api/cards/{id}/regenerate` | Regen whole card or one field |
| POST | `/api/cards/{id}/review` | Submit rating (again/good/easy) |
| DELETE | `/api/cards/{id}` | Delete card |

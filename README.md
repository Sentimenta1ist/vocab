# Vocab SRS

An English vocabulary trainer: type a word, Gemini writes the study card, and an SM-2 scheduler decides when you see it again. Installable as a PWA.

**Stack:** FastAPI · PostgreSQL · Gemini 2.5 Flash (structured output) · vanilla JS PWA

## What it does

- Add a word; the backend asks Gemini for two example sentences, a plain-English explanation and a Russian translation, then stores the card.
- Edit any field by hand, or regenerate the whole card or a single field.
- Study session: due review cards plus a capped number of new cards per day, rated `again` / `good` / `easy`.
- Cards move through `new` -> `learning` -> `learned`.
- Email + password accounts (bcrypt, JWT). Every card is scoped to its owner.
- Web app manifest and icons so it can be added to a phone home screen.

## How the AI part works

Code: `backend/app/llm/gemini.py`.

- Model `gemini-2.5-flash` via the `google-genai` async client, one shared client instance, 45 s timeout per call.
- **Full card** (`generate_card`): the prompt asks for `example_1`, `example_2`, `explanation` (A2-level English, 1-2 sentences) and `translation` (Russian). Examples must make the meaning clear from context alone. Temperature 0.7.
- **Single field** (`regenerate_field`): a per-field instruction, returns `{"value": "..."}`. Temperature 0.9 for more variety.
- **Structured output:** requests use `response_mime_type="application/json"` with a Pydantic model (`CardContent`, `SingleField`) as `response_schema`.
- **Validation:** the response text is parsed with `model_validate_json`. A schema mismatch becomes HTTP 502, a timeout 504, and quota / `RESOURCE_EXHAUSTED` errors 429; other failures return 502. Nothing is saved on failure.
- Input is normalised (trimmed, lower-cased), blank words are rejected, and a duplicate word for the same user returns 409 before any LLM call.

## How SM-2 scheduling works

Code: `backend/app/services/srs_service.py` (a simplified SM-2).

| Rating | Quality | Effect |
|---|---|---|
| `again` | 0 | interval = 1 day, repetitions reset to 0, ease factor unchanged, category -> `learning` |
| `good` | 4 | ease factor delta 0 |
| `easy` | 5 | ease factor +0.1 |

- On success the interval is 1 day for the first repetition, 6 for the second, then `round(previous_interval * ease_factor)`.
- Ease factor starts at 2.5 and never drops below 1.3.
- A card becomes `learned` once its interval reaches 21 days.
- `next_review_at` is midnight of the target day in the configured `TIMEZONE`, so a day's cards unlock together.
- `/api/cards/due` returns cards with `next_review_at <= now` plus up to `NEW_CARDS_DAILY_CAP` new cards, oldest first.

## Architecture

```
 Browser (PWA, vanilla JS)
        |  JWT over HTTPS
        v
 +-----------------------------+        +----------------------+
 | FastAPI (uvicorn)           | -----> | Gemini 2.5 Flash     |
 |  routes: auth, cards, review|  JSON  | (structured output)  |
 |  services: cards, SM-2, auth|        +----------------------+
 |  serves frontend/ statically|
 +--------------+--------------+
                | SQLAlchemy async (asyncpg)
                v
        PostgreSQL 16  (Alembic migrations)
```

## Stack

| Layer | Technology |
|---|---|
| API | FastAPI 0.115, Pydantic 2, pydantic-settings |
| Database | PostgreSQL 16, SQLAlchemy 2 (async), asyncpg, Alembic |
| LLM | Gemini 2.5 Flash via `google-genai` |
| Auth | bcrypt, PyJWT (HS256) |
| Frontend | Vanilla JS, CSS, web app manifest |
| Packaging | Docker (multi-stage, Python 3.12-slim), docker compose |

## Run locally

Requires Docker and a [Gemini API key](https://aistudio.google.com/app/apikey).

```bash
cp .env.example .env
# set GOOGLE_API_KEY, JWT_SECRET, POSTGRES_PASSWORD,
# and put the same password into DATABASE_URL
docker compose up --build
```

The app is served at `http://localhost:8000`; health check at `/health`. Migrations run automatically on container start (`entrypoint.sh` runs `alembic upgrade head`, then uvicorn). Interactive API docs are at `/docs` (FastAPI default).

Environment variables (see `.env.example`):

| Variable | Required | Default |
|---|---|---|
| `GOOGLE_API_KEY` | yes | - |
| `JWT_SECRET` | yes | - |
| `POSTGRES_PASSWORD` | yes | - |
| `DATABASE_URL` | yes | `postgresql+asyncpg://vocab:<password>@postgres:5432/vocab` |
| `POSTGRES_DB`, `POSTGRES_USER` | no | `vocab` |
| `TIMEZONE` | no | `Europe/Dublin` |
| `NEW_CARDS_DAILY_CAP` | no | `20` |
| `PORT` | no | `8000` |
| `ALLOW_REGISTRATION` | no | `false` (`/api/auth/register` returns 403; the frontend hides the switch unless `config.js` sets `window.__ALLOW_REGISTRATION__ = true`) |
| `DAILY_LLM_LIMIT` | no | `200` Gemini calls per day for the whole service |
| `ENABLE_DOCS` | no | `false` (Swagger at `/docs`) |
| `CORS_ORIGINS` | no | `*`; credentials are never allowed |

Rate limits per client IP (`CF-Connecting-IP` behind Cloudflare): login 10/min, register 5/min, card creation and regeneration 20/min each.

Tests: `pip install -r backend/requirements-dev.txt && cd backend && pytest`.

Backend only, without rebuilding the image (needs a reachable Postgres whose host in `DATABASE_URL` is not the compose service name; settings are read from `.env` in the working directory or from the environment):

```bash
cd backend
pip install -r requirements.txt
alembic upgrade head
FRONTEND_DIR=../frontend uvicorn app.main:app --reload --port 8000
```

## API

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | Create account / get a JWT |
| GET | `/api/auth/me` | Current user |
| GET | `/health` | Health check |
| GET | `/api/cards/stats` | Category counts and due count |
| GET | `/api/cards/due` | Cards due for study |
| GET | `/api/cards?category=` | List cards, optional filter |
| POST | `/api/cards` | Add a word, Gemini generates the card |
| GET / PATCH / DELETE | `/api/cards/{id}` | Read, edit, delete |
| POST | `/api/cards/{id}/regenerate` | Regenerate the card or one field |
| POST | `/api/cards/{id}/review` | Submit `again` / `good` / `easy` |

## Project layout

```
backend/
  app/
    main.py            # FastAPI app, CORS, static frontend mount
    config.py          # Settings from env (pydantic-settings)
    database.py        # Async engine and session
    models.py          # User, Card
    schemas.py         # Request/response models
    routes/            # auth, cards, review
    services/          # auth_service, card_service, srs_service (SM-2)
    llm/gemini.py      # Gemini client, prompts, response schemas
  migrations/          # Alembic
frontend/              # Vanilla JS PWA (index.html, app.js, style.css)
Dockerfile             # App image (backend + frontend)
docker-compose.yml     # app + postgres
```

## Deploy

Deployed to Coolify as a Docker Compose resource (`docker-compose.yml`). Add the variables from `.env.example` in the Coolify environment settings; `DATABASE_URL` must use the compose service name `postgres`, not `localhost`. Use `/health` as the health check path. Migrations run on every container start.

import asyncio
import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.config import settings

logger = logging.getLogger(__name__)

# Single client instance shared across requests
_client: Optional[genai.Client] = None

MODEL = "gemini-2.5-flash"
TIMEOUT_SECONDS = 45.0


# In-process daily budget for Gemini calls. Single uvicorn worker, so a module
# counter is enough; it resets on restart, which only ever loosens the cap once.
_usage_day: Optional[str] = None
_usage_count = 0


def _consume_daily_budget() -> None:
    global _usage_day, _usage_count
    today = datetime.now(ZoneInfo(settings.timezone)).date().isoformat()
    if today != _usage_day:
        _usage_day, _usage_count = today, 0
    if _usage_count >= settings.daily_llm_limit:
        logger.warning("Daily LLM limit of %d calls reached", settings.daily_llm_limit)
        raise HTTPException(status_code=429, detail="Daily AI limit reached. Try again tomorrow.")
    _usage_count += 1


def get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.google_api_key)
    return _client


# ------------------------------------------------------------------
# Pydantic schemas used as response_schema for structured output
# ------------------------------------------------------------------

class CardContent(BaseModel):
    example_1: str
    example_2: str
    explanation: str
    translation: str


class SingleField(BaseModel):
    value: str


# ------------------------------------------------------------------
# Prompt builders
# ------------------------------------------------------------------

_FIELD_INSTRUCTIONS: dict[str, str] = {
    "example_1": (
        "Write one short, everyday English sentence that uses the word naturally. "
        "The sentence must make the word's meaning obvious from context alone — "
        "no need to know the word to understand the sentence."
    ),
    "example_2": (
        "Write a second everyday English sentence using the word in a different situation. "
        "Context should make the meaning clear without knowing the word."
    ),
    "explanation": (
        "Explain the meaning of the word in the simplest possible English. "
        "Use only very common, short words (A2 level). Keep it to 1–2 sentences."
    ),
    "translation": "Provide the Russian translation of the word. Just the translation, no extra text.",
}


def _full_card_prompt(word: str) -> str:
    return f"""Generate vocabulary study content for the English word: "{word}"

Rules:
- example_1: a simple, everyday sentence that makes the word's meaning obvious from context
- example_2: another simple sentence, different situation, same clarity requirement
- explanation: 1–2 sentences using only basic, short English words (A2 level) — no advanced vocabulary
- translation: Russian translation of "{word}"

Return valid JSON matching the schema exactly.
"""


def _single_field_prompt(word: str, field: str) -> str:
    return (
        f'For the English word "{word}":\n'
        f'{_FIELD_INSTRUCTIONS[field]}\n'
        f'Return JSON with a single key "value" containing your answer.'
    )


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

async def generate_card(word: str) -> CardContent:
    """Call Gemini to generate a full study card for the given word."""
    _consume_daily_budget()
    client = get_client()
    prompt = _full_card_prompt(word)

    try:
        response = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=CardContent,
                    temperature=0.7,
                ),
            ),
            timeout=TIMEOUT_SECONDS,
        )
        return CardContent.model_validate_json(response.text)

    except asyncio.TimeoutError:
        logger.error("Gemini API timed out generating full card for '%s'", word)
        raise HTTPException(status_code=504, detail="AI service timed out. Please try again.")

    except ValidationError as exc:
        logger.error("Gemini returned invalid JSON for '%s': %s", word, exc)
        raise HTTPException(status_code=502, detail="AI service returned an unexpected response.")

    except Exception as exc:
        if "429" in str(exc) or "quota" in str(exc).lower() or "RESOURCE_EXHAUSTED" in str(exc):
            raise HTTPException(status_code=429, detail="Google AI free quota exceeded. Try again tomorrow.")
        logger.error("Gemini API error generating card for '%s': %s", word, exc)
        raise HTTPException(status_code=502, detail="AI service error. Please try again.")


async def regenerate_field(word: str, field: str) -> str:
    """Call Gemini to regenerate a single card field, returning just the new value."""
    _consume_daily_budget()
    client = get_client()
    prompt = _single_field_prompt(word, field)

    try:
        response = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=SingleField,
                    temperature=0.9,  # slightly higher for variety on regeneration
                ),
            ),
            timeout=TIMEOUT_SECONDS,
        )
        return SingleField.model_validate_json(response.text).value

    except asyncio.TimeoutError:
        logger.error("Gemini API timed out regenerating '%s' for '%s'", field, word)
        raise HTTPException(status_code=504, detail="AI service timed out. Please try again.")

    except ValidationError as exc:
        logger.error("Gemini returned invalid JSON for field '%s', word '%s': %s", field, word, exc)
        raise HTTPException(status_code=502, detail="AI service returned an unexpected response.")

    except Exception as exc:
        if "429" in str(exc) or "quota" in str(exc).lower() or "RESOURCE_EXHAUSTED" in str(exc):
            raise HTTPException(status_code=429, detail="Google AI free quota exceeded. Try again tomorrow.")
        logger.error("Gemini API error regenerating '%s' for '%s': %s", field, word, exc)
        raise HTTPException(status_code=502, detail="AI service error. Please try again.")

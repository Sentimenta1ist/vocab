import logging
from typing import Optional

import openai
from fastapi import HTTPException
from pydantic import BaseModel, ValidationError

from app.config import settings

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 45.0

_client: Optional[openai.AsyncOpenAI] = None


def get_client() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        _client = openai.AsyncOpenAI(
            api_key=settings.groq_api_key,
            base_url=settings.llm_base_url,
            max_retries=2,
            timeout=TIMEOUT_SECONDS,
        )
    return _client


# ------------------------------------------------------------------
# Pydantic schemas for response validation
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

Return a JSON object with exactly these keys: example_1, example_2, explanation, translation.
"""


def _single_field_prompt(word: str, field: str) -> str:
    return (
        f'For the English word "{word}":\n'
        f'{_FIELD_INSTRUCTIONS[field]}\n'
        f'Return a JSON object with a single key "value" containing your answer.'
    )


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _log_rate_limit_headers(headers) -> None:
    remaining_req = headers.get("x-ratelimit-remaining-requests")
    remaining_tok = headers.get("x-ratelimit-remaining-tokens")
    if remaining_req is not None or remaining_tok is not None:
        logger.debug(
            "Groq rate-limit remaining — requests: %s, tokens: %s",
            remaining_req,
            remaining_tok,
        )


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

async def generate_card(word: str) -> CardContent:
    """Generate a full study card for the given word via the configured LLM."""
    client = get_client()
    prompt = _full_card_prompt(word)

    try:
        raw = await client.chat.completions.with_raw_response.create(
            model=settings.llm_model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.7,
        )
        _log_rate_limit_headers(raw.headers)
        text = raw.parse().choices[0].message.content or ""
        return CardContent.model_validate_json(text)

    except openai.APITimeoutError:
        logger.error("LLM API timed out generating full card for '%s'", word)
        raise HTTPException(status_code=504, detail="AI service timed out. Please try again.")

    except openai.RateLimitError as exc:
        retry_after = exc.response.headers.get("retry-after") if exc.response else None
        logger.warning("LLM rate limit hit for '%s'; retry-after=%s", word, retry_after)
        raise HTTPException(status_code=429, detail="AI rate limit reached. Please try again shortly.")

    except ValidationError as exc:
        logger.error("LLM returned invalid JSON for '%s': %s", word, exc)
        raise HTTPException(status_code=502, detail="AI service returned an unexpected response.")

    except openai.APIError as exc:
        logger.error("LLM API error generating card for '%s': %s", word, exc)
        raise HTTPException(status_code=502, detail="AI service error. Please try again.")


async def regenerate_field(word: str, field: str) -> str:
    """Regenerate a single card field, returning just the new value."""
    client = get_client()
    prompt = _single_field_prompt(word, field)

    try:
        raw = await client.chat.completions.with_raw_response.create(
            model=settings.llm_model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.9,
        )
        _log_rate_limit_headers(raw.headers)
        text = raw.parse().choices[0].message.content or ""
        return SingleField.model_validate_json(text).value

    except openai.APITimeoutError:
        logger.error("LLM API timed out regenerating '%s' for '%s'", field, word)
        raise HTTPException(status_code=504, detail="AI service timed out. Please try again.")

    except openai.RateLimitError as exc:
        retry_after = exc.response.headers.get("retry-after") if exc.response else None
        logger.warning(
            "LLM rate limit hit regenerating '%s' for '%s'; retry-after=%s",
            field,
            word,
            retry_after,
        )
        raise HTTPException(status_code=429, detail="AI rate limit reached. Please try again shortly.")

    except ValidationError as exc:
        logger.error("LLM returned invalid JSON for field '%s', word '%s': %s", field, word, exc)
        raise HTTPException(status_code=502, detail="AI service returned an unexpected response.")

    except openai.APIError as exc:
        logger.error("LLM API error regenerating '%s' for '%s': %s", field, word, exc)
        raise HTTPException(status_code=502, detail="AI service error. Please try again.")

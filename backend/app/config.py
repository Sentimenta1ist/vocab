from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Required
    database_url: str

    @field_validator("database_url", mode="before")
    @classmethod
    def normalise_db_url(cls, v: str) -> str:
        # Coolify (and Heroku) emit "postgres://" or "postgres+asyncpg://"
        # SQLAlchemy requires the full "postgresql+asyncpg://" prefix.
        replacements = [
            ("postgres+asyncpg://", "postgresql+asyncpg://"),
            ("postgres://",         "postgresql+asyncpg://"),
            ("postgresql://",       "postgresql+asyncpg://"),
        ]
        for old, new in replacements:
            if v.startswith(old):
                return new + v[len(old):]
        return v
    groq_api_key: str
    jwt_secret: str

    # LLM provider (OpenAI-compatible)
    llm_base_url: str = "https://api.groq.com/openai/v1"
    llm_model: str = "llama-3.1-8b-instant"

    # Optional with defaults
    timezone: str = "Europe/Dublin"
    new_cards_daily_cap: int = 20
    port: int = 8000
    frontend_dir: str = "/app/frontend"
    jwt_expire_days: int = 30
    # Comma-separated allowed origins for CORS, e.g. "https://vocab.example.com,https://app.example.com"
    # Use "*" to allow any origin (fine for a personal app behind JWT auth)
    cors_origins: str = "*"


settings = Settings()

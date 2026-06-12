from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Required
    database_url: str
    google_api_key: str
    jwt_secret: str

    # Optional with defaults
    timezone: str = "Europe/Dublin"
    new_cards_daily_cap: int = 20
    port: int = 8000
    frontend_dir: str = "/app/frontend"
    jwt_expire_days: int = 30


settings = Settings()

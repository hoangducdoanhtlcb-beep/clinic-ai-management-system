from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Clinic AI"
    app_env: str = "development"
    database_url: str = (
        "postgresql+psycopg://postgres:postgres@localhost:5432/clinic_ai"
    )
    auth_secret: str = "clinic-ai-local-dev-secret-change-me"
    access_token_minutes: int = 480

    # KT3 AI settings. API key stays server-side in .env and is never exposed to frontend.
    ai_provider: str = "gemini"
    ai_model: str = "gemini-3.5-flash"
    ai_api_key: str = ""
    ai_base_url: str = "https://api.openai.com/v1"
    ai_timeout_seconds: float = 60.0
    ai_temperature: float = 0.2
    ai_max_output_tokens: int = 2048

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

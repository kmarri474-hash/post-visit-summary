from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field(default="dev", alias="APP_ENV")

    # UHG UAIS (OAuth2 client-credentials -> bearer token used as azure_ad_token)
    uais_token_url: str | None = Field(default=None, alias="UAIS_TOKEN_URL")
    hcp_client_id: str | None = Field(default=None, alias="HCP_CLIENT_ID")
    # NB: env var name keeps the original (typo'd) spelling used by the UHG platform.
    hcp_client_secret: str | None = Field(default=None, alias="HCP_CLIENT_SECRETE")
    hcp_scope: str | None = Field(default=None, alias="HCP_SCOPE")

    # Azure OpenAI (via UAIS)
    uais_completions_endpoint: str | None = Field(default=None, alias="UAIS_COMPLETIONS_ENDPOINT")
    uais_api_version: str = Field(default="2024-08-01-preview", alias="UAIS_API_VERSION")
    uais_deployment: str = Field(default="gpt-4o", alias="UAIS_DEPLOYMENT")
    uais_whisper_deployment: str = Field(default="whisper", alias="UAIS_WHISPER_DEPLOYMENT")
    uais_project_id: str | None = Field(default=None, alias="UAIS_PROJECT_ID")

    # DB — prefer PG_* (matches hs-summarization-agents-fastapi pattern),
    # fall back to DATABASE_URL, then SQLite for dev.
    database_url: str | None = Field(default=None, alias="DATABASE_URL")
    pg_host: str | None = Field(default=None, alias="PG_HOST")
    pg_port: str | None = Field(default=None, alias="PG_PORT")
    pg_database: str | None = Field(default=None, alias="PG_DATABASE")
    pg_user: str | None = Field(default=None, alias="PG_USER")
    pg_password: str | None = Field(default=None, alias="PG_PASSWORD")

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        if self.pg_host and self.pg_database and self.pg_user:
            pwd = self.pg_password or ""
            port = self.pg_port or "5432"
            return (
                f"postgresql+asyncpg://{self.pg_user}:{pwd}"
                f"@{self.pg_host}:{port}/{self.pg_database}"
            )
        return "sqlite+aiosqlite:///./pvs.db"

    # Azure Cognitive Services Speech (for transcription + live streaming)
    azure_speech_client_id: str | None = Field(default=None, alias="AZURE_SPEECH_CLIENT_ID")
    azure_speech_client_secret: str | None = Field(default=None, alias="AZURE_SPEECH_CLIENT_SECRET")
    azure_speech_tenant_id: str | None = Field(default=None, alias="AZURE_SPEECH_TENANT_ID")
    azure_speech_resource_id: str | None = Field(default=None, alias="AZURE_SPEECH_RESOURCE_ID")
    azure_speech_region: str | None = Field(default=None, alias="AZURE_SPEECH_REGION")
    azure_speech_endpoint: str | None = Field(default=None, alias="AZURE_SPEECH_ENDPOINT")

    # CORS
    api_cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        alias="API_CORS_ORIGINS",
    )

    # Agents
    confidence_floor: float = Field(default=0.7, alias="AGENT_CONFIDENCE_FLOOR")
    model_temperature: float = Field(default=0.2, alias="AGENT_MODEL_TEMPERATURE")

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]

    @property
    def speech_configured(self) -> bool:
        return bool(
            self.azure_speech_client_id
            and self.azure_speech_client_secret
            and self.azure_speech_tenant_id
            and self.azure_speech_resource_id
            and self.azure_speech_region
        )

    @property
    def azure_configured(self) -> bool:
        return bool(
            self.uais_token_url
            and self.hcp_client_id
            and self.hcp_client_secret
            and self.uais_completions_endpoint
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()

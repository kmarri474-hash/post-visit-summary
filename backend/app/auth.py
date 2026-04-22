"""UHG UAIS auth + Azure OpenAI client factory.

Mirrors the reference pattern in `references/auth_utils.py` + `references/azure_ai_utils.py`:

  1. `AuthTokenManager` performs an OAuth2 client-credentials exchange against
     `UAIS_TOKEN_URL` using `HCP_CLIENT_ID` / `HCP_CLIENT_SECRETE` / `HCP_SCOPE`
     and caches the bearer token until shortly before expiry.
  2. `AzureAIManager` builds `AzureChatOpenAI` / `AzureOpenAI` clients wired
     with that bearer token as `azure_ad_token` and the `projectId` header.

We provide both async (for httpx inside FastAPI) and sync (for the
`azure_ad_token_provider` callable that the OpenAI SDK invokes at request
time) entry points. Tokens are cached in-process.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Optional

import httpx

from .config import get_settings

log = logging.getLogger(__name__)

# 5-minute safety buffer subtracted from server-reported expiry.
_EXPIRY_BUFFER_SECONDS = 300


class AuthTokenManager:
    """Thread-safe OAuth2 client-credentials token manager with caching."""

    def __init__(self) -> None:
        self._token: Optional[str] = None
        self._expiry: float = 0.0
        self._lock = threading.Lock()
        self._alock = asyncio.Lock()

    # ---- async path (used by FastAPI endpoints if needed) ------------------
    async def get_token_async(self) -> str:
        if self._is_valid():
            return self._token  # type: ignore[return-value]
        async with self._alock:
            if self._is_valid():
                return self._token  # type: ignore[return-value]
            data = await self._request_token_async()
            self._store(data)
            return self._token  # type: ignore[return-value]

    # ---- sync path (used as azure_ad_token_provider callable) --------------
    def get_token_sync(self) -> str:
        if self._is_valid():
            return self._token  # type: ignore[return-value]
        with self._lock:
            if self._is_valid():
                return self._token  # type: ignore[return-value]
            data = self._request_token_sync()
            self._store(data)
            return self._token  # type: ignore[return-value]

    # ---- internals ---------------------------------------------------------
    def _is_valid(self) -> bool:
        return bool(self._token) and time.time() < self._expiry

    def _store(self, data: dict) -> None:
        if not data or "access_token" not in data:
            raise RuntimeError("UAIS token response missing access_token")
        self._token = data["access_token"]
        expires_in = int(data.get("expires_in", 3600))
        self._expiry = time.time() + max(60, expires_in - _EXPIRY_BUFFER_SECONDS)
        log.info(
            "UAIS token refreshed (token_type=%s, expires_in=%ss)",
            data.get("token_type", "Bearer"),
            expires_in,
        )

    def _payload(self) -> dict:
        s = get_settings()
        if not s.uais_token_url:
            raise RuntimeError("UAIS_TOKEN_URL is not set")
        return {
            "url": s.uais_token_url,
            "headers": {"Content-Type": "application/x-www-form-urlencoded"},
            "data": {
                "scope": s.hcp_scope or "",
                "grant_type": "client_credentials",
                "client_id": s.hcp_client_id or "",
                "client_secret": s.hcp_client_secret or "",
            },
        }

    async def _request_token_async(self) -> dict:
        p = self._payload()
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(p["url"], headers=p["headers"], data=p["data"])
        if resp.status_code != 200:
            log.error("UAIS token request failed: %s %s", resp.status_code, resp.text)
            raise RuntimeError(f"UAIS token request failed: {resp.status_code}")
        return resp.json()

    def _request_token_sync(self) -> dict:
        p = self._payload()
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(p["url"], headers=p["headers"], data=p["data"])
        if resp.status_code != 200:
            log.error("UAIS token request failed: %s %s", resp.status_code, resp.text)
            raise RuntimeError(f"UAIS token request failed: {resp.status_code}")
        return resp.json()


# Module-level singleton (constructed before dotenv loads; reads env lazily).
token_manager = AuthTokenManager()


async def get_auth_token_async() -> str:
    return await token_manager.get_token_async()


def get_auth_token_sync() -> str:
    return token_manager.get_token_sync()


# ===== Azure OpenAI client factory ==========================================

def _default_headers() -> dict:
    s = get_settings()
    headers: dict[str, str] = {}
    if s.uais_project_id:
        headers["projectId"] = s.uais_project_id
    return headers


def build_chat_model(*, temperature: float, streaming: bool = True):
    """Return a configured LangChain `AzureChatOpenAI` bound to UAIS."""
    from langchain_openai import AzureChatOpenAI

    s = get_settings()
    if not s.azure_configured:
        raise RuntimeError("UAIS/Azure OpenAI is not configured (missing UAIS_* / HCP_* env vars)")

    return AzureChatOpenAI(
        azure_endpoint=s.uais_completions_endpoint,
        api_version=s.uais_api_version,
        azure_deployment=s.uais_deployment,
        # The SDK calls this callable on each request and sends the result
        # as `Authorization: Bearer <token>`. Our manager caches internally.
        azure_ad_token_provider=get_auth_token_sync,
        default_headers=_default_headers(),
        temperature=temperature,
        streaming=streaming,
        timeout=60,
    )


def build_async_openai_client():
    """Return a raw `openai.AsyncAzureOpenAI` client bound to UAIS (for Whisper)."""
    from openai import AsyncAzureOpenAI

    s = get_settings()
    if not s.azure_configured:
        raise RuntimeError("UAIS/Azure OpenAI is not configured")

    return AsyncAzureOpenAI(
        azure_endpoint=s.uais_completions_endpoint,
        api_version=s.uais_api_version,
        azure_ad_token_provider=get_auth_token_sync,
        default_headers=_default_headers(),
    )

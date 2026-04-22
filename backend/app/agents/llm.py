from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Type, TypeVar

from pydantic import BaseModel

from ..config import get_settings

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


def prompt_hash(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode("utf-8"))
    return h.hexdigest()[:16]


def _build_azure_chat():
    """Lazy import so unit tests can run without LangChain installed."""
    from ..auth import build_chat_model

    s = get_settings()
    return build_chat_model(temperature=s.model_temperature, streaming=True)


class LLMClient:
    """Thin wrapper over AzureChatOpenAI with structured-output support and an offline fallback."""

    def __init__(self) -> None:
        self._chat = None
        self._settings = get_settings()

    @property
    def model_name(self) -> str:
        return self._settings.uais_deployment

    def _chat_client(self):
        if self._chat is None:
            self._chat = _build_azure_chat()
        return self._chat

    async def structured(
        self,
        schema: Type[T],
        system: str,
        user: str,
        *,
        fallback: T | None = None,
    ) -> T:
        """Call Azure OpenAI and parse into `schema`. On failure, return `fallback` if provided."""
        if not self._settings.azure_configured:
            if fallback is not None:
                log.warning("Azure not configured; using offline fallback for %s", schema.__name__)
                return fallback
            raise RuntimeError("Azure OpenAI not configured and no fallback provided")

        from langchain_core.messages import HumanMessage, SystemMessage

        try:
            chat = self._chat_client().with_structured_output(schema, method="function_calling")
            msg = await chat.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
            if isinstance(msg, schema):
                return msg
            return schema.model_validate(msg)
        except Exception as e:  # pragma: no cover
            log.exception("Structured LLM call failed: %s", e)
            if fallback is not None:
                return fallback
            raise

    async def stream_text(self, system: str, user: str):
        """Async generator yielding text chunks; used for UI token preview."""
        if not self._settings.azure_configured:
            yield "[offline mode]"
            return
        from langchain_core.messages import HumanMessage, SystemMessage

        chat = self._chat_client()
        async for chunk in chat.astream([SystemMessage(content=system), HumanMessage(content=user)]):
            text = getattr(chunk, "content", "") or ""
            if text:
                yield text


def dumps_for_hash(obj: Any) -> str:
    try:
        return json.dumps(obj, sort_keys=True, default=str)
    except Exception:
        return str(obj)

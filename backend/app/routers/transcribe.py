from __future__ import annotations

import io
import logging
import tempfile

from fastapi import APIRouter, HTTPException, UploadFile, File

from ..auth import build_async_openai_client
from ..config import get_settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["transcribe"])


@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict:
    s = get_settings()
    if not s.azure_configured:
        raise HTTPException(400, "UAIS / Azure OpenAI not configured; paste the transcript instead.")

    try:
        client = build_async_openai_client()
    except Exception as e:  # pragma: no cover
        raise HTTPException(500, f"openai SDK not available: {e}")

    content = await file.read()
    try:
        # The Azure python SDK expects a file-like; use a temp path for reliability.
        with tempfile.NamedTemporaryFile(suffix="." + (file.filename or "audio").split(".")[-1], delete=False) as tmp:
            tmp.write(content)
            tmp.flush()
            tmp.seek(0)
            with open(tmp.name, "rb") as f:
                resp = await client.audio.transcriptions.create(
                    model=s.uais_whisper_deployment,
                    file=f,
                )
        text = getattr(resp, "text", None) or (resp if isinstance(resp, str) else "")
        return {"text": text}
    except Exception as e:
        log.exception("transcription failed")
        raise HTTPException(500, f"transcription failed: {e}")

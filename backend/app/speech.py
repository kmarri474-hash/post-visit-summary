"""
Azure Cognitive Services Speech helper.

Supports two auth modes:
  1. Subscription key  (AZURE_SPEECH_KEY) — simpler, preferred
  2. AAD client-credentials (AZURE_SPEECH_CLIENT_ID/SECRET/TENANT_ID)

For FILE UPLOADS  → REST-based chunked transcription (fast, parallel).
For LIVE BROWSER  → short-lived token returned to the JS SDK.
"""
from __future__ import annotations

import asyncio
import io
import logging
import wave
from typing import Optional

import httpx

from .config import get_settings

log = logging.getLogger(__name__)


# ── Credential helpers ────────────────────────────────────────────────────────

def _require_speech_settings():
    s = get_settings()
    if not s.speech_configured:
        raise RuntimeError(
            "Azure Speech not configured. Set AZURE_SPEECH_KEY + AZURE_SPEECH_REGION, "
            "or set AZURE_SPEECH_CLIENT_ID, AZURE_SPEECH_CLIENT_SECRET, "
            "AZURE_SPEECH_TENANT_ID, AZURE_SPEECH_RESOURCE_ID and AZURE_SPEECH_REGION."
        )
    return s


def _get_raw_access_token() -> tuple[str, object]:
    """Return (raw_bearer_token, settings) via AAD client-credentials."""
    try:
        from azure.identity import ClientSecretCredential
    except ImportError:
        raise RuntimeError(
            "azure-identity is not installed. "
            "Run: pip install 'post-visit-summary[azure-speech]'"
        )
    s = _require_speech_settings()
    credential = ClientSecretCredential(
        tenant_id=s.azure_speech_tenant_id,
        client_id=s.azure_speech_client_id,
        client_secret=s.azure_speech_client_secret,
    )
    token = credential.get_token("https://cognitiveservices.azure.com/.default")
    return token.token, s


def get_speech_token_for_browser() -> dict:
    """Short-lived token payload for the browser Speech JS SDK."""
    s = _require_speech_settings()

    if s.azure_speech_key:
        return {
            "token": s.azure_speech_key,
            "region": s.azure_speech_region,
            "endpoint": s.azure_speech_endpoint,
            "authType": "key",
        }

    raw_token, _ = _get_raw_access_token()
    return {
        "token": f"aad#{s.azure_speech_resource_id}#{raw_token}",
        "region": s.azure_speech_region,
        "endpoint": s.azure_speech_endpoint,
        "authType": "aad",
    }


# ── REST API transcription (parallel chunks) ─────────────────────────────────

CHUNK_SECONDS = 55.0  # Azure STT REST limit is 60 s; use 55 s for safety


def _chunk_wav_bytes(wav_path: str, chunk_seconds: float = CHUNK_SECONDS) -> list[bytes]:
    """Split a WAV file into ≤chunk_seconds complete WAV byte-blobs."""
    with wave.open(wav_path, "rb") as wf:
        framerate = wf.getframerate()
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        frames_per_chunk = int(chunk_seconds * framerate)
        chunks: list[bytes] = []
        while True:
            frames = wf.readframes(frames_per_chunk)
            if not frames:
                break
            buf = io.BytesIO()
            with wave.open(buf, "wb") as out:
                out.setnchannels(n_channels)
                out.setsampwidth(sampwidth)
                out.setframerate(framerate)
                out.writeframes(frames)
            chunks.append(buf.getvalue())
    return chunks


def _stt_url(region: str | None, endpoint: str | None) -> str:
    if endpoint:
        base = endpoint.rstrip("/")
        if "/speech/recognition" in base:
            return base
        return f"{base}/speech/recognition/conversation/cognitiveservices/v1"
    return (
        f"https://{region}.stt.speech.microsoft.com"
        "/speech/recognition/conversation/cognitiveservices/v1"
    )


async def _transcribe_chunk(
    chunk_data: bytes,
    url: str,
    speech_key: str | None,
    raw_aad_token: str | None,
    subscription_id: str | None,
    client: httpx.AsyncClient,
    index: int,
) -> str:
    if speech_key:
        headers = {
            "Ocp-Apim-Subscription-Key": speech_key,
            "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
            "Accept": "application/json",
        }
    else:
        headers = {
            "Authorization": f"Bearer {raw_aad_token}",
            "Ocp-Apim-Subscription-Id": subscription_id or "",
            "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
            "Accept": "application/json",
        }
    params = {"language": "en-US", "format": "simple"}
    resp = await client.post(url, params=params, headers=headers, content=chunk_data)
    resp.raise_for_status()
    result = resp.json()
    text = result.get("DisplayText", "") if result.get("RecognitionStatus") == "Success" else ""
    log.debug("Chunk %d → %d chars", index, len(text))
    return text


async def transcribe_audio_rest(wav_path: str) -> str:
    """Transcribe a WAV file: split into 55-second chunks, POST all in parallel."""
    s = _require_speech_settings()

    speech_key = s.azure_speech_key
    raw_token: str | None = None
    subscription_id: str | None = None

    if not speech_key:
        raw_token, _ = _get_raw_access_token()
        if s.azure_speech_resource_id:
            parts = s.azure_speech_resource_id.strip("/").split("/")
            try:
                idx = [p.lower() for p in parts].index("subscriptions")
                subscription_id = parts[idx + 1]
            except (ValueError, IndexError):
                pass

    url = _stt_url(s.azure_speech_region, s.azure_speech_endpoint)
    chunks = _chunk_wav_bytes(wav_path)
    log.info("Transcribing %d chunk(s) in parallel via REST → %s", len(chunks), url)

    async with httpx.AsyncClient(timeout=30.0) as client:
        results = await asyncio.gather(
            *[
                _transcribe_chunk(chunk, url, speech_key, raw_token, subscription_id, client, i)
                for i, chunk in enumerate(chunks)
            ],
            return_exceptions=True,
        )

    texts: list[str] = []
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            log.warning("Chunk %d failed: %s", i, r)
        elif r:
            texts.append(r)

    if not texts:
        raise RuntimeError("Speech REST API returned no recognized text.")

    return " ".join(texts)


# ── SDK-based transcription (fallback) ────────────────────────────────────────

def _transcribe_sync(audio_file_path: str) -> str:
    """Synchronous SDK continuous recognition."""
    import threading
    import time

    try:
        import azure.cognitiveservices.speech as speechsdk
    except ImportError:
        raise RuntimeError(
            "azure-cognitiveservices-speech is not installed. "
            "Run: pip install 'post-visit-summary[azure-speech]'"
        )

    s = _require_speech_settings()

    if s.azure_speech_key:
        if s.azure_speech_endpoint:
            speech_config = speechsdk.SpeechConfig(
                subscription=s.azure_speech_key, endpoint=s.azure_speech_endpoint
            )
        else:
            speech_config = speechsdk.SpeechConfig(
                subscription=s.azure_speech_key, region=s.azure_speech_region
            )
    else:
        auth_token = f"aad#{s.azure_speech_resource_id}#{_get_raw_access_token()[0]}"
        if s.azure_speech_endpoint:
            speech_config = speechsdk.SpeechConfig(endpoint=s.azure_speech_endpoint)
            speech_config.authorization_token = auth_token
        else:
            speech_config = speechsdk.SpeechConfig(
                auth_token=auth_token, region=s.azure_speech_region
            )

    speech_config.speech_recognition_language = "en-US"
    speech_config.set_property_by_name("OPENSSL_DISABLE_CRL_CHECK", "true")

    duration_seconds: Optional[float] = None
    try:
        with wave.open(audio_file_path, "rb") as wf:
            duration_seconds = wf.getnframes() / wf.getframerate()
    except Exception:
        pass

    audio_config = speechsdk.audio.AudioConfig(filename=audio_file_path)
    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config, audio_config=audio_config
    )

    segments: list[str] = []
    done = False
    err_info: dict = {}

    def on_recognized(evt):
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            t = evt.result.text.strip()
            if t:
                segments.append(t)

    def on_canceled(evt):
        nonlocal done
        err_info["reason"] = str(evt.reason)
        if hasattr(evt, "error_details") and evt.error_details:
            err_info["details"] = evt.error_details
        err_info["canceled"] = True
        done = True

    def on_stopped(_evt):
        nonlocal done
        done = True

    recognizer.recognized.connect(on_recognized)
    recognizer.canceled.connect(on_canceled)
    recognizer.session_stopped.connect(on_stopped)
    recognizer.start_continuous_recognition()

    timeout = max(60.0, (duration_seconds or 60.0) * 3)
    log.info("SDK recognition started (audio ~%.0fs, timeout %.0fs)", duration_seconds or 0, timeout)
    start = time.time()
    while not done and (time.time() - start) < timeout:
        threading.Event().wait(0.5)

    recognizer.stop_continuous_recognition()
    log.info("SDK recognition done in %.1fs, %d segment(s)", time.time() - start, len(segments))

    if err_info.get("canceled"):
        msg = f"Speech recognition canceled: {err_info.get('reason')}"
        if err_info.get("details"):
            msg += f" — {err_info['details']}"
        raise RuntimeError(msg)

    if not segments:
        raise RuntimeError("No speech recognized from the audio.")
    return " ".join(segments)


async def transcribe_audio_with_azure_speech(audio_file_path: str) -> str:
    """Async wrapper — runs SDK transcription in a thread-pool executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _transcribe_sync, audio_file_path)

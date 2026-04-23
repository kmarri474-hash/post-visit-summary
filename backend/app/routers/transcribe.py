from __future__ import annotations

import asyncio
import json
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect

from ..config import get_settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["transcribe"])


def _convert_to_wav(src_path: str, dst_path: str) -> None:
    """Convert any audio file to mono PCM WAV 16 kHz / 16-bit using PyAV.

    PyAV ships its own bundled FFmpeg codecs inside the wheel — no system
    ffmpeg installation required, making this safe for containerised deploys.
    """
    try:
        import av  # type: ignore
    except ImportError:
        raise RuntimeError(
            "PyAV is not installed. Run: pip install av"
        )

    with av.open(src_path) as in_container:
        in_stream = next(
            (s for s in in_container.streams if s.type == "audio"), None
        )
        if in_stream is None:
            raise RuntimeError("No audio stream found in uploaded file.")

        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        with av.open(dst_path, mode="w", format="wav") as out_container:
            out_stream = out_container.add_stream("pcm_s16le", rate=16000, layout="mono")
            for frame in in_container.decode(in_stream):
                for rf in resampler.resample(frame):
                    rf.pts = None
                    out_container.mux(out_stream.encode(rf))
            out_container.mux(out_stream.encode(None))  # flush


@router.get("/speech/token")
async def speech_token() -> dict:
    """Return a short-lived Azure Speech token for the browser SDK (live transcription)."""
    s = get_settings()
    if not s.speech_configured:
        raise HTTPException(
            503,
            "Azure Speech is not configured on this server. "
            "Set AZURE_SPEECH_* environment variables to enable live transcription.",
        )
    try:
        from ..speech import get_speech_token_for_browser
        return get_speech_token_for_browser()
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        log.exception("Failed to obtain Speech token")
        raise HTTPException(500, f"Speech token error: {exc}")


@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict:
    """Transcribe an uploaded audio file. Priority: Azure Speech REST > UAIS Whisper > local Whisper."""
    s = get_settings()
    content = await file.read()
    ext = (file.filename or "audio.wav").rsplit(".", 1)[-1].lower()

    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(content)
        raw_path = tmp.name

    wav_path: str | None = None
    try:
        # ── Path 1: Azure Cognitive Services Speech SDK ───────────────────────
        if s.speech_configured:
            log.info("Using Azure Speech SDK for transcription")
            try:
                from ..speech import transcribe_audio_with_azure_speech

                # Convert to WAV in thread executor (non-blocking, PyAV bundled)
                if ext not in ("wav",):
                    wav_path = raw_path + "_converted.wav"
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(None, _convert_to_wav, raw_path, wav_path)
                    audio_for_sdk = wav_path
                else:
                    audio_for_sdk = raw_path

                text = await transcribe_audio_with_azure_speech(audio_for_sdk)
                return {"text": text, "source": "azure-speech"}
            except HTTPException:
                raise
            except Exception as exc:
                log.warning("Azure Speech SDK failed, trying fallback: %s", exc)

        # ── Path 2: UAIS / Azure OpenAI Whisper ──────────────────────────────
        if s.azure_configured:
            log.info("Using UAIS Whisper for transcription")
            try:
                from ..auth import build_async_openai_client
                client = build_async_openai_client()
                with open(raw_path, "rb") as f:
                    resp = await client.audio.transcriptions.create(
                        model=s.uais_whisper_deployment, file=f,
                    )
                text = getattr(resp, "text", None) or (resp if isinstance(resp, str) else "")
                return {"text": text, "source": "uais-whisper"}
            except Exception as exc:
                log.warning("UAIS Whisper failed: %s", exc)

        # ── Path 3: Local faster-whisper ──────────────────────────────────────
        log.info("Attempting local faster-whisper")
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except ImportError:
            raise HTTPException(
                503,
                "No transcription service is available. Configure AZURE_SPEECH_* env vars "
                "for Azure Speech, or install local Whisper: "
                "pip install 'post-visit-summary[local-whisper]'",
            )

        def _run_local() -> str:
            model = WhisperModel("base", device="cpu", compute_type="int8")
            segs, _ = model.transcribe(raw_path)
            return " ".join(seg.text.strip() for seg in segs)

        loop = asyncio.get_running_loop()
        text = await loop.run_in_executor(None, _run_local)
        return {"text": text, "source": "local-whisper"}

    finally:
        for p in (raw_path, wav_path):
            if p:
                try:
                    Path(p).unlink(missing_ok=True)
                except Exception:
                    pass


# ── WebSocket live-transcription proxy ────────────────────────────────────────

@router.websocket("/speech/stream")
async def speech_stream(ws: WebSocket):
    """Proxy live audio from the browser to Azure Speech SDK via the VNet.

    Protocol:
      Browser → Server:  binary frames of 16-bit PCM mono 16 kHz audio
      Server → Browser:  JSON text frames:
        {"type":"recognizing", "text":"partial..."}
        {"type":"recognized", "text":"Final sentence."}
        {"type":"error", "message":"..."}
    """
    await ws.accept()

    s = get_settings()
    if not s.speech_configured:
        await ws.send_json({"type": "error", "message": "Speech not configured"})
        await ws.close()
        return

    try:
        import azure.cognitiveservices.speech as speechsdk
    except ImportError:
        await ws.send_json({"type": "error", "message": "Speech SDK not installed"})
        await ws.close()
        return

    # Build speech config (same as _transcribe_sync)
    if s.azure_speech_key:
        if s.azure_speech_endpoint:
            speech_config = speechsdk.SpeechConfig(
                subscription=s.azure_speech_key, endpoint=s.azure_speech_endpoint,
            )
        else:
            speech_config = speechsdk.SpeechConfig(
                subscription=s.azure_speech_key, region=s.azure_speech_region,
            )
    else:
        from ..speech import _get_raw_access_token
        raw_token, _ = _get_raw_access_token()
        auth_token = f"aad#{s.azure_speech_resource_id}#{raw_token}"
        if s.azure_speech_endpoint:
            speech_config = speechsdk.SpeechConfig(endpoint=s.azure_speech_endpoint)
            speech_config.authorization_token = auth_token
        else:
            speech_config = speechsdk.SpeechConfig(
                auth_token=auth_token, region=s.azure_speech_region,
            )

    speech_config.speech_recognition_language = "en-US"
    speech_config.set_property_by_name("OPENSSL_DISABLE_CRL_CHECK", "true")

    # Push-based audio stream
    stream_format = speechsdk.audio.AudioStreamFormat(
        samples_per_second=16000, bits_per_sample=16, channels=1,
    )
    push_stream = speechsdk.audio.PushAudioInputStream(stream_format)
    audio_config = speechsdk.audio.AudioConfig(stream=push_stream)
    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config, audio_config=audio_config,
    )

    loop = asyncio.get_running_loop()

    def on_recognizing(evt):
        if evt.result.reason == speechsdk.ResultReason.RecognizingSpeech:
            asyncio.run_coroutine_threadsafe(
                ws.send_json({"type": "recognizing", "text": evt.result.text}), loop,
            )

    def on_recognized(evt):
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            text = evt.result.text.strip()
            if text:
                asyncio.run_coroutine_threadsafe(
                    ws.send_json({"type": "recognized", "text": text}), loop,
                )

    def on_canceled(evt):
        msg = str(evt.reason)
        if hasattr(evt, "error_details") and evt.error_details:
            msg += f": {evt.error_details}"
        asyncio.run_coroutine_threadsafe(
            ws.send_json({"type": "error", "message": msg}), loop,
        )

    recognizer.recognizing.connect(on_recognizing)
    recognizer.recognized.connect(on_recognized)
    recognizer.canceled.connect(on_canceled)
    recognizer.start_continuous_recognition()

    try:
        while True:
            data = await ws.receive_bytes()
            push_stream.write(data)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.warning("Speech WS error: %s", exc)
    finally:
        push_stream.close()
        recognizer.stop_continuous_recognition()
        log.info("Speech WS proxy session ended")

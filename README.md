# Post-Visit Summary & Clinical Coding Agent

Multi-agent system that turns an encounter (audio or text + structured fields) into a clinical note draft, a PCP handoff summary, and coding artifacts (ICD-10, CPT, E/M, HCC) — all persisted as drafts with a full audit trail until a clinician signs off.

> **Running it locally?** See [`LOCAL_SETUP.md`](./LOCAL_SETUP.md) for a copy-pasteable end-to-end walkthrough (Postgres via Podman, backend venv, frontend dev server, snapshot load, smoke test, troubleshooting).

## Stack

- **Backend**: FastAPI, LangGraph, Azure OpenAI via UHG **UAIS** (OAuth2 client-credentials → bearer token used as `azure_ad_token`, with `projectId` header), SQLAlchemy (async), Postgres
- **Frontend**: Vite + React + TypeScript + TailwindCSS + shadcn-style components
- **Streaming**: Server-Sent Events for live agent progress
- **Transcription**: Azure Cognitive Services Speech (AAD auth) with fallback to UAIS Whisper and local faster-whisper

## Quick start (Podman)

```bash
cp .env.example .env
# edit .env and fill in UAIS_* / HCP_* values and AZURE_SPEECH_* values

# First-time Podman setup on macOS (skip if already done):
podman machine init
podman machine start

# Bring the stack up (pick whichever of these is installed):
podman compose up --build            # Podman v4.4+ built-in compose
# or
podman-compose up --build            # the separate `podman-compose` tool
```

- Web UI: http://localhost:5173
- API docs: http://localhost:8000/docs

Common Podman commands:

```bash
podman compose ps                    # show containers
podman compose logs -f api           # tail API logs
podman compose exec api pytest -q    # run the smoke test
podman compose down                  # stop
podman compose down -v               # stop and drop the postgres volume
```

On first boot the API creates all tables via SQLAlchemy metadata and exposes the two sample encounters through `GET /api/encounters/samples`.

> The `docker-compose.yml` is standard Compose v3 syntax and works unchanged with Podman. If you prefer Docker, `docker compose up --build` still works.

## Demo flow

1. Open the web UI, pick a seeded sample (e.g., "CHF follow-up").
2. Click **Run agents** — watch the SSE timeline (structurer → note ∥ pcp ∥ coding ∥ gaps → guardrail).
3. Review drafts across tabs (Note, PCP Summary, Problems, Orders, Referrals, Coding, Gaps).
4. Edit a suggested ICD-10 code; a new version + audit entry is recorded.
5. Try to sign off while a required gap is open — blocked. Resolve or override with comment, then sign off. Final view + full audit trail.

## Transcription

The encounter intake page supports three ways to get a transcript:

| Method | How | Requires |
|---|---|---|
| **Live ambient mic** | Click **Start live transcript** — real-time streaming directly browser → Azure | `AZURE_SPEECH_*` env vars |
| **Upload audio** | Upload any audio file (m4a, mp3, wav, …) — converted server-side with PyAV, transcribed via Azure Speech SDK | `AZURE_SPEECH_*` env vars |
| **Paste text** | Paste directly into the transcript textarea | nothing |

### Transcription priority order (file upload)

1. **Azure Cognitive Services Speech SDK** (AAD credentials, no subscription key needed)
2. **UAIS Whisper** (Azure OpenAI via UAIS, if configured)
3. **Local faster-whisper** (CPU, base model — `pip install 'post-visit-summary[local-whisper]'`)

### How live listening works

The browser fetches a short-lived token from `GET /api/speech/token`. The backend exchanges your AAD credentials for a Speech token (`aad#<resource_id>#<bearer>`) and returns it. The browser Speech JS SDK then opens a WebSocket **directly to Azure** — microphone audio never touches the backend. The client secret stays on the server.

## Guardrails

- All artifacts are drafts until a `signoff` row exists.
- Every coding suggestion must cite evidence (transcript / structured-input span); items without evidence are demoted to gaps.
- Items below the confidence floor (default 0.7) are surfaced under "Needs review".
- Every LLM call, node transition, edit, and signoff is recorded in `audit_log`.

## Repo layout

See `backend/` and `web/` — or the plan doc at `../.windsurf/plans/post-visit-summary-agent-814de5.md`.

## Running without Docker

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e .
pip install -e ".[azure-speech]"   # for Azure Speech transcription
export DATABASE_URL=sqlite+aiosqlite:///./pvs.db   # SQLite fallback
uvicorn app.main:app --reload

# Frontend
cd web
npm install
npm run dev
```


# Local Setup — Post-Visit Summary & Clinical Coding Agent

End-to-end, copy-pasteable instructions for running the full stack on a
fresh macOS or Linux machine. Every step below can be executed verbatim
by a human or an automation agent; if a step requires a decision, it is
called out explicitly.

The stack is:

- **Postgres 16** (via Podman container) — persistent storage.
- **FastAPI backend** (Python 3.11+) — agent graph, REST + SSE API.
- **Vite + React frontend** (Node 18+) — the clinician UI at
  `http://localhost:5173`.

> Two supported modes:
>   - **Mode A — Native** (recommended for development): Postgres in a
>     Podman container, backend in a local venv, frontend in a local
>     `node_modules`. Fast reloads, easy breakpoints. Covered below.
>   - **Mode B — Containerised**: everything in `docker-compose`. See
>     the short section at the very end.

---

## 1. Prerequisites

Install the following once per machine. Versions are minimums; newer
works.

| Tool        | Minimum | Install (macOS)                                  | Verify                  |
|-------------|---------|--------------------------------------------------|-------------------------|
| Git         | 2.30    | `brew install git`                               | `git --version`         |
| Python      | 3.11    | `brew install python@3.11`                       | `python3 --version`     |
| Node.js     | 18 LTS  | `brew install node` (or `nvm install 18`)        | `node --version`        |
| npm         | 9       | ships with Node                                  | `npm --version`         |
| Podman      | 4.4     | `brew install podman`                            | `podman --version`      |
| psql (opt.) | 14      | `brew install libpq && brew link --force libpq`  | `psql --version`        |

If you prefer Docker Desktop over Podman, everything still works —
substitute `docker` for `podman` below.

One-time Podman init on macOS:

```bash
podman machine init            # creates the VM (first time only)
podman machine start           # starts it
podman system info >/dev/null  # sanity check
```

---

## 2. Clone and configure

```bash
git clone <your-repo-url> post-visit-summary
cd post-visit-summary
```

Create your local `.env` from the template and fill in the UAIS / Azure
OpenAI credentials (ask the team for the values; they are secrets and
are **not** in git):

```bash
cp .env.example .env
${EDITOR:-vi} .env
```

The keys you must set are:

```
UAIS_TOKEN_URL=...
HCP_CLIENT_ID=...
HCP_CLIENT_SECRETE=...   # note the spelling — mirrors the UHG platform
HCP_SCOPE=...
UAIS_COMPLETIONS_ENDPOINT=...
UAIS_API_VERSION=2025-01-01-preview
UAIS_DEPLOYMENT=gpt-5.2_2025-12-11   # or whichever deployment you have
UAIS_PROJECT_ID=...
```

**Azure Cognitive Services Speech** (required for audio upload and live mic transcription):

Obtain from your Azure app registration and Speech resource in the Azure Portal:

```
AZURE_SPEECH_CLIENT_ID=<app-registration-client-id>
AZURE_SPEECH_CLIENT_SECRET=<app-registration-secret>
AZURE_SPEECH_TENANT_ID=<directory-tenant-id>
AZURE_SPEECH_RESOURCE_ID=<ARM resource ID — Speech resource → Properties in Azure Portal>
AZURE_SPEECH_REGION=eastus
# AZURE_SPEECH_ENDPOINT=   # optional, only for custom / private endpoints
```

> If these are not set, transcription falls back to UAIS Whisper (if configured) or
> local faster-whisper. You can always paste a transcript manually.

Postgres credentials default to a local-only container and do **not**
need to be changed:

```
PG_HOST=127.0.0.1
PG_PORT=55432
PG_DATABASE=pvs
PG_USER=postgres
PG_PASSWORD=postgres
```

> The backend falls back to `sqlite+aiosqlite:///./pvs.db` if neither
> `DATABASE_URL` nor `PG_*` are set — useful only if you really want to
> avoid Podman. All commands below assume Postgres.

---

## 3. Start Postgres (Podman)

Run the helper script. It creates a named volume
(`pvs_postgres_data`) and a container (`pvs_postgres`) listening on
`127.0.0.1:55432`. It is idempotent — safe to run repeatedly.

```bash
scripts/start_postgres_podman.sh
```

Expected output ends with:

```
Postgres is running:
  host=127.0.0.1 port=55432 db=pvs user=postgres
```

Verify with psql (optional):

```bash
psql postgresql://postgres:postgres@127.0.0.1:55432/pvs -c "\l"
```

To stop/remove Postgres later:

```bash
scripts/stop_postgres_podman.sh       # stop container
podman volume rm pvs_postgres_data    # wipe data (only if you want to reset)
```

---

## 4. Backend — Python venv + dependencies

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e .
# Azure Speech transcription (recommended — enables file upload + live mic)
pip install -e ".[azure-speech]"
# Optional: local Whisper fallback (large model download, CPU)
# pip install -e ".[local-whisper]"
# Optional: dev tools (pytest, ruff)
pip install -e ".[dev]"
cd ..
```

Every subsequent backend command assumes the venv is active
(`source backend/.venv/bin/activate`). Deactivate with `deactivate`.

---

## 5. Backend — run it

From the repo root:

```bash
PYTHONPATH="$PWD" uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

On first boot you will see logs similar to:

```
INFO pvs: UAIS configured: True | deployment=gpt-5.2_2025-12-11
INFO pvs.snapshot: snapshot loaded from .../backend/app/data/snapshot.json (...)
INFO pvs: backfill: promoted N encounter(s) to signed
Uvicorn running on http://127.0.0.1:8000
```

Three startup steps run automatically in order:

1. **Schema creation** (`create_all`) — creates any missing tables.
2. **Snapshot load** (`load_state`) — if the DB is empty and
   `backend/app/data/snapshot.json` exists, it is imported so you start
   with the team's current data set.
3. **Demo seed** (`seed_demo_encounters`) — inserts the two
   pre-canned demo encounters (if missing) so the "Saved encounters"
   section is never empty.
4. **Signed-encounter backfill** — flips any encounter whose artifacts
   are all signed to `status='signed'`.

Health check:

```bash
curl -s http://127.0.0.1:8000/api/health | jq
# -> {"ok": true, "azure_configured": true}
```

Interactive API docs: <http://127.0.0.1:8000/docs>.

Leave this terminal running.

---

## 6. Frontend — install and run

Open a **second** terminal:

```bash
cd web
npm install          # first time only
npm run dev
```

Vite prints:

```
  VITE ready in ... ms
  ➜  Local:   http://localhost:5173/
```

Open <http://localhost:5173> in your browser.

The frontend reads `VITE_API_BASE_URL` from the root `.env` (default
`http://localhost:8000`). If you changed the API port, update it and
restart `npm run dev`.

---

## 7. End-to-end smoke test

1. Load <http://localhost:5173>. You should see:
   - A hero with three tiles (Agents / Artifacts / Guardrails).
   - A **Seeded encounters** list (at least 2).
   - A **Drafts in review** list (whatever the snapshot shipped with).
   - A **Signed off** list (may be empty).
2. Pick a seeded encounter → **Run agents**. You'll be redirected to
   `/run/:id` and see the 7-node graph animate via SSE.
3. When the run finishes, click **Review drafts** (or wait for the
   button to enable).
4. On the review page:
   - Type into any text area — multi-character input should work.
   - Click **Save edits** → you'll see a green `Edits saved` toast in
     the top right.
   - Click **Sign off** on each of the 5 artifact tabs (SOAP, PCP,
     Problems & plan, Coding, Gaps). A toast confirms each.
   - When the 5th artifact is signed, the toast reads
     `Encounter fully signed off` and the encounter's status flips to
     `signed`.
5. Navigate back to the home page. The encounter should now appear
   under **Signed off** with a green badge and checkmark.

Every action above is recorded in the `audit_log` table. View it via
`/audit/:id` in the UI or query the DB directly.

---

## 8. DB state snapshots (dump / load)

The project ships with a portable JSON snapshot at
`backend/app/data/snapshot.json`. It contains every encounter,
artifact, version, edit, signoff, and audit entry from the original
author's machine.

### Load (automatic on startup)

`load_state` runs on every backend boot and only imports the snapshot
when the `encounters` table is empty. Nothing for you to do.

### Dump (capture your current DB)

After you have made meaningful changes locally and want to share them
with the team, regenerate the snapshot and commit it:

```bash
scripts/db_snapshot.sh dump
# output:
# INFO pvs.snapshot: snapshot written to .../snapshot.json ({...counts...})
git add backend/app/data/snapshot.json
git commit -m "refresh db snapshot"
```

### Manual load

To force-reload the snapshot into a non-empty database (destructive —
make sure that's what you want):

```bash
# Nuke the DB first
scripts/stop_postgres_podman.sh
podman volume rm pvs_postgres_data
scripts/start_postgres_podman.sh
# Then start the backend — auto-load fires, or run manually:
scripts/db_snapshot.sh load
```

---

## 9. Daily workflow cheatsheet

```bash
# Start stack
scripts/start_postgres_podman.sh
source backend/.venv/bin/activate
(cd . && PYTHONPATH="$PWD" uvicorn backend.app.main:app --reload --port 8000) &
(cd web && npm run dev) &

# Run tests
(cd backend && pytest -q)

# Lint / typecheck
(cd web && npx tsc --noEmit)
(cd backend && ruff check .)

# Stop stack
pkill -f "uvicorn backend.app.main"
pkill -f "vite"
scripts/stop_postgres_podman.sh
```

---

## 10. Troubleshooting

| Symptom                                                         | Likely cause                                           | Fix                                                                                     |
|-----------------------------------------------------------------|--------------------------------------------------------|-----------------------------------------------------------------------------------------|
| `connection refused` on port 55432                              | Postgres container not running                         | `scripts/start_postgres_podman.sh`                                                      |
| Backend boots but `azure_configured: false`                     | Missing `UAIS_*` / `HCP_*` values in `.env`            | Re-check `.env` and restart backend                                                     |
| Audio upload returns 503                                        | `AZURE_SPEECH_*` not set                               | Add Speech env vars to `.env`; or paste a transcript from `test-data/transcripts/`      |
| Audio upload takes ~2 minutes                                   | Expected — SDK processes at real-time speed            | Use live mic for immediate results instead                                               |
| Live listening button does nothing / shows error                | Speech token fetch failed                              | Check `AZURE_SPEECH_*` in `.env`; check backend logs for credential errors              |
| Live listening shows "canceled" immediately                     | AAD app missing Speech role                            | Assign **Cognitive Services Speech Contributor** on the Speech resource to your app reg  |
| Home page "Signed off" empty even though you signed 5 artifacts | Browser still has cached list                          | Refresh the page; if still empty check `/api/encounters` JSON for `artifacts_signed`    |
| Home page shows old data after backend restart                  | Browser cache                                          | Hard refresh (`Cmd+Shift+R`)                                                            |
| `CORS error` in the browser console                             | `API_CORS_ORIGINS` does not include the UI origin      | Add `http://localhost:5173` to `API_CORS_ORIGINS` in `.env`, restart backend            |
| `ModuleNotFoundError: backend` when running uvicorn             | `PYTHONPATH` not set to repo root                      | Prefix with `PYTHONPATH="$PWD"` (see step 5)                                            |
| `podman machine start` fails                                    | Old/broken VM                                          | `podman machine rm -f podman-machine-default && podman machine init && podman machine start` |
| Snapshot load says "version mismatch"                           | Snapshot written by a newer schema                     | Pull latest code, then retry; or regenerate with `scripts/db_snapshot.sh dump`          |
| Textarea loses focus after 1 keystroke                          | Stale build                                            | Refresh Vite (it should hot-reload); if still broken restart `npm run dev`              |

---

## 11. Mode B — Compose (everything containerised)

For environments where you don't want to install Python / Node locally:

```bash
cp .env.example .env
# edit .env

podman compose up --build        # or: docker compose up --build
```

This brings up Postgres, the API (port 8000), the web UI (port 5173),
and Adminer (port 8080 for DB browsing). Logs are streamed to the
foreground; `Ctrl-C` stops the stack. Use `podman compose down -v` to
wipe the Postgres volume.

Mode B does **not** apply the auto-load snapshot by default unless you
bind-mount `backend/app/data/snapshot.json` — which the provided
`docker-compose.yml` already does via `./backend:/app`.

---

## 12. Who to ask

- **UAIS / Azure credentials**: team slack channel.
- **Azure Speech credentials**: Azure Portal → app registration (client ID/secret/tenant) + Speech resource (resource ID/region).
- **Project architecture**: `README.md` and
  `../.windsurf/plans/post-visit-summary-agent-*.md`.
- **Bugs or feature requests**: open a GitHub issue or ping the author
  in the project channel.

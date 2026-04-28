from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .config import get_settings
from .db import create_all, session_scope
from .models import Artifact, AuditLog, Encounter
from .routers import artifacts, audit, encounters, transcribe
from .seed_demo import seed_demo_encounters
from .state_snapshot import DEFAULT_PATH as SNAPSHOT_PATH, load_state


async def _backfill_signed_encounters() -> None:
    """Promote encounters whose artifacts were all signed before the
    encounter-level status flip existed. Safe to run on every startup."""
    async with session_scope() as s:
        rows = (await s.execute(
            select(Encounter).where(Encounter.status != "signed")
            .options(selectinload(Encounter.artifacts).selectinload(Artifact.signoff))
        )).scalars().all()
        promoted = 0
        for enc in rows:
            if enc.artifacts and all(a.signoff is not None for a in enc.artifacts):
                enc.status = "signed"
                s.add(AuditLog(
                    encounter_id=enc.id, actor="system", action="encounter_signed",
                    payload={"source": "backfill"},
                ))
                promoted += 1
        if promoted:
            logging.getLogger("pvs").info("backfill: promoted %d encounter(s) to signed", promoted)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("pvs")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_all()
    s = get_settings()
    log.info("UAIS configured: %s | deployment=%s", s.azure_configured, s.uais_deployment)
    try:
        await load_state(SNAPSHOT_PATH, only_if_empty=True)
    except Exception:
        log.exception("snapshot load failed (continuing)")
    try:
        await seed_demo_encounters()
    except Exception:
        log.exception("demo seeding failed (continuing)")
    try:
        await _backfill_signed_encounters()
    except Exception:
        log.exception("signed-encounter backfill failed (continuing)")
    yield


app = FastAPI(title="Post-Visit Summary & Clinical Coding Agent", version="0.1.0", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(encounters.router)
app.include_router(artifacts.router)
app.include_router(audit.router)
app.include_router(transcribe.router)

@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "azure_configured": get_settings().azure_configured}

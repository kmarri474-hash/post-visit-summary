from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from ..agents.reference import samples as sample_list
from ..agents.runner import run_encounter_stream
from ..db import get_session
from ..models import Artifact, AuditLog, Encounter
from ..schemas import ArtifactOut, ArtifactVersionOut, EncounterCreate, EncounterOut

router = APIRouter(prefix="/api/encounters", tags=["encounters"])


def _latest_version_out(a: Artifact) -> ArtifactVersionOut | None:
    if not a.versions:
        return None
    v = max(a.versions, key=lambda x: x.version)
    return ArtifactVersionOut.model_validate(v)


@router.get("/samples")
async def list_samples() -> list[dict[str, Any]]:
    return sample_list()


@router.post("", response_model=EncounterOut)
async def create_encounter(body: EncounterCreate, session: AsyncSession = Depends(get_session)) -> EncounterOut:
    enc = Encounter(
        patient_ref=body.patient_ref,
        clinician_ref=body.clinician_ref,
        source_type=body.source_type,
        raw_transcript=body.transcript,
        structured_input=body.structured_input,
        status="created",
    )
    session.add(enc)
    await session.flush()  # populate enc.id before referencing it
    session.add(AuditLog(encounter_id=enc.id, actor="system", action="encounter_created",
                         payload={"source_type": body.source_type}))
    await session.commit()
    return EncounterOut.model_validate(enc)


@router.post("/from-sample/{sample_id}", response_model=EncounterOut)
async def create_from_sample(sample_id: str, session: AsyncSession = Depends(get_session)) -> EncounterOut:
    found = next((s for s in sample_list() if s["id"] == sample_id), None)
    if not found:
        raise HTTPException(404, "sample not found")
    enc = Encounter(
        patient_ref=found["patient_ref"],
        clinician_ref=found["clinician_ref"],
        source_type="sample",
        raw_transcript=found.get("transcript", ""),
        structured_input=found.get("structured_input", {}),
        status="created",
    )
    session.add(enc)
    await session.flush()  # populate enc.id before referencing it
    session.add(AuditLog(encounter_id=enc.id, actor="system", action="encounter_created",
                         payload={"source": "sample", "sample_id": sample_id}))
    await session.commit()
    return EncounterOut.model_validate(enc)


@router.get("")
async def list_encounters(session: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    rows = (await session.execute(
        select(Encounter).order_by(Encounter.created_at.desc())
        .options(selectinload(Encounter.artifacts).selectinload(Artifact.signoff))
    )).scalars().all()
    out: list[dict[str, Any]] = []
    for r in rows:
        base = EncounterOut.model_validate(r).model_dump()
        total = len(r.artifacts)
        signed = sum(1 for a in r.artifacts if a.signoff is not None)
        base["artifacts_total"] = total
        base["artifacts_signed"] = signed
        out.append(base)
    return out


@router.get("/{encounter_id}")
async def get_encounter(encounter_id: str, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    enc = (await session.execute(
        select(Encounter).where(Encounter.id == encounter_id)
        .options(selectinload(Encounter.artifacts).selectinload(Artifact.versions),
                 selectinload(Encounter.artifacts).selectinload(Artifact.signoff))
    )).scalar_one_or_none()
    if not enc:
        raise HTTPException(404, "not found")
    artifacts = []
    for a in enc.artifacts:
        artifacts.append({
            "id": a.id,
            "encounter_id": a.encounter_id,
            "kind": a.kind,
            "signed": a.signoff is not None,
            "latest_version": _latest_version_out(a).model_dump() if _latest_version_out(a) else None,
        })
    return {
        "encounter": EncounterOut.model_validate(enc).model_dump(),
        "artifacts": artifacts,
    }


@router.post("/{encounter_id}/run")
async def run_encounter(encounter_id: str, session: AsyncSession = Depends(get_session)):
    enc = (await session.execute(select(Encounter).where(Encounter.id == encounter_id))).scalar_one_or_none()
    if not enc:
        raise HTTPException(404, "not found")

    async def event_gen():
        async for evt in run_encounter_stream(encounter_id):
            yield {"event": evt.get("type", "message"), "data": json.dumps(evt, default=str)}

    return EventSourceResponse(event_gen())

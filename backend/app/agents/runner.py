from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator

from sqlalchemy import select

from ..db import session_scope
from ..models import Artifact, ArtifactVersion, AuditLog, Encounter
from ..schemas import EncounterInput
from .graph import build_graph
from .state import AgentEvent, EncounterState

log = logging.getLogger(__name__)


def _encounter_to_input(enc: Encounter) -> EncounterInput:
    si = enc.structured_input or {}
    return EncounterInput(
        patient_ref=enc.patient_ref,
        clinician_ref=enc.clinician_ref,
        source_type=enc.source_type,  # type: ignore[arg-type]
        transcript=enc.raw_transcript or "",
        vitals=si.get("vitals", {}) or {},
        medications=si.get("medications", []) or [],
        diagnoses=si.get("diagnoses", []) or [],
        chief_complaint=si.get("chief_complaint"),
        assessments=si.get("assessments", []) or [],
        care_plan_changes=si.get("care_plan_changes", []) or [],
        referrals=si.get("referrals", []) or [],
        orders=si.get("orders", []) or [],
        followup=si.get("followup"),
    )


ARTIFACT_KEYS = [
    ("structured", "structured"),
    ("note", "note"),
    ("pcp_summary", "pcp"),
    ("coding", "coding"),
    ("gaps", "gaps"),
]


async def _persist_run(encounter_id: str, final_state: dict[str, Any], model_name: str) -> None:
    """Write one ArtifactVersion per artifact kind and an audit log row."""
    from sqlalchemy.orm import selectinload

    async with session_scope() as s:
        enc = (await s.execute(
            select(Encounter).where(Encounter.id == encounter_id).options(selectinload(Encounter.artifacts).selectinload(Artifact.versions))
        )).scalar_one()

        guardrail = final_state.get("guardrail")
        requires = bool(getattr(guardrail, "requires_human_review", False))

        for kind, key in ARTIFACT_KEYS:
            obj = final_state.get(key)
            if obj is None:
                continue
            content = obj.model_dump() if hasattr(obj, "model_dump") else obj
            confidence = float(getattr(obj, "confidence", 0.0) or 0.0)

            artifact = next((a for a in enc.artifacts if a.kind == kind), None)
            if artifact is None:
                artifact = Artifact(encounter_id=enc.id, kind=kind)
                s.add(artifact)
                await s.flush()
                next_version = 1
            else:
                next_version = (max((v.version for v in artifact.versions), default=0) or 0) + 1

            s.add(ArtifactVersion(
                artifact_id=artifact.id,
                version=next_version,
                content=content,
                created_by="agent",
                model=model_name,
                confidence=confidence,
                requires_human_review=requires,
            ))

        enc.status = "draft"
        s.add(AuditLog(
            encounter_id=enc.id,
            actor="agent",
            action="run_completed",
            payload={
                "requires_human_review": requires,
                "uncertainty_notes": getattr(guardrail, "uncertainty_notes", []),
                "dropped_items": getattr(guardrail, "dropped_items", []),
                "model": model_name,
            },
        ))


async def run_encounter_stream(encounter_id: str) -> AsyncIterator[AgentEvent]:
    """Drive the LangGraph and yield SSE events until completion."""
    from .llm import LLMClient

    async with session_scope() as s:
        enc = (await s.execute(select(Encounter).where(Encounter.id == encounter_id))).scalar_one()
        enc.status = "running"
        s.add(AuditLog(encounter_id=enc.id, actor="system", action="run_started", payload={}))
        encounter_input = _encounter_to_input(enc)

    queue: asyncio.Queue[AgentEvent | None] = asyncio.Queue()

    def emit(event: AgentEvent) -> None:
        try:
            queue.put_nowait(event)
        except Exception:
            pass

    graph = build_graph()
    initial: EncounterState = {
        "encounter_id": encounter_id,
        "input": encounter_input,
        "emitter": emit,
        "errors": [],
    }

    model_name = LLMClient().model_name

    async def drive() -> None:
        try:
            final = await graph.ainvoke(initial)
            await _persist_run(encounter_id, final, model_name=model_name)
            await queue.put({"type": "run_completed", "node": "graph", "message": "done",
                             "data": {
                                 "requires_human_review": bool(getattr(final.get("guardrail"), "requires_human_review", False)),
                             }})
        except Exception as e:
            log.exception("graph run failed")
            await queue.put({"type": "node_error", "node": "graph", "message": str(e)})
        finally:
            await queue.put(None)

    task = asyncio.create_task(drive())
    try:
        while True:
            evt = await queue.get()
            if evt is None:
                break
            yield evt
    finally:
        if not task.done():
            task.cancel()

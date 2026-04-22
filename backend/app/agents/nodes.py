from __future__ import annotations

import json
import logging
from typing import Any

from ..config import get_settings
from ..schemas import (
    ClinicalNote,
    CodeSuggestion,
    CodingBundle,
    DocumentationGap,
    EncounterInput,
    EvidenceSpan,
    GapList,
    GuardrailReport,
    HCCSuggestion,
    PCPSummary,
    StructuredEncounter,
    StructuredProblem,
)
from . import prompts
from .llm import LLMClient
from .reference import reference_block
from .state import AgentEvent, EncounterState

log = logging.getLogger(__name__)


def _emit(state: EncounterState, event: AgentEvent) -> None:
    emitter = state.get("emitter")
    if emitter:
        try:
            emitter(event)
        except Exception:  # pragma: no cover
            log.exception("emitter failed")


def _encounter_as_context(inp: EncounterInput) -> str:
    return json.dumps(inp.model_dump(), indent=2, default=str)


# ==== Offline fallbacks (used when Azure is not configured) ===================

def _fallback_structured(inp: EncounterInput) -> StructuredEncounter:
    problems = [
        StructuredProblem(
            name=d.description,
            status="active",
            evidence=[EvidenceSpan(source="structured", quote=d.description)],
        )
        for d in inp.diagnoses
    ]
    return StructuredEncounter(
        chief_complaint=inp.chief_complaint or "",
        hpi=inp.transcript[:400],
        problems=problems,
        medications=inp.medications,
        vitals=inp.vitals,
        assessments=inp.assessments,
        care_plan_changes=inp.care_plan_changes,
        referrals=inp.referrals,
        orders=inp.orders,
        followup=inp.followup or "",
        confidence=0.6,
    )


def _fallback_note(inp: EncounterInput) -> ClinicalNote:
    v = inp.vitals
    objective = ", ".join(
        x for x in [
            f"BP {v.bp}" if v.bp else None,
            f"HR {v.hr}" if v.hr else None,
            f"SpO2 {v.spo2}%" if v.spo2 else None,
        ] if x
    ) or "Vitals not documented."
    return ClinicalNote(
        subjective=inp.chief_complaint or (inp.transcript[:200] or "See transcript."),
        objective=objective,
        assessment="; ".join(d.description for d in inp.diagnoses) or "See assessments.",
        plan="; ".join(inp.care_plan_changes + inp.orders) or "See care plan.",
        confidence=0.5,
        evidence=[EvidenceSpan(source="transcript", quote=inp.transcript[:120])] if inp.transcript else [],
    )


def _fallback_pcp(inp: EncounterInput) -> PCPSummary:
    return PCPSummary(
        greeting="Dear Colleague,",
        reason_for_visit=inp.chief_complaint or "Follow-up visit.",
        key_findings="; ".join(inp.assessments) or "See note.",
        changes_made="; ".join(inp.care_plan_changes) or "No changes.",
        actions_for_pcp=inp.referrals or [],
        followup=inp.followup or "",
        closing="Sincerely, care team",
        confidence=0.5,
    )


def _fallback_coding(inp: EncounterInput) -> CodingBundle:
    icd = [
        CodeSuggestion(
            code=d.icd10 or "",
            description=d.description,
            rationale="Listed as diagnosis during encounter.",
            confidence=0.7 if d.icd10 else 0.4,
            evidence=[EvidenceSpan(source="structured", quote=d.description)],
        )
        for d in inp.diagnoses if d.icd10 or d.description
    ]
    em = CodeSuggestion(
        code="99214",
        description="Established patient, moderate complexity",
        rationale="Moderate complexity chronic condition management with medication changes.",
        confidence=0.6,
        evidence=[EvidenceSpan(source="structured", quote=", ".join(inp.care_plan_changes) or "care plan changes")],
    )
    return CodingBundle(icd10=icd, cpt=[], em_level=em, hcc=[], notes="Offline fallback output.", confidence=0.5)


def _fallback_gaps(inp: EncounterInput) -> GapList:
    gaps: list[DocumentationGap] = []
    if not inp.vitals.bp:
        gaps.append(DocumentationGap(field="vitals.bp", why_it_matters="Required for E/M and HTN coding.", severity="high", blocks_signoff=True))
    if not inp.followup:
        gaps.append(DocumentationGap(field="followup", why_it_matters="Follow-up interval is required for care continuity.", severity="medium"))
    return GapList(gaps=gaps, confidence=0.6)


# ==== Nodes ===================================================================

llm = LLMClient()


async def node_intake(state: EncounterState) -> dict:
    _emit(state, {"type": "node_started", "node": "intake", "message": "Normalizing inputs"})
    inp = state["input"]
    _emit(state, {"type": "node_completed", "node": "intake", "message": "Inputs normalized",
                  "data": {"transcript_len": len(inp.transcript)}})
    return {}


async def node_structurer(state: EncounterState) -> dict:
    node = "structurer"
    _emit(state, {"type": "node_started", "node": node, "message": "Extracting structured encounter"})
    inp = state["input"]
    user = f"Encounter input:\n{_encounter_as_context(inp)}"
    try:
        result = await llm.structured(
            StructuredEncounter, prompts.STRUCTURER_SYSTEM, user, fallback=_fallback_structured(inp),
        )
    except Exception as e:
        result = _fallback_structured(inp)
        _emit(state, {"type": "log", "node": node, "message": f"fallback due to: {e}"})
    _emit(state, {"type": "node_completed", "node": node, "message": f"{len(result.problems)} problems",
                  "data": {"confidence": result.confidence, "problems": [p.name for p in result.problems]}})
    return {"structured": result}


async def node_note(state: EncounterState) -> dict:
    node = "note_drafter"
    _emit(state, {"type": "node_started", "node": node, "message": "Drafting SOAP note"})
    inp = state["input"]
    s = state["structured"]
    user = f"Structured encounter:\n{s.model_dump_json(indent=2)}\n\nRaw transcript:\n{inp.transcript}"
    try:
        result = await llm.structured(ClinicalNote, prompts.NOTE_DRAFTER_SYSTEM, user, fallback=_fallback_note(inp))
    except Exception as e:
        result = _fallback_note(inp)
        _emit(state, {"type": "log", "node": node, "message": f"fallback due to: {e}"})
    _emit(state, {"type": "node_completed", "node": node, "message": "SOAP note draft ready",
                  "data": {"confidence": result.confidence}})
    return {"note": result}


async def node_pcp(state: EncounterState) -> dict:
    node = "pcp_summary"
    _emit(state, {"type": "node_started", "node": node, "message": "Drafting PCP handoff"})
    inp = state["input"]
    s = state["structured"]
    user = f"Structured encounter:\n{s.model_dump_json(indent=2)}\n\nTranscript:\n{inp.transcript[:3000]}"
    try:
        result = await llm.structured(PCPSummary, prompts.PCP_SUMMARY_SYSTEM, user, fallback=_fallback_pcp(inp))
    except Exception as e:
        result = _fallback_pcp(inp)
        _emit(state, {"type": "log", "node": node, "message": f"fallback due to: {e}"})
    _emit(state, {"type": "node_completed", "node": node, "message": "PCP handoff ready",
                  "data": {"confidence": result.confidence}})
    return {"pcp": result}


async def node_coding(state: EncounterState) -> dict:
    node = "coding"
    _emit(state, {"type": "node_started", "node": node, "message": "Suggesting ICD-10 / CPT / E/M / HCC"})
    inp = state["input"]
    s = state["structured"]
    user = (
        f"{reference_block()}\n\nStructured encounter:\n{s.model_dump_json(indent=2)}\n\n"
        f"Transcript:\n{inp.transcript[:3000]}"
    )
    try:
        result = await llm.structured(CodingBundle, prompts.CODING_SYSTEM, user, fallback=_fallback_coding(inp))
    except Exception as e:
        result = _fallback_coding(inp)
        _emit(state, {"type": "log", "node": node, "message": f"fallback due to: {e}"})
    _emit(state, {
        "type": "node_completed", "node": node,
        "message": f"{len(result.icd10)} ICD-10, {len(result.cpt)} CPT, {len(result.hcc)} HCC",
        "data": {"confidence": result.confidence, "em_level": result.em_level.code if result.em_level else None},
    })
    return {"coding": result}


async def node_gaps(state: EncounterState) -> dict:
    node = "gap_detector"
    _emit(state, {"type": "node_started", "node": node, "message": "Scanning for documentation gaps"})
    inp = state["input"]
    s = state["structured"]
    user = f"Structured encounter:\n{s.model_dump_json(indent=2)}\n\nTranscript:\n{inp.transcript[:3000]}"
    try:
        result = await llm.structured(GapList, prompts.GAP_DETECTOR_SYSTEM, user, fallback=_fallback_gaps(inp))
    except Exception as e:
        result = _fallback_gaps(inp)
        _emit(state, {"type": "log", "node": node, "message": f"fallback due to: {e}"})
    _emit(state, {"type": "node_completed", "node": node, "message": f"{len(result.gaps)} gaps",
                  "data": {"blockers": [g.field for g in result.gaps if g.blocks_signoff]}})
    return {"gaps": result}


async def node_guardrail(state: EncounterState) -> dict:
    node = "guardrail"
    _emit(state, {"type": "node_started", "node": node, "message": "Applying guardrails"})
    floor = get_settings().confidence_floor
    notes: list[str] = []
    dropped: list[str] = []
    requires = False

    coding = state.get("coding")
    if coding:
        cleaned_icd = []
        for c in coding.icd10:
            if not c.evidence:
                dropped.append(f"ICD-10 {c.code or c.description} dropped: no evidence")
                continue
            cleaned_icd.append(c)
        coding.icd10 = cleaned_icd
        if coding.confidence < floor:
            requires = True
            notes.append(f"Coding confidence {coding.confidence:.2f} below floor {floor}")

    note = state.get("note")
    if note and note.confidence < floor:
        requires = True
        notes.append(f"Note confidence {note.confidence:.2f} below floor {floor}")

    pcp = state.get("pcp")
    if pcp and pcp.confidence < floor:
        requires = True
        notes.append(f"PCP summary confidence {pcp.confidence:.2f} below floor {floor}")

    gaps = state.get("gaps")
    if gaps and any(g.blocks_signoff for g in gaps.gaps):
        requires = True
        notes.append("High-severity documentation gaps block signoff.")

    report = GuardrailReport(
        requires_human_review=requires, uncertainty_notes=notes, dropped_items=dropped,
    )
    _emit(state, {"type": "node_completed", "node": node,
                  "message": "Flagged for review" if requires else "Clean",
                  "data": {"requires_human_review": requires, "dropped": len(dropped)}})
    return {"guardrail": report, "coding": coding} if coding else {"guardrail": report}

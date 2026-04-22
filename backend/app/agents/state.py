from __future__ import annotations

from typing import Any, Callable, Optional, TypedDict

from ..schemas import (
    ClinicalNote,
    CodingBundle,
    EncounterInput,
    GapList,
    GuardrailReport,
    PCPSummary,
    StructuredEncounter,
)


class AgentEvent(TypedDict, total=False):
    type: str  # node_started | node_completed | node_error | log | run_completed
    node: str
    message: str
    data: dict[str, Any]


Emitter = Callable[[AgentEvent], None]


class EncounterState(TypedDict, total=False):
    encounter_id: str
    input: EncounterInput
    structured: StructuredEncounter
    note: ClinicalNote
    pcp: PCPSummary
    coding: CodingBundle
    gaps: GapList
    guardrail: GuardrailReport
    emitter: Optional[Emitter]
    errors: list[str]

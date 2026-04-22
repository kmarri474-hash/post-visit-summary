from __future__ import annotations

from datetime import datetime
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field


# ==== Inputs =================================================================

class Vitals(BaseModel):
    bp: Optional[str] = None
    hr: Optional[int] = None
    temp_f: Optional[float] = None
    resp_rate: Optional[int] = None
    spo2: Optional[int] = None
    weight_lb: Optional[float] = None
    height_in: Optional[float] = None


class Medication(BaseModel):
    name: str
    dose: Optional[str] = None
    frequency: Optional[str] = None
    status: Literal["active", "new", "changed", "discontinued"] = "active"


class Diagnosis(BaseModel):
    description: str
    icd10: Optional[str] = None


class EncounterInput(BaseModel):
    patient_ref: str = Field(default="PT-DEMO-001")
    clinician_ref: str = Field(default="DR-DEMO")
    source_type: Literal["text", "audio", "sample"] = "text"
    transcript: str = ""
    vitals: Vitals = Field(default_factory=Vitals)
    medications: List[Medication] = Field(default_factory=list)
    diagnoses: List[Diagnosis] = Field(default_factory=list)
    chief_complaint: Optional[str] = None
    assessments: List[str] = Field(default_factory=list)
    care_plan_changes: List[str] = Field(default_factory=list)
    referrals: List[str] = Field(default_factory=list)
    orders: List[str] = Field(default_factory=list)
    followup: Optional[str] = None


# ==== Agent structured outputs ==============================================

class EvidenceSpan(BaseModel):
    source: Literal["transcript", "structured"] = "transcript"
    quote: str
    location: Optional[str] = None


class StructuredProblem(BaseModel):
    name: str
    status: Literal["active", "resolved", "worsening", "improving", "new"] = "active"
    evidence: List[EvidenceSpan] = Field(default_factory=list)


class StructuredEncounter(BaseModel):
    chief_complaint: str = ""
    hpi: str = ""
    problems: List[StructuredProblem] = Field(default_factory=list)
    medications: List[Medication] = Field(default_factory=list)
    vitals: Vitals = Field(default_factory=Vitals)
    assessments: List[str] = Field(default_factory=list)
    care_plan_changes: List[str] = Field(default_factory=list)
    referrals: List[str] = Field(default_factory=list)
    orders: List[str] = Field(default_factory=list)
    followup: str = ""
    confidence: float = 0.8


class ClinicalNote(BaseModel):
    subjective: str
    objective: str
    assessment: str
    plan: str
    confidence: float = 0.8
    evidence: List[EvidenceSpan] = Field(default_factory=list)


class PCPSummary(BaseModel):
    greeting: str
    reason_for_visit: str
    key_findings: str
    changes_made: str
    actions_for_pcp: List[str] = Field(default_factory=list)
    followup: str
    closing: str
    confidence: float = 0.8


class CodeSuggestion(BaseModel):
    code: str
    description: str
    rationale: str
    confidence: float
    evidence: List[EvidenceSpan] = Field(default_factory=list)


class HCCSuggestion(BaseModel):
    icd10: str
    hcc_category: str
    description: str
    rationale: str
    confidence: float
    evidence: List[EvidenceSpan] = Field(default_factory=list)


class CodingBundle(BaseModel):
    icd10: List[CodeSuggestion] = Field(default_factory=list)
    cpt: List[CodeSuggestion] = Field(default_factory=list)
    em_level: Optional[CodeSuggestion] = None
    hcc: List[HCCSuggestion] = Field(default_factory=list)
    notes: str = ""
    confidence: float = 0.7


class DocumentationGap(BaseModel):
    field: str
    why_it_matters: str
    severity: Literal["low", "medium", "high"] = "medium"
    blocks_signoff: bool = False


class GapList(BaseModel):
    gaps: List[DocumentationGap] = Field(default_factory=list)
    confidence: float = 0.8


class GuardrailReport(BaseModel):
    requires_human_review: bool = False
    uncertainty_notes: List[str] = Field(default_factory=list)
    dropped_items: List[str] = Field(default_factory=list)


# ==== API I/O ================================================================

class EncounterCreate(BaseModel):
    patient_ref: str = "PT-DEMO-001"
    clinician_ref: str = "DR-DEMO"
    source_type: Literal["text", "audio", "sample"] = "text"
    transcript: str = ""
    structured_input: dict[str, Any] = Field(default_factory=dict)


class EncounterOut(BaseModel):
    id: str
    patient_ref: str
    clinician_ref: str
    source_type: str
    status: str
    created_at: datetime
    raw_transcript: str
    structured_input: dict[str, Any]

    class Config:
        from_attributes = True


class ArtifactVersionOut(BaseModel):
    id: str
    version: int
    content: dict[str, Any]
    created_by: str
    model: str
    confidence: float
    requires_human_review: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ArtifactOut(BaseModel):
    id: str
    encounter_id: str
    kind: str
    latest_version: Optional[ArtifactVersionOut] = None
    signed: bool = False

    class Config:
        from_attributes = True


class ArtifactPatch(BaseModel):
    content: dict[str, Any]
    reason: Optional[str] = None


class SignoffRequest(BaseModel):
    comment: str = ""
    override_gaps: bool = False


class AuditEventOut(BaseModel):
    id: str
    actor: str
    action: str
    payload: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True

export type EvidenceSpan = { source: "transcript" | "structured"; quote: string; location?: string };

export type CodeSuggestion = {
  code: string;
  description: string;
  rationale: string;
  confidence: number;
  evidence: EvidenceSpan[];
};

export type HCCSuggestion = {
  icd10: string;
  hcc_category: string;
  description: string;
  rationale: string;
  confidence: number;
  evidence: EvidenceSpan[];
};

export type CodingBundle = {
  icd10: CodeSuggestion[];
  cpt: CodeSuggestion[];
  em_level?: CodeSuggestion | null;
  hcc: HCCSuggestion[];
  notes?: string;
  confidence: number;
};

export type ClinicalNote = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  confidence: number;
  evidence: EvidenceSpan[];
};

export type PCPSummary = {
  greeting: string;
  reason_for_visit: string;
  key_findings: string;
  changes_made: string;
  actions_for_pcp: string[];
  followup: string;
  closing: string;
  confidence: number;
};

export type DocumentationGap = {
  field: string;
  why_it_matters: string;
  severity: "low" | "medium" | "high";
  blocks_signoff: boolean;
};

export type GapList = { gaps: DocumentationGap[]; confidence: number };

export type StructuredProblem = { name: string; status: string; evidence: EvidenceSpan[] };
export type StructuredEncounter = {
  chief_complaint: string;
  hpi: string;
  problems: StructuredProblem[];
  medications: any[];
  vitals: any;
  assessments: string[];
  care_plan_changes: string[];
  referrals: string[];
  orders: string[];
  followup: string;
  confidence: number;
};

export type ArtifactOut = {
  id: string;
  encounter_id: string;
  kind:
    | "structured"
    | "note"
    | "pcp_summary"
    | "coding"
    | "gaps"
    | "problems"
    | "orders"
    | "referrals";
  signed: boolean;
  latest_version: {
    id: string;
    version: number;
    content: any;
    created_by: string;
    model: string;
    confidence: number;
    requires_human_review: boolean;
    created_at: string;
  } | null;
};

export type EncounterDetail = {
  encounter: {
    id: string;
    patient_ref: string;
    clinician_ref: string;
    source_type: string;
    status: string;
    created_at: string;
    raw_transcript: string;
    structured_input: any;
  };
  artifacts: ArtifactOut[];
};

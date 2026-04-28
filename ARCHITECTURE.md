# Architecture — Post-Visit Summary & Clinical Coding Agent

This document explains how the system is put together: the top-level
components, the LangGraph agent topology, the database schema, and the
end-to-end request flows. All diagrams are Mermaid blocks that GitHub
renders natively.

- [1. System overview](#1-system-overview)
- [2. Component responsibilities](#2-component-responsibilities)
- [3. Agent graph (LangGraph)](#3-agent-graph-langgraph)
- [4. Data model](#4-data-model)
- [5. End-to-end flows](#5-end-to-end-flows)
- [6. State lifecycle and snapshots](#6-state-lifecycle-and-snapshots)
- [7. Guardrails and sign-off rules](#7-guardrails-and-sign-off-rules)
- [8. Observability / audit log](#8-observability--audit-log)

---

## 1. System overview

Three processes that talk over HTTP plus a Server-Sent Events (SSE)
channel for live agent progress.

```mermaid
flowchart LR
  subgraph Browser["Browser · localhost:5173"]
    UI["React + Vite SPA<br/>(intake → run → review → audit)"]
  end

  subgraph API["FastAPI · localhost:8000"]
    routers["Routers:<br/>/api/encounters · /api/artifacts<br/>/api/audit · /api/transcribe"]
    runner["Agent runner<br/>(LangGraph StateGraph)"]
    snap["State snapshot<br/>(dump / load JSON)"]
  end

  subgraph PG["Postgres · localhost:55432"]
    tables["encounters · artifacts · artifact_versions<br/>edits · signoffs · audit_log"]
  end

  subgraph Ext["UHG UAIS gateway"]
    llm["Azure OpenAI<br/>(gpt-4o / gpt-5.2 / whisper)"]
  end

  UI -- "REST JSON" --> routers
  UI -- "SSE run stream" --> runner
  routers --> tables
  runner --> tables
  runner -- "chat / whisper" --> llm
  snap <-- "JSON file" --> tables
```

- The UI is a single-page React app; routes map 1:1 to FastAPI
  endpoints (see §5 for the per-flow sequence).
- The backend owns all business logic; the browser is a thin renderer.
- LLM calls are proxied through **UAIS** using an OAuth2
  client-credentials bearer token as the Azure `azure_ad_token`.
- Postgres is the single source of truth. A portable JSON snapshot
  auto-loads on first startup so a fresh clone bootstraps with the
  team's working data set (see §6).

---

## 2. Component responsibilities

### Frontend (`@/web`)

```mermaid
flowchart TB
  App["App shell<br/>(theme, nav, route outlet)"]
  Intake["EncounterIntake<br/>/intake"]
  Run["RunConsole<br/>/run/:id"]
  Review["DraftReview<br/>/review/:id"]
  Audit["AuditTrail<br/>/audit/:id"]
  About["AboutTopic<br/>/about/:topic"]

  App --> Intake
  App --> Run
  App --> Review
  App --> Audit
  App --> About

  Intake -- "POST encounter → nav" --> Run
  Run -- "SSE done → nav" --> Review
  Review -- "View audit" --> Audit
```

| Route             | Page                | Key behaviour                                                             |
|-------------------|---------------------|---------------------------------------------------------------------------|
| `/intake`         | `EncounterIntake`   | Seeded encounters · upload audio · paste transcript · "Drafts / Signed"  |
| `/run/:id`        | `RunConsole`        | Live SSE timeline of the 7-node agent graph                               |
| `/review/:id`     | `DraftReview`       | Per-artifact tabs (SOAP, PCP, Problems, Coding, Gaps) with sign-off       |
| `/audit/:id`      | `AuditTrail`        | Chronological audit log for an encounter                                  |
| `/about/:topic`   | `AboutTopic`        | Explainer cards for `agents`, `artifacts`, `guardrails`                   |

### Backend (`@/backend/app`)

```mermaid
flowchart TB
  subgraph R[Routers]
    EnR["encounters.py<br/>• POST /encounters · /from-sample/{id}<br/>• GET /encounters (with signed counts)<br/>• GET /encounters/{id}<br/>• POST /encounters/{id}/run  (SSE)"]
    ArR["artifacts.py<br/>• PATCH → new ArtifactVersion + Edit<br/>• POST /signoff → Signoff + status flip"]
    AuR["audit.py<br/>• GET /encounters/{id}/audit"]
    TrR["transcribe.py<br/>• POST /transcribe (Whisper via UAIS)"]
  end

  subgraph A[Agents]
    Runner["runner.py · run_encounter_stream<br/>drives the graph, emits AgentEvents"]
    Graph["graph.py · build_graph()<br/>StateGraph[EncounterState]"]
    Nodes["nodes.py · 7 agent nodes"]
    LLM["llm.py · LLMClient<br/>(UAIS bearer → Azure OpenAI)"]
    Prompts["prompts.py"]
  end

  subgraph P[Persistence]
    Models["models.py · SQLAlchemy ORM"]
    DB["db.py · async engine + sessions"]
    Seed["seed_demo.py · pre-canned encounters"]
    Snap["state_snapshot.py · dump/load JSON"]
  end

  Main["main.py · FastAPI app + lifespan hook"]
  Main --> R
  Main --> DB
  Main --> Snap
  Main --> Seed
  R --> A
  R --> P
  A --> LLM
  A --> Models
```

---

## 3. Agent graph (LangGraph)

The run is a single `StateGraph[EncounterState]` compiled once at
process start (cached) and driven per encounter. Fan-out after
`structurer`, join at `guardrail`.

```mermaid
flowchart LR
  classDef node fill:#eef2ff,stroke:#6366f1,color:#312e81,rx:8,ry:8;
  classDef guard fill:#fef3c7,stroke:#f59e0b,color:#78350f,rx:8,ry:8;

  START(["START"]):::node
  Intake["intake<br/><small>normalize + validate input</small>"]:::node
  Structurer["structurer<br/><small>extract problems, vitals, plan</small>"]:::node
  Note["note_drafter<br/><small>SOAP draft</small>"]:::node
  PCP["pcp_summary<br/><small>PCP handoff letter</small>"]:::node
  Coding["coding<br/><small>ICD-10 · CPT · E/M · HCC</small>"]:::node
  Gaps["gap_detector<br/><small>missing / low-confidence items</small>"]:::node
  Guardrail["guardrail<br/><small>evidence + confidence gate</small>"]:::guard
  END(["END"]):::node

  START --> Intake --> Structurer
  Structurer --> Note
  Structurer --> PCP
  Structurer --> Coding
  Structurer --> Gaps
  Note --> Guardrail
  PCP --> Guardrail
  Coding --> Guardrail
  Gaps --> Guardrail
  Guardrail --> END
```

Each node reads from and writes into a shared `EncounterState`
TypedDict (`backend/app/agents/state.py`). Every node also emits
`node_started` / `node_completed` events into a queue that the FastAPI
SSE endpoint streams back to the browser.

### State envelope

```mermaid
classDiagram
  class EncounterState {
    +str encounter_id
    +EncounterInput input
    +StructuredEncounter structured
    +ClinicalNote note
    +PcpSummary pcp
    +CodingBundle coding
    +GapReport gaps
    +GuardrailReport guardrail
    +list~str~ errors
    +Callable emitter(AgentEvent)
  }
  class AgentEvent {
    +Literal type
    +str node
    +str message
    +dict data
  }
  EncounterState --> AgentEvent : emitter
```

### Node contracts (brief)

| Node            | Reads                     | Writes                   | Notes                                   |
|-----------------|---------------------------|--------------------------|-----------------------------------------|
| `intake`        | `input`                   | validated `input`        | no LLM                                  |
| `structurer`    | `input`                   | `structured`             | LLM call, extracts problems + plan      |
| `note_drafter`  | `structured`              | `note`                   | LLM call, SOAP                          |
| `pcp_summary`   | `structured`              | `pcp`                    | LLM call, PCP letter                    |
| `coding`        | `structured` + `note`     | `coding`                 | LLM call, uses 650+ ICD-10-CM / 385+ CPT / 271 HCC V28 reference codes |
| `gap_detector`  | all prior                 | `gaps`                   | LLM + rule pass, flags missing items    |
| `guardrail`     | all prior                 | `guardrail`              | Demotes no-evidence items, sets review  |

### Reference code databases

The `coding` node is backed by comprehensive clinical code databases
loaded from `backend/app/data/`:

| File               | Contents                            | Count    |
|--------------------|-------------------------------------|----------|
| `icd10_seed.json`  | ICD-10-CM 2025 diagnosis codes      | 650+     |
| `cpt_seed.json`    | CPT / HCPCS Level II procedure codes| 385+     |
| `hcc_map.json`     | CMS-HCC V28 risk-adjustment map     | 271      |

**ICD-10-CM** covers all major chapters: infectious (A/B), neoplasms (C/D),
blood (D50–D89), endocrine/diabetes (E), mental health (F), nervous system (G),
eye/ear (H), circulatory (I), respiratory (J), digestive (K), skin (L),
musculoskeletal (M), genitourinary (N), pregnancy (O), symptoms (R),
injury (S/T), external causes (W), and Z-codes.

**CPT/HCPCS** spans E&M (office, hospital, ED, critical care, nursing facility,
home, telehealth, care management, preventive/wellness), surgery (all
subspecialties), radiology/imaging, 68+ laboratory codes, medicine
(cardiology, pulmonary, allergy, neurology, physical medicine), infusions,
immunizations, vaccines, and HCPCS Level II (G/J codes).

**HCC V28** maps 271 ICD-10 codes to 47 distinct HCC risk-adjustment
categories. The full map is injected into the coding prompt for accurate
risk-adjustment capture.

`reference.py` builds a token-efficient prompt (~5,200 tokens) that
includes the complete HCC map and E&M codes, with a note that the LLM
may use any valid ICD-10-CM, CPT, or HCPCS code — not just the reference set.

---

## 4. Data model

Six tables, all keyed by UUIDs. An encounter fans out to five
artifacts (one per `kind`); each artifact has an append-only version
history. The first signoff row per artifact freezes it.

```mermaid
erDiagram
  ENCOUNTERS ||--o{ ARTIFACTS : has
  ENCOUNTERS ||--o{ AUDIT_LOG : generates
  ARTIFACTS ||--o{ ARTIFACT_VERSIONS : "append-only"
  ARTIFACTS ||--o| SIGNOFFS : "at most one"
  ARTIFACT_VERSIONS ||--o{ EDITS : "manual edits"
  ARTIFACT_VERSIONS ||--o| SIGNOFFS : "final version"

  ENCOUNTERS {
    uuid id PK
    string patient_ref
    string clinician_ref
    string source_type  "text | audio | sample"
    text   raw_transcript
    json   structured_input
    string status       "created | running | draft | signed"
    datetime created_at
  }
  ARTIFACTS {
    uuid id PK
    uuid encounter_id FK
    string kind  "structured | note | pcp_summary | coding | gaps"
    datetime created_at
  }
  ARTIFACT_VERSIONS {
    uuid id PK
    uuid artifact_id FK
    int  version
    json content
    string created_by  "agent | demo-user | ..."
    string model
    float  confidence
    bool   requires_human_review
    datetime created_at
  }
  EDITS {
    uuid id PK
    uuid version_id FK
    string user_id
    json diff
    datetime created_at
  }
  SIGNOFFS {
    uuid id PK
    uuid artifact_id FK "unique"
    uuid final_version_id FK
    string user_id
    text   comment
    datetime signed_at
  }
  AUDIT_LOG {
    uuid id PK
    uuid encounter_id FK
    string actor
    string action
    json   payload
    datetime created_at
  }
```

Key invariants enforced in code:

- **One signoff per artifact.** `signoffs.artifact_id` is unique; the
  PATCH endpoint refuses to mutate signed artifacts.
- **Encounter status is derived.** `encounter.status` flips to
  `signed` only when every artifact on it has a signoff (enforced both
  per-signoff and via a startup backfill).
- **Every mutation is audited.** Create, run, edit, signoff, and
  override all insert an `audit_log` row.

---

## 5. End-to-end flows

### 5.1 Create encounter + run agents

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant UI as React UI
  participant API as FastAPI
  participant DB as Postgres
  participant G as LangGraph
  participant LLM as UAIS · Azure OpenAI

  User->>UI: Paste transcript · click "Run agents"
  UI->>API: POST /api/encounters  (or /from-sample/{id})
  API->>DB: INSERT encounters (status=created)
  API-->>UI: { id }

  UI->>API: POST /api/encounters/{id}/run  (SSE)
  API->>DB: UPDATE encounters set status=running
  API->>G: build_graph().ainvoke(state)
  loop per node
    G->>LLM: chat.completions
    LLM-->>G: JSON
    G-->>API: emit node_started / node_completed
    API-->>UI: SSE event (live timeline)
  end
  G-->>API: final state (5 artifacts)
  API->>DB: INSERT artifacts + artifact_versions (v1)
  API->>DB: UPDATE encounters set status=draft
  API-->>UI: SSE run_completed
  UI->>UI: navigate(/review/:id)
```

### 5.2 Review, edit, sign off an artifact

```mermaid
sequenceDiagram
  autonumber
  actor Clinician
  participant UI as DraftReview
  participant API as /api/artifacts
  participant DB as Postgres

  Clinician->>UI: edit text area · Save edits
  UI->>API: PATCH /artifacts/{id} { content, reason }
  API->>DB: INSERT artifact_versions (v+1) + edits row + audit_log
  API-->>UI: latest version
  UI-->>Clinician: toast "Edits saved"

  Clinician->>UI: Sign off  (optional comment)
  UI->>API: POST /artifacts/{id}/signoff
  API->>DB: check artifact.signoff IS NULL
  API->>DB: if kind=coding → SELECT gaps WHERE blocks_signoff
  alt high-severity gaps open
    API-->>UI: 412 "signoff blocked by open gaps"
    UI->>Clinician: "Override with comment?"
    Clinician->>UI: confirm
    UI->>API: POST /signoff { override_gaps:true, comment }
  end
  API->>DB: INSERT signoffs + audit_log
  API->>DB: IF all artifacts signed → UPDATE encounters.status='signed'
  API-->>UI: { ok, encounter_signed }
  UI-->>Clinician: toast "Encounter fully signed off"
```

### 5.3 Home page listing — derived "Signed off" bucket

```mermaid
flowchart LR
  UI["Home page<br/>(/intake)"]
  API["GET /api/encounters"]
  DB[(Postgres)]

  UI --> API --> DB
  API -- "each row:<br/>+ artifacts_signed<br/>+ artifacts_total" --> UI

  UI --> Split{{"isFullySigned(e)?"}}
  Split -- "yes<br/>(status==signed<br/> OR signed==total)" --> Signed["Signed off list"]
  Split -- "no" --> Drafts["Drafts in review<br/>(shows X/Y signed)"]
```

The frontend treats an encounter as signed off when **either** its
stored status is `signed` **or** `artifacts_signed === artifacts_total`.
That keeps the UI correct even before the status-flip code has had a
chance to run against older rows.

---

## 6. State lifecycle and snapshots

Snapshots make the DB state portable so a fresh clone gets the same
working data the team has locally.

```mermaid
flowchart TB
  subgraph Startup["FastAPI lifespan()"]
    direction TB
    S1["create_all()<br/>ensure schema"] --> S2["load_state(snapshot.json,<br/>only_if_empty=True)"]
    S2 --> S3["seed_demo_encounters()<br/>insert missing demo rows"]
    S3 --> S4["_backfill_signed_encounters()<br/>promote fully-signed"]
  end

  subgraph Runtime
    direction LR
    UI --> API --> DB[(Postgres)]
  end

  subgraph Ops["Developer ops"]
    direction TB
    Dump["scripts/db_snapshot.sh dump"] --> File["backend/app/data/snapshot.json"]
    File --> Commit["git add + push"]
  end

  File -. "next boot" .-> S2
  DB -. "current state" .-> Dump
```

- `load_state` is a **no-op** when the `encounters` table already has
  rows, so it's safe to call on every startup.
- Snapshots preserve UUIDs, timestamps, version numbers, edit history
  and signoffs. Everything round-trips.

---

## 7. Guardrails and sign-off rules

```mermaid
flowchart TB
  classDef ok fill:#ecfdf5,stroke:#10b981,color:#065f46,rx:8,ry:8;
  classDef warn fill:#fef3c7,stroke:#f59e0b,color:#78350f,rx:8,ry:8;
  classDef bad fill:#fee2e2,stroke:#ef4444,color:#7f1d1d,rx:8,ry:8;

  A["Item produced<br/>by drafter / coding node"]:::ok
  B{"Has evidence<br/>span?"}
  C{"confidence ≥<br/>AGENT_CONFIDENCE_FLOOR<br/>(default 0.7)?"}
  D["Demote → gaps report"]:::bad
  E["requires_human_review = true"]:::warn
  F["Publish as draft"]:::ok

  A --> B
  B -- "no"  --> D
  B -- "yes" --> C
  C -- "no"  --> E --> F
  C -- "yes" --> F
```

Runtime rules applied at sign-off time:

1. **Coding signoff** reads the latest `gaps` artifact. If any gap has
   `blocks_signoff=true` and `override_gaps` was not passed, the API
   returns HTTP 412 with the list of blockers.
2. The clinician can override with a comment — the signoff still
   records `override_gaps=true` in the audit payload.
3. Sign-off cannot replace a sign-off (unique constraint on
   `signoffs.artifact_id`).

---

## 8. Observability / audit log

Every mutating action produces an `audit_log` row. The frontend
`AuditTrail` page calls `GET /api/encounters/{id}/audit` to render a
chronological view.

| `action`                   | Emitted by                   | Payload highlights                              |
|----------------------------|------------------------------|-------------------------------------------------|
| `encounter_created`        | `POST /encounters`           | `source_type`, optional `sample_id`             |
| `run_started`              | Agent runner                 | —                                               |
| `run_completed`            | Agent runner                 | `requires_human_review`, `model`, dropped items |
| `artifact_edited`          | `PATCH /artifacts/{id}`      | `kind`, `version`, `reason`                     |
| `artifact_signed`          | `POST /artifacts/.../signoff`| `kind`, `version`, `override_gaps`, `comment`   |
| `encounter_signed`         | artifacts router + backfill  | `final_artifact_id`, `source` (if backfill)     |
| `demo_encounter_seeded`    | `seed_demo.py`               | `sample_id`                                     |

Combined with `artifact_versions` (append-only content) and `edits`
(diff + user), the audit trail is sufficient to reconstruct the exact
state of any artifact at any moment — the legal basis for "clinician
signed off on version N at time T".

---

## Further reading

- `@/LOCAL_SETUP.md` — copy-pasteable setup instructions for a fresh machine.
- `@/backend/app/agents/` — each node, prompts, and state types.
- `@/backend/app/state_snapshot.py` — dump/load implementation.
- `@/web/src/pages/RunConsole.tsx` — SVG flowchart component driven by SSE.

"""Smoke test: builds the graph and runs it with Azure unconfigured, exercising fallbacks."""
import os

# Leave UAIS vars unset so the graph runs in offline-fallback mode.
for _k in (
    "UAIS_TOKEN_URL",
    "HCP_CLIENT_ID",
    "HCP_CLIENT_SECRETE",
    "UAIS_COMPLETIONS_ENDPOINT",
):
    os.environ.pop(_k, None)
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_pvs.db")

import pytest

from app.agents.graph import build_graph
from app.agents.state import EncounterState
from app.schemas import Diagnosis, EncounterInput, Medication, Vitals


@pytest.mark.asyncio
async def test_graph_runs_with_fallbacks():
    graph = build_graph()
    events = []

    def emit(e):
        events.append(e)

    state: EncounterState = {
        "encounter_id": "test-1",
        "input": EncounterInput(
            transcript="Patient reports elevated blood sugar. Plan: start empagliflozin.",
            vitals=Vitals(bp="148/92", hr=84),
            medications=[Medication(name="metformin", dose="1000 mg", frequency="BID")],
            diagnoses=[Diagnosis(description="Type 2 diabetes", icd10="E11.65")],
            chief_complaint="Elevated sugars",
            care_plan_changes=["Start empagliflozin"],
            followup="6 weeks",
        ),
        "emitter": emit,
        "errors": [],
    }

    final = await graph.ainvoke(state)
    assert "note" in final
    assert "pcp" in final
    assert "coding" in final
    assert "gaps" in final
    assert "guardrail" in final
    started = [e for e in events if e.get("type") == "node_started"]
    completed = [e for e in events if e.get("type") == "node_completed"]
    # intake, structurer, 4 parallel, guardrail = 7
    assert len(started) == 7
    assert len(completed) == 7

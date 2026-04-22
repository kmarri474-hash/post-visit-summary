from __future__ import annotations

from functools import lru_cache

from langgraph.graph import END, START, StateGraph

from . import nodes
from .state import EncounterState


@lru_cache
def build_graph():
    g = StateGraph(EncounterState)
    g.add_node("intake", nodes.node_intake)
    g.add_node("structurer", nodes.node_structurer)
    g.add_node("note_drafter", nodes.node_note)
    g.add_node("pcp_summary", nodes.node_pcp)
    g.add_node("coding", nodes.node_coding)
    g.add_node("gap_detector", nodes.node_gaps)
    g.add_node("guardrail", nodes.node_guardrail)

    g.add_edge(START, "intake")
    g.add_edge("intake", "structurer")
    # Fan-out after structurer
    g.add_edge("structurer", "note_drafter")
    g.add_edge("structurer", "pcp_summary")
    g.add_edge("structurer", "coding")
    g.add_edge("structurer", "gap_detector")
    # Join at guardrail
    g.add_edge("note_drafter", "guardrail")
    g.add_edge("pcp_summary", "guardrail")
    g.add_edge("coding", "guardrail")
    g.add_edge("gap_detector", "guardrail")
    g.add_edge("guardrail", END)
    return g.compile()

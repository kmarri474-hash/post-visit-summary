from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@lru_cache
def icd10() -> list[dict]:
    return json.loads((DATA_DIR / "icd10_seed.json").read_text())


@lru_cache
def cpt() -> list[dict]:
    return json.loads((DATA_DIR / "cpt_seed.json").read_text())


@lru_cache
def hcc_map() -> dict[str, dict]:
    return json.loads((DATA_DIR / "hcc_map.json").read_text())


@lru_cache
def samples() -> list[dict]:
    return json.loads((DATA_DIR / "samples.json").read_text())


def reference_block() -> str:
    lines = ["Reference ICD-10 codes:"]
    for c in icd10():
        hcc = f" [{c['hcc']}]" if c.get("hcc") else ""
        lines.append(f"  {c['code']}: {c['description']}{hcc}")
    lines.append("\nReference CPT codes:")
    for c in cpt():
        lines.append(f"  {c['code']}: {c['description']}")
    lines.append("\nICD-10 -> HCC map:")
    for k, v in hcc_map().items():
        lines.append(f"  {k} -> {v['hcc']} ({v['description']})")
    return "\n".join(lines)

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
    """Build a condensed reference string for LLM prompts.

    Full code databases are available (650+ ICD-10, 385+ CPT, 270+ HCC
    mappings) but we emit a compact summary to keep prompt size manageable.
    The coding prompt instructs the LLM to use any valid code, not just
    those listed here.
    """
    icd_data = icd10()
    cpt_data = cpt()
    hcc_data = hcc_map()

    lines = [
        f"Code database loaded: {len(icd_data)} ICD-10-CM, "
        f"{len(cpt_data)} CPT/HCPCS, {len(hcc_data)} HCC V28 mappings.",
        "",
        "ICD-10-CM chapters covered: " + ", ".join(
            sorted({c["code"][0] for c in icd_data})
        ),
    ]

    # Emit the full HCC map — critical for risk adjustment accuracy
    lines.append("\nICD-10 -> HCC V28 risk-adjustment map (complete):")
    for k, v in hcc_data.items():
        lines.append(f"  {k} -> {v['hcc']} ({v['description']})")

    # Emit E&M codes (always relevant for visit-based encounters)
    lines.append("\nE&M and visit codes:")
    for c in cpt_data:
        if c["code"].startswith("992") or c["code"].startswith("G04") or c["code"].startswith("G02"):
            lines.append(f"  {c['code']}: {c['description']}")

    lines.append(
        "\nNote: Use any valid ICD-10-CM, CPT, or HCPCS code supported by "
        "clinical documentation — the above is a reference subset."
    )
    return "\n".join(lines)

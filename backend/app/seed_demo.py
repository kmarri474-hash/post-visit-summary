"""Idempotent demo seeder: inserts fully-populated encounters with all
artifacts already drafted so a reviewer can open the app and jump straight
into the Draft Review flow without waiting for a live agent run.

Called once from the FastAPI lifespan on startup. Only writes rows whose
fixed IDs don't already exist, so restarts are safe.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select

from .agents.reference import samples as sample_list
from .db import SessionLocal
from .models import Artifact, ArtifactVersion, AuditLog, Encounter

log = logging.getLogger(__name__)


# ---- Canned artifact content -----------------------------------------------

def _dm2_htn_artifacts() -> dict[str, dict[str, Any]]:
    EV_TRANSCRIPT = "transcript"
    EV_STRUCTURED = "structured"

    ev = lambda q, s=EV_TRANSCRIPT: {"source": s, "quote": q}  # noqa: E731

    return {
        "structured": {
            "chief_complaint": "Elevated home glucose readings and nocturia",
            "hpi": (
                "Mr. Alvarez returns for diabetes and hypertension follow-up. "
                "Reports fasting glucose 180-210, polydipsia, and nocturia. "
                "Adherent to metformin 1000 mg BID; missed lisinopril doses last week. "
                "BP today 148/92, A1c 8.9%, weight up 3 lb."
            ),
            "problems": [
                {"name": "Type 2 diabetes mellitus with hyperglycemia", "status": "uncontrolled",
                 "evidence": [ev("sugars have been running high in the mornings, 180 to 210"),
                              ev("A1c from last week came back at 8.9%")]},
                {"name": "Essential hypertension", "status": "suboptimally controlled",
                 "evidence": [ev("blood pressure today is 148 over 92"),
                              ev("I did miss lisinopril a couple of times last week")]},
                {"name": "Medication nonadherence (lisinopril)", "status": "active",
                 "evidence": [ev("I did miss lisinopril a couple of times last week")]},
                {"name": "Weight gain", "status": "active",
                 "evidence": [ev("Weight is up three pounds")]},
            ],
            "medications": [
                {"name": "metformin", "dose": "1000 mg", "frequency": "BID", "status": "active"},
                {"name": "lisinopril", "dose": "20 mg", "frequency": "daily", "status": "changed"},
                {"name": "empagliflozin", "dose": "10 mg", "frequency": "daily", "status": "new"},
            ],
            "vitals": {"bp": "148/92", "hr": 84, "temp_f": 98.4, "weight_lb": 202},
            "assessments": ["Uncontrolled T2DM, A1c 8.9%", "Hypertension, suboptimally controlled"],
            "care_plan_changes": ["Start empagliflozin 10 mg daily", "Increase lisinopril to 20 mg daily"],
            "orders": ["Basic metabolic panel", "Urine microalbumin", "Repeat A1c in 3 months"],
            "referrals": ["Nutrition: diabetes diet review"],
            "followup": "Return in 6 weeks",
        },
        "note": {
            "subjective": (
                "53-year-old male with T2DM and HTN presents for follow-up. Reports AM glucose "
                "180-210 mg/dL, polydipsia, and nocturia. Adherent to metformin; missed several "
                "lisinopril doses last week. Denies chest pain, SOB, vision changes, neuropathic "
                "symptoms, or hypoglycemia."
            ),
            "objective": (
                "Vitals: BP 148/92, HR 84, Temp 98.4°F, Wt 202 lb (↑3 lb). A1c 8.9% (last week). "
                "General: well-appearing, no acute distress. Focused exam unremarkable."
            ),
            "assessment": (
                "1) Type 2 diabetes mellitus, uncontrolled (E11.65) — A1c 8.9%, symptomatic "
                "hyperglycemia. 2) Essential hypertension (I10) — suboptimal control with recent "
                "adherence lapse. 3) Overweight — 3 lb interval gain."
            ),
            "plan": (
                "• Start empagliflozin 10 mg PO daily; counseled on euglycemic DKA, GU infection, "
                "and volume-status precautions.\n"
                "• Increase lisinopril to 20 mg daily; adherence counseling.\n"
                "• Labs today: BMP, urine microalbumin.\n"
                "• Nutrition referral for diabetes diet review.\n"
                "• Follow-up in 6 weeks for BP/adherence; repeat A1c in 3 months."
            ),
            "evidence": [
                ev("sugars have been running high in the mornings, 180 to 210"),
                ev("blood pressure today is 148 over 92, heart rate 84"),
                ev("A1c from last week came back at 8.9%"),
                ev("start you on empagliflozin 10 mg daily and increase lisinopril to 20 mg daily"),
            ],
        },
        "pcp_summary": {
            "greeting": "Hello Dr. Smith,",
            "reason_for_visit": "Follow-up for T2DM and HTN, both uncontrolled at today's visit.",
            "key_findings": (
                "A1c 8.9% with symptomatic AM hyperglycemia (180-210). BP 148/92. Reports missed "
                "lisinopril doses last week. Weight up 3 lb."
            ),
            "changes_made": (
                "Started empagliflozin 10 mg daily and increased lisinopril to 20 mg daily. "
                "Counseled on SGLT2 precautions and adherence."
            ),
            "actions_for_pcp": [
                "Review BMP and urine microalbumin results when available",
                "Reinforce medication adherence at next encounter",
                "Consider CGM or home BP log if control remains suboptimal",
                "Repeat A1c in 3 months; titrate regimen as needed",
            ],
            "followup": "Patient to return in 6 weeks.",
            "closing": "Thank you for co-managing this patient. — Dr. Lee",
        },
        "coding": {
            "icd10": [
                {"code": "E11.65", "description": "Type 2 diabetes mellitus with hyperglycemia",
                 "rationale": "Documented A1c 8.9% with symptomatic hyperglycemia.",
                 "confidence": 0.95,
                 "evidence": [ev("A1c from last week came back at 8.9%"),
                              ev("sugars have been running high in the mornings, 180 to 210")]},
                {"code": "I10", "description": "Essential (primary) hypertension",
                 "rationale": "Elevated in-office BP with established diagnosis.",
                 "confidence": 0.9,
                 "evidence": [ev("blood pressure today is 148 over 92")]},
            ],
            "cpt": [
                {"code": "99214", "description": "Office visit, established patient, moderate MDM",
                 "rationale": "Two chronic conditions, one uncontrolled; Rx management; labs ordered.",
                 "confidence": 0.85, "evidence": [ev("uncontrolled T2DM, A1c 8.9%", EV_STRUCTURED)]},
                {"code": "36415", "description": "Routine venipuncture",
                 "rationale": "BMP drawn in office.", "confidence": 0.8,
                 "evidence": [ev("Basic metabolic panel", EV_STRUCTURED)]},
                {"code": "81003", "description": "Urinalysis by dipstick (automated)",
                 "rationale": "Urine microalbumin screening.", "confidence": 0.7,
                 "evidence": [ev("Urine microalbumin", EV_STRUCTURED)]},
            ],
            "em_level": {
                "code": "99214", "description": "Level 4 established patient",
                "rationale": ("Moderate MDM: 2+ chronic illnesses with 1 uncontrolled; new medication "
                              "with monitoring; moderate risk from SGLT2 initiation."),
                "confidence": 0.85,
                "evidence": [ev("start you on empagliflozin 10 mg daily")],
            },
            "hcc": [
                {"icd10": "E11.65", "hcc_category": "HCC 18",
                 "description": "Diabetes with chronic complications",
                 "rationale": "Hyperglycemia with documented uncontrolled A1c.",
                 "confidence": 0.8,
                 "evidence": [ev("A1c from last week came back at 8.9%")]},
            ],
        },
        "gaps": {
            "gaps": [
                {"field": "Baseline renal function (eGFR/Cr) prior to SGLT2",
                 "why_it_matters": "SGLT2 inhibitors require baseline renal evaluation; missing documentation.",
                 "severity": "high", "blocks_signoff": True},
                {"field": "Allergies",
                 "why_it_matters": "Drug allergy status not documented before prescribing new medication.",
                 "severity": "high", "blocks_signoff": True},
                {"field": "Medication reconciliation: prior lisinopril dose",
                 "why_it_matters": "Prior dose needed to document titration.",
                 "severity": "medium", "blocks_signoff": False},
                {"field": "Smoking / alcohol history",
                 "why_it_matters": "Relevant to CV risk and diabetes management.",
                 "severity": "low", "blocks_signoff": False},
                {"field": "Foot exam",
                 "why_it_matters": "Annual diabetic foot exam not documented.",
                 "severity": "medium", "blocks_signoff": False},
            ]
        },
    }


def _chf_artifacts() -> dict[str, dict[str, Any]]:
    ev = lambda q, s="transcript": {"source": s, "quote": q}  # noqa: E731
    return {
        "structured": {
            "chief_complaint": "Worsening dyspnea and lower-extremity edema",
            "hpi": (
                "68-year-old female with HFrEF (EF 35%) returns with 5 lb weight gain, increased "
                "orthopnea, and bilateral pedal edema over the past week. Missed last two doses of "
                "torsemide."
            ),
            "problems": [
                {"name": "Acute on chronic systolic heart failure (HFrEF) exacerbation",
                 "status": "active",
                 "evidence": [ev("I've been more short of breath and my legs are swollen"),
                              ev("gained about 5 pounds in the last week")]},
                {"name": "Volume overload", "status": "active",
                 "evidence": [ev("legs are swollen"), ev("lying flat makes it worse")]},
            ],
            "medications": [
                {"name": "torsemide", "dose": "40 mg", "frequency": "daily", "status": "changed"},
                {"name": "carvedilol", "dose": "12.5 mg", "frequency": "BID", "status": "active"},
                {"name": "sacubitril/valsartan", "dose": "49/51 mg", "frequency": "BID", "status": "active"},
            ],
            "vitals": {"bp": "118/72", "hr": 96, "temp_f": 98.1, "weight_lb": 178, "spo2": 94},
            "assessments": ["Acute on chronic HFrEF exacerbation, likely diuretic nonadherence"],
            "care_plan_changes": ["Increase torsemide to 60 mg daily x 3 days, then 40 mg daily",
                                  "Daily weights with threshold of +3 lb to call"],
            "orders": ["BMP", "BNP", "Chest X-ray"],
            "referrals": ["Heart failure clinic within 1 week"],
            "followup": "Phone check in 3 days; in-person in 1 week",
        },
        "note": {
            "subjective": (
                "68-year-old female with HFrEF (EF 35%) reports progressive dyspnea on exertion, "
                "2-pillow orthopnea, and bilateral leg swelling over 1 week. Gained 5 lb. Missed "
                "two torsemide doses. Denies chest pain, syncope, or palpitations."
            ),
            "objective": (
                "Vitals: BP 118/72, HR 96, SpO2 94% on RA, Wt 178 lb (↑5). JVP ~10 cm. Bibasilar "
                "crackles. 2+ pitting edema to mid-shin bilaterally. Regular rate and rhythm."
            ),
            "assessment": (
                "1) Acute on chronic HFrEF exacerbation (I50.23) — volume overload with presumed "
                "diuretic nonadherence as trigger; stable BP and oxygenation."
            ),
            "plan": (
                "• Increase torsemide to 60 mg daily for 3 days, then resume 40 mg.\n"
                "• Continue GDMT: carvedilol, sacubitril/valsartan.\n"
                "• Labs: BMP, BNP; CXR.\n"
                "• Daily weights; call if +3 lb in 24h or +5 lb in a week.\n"
                "• HF clinic referral; phone check in 3 days; in-person follow-up in 1 week."
            ),
            "evidence": [
                ev("gained about 5 pounds in the last week"),
                ev("I've been more short of breath and my legs are swollen"),
                ev("I missed the last two water pills"),
            ],
        },
        "pcp_summary": {
            "greeting": "Hello Dr. Chen,",
            "reason_for_visit": "Your patient was seen for worsening HFrEF symptoms.",
            "key_findings": "5-lb weight gain, orthopnea, 2+ pedal edema. SpO2 94% RA. Clinical volume overload.",
            "changes_made": "Temporary torsemide bump (60 mg x 3 days → 40 mg). Labs and CXR ordered. HF clinic referral placed.",
            "actions_for_pcp": [
                "Review BMP (electrolytes post-diuresis) when available",
                "Reinforce adherence — missed diuretic doses likely trigger",
                "Co-manage dose titration with HF clinic",
            ],
            "followup": "Phone check in 3 days; in-person in 1 week.",
            "closing": "Thanks for your continued partnership. — Dr. Patel",
        },
        "coding": {
            "icd10": [
                {"code": "I50.23", "description": "Acute on chronic systolic (congestive) heart failure",
                 "rationale": "Documented HFrEF exacerbation with clinical volume overload.",
                 "confidence": 0.92,
                 "evidence": [ev("gained about 5 pounds in the last week"),
                              ev("I've been more short of breath and my legs are swollen")]},
            ],
            "cpt": [
                {"code": "99214", "description": "Office visit, established patient, moderate MDM",
                 "rationale": "Complex chronic condition with acute exacerbation; Rx titration; labs ordered.",
                 "confidence": 0.88, "evidence": [ev("HFrEF exacerbation", "structured")]},
                {"code": "71046", "description": "Chest X-ray, 2 views",
                 "rationale": "Ordered today for evaluation of volume status.",
                 "confidence": 0.85, "evidence": [ev("Chest X-ray", "structured")]},
            ],
            "em_level": {
                "code": "99214", "description": "Level 4 established patient",
                "rationale": "Moderate MDM: acute exacerbation of chronic systemic illness, medication management, ordered tests.",
                "confidence": 0.85,
                "evidence": [ev("Increase torsemide to 60 mg daily", "structured")],
            },
            "hcc": [
                {"icd10": "I50.23", "hcc_category": "HCC 85",
                 "description": "Congestive heart failure",
                 "rationale": "Active CHF exacerbation documented.",
                 "confidence": 0.9,
                 "evidence": [ev("I've been more short of breath")]},
            ],
        },
        "gaps": {
            "gaps": [
                {"field": "Serum potassium at this visit",
                 "why_it_matters": "Required before escalating loop diuretic with ARNi onboard.",
                 "severity": "high", "blocks_signoff": True},
                {"field": "Baseline home BP log",
                 "why_it_matters": "Informs safety of further diuresis given BP 118/72.",
                 "severity": "medium", "blocks_signoff": False},
                {"field": "NYHA functional class",
                 "why_it_matters": "Not explicitly documented; required for HF quality reporting.",
                 "severity": "medium", "blocks_signoff": False},
            ]
        },
    }


DEMOS = [
    {
        "sample_id": "sample-dm2-htn",
        "encounter_id": "demo-dm2-htn",
        "artifacts": _dm2_htn_artifacts,
        "confidences": {"structured": 0.88, "note": 0.9, "pcp_summary": 0.88,
                        "coding": 0.84, "gaps": 0.82},
    },
    {
        "sample_id": "sample-chf",
        "encounter_id": "demo-chf",
        "artifacts": _chf_artifacts,
        "confidences": {"structured": 0.9, "note": 0.92, "pcp_summary": 0.9,
                        "coding": 0.87, "gaps": 0.85},
    },
]


async def seed_demo_encounters() -> None:
    """Insert demo encounters if they don't already exist. Idempotent."""
    async with SessionLocal() as session:
        for demo in DEMOS:
            enc_id = demo["encounter_id"]
            existing = await session.execute(select(Encounter).where(Encounter.id == enc_id))
            if existing.scalar_one_or_none():
                continue

            sample = next((s for s in sample_list() if s["id"] == demo["sample_id"]), None)
            if not sample:
                log.warning("demo seeder: sample %s missing, skipping", demo["sample_id"])
                continue

            enc = Encounter(
                id=enc_id,
                patient_ref=sample["patient_ref"],
                clinician_ref=sample["clinician_ref"],
                source_type="sample",
                raw_transcript=sample.get("transcript", ""),
                structured_input=sample.get("structured_input", {}),
                status="draft",
            )
            session.add(enc)

            artifacts = demo["artifacts"]()
            confs = demo["confidences"]
            for kind, content in artifacts.items():
                art = Artifact(encounter_id=enc_id, kind=kind)
                session.add(art)
                await session.flush()
                version = ArtifactVersion(
                    artifact_id=art.id,
                    version=1,
                    content=content,
                    created_by="demo-seed",
                    model="demo",
                    prompt_hash="demo",
                    confidence=confs.get(kind, 0.85),
                    requires_human_review=False,
                )
                session.add(version)

            session.add(AuditLog(
                encounter_id=enc_id,
                actor="demo-seed",
                action="demo_encounter_seeded",
                payload={"sample_id": demo["sample_id"]},
            ))
            log.info("seeded demo encounter %s (%s)", enc_id, demo["sample_id"])

        await session.commit()

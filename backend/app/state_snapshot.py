"""Portable DB state snapshots.

Exports every row from the core tables (encounters, artifacts, versions,
edits, signoffs, audit_log) to a single JSON file, and can re-import that
file into an empty database. Enables a fresh clone of the project to
bootstrap with the same encounters / signoffs as an existing dev machine
without requiring a full SQL dump or Alembic history.

Usage:
    python -m backend.app.state_snapshot dump --out backend/app/data/snapshot.json
    python -m backend.app.state_snapshot load --in  backend/app/data/snapshot.json

Or from code:
    await dump_state(Path("snapshot.json"))
    await load_state(Path("snapshot.json"), only_if_empty=True)
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select

from .db import session_scope
from .models import Artifact, ArtifactVersion, AuditLog, Edit, Encounter, Signoff

log = logging.getLogger("pvs.snapshot")

SNAPSHOT_VERSION = 1
DEFAULT_PATH = Path(__file__).resolve().parent / "data" / "snapshot.json"


def _iso(v: datetime | None) -> str | None:
    return v.isoformat() if v else None


def _parse_dt(v: str | None) -> datetime | None:
    return datetime.fromisoformat(v) if v else None


# ---------------------------------------------------------------------------
# Dump
# ---------------------------------------------------------------------------

async def dump_state(path: Path = DEFAULT_PATH) -> dict[str, int]:
    """Write every row from the core tables to a JSON file.

    Returns a small summary dict of counts per table.
    """
    from sqlalchemy.orm import selectinload

    async with session_scope() as s:
        encounters = (await s.execute(
            select(Encounter).options(
                selectinload(Encounter.artifacts).selectinload(Artifact.versions).selectinload(ArtifactVersion.edits),
                selectinload(Encounter.artifacts).selectinload(Artifact.signoff),
                selectinload(Encounter.audit_events),
            )
        )).scalars().all()

        payload: dict[str, Any] = {
            "snapshot_version": SNAPSHOT_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "encounters": [],
        }
        counts = {"encounters": 0, "artifacts": 0, "versions": 0, "edits": 0,
                  "signoffs": 0, "audit_log": 0}

        for enc in encounters:
            counts["encounters"] += 1
            artifacts_out: list[dict[str, Any]] = []
            for a in enc.artifacts:
                counts["artifacts"] += 1
                versions_out: list[dict[str, Any]] = []
                for v in sorted(a.versions, key=lambda x: x.version):
                    counts["versions"] += 1
                    edits_out = []
                    for e in v.edits:
                        counts["edits"] += 1
                        edits_out.append({
                            "id": e.id, "version_id": e.version_id,
                            "user_id": e.user_id, "diff": e.diff,
                            "created_at": _iso(e.created_at),
                        })
                    versions_out.append({
                        "id": v.id, "artifact_id": v.artifact_id,
                        "version": v.version, "content": v.content,
                        "created_by": v.created_by, "model": v.model,
                        "prompt_hash": v.prompt_hash, "confidence": v.confidence,
                        "requires_human_review": v.requires_human_review,
                        "created_at": _iso(v.created_at),
                        "edits": edits_out,
                    })
                signoff_out = None
                if a.signoff is not None:
                    counts["signoffs"] += 1
                    signoff_out = {
                        "id": a.signoff.id, "artifact_id": a.signoff.artifact_id,
                        "user_id": a.signoff.user_id,
                        "final_version_id": a.signoff.final_version_id,
                        "comment": a.signoff.comment,
                        "signed_at": _iso(a.signoff.signed_at),
                    }
                artifacts_out.append({
                    "id": a.id, "encounter_id": a.encounter_id, "kind": a.kind,
                    "created_at": _iso(a.created_at),
                    "versions": versions_out,
                    "signoff": signoff_out,
                })
            audit_out = []
            for ev in enc.audit_events:
                counts["audit_log"] += 1
                audit_out.append({
                    "id": ev.id, "encounter_id": ev.encounter_id,
                    "actor": ev.actor, "action": ev.action,
                    "payload": ev.payload, "created_at": _iso(ev.created_at),
                })
            payload["encounters"].append({
                "id": enc.id, "patient_ref": enc.patient_ref,
                "clinician_ref": enc.clinician_ref, "source_type": enc.source_type,
                "raw_transcript": enc.raw_transcript,
                "structured_input": enc.structured_input,
                "status": enc.status, "created_at": _iso(enc.created_at),
                "artifacts": artifacts_out, "audit_log": audit_out,
            })

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str))
    log.info("snapshot written to %s (%s)", path, counts)
    return counts


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------

async def load_state(
    path: Path = DEFAULT_PATH,
    *,
    only_if_empty: bool = True,
) -> dict[str, int]:
    """Insert rows from the JSON snapshot back into the DB.

    When ``only_if_empty`` is true (default), this is a no-op if any
    encounter already exists — safe to call on every startup.
    """
    if not path.exists():
        log.info("no snapshot file at %s; skipping load", path)
        return {"loaded": 0}

    data = json.loads(path.read_text())
    if data.get("snapshot_version") != SNAPSHOT_VERSION:
        log.warning("snapshot version mismatch (%s vs %s); skipping",
                    data.get("snapshot_version"), SNAPSHOT_VERSION)
        return {"loaded": 0}

    async with session_scope() as s:
        if only_if_empty:
            existing = (await s.execute(select(Encounter.id).limit(1))).first()
            if existing:
                log.info("encounters already present; snapshot load skipped")
                return {"loaded": 0}

        counts = {"encounters": 0, "artifacts": 0, "versions": 0, "edits": 0,
                  "signoffs": 0, "audit_log": 0}

        for enc_row in data.get("encounters", []):
            enc = Encounter(
                id=enc_row["id"],
                patient_ref=enc_row["patient_ref"],
                clinician_ref=enc_row["clinician_ref"],
                source_type=enc_row["source_type"],
                raw_transcript=enc_row.get("raw_transcript", ""),
                structured_input=enc_row.get("structured_input") or {},
                status=enc_row.get("status", "created"),
                created_at=_parse_dt(enc_row.get("created_at")),
            )
            s.add(enc)
            counts["encounters"] += 1

            for a_row in enc_row.get("artifacts", []):
                art = Artifact(
                    id=a_row["id"],
                    encounter_id=a_row["encounter_id"],
                    kind=a_row["kind"],
                    created_at=_parse_dt(a_row.get("created_at")),
                )
                s.add(art)
                counts["artifacts"] += 1

                for v_row in a_row.get("versions", []):
                    ver = ArtifactVersion(
                        id=v_row["id"],
                        artifact_id=v_row["artifact_id"],
                        version=v_row["version"],
                        content=v_row.get("content") or {},
                        created_by=v_row.get("created_by", "agent"),
                        model=v_row.get("model", ""),
                        prompt_hash=v_row.get("prompt_hash", ""),
                        confidence=v_row.get("confidence", 0.0),
                        requires_human_review=v_row.get("requires_human_review", False),
                        created_at=_parse_dt(v_row.get("created_at")),
                    )
                    s.add(ver)
                    counts["versions"] += 1
                    for e_row in v_row.get("edits", []):
                        s.add(Edit(
                            id=e_row["id"], version_id=e_row["version_id"],
                            user_id=e_row["user_id"], diff=e_row.get("diff") or {},
                            created_at=_parse_dt(e_row.get("created_at")),
                        ))
                        counts["edits"] += 1

                so = a_row.get("signoff")
                if so:
                    s.add(Signoff(
                        id=so["id"], artifact_id=so["artifact_id"],
                        user_id=so["user_id"],
                        final_version_id=so["final_version_id"],
                        comment=so.get("comment", ""),
                        signed_at=_parse_dt(so.get("signed_at")),
                    ))
                    counts["signoffs"] += 1

            for ev_row in enc_row.get("audit_log", []):
                s.add(AuditLog(
                    id=ev_row["id"], encounter_id=ev_row["encounter_id"],
                    actor=ev_row["actor"], action=ev_row["action"],
                    payload=ev_row.get("payload") or {},
                    created_at=_parse_dt(ev_row.get("created_at")),
                ))
                counts["audit_log"] += 1

    log.info("snapshot loaded from %s (%s)", path, counts)
    return counts


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Dump or load a DB state snapshot")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_dump = sub.add_parser("dump", help="Export current DB to JSON")
    p_dump.add_argument("--out", type=Path, default=DEFAULT_PATH)
    p_load = sub.add_parser("load", help="Import JSON back into the DB")
    p_load.add_argument("--in", dest="src", type=Path, default=DEFAULT_PATH)
    p_load.add_argument("--force", action="store_true",
                        help="Load even if the DB already has encounters")

    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    if args.cmd == "dump":
        counts = asyncio.run(dump_state(args.out))
        print(json.dumps({"path": str(args.out), "counts": counts}, indent=2))
    else:
        counts = asyncio.run(load_state(args.src, only_if_empty=not args.force))
        print(json.dumps({"path": str(args.src), "counts": counts}, indent=2))


if __name__ == "__main__":
    _main()

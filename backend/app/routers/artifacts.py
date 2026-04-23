from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db import get_session
from ..models import Artifact, ArtifactVersion, AuditLog, Edit, Encounter, Signoff
from ..schemas import ArtifactPatch, ArtifactVersionOut, SignoffRequest

router = APIRouter(prefix="/api/artifacts", tags=["artifacts"])


async def _load_artifact(artifact_id: str, session: AsyncSession) -> Artifact:
    a = (await session.execute(
        select(Artifact).where(Artifact.id == artifact_id)
        .options(selectinload(Artifact.versions), selectinload(Artifact.signoff))
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "artifact not found")
    return a


@router.get("/{artifact_id}")
async def get_artifact(artifact_id: str, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    a = await _load_artifact(artifact_id, session)
    versions = sorted(a.versions, key=lambda v: v.version)
    return {
        "id": a.id,
        "encounter_id": a.encounter_id,
        "kind": a.kind,
        "signed": a.signoff is not None,
        "versions": [ArtifactVersionOut.model_validate(v).model_dump() for v in versions],
    }


@router.patch("/{artifact_id}")
async def patch_artifact(
    artifact_id: str,
    body: ArtifactPatch,
    session: AsyncSession = Depends(get_session),
    x_user_id: str = Header(default="demo-user"),
) -> dict[str, Any]:
    a = await _load_artifact(artifact_id, session)
    if a.signoff is not None:
        raise HTTPException(409, "artifact already signed off")
    latest = max(a.versions, key=lambda v: v.version) if a.versions else None
    next_version = (latest.version + 1) if latest else 1
    new_version = ArtifactVersion(
        artifact_id=a.id,
        version=next_version,
        content=body.content,
        created_by=x_user_id,
        model=latest.model if latest else "",
        confidence=latest.confidence if latest else 0.0,
        requires_human_review=latest.requires_human_review if latest else False,
    )
    session.add(new_version)
    await session.flush()
    session.add(Edit(
        version_id=new_version.id,
        user_id=x_user_id,
        diff={"reason": body.reason, "prev_version": latest.version if latest else None},
    ))
    session.add(AuditLog(
        encounter_id=a.encounter_id, actor=x_user_id, action="artifact_edited",
        payload={"artifact_id": a.id, "kind": a.kind, "version": next_version, "reason": body.reason},
    ))
    await session.commit()
    return ArtifactVersionOut.model_validate(new_version).model_dump()


@router.post("/{artifact_id}/signoff")
async def signoff_artifact(
    artifact_id: str,
    body: SignoffRequest,
    session: AsyncSession = Depends(get_session),
    x_user_id: str = Header(default="demo-user"),
) -> dict[str, Any]:
    a = await _load_artifact(artifact_id, session)
    if a.signoff is not None:
        raise HTTPException(409, "already signed")
    if not a.versions:
        raise HTTPException(400, "no versions to sign")

    # Enforce gap-blocking guardrail at signoff time (coding artifact only).
    if a.kind == "coding" and not body.override_gaps:
        gaps_art = (await session.execute(
            select(Artifact).where(Artifact.encounter_id == a.encounter_id, Artifact.kind == "gaps")
            .options(selectinload(Artifact.versions))
        )).scalar_one_or_none()
        if gaps_art and gaps_art.versions:
            latest_gaps = max(gaps_art.versions, key=lambda v: v.version).content or {}
            blockers = [g for g in (latest_gaps.get("gaps") or []) if g.get("blocks_signoff")]
            if blockers:
                raise HTTPException(
                    status_code=412,
                    detail={
                        "error": "signoff blocked by open high-severity gaps",
                        "blockers": blockers,
                        "hint": "resolve the gaps or pass override_gaps=true with a comment",
                    },
                )

    latest = max(a.versions, key=lambda v: v.version)
    so = Signoff(
        artifact_id=a.id,
        user_id=x_user_id,
        final_version_id=latest.id,
        comment=body.comment,
    )
    session.add(so)
    session.add(AuditLog(
        encounter_id=a.encounter_id, actor=x_user_id, action="artifact_signed",
        payload={"artifact_id": a.id, "kind": a.kind, "version": latest.version,
                 "override_gaps": body.override_gaps, "comment": body.comment},
    ))
    await session.flush()

    # Capture values we need for the response before expiring the session
    # cache (async SQLAlchemy doesn't support lazy loads after expire).
    signed_at_iso = so.signed_at.isoformat()
    final_version = latest.version
    artifact_id = a.id
    artifact_kind = a.kind
    encounter_id = a.encounter_id

    # If every artifact for this encounter now has a signoff, promote the
    # encounter to "signed" so the home page can bucket it separately.
    # Expire cached identity-map objects so selectinload re-fetches signoffs
    # (needed because expire_on_commit=False keeps stale `signoff=None`).
    session.expire_all()
    enc = (await session.execute(
        select(Encounter).where(Encounter.id == encounter_id)
        .options(selectinload(Encounter.artifacts).selectinload(Artifact.signoff))
    )).scalar_one_or_none()
    encounter_signed = False
    if enc and enc.artifacts and all(art.signoff is not None for art in enc.artifacts):
        enc.status = "signed"
        encounter_signed = True
        session.add(AuditLog(
            encounter_id=enc.id, actor=x_user_id, action="encounter_signed",
            payload={"final_artifact_id": artifact_id, "final_kind": artifact_kind},
        ))

    await session.commit()
    return {
        "ok": True,
        "signed_at": signed_at_iso,
        "final_version": final_version,
        "encounter_signed": encounter_signed,
    }

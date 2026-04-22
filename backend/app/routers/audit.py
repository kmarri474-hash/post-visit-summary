from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import AuditLog
from ..schemas import AuditEventOut

router = APIRouter(prefix="/api", tags=["audit"])


@router.get("/encounters/{encounter_id}/audit", response_model=list[AuditEventOut])
async def encounter_audit(encounter_id: str, session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(AuditLog).where(AuditLog.encounter_id == encounter_id).order_by(AuditLog.created_at.asc())
    )).scalars().all()
    return [AuditEventOut.model_validate(r) for r in rows]

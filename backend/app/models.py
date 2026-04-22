from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Encounter(Base):
    __tablename__ = "encounters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    patient_ref: Mapped[str] = mapped_column(String(120))
    clinician_ref: Mapped[str] = mapped_column(String(120))
    source_type: Mapped[str] = mapped_column(String(32), default="text")  # text | audio | sample
    raw_transcript: Mapped[str] = mapped_column(Text, default="")
    structured_input: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="created")  # created|running|draft|signed
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    artifacts: Mapped[list["Artifact"]] = relationship(back_populates="encounter", cascade="all, delete-orphan")
    audit_events: Mapped[list["AuditLog"]] = relationship(back_populates="encounter", cascade="all, delete-orphan")


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    encounter_id: Mapped[str] = mapped_column(ForeignKey("encounters.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))  # note|pcp_summary|coding|gaps|problems|orders|referrals|structured
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    encounter: Mapped[Encounter] = relationship(back_populates="artifacts")
    versions: Mapped[list["ArtifactVersion"]] = relationship(
        back_populates="artifact", cascade="all, delete-orphan", order_by="ArtifactVersion.version"
    )
    signoff: Mapped[Optional["Signoff"]] = relationship(back_populates="artifact", uselist=False, cascade="all, delete-orphan")


class ArtifactVersion(Base):
    __tablename__ = "artifact_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_by: Mapped[str] = mapped_column(String(120), default="agent")
    model: Mapped[str] = mapped_column(String(120), default="")
    prompt_hash: Mapped[str] = mapped_column(String(64), default="")
    confidence: Mapped[float] = mapped_column(default=0.0)
    requires_human_review: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    artifact: Mapped[Artifact] = relationship(back_populates="versions")
    edits: Mapped[list["Edit"]] = relationship(back_populates="version", cascade="all, delete-orphan")


class Edit(Base):
    __tablename__ = "edits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    version_id: Mapped[str] = mapped_column(ForeignKey("artifact_versions.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(120))
    diff: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    version: Mapped[ArtifactVersion] = relationship(back_populates="edits")


class Signoff(Base):
    __tablename__ = "signoffs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id", ondelete="CASCADE"), unique=True)
    user_id: Mapped[str] = mapped_column(String(120))
    final_version_id: Mapped[str] = mapped_column(ForeignKey("artifact_versions.id"))
    comment: Mapped[str] = mapped_column(Text, default="")
    signed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    artifact: Mapped[Artifact] = relationship(back_populates="signoff")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    encounter_id: Mapped[str] = mapped_column(ForeignKey("encounters.id", ondelete="CASCADE"), index=True)
    actor: Mapped[str] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    encounter: Mapped[Encounter] = relationship(back_populates="audit_events")

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from backend.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)
    email_verified_at: Mapped[str | None] = mapped_column(String(40))
    verification_token_hash: Mapped[str | None] = mapped_column(String(64))
    verification_expires_at: Mapped[str | None] = mapped_column(String(40))
    reset_token_hash: Mapped[str | None] = mapped_column(String(64))
    reset_expires_at: Mapped[str | None] = mapped_column(String(40))
    session_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (Index("uq_users_email_lower", func.lower(email), unique=True),)


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    date: Mapped[str] = mapped_column(String(40), nullable=False)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    category: Mapped[str] = mapped_column(String(50), nullable=False, default="General")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    topics: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    decisions: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    action_items: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    transcript_segments: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    raw_transcript: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="completed")
    provider_used: Mapped[str | None] = mapped_column(String(40))
    storage_key: Mapped[str | None] = mapped_column(Text)
    audio_path: Mapped[str | None] = mapped_column(Text)
    mime_type: Mapped[str | None] = mapped_column(String(120))
    error: Mapped[str | None] = mapped_column(Text)
    quota_month: Mapped[str | None] = mapped_column(String(7))
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(40), nullable=False)

    __table_args__ = (
        CheckConstraint("status IN ('saved','processing','completed','failed')", name="ck_meetings_status"),
        Index("meetings_by_user_date", "user_id", date.desc()),
    )


class Usage(Base):
    __tablename__ = "usage"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    month: Mapped[str] = mapped_column(String(7), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

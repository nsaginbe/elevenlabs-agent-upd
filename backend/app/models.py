from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class TrainingSession(Base):
    __tablename__ = "training_sessions"

    id = Column(Integer, primary_key=True, index=True)
    manager_name = Column(String, index=True, nullable=False)
    session_start = Column(DateTime, default=datetime.now(timezone.utc))
    session_end = Column(DateTime, nullable=True)
    conversation_log = Column(Text, nullable=True)
    ai_analysis = Column(Text, nullable=True)
    score = Column(Float, nullable=True)
    feedback = Column(Text, nullable=True)
    status = Column(String, default="active")
    product_description = Column(Text, nullable=True)
    difficulty_level = Column(String, nullable=True)
    client_type = Column(String, nullable=True)
    first_message = Column(Text, nullable=True)
    session_system_prompt = Column(Text, nullable=True)
    signed_ws_url = Column(Text, nullable=True)
    conversation_id = Column(String, nullable=True)


def create_tables(engine) -> None:
    Base.metadata.create_all(bind=engine)


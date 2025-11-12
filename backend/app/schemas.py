from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class TrainerSettings(BaseModel):
    product_description: Optional[str] = None
    difficulty_level: Optional[str] = None
    client_type: Optional[str] = None
    first_message: Optional[str] = None


class TrainingSessionCreate(BaseModel):
    manager_name: str
    product_description: Optional[str] = None
    difficulty_level: Optional[str] = None
    client_type: Optional[str] = None
    first_message: Optional[str] = None


class TrainingSessionUpdate(BaseModel):
    manager_name: Optional[str] = None
    product_description: Optional[str] = None
    difficulty_level: Optional[str] = None
    client_type: Optional[str] = None
    first_message: Optional[str] = None
    conversation_log: Optional[str] = None
    ai_analysis: Optional[str] = None
    score: Optional[float] = None
    feedback: Optional[str] = None
    status: Optional[str] = None
    session_end: Optional[datetime] = None
    session_system_prompt: Optional[str] = None
    signed_ws_url: Optional[str] = None
    conversation_id: Optional[str] = None


class TrainingSessionResponse(BaseModel):
    id: int
    manager_name: str
    session_start: datetime
    session_end: Optional[datetime]
    conversation_log: Optional[str]
    ai_analysis: Optional[str]
    score: Optional[float]
    feedback: Optional[str]
    status: str
    product_description: Optional[str] = None
    difficulty_level: Optional[str] = None
    client_type: Optional[str] = None
    first_message: Optional[str] = None
    session_system_prompt: Optional[str] = None
    signed_ws_url: Optional[str] = None
    conversation_id: Optional[str] = None

    class Config:
        from_attributes = True


class CompleteSessionRequest(BaseModel):
    conversation_log: str


class ConversationAnalysis(BaseModel):
    score: float
    strengths: list[str]
    areas_for_improvement: list[str]
    specific_feedback: str
    key_moments: list[str]


class StartSessionResponse(BaseModel):
    session: TrainingSessionResponse
    signed_ws_url: str
    conversation_id: Optional[str]
    session_system_prompt: str
    conversation_config_override: Optional[dict[str, Any]] = None
    dynamic_variables: Optional[dict[str, Any]] = None



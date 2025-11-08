from __future__ import annotations

from datetime import datetime, timezone
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..analysis_service import analyse_conversation, get_openai_client
from ..database import get_db, engine
from ..models import TrainingSession, create_tables
from ..prompts import build_session_prompt
from ..schemas import (
    CompleteSessionRequest,
    StartSessionResponse,
    TrainingSessionCreate,
    TrainingSessionResponse,
)
from .. import elevenlabs_service


router = APIRouter(prefix="/api/sessions", tags=["sessions"])
logger = logging.getLogger("moonai.api.sessions")


create_tables(engine)


@router.post("", response_model=StartSessionResponse)
def create_session(
    payload: TrainingSessionCreate, db: Session = Depends(get_db)
):
    logger.info(
        "Creating training session for manager '%s' (difficulty=%s)",
        payload.manager_name,
        payload.difficulty_level or "auto",
    )
    session_prompt = build_session_prompt(
        company_description=payload.company_description,
        difficulty_level=payload.difficulty_level,
    )

    try:
        (
            agent_id,
            conversation_id,
            signed_ws_url,
            overrides,
            dynamic_variables,
        ) = elevenlabs_service.create_conversation_session(
            company_description=payload.company_description,
            difficulty_level=payload.difficulty_level,
            system_prompt=session_prompt,
        )
    except Exception as exc:
        logger.exception("Failed to obtain ElevenLabs signed WS URL")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"ElevenLabs initialization failed: {exc}",
        )

    logger.info(
        "Session %s: obtained conversation_id=%s (agent_id=%s, ws_url_prefix=%s)",
        payload.manager_name,
        conversation_id,
        agent_id or "<placeholder>",
        signed_ws_url[:60] + "..." if signed_ws_url else "<none>",
    )

    training_session = TrainingSession(
        manager_name=payload.manager_name,
        company_description=payload.company_description,
        difficulty_level=payload.difficulty_level,
        session_system_prompt=session_prompt,
        signed_ws_url=signed_ws_url,
        conversation_id=conversation_id,
    )

    db.add(training_session)
    db.commit()
    db.refresh(training_session)

    response_payload = StartSessionResponse(
        session=TrainingSessionResponse.model_validate(training_session),
        signed_ws_url=signed_ws_url,
        conversation_id=conversation_id,
        session_system_prompt=session_prompt,
        conversation_config_override=overrides,
        # dynamic_variables=dynamic_variables or None,
        dynamic_variables=None,
    )

    return response_payload


@router.get("/{session_id}", response_model=TrainingSessionResponse)
def get_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(TrainingSession, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


@router.post("/{session_id}/complete", response_model=TrainingSessionResponse)
def complete_session(
    session_id: int,
    payload: CompleteSessionRequest,
    db: Session = Depends(get_db),
):
    logger.info("Completing training session %s", session_id)
    session = db.get(TrainingSession, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    session.conversation_log = payload.conversation_log
    session.session_end = datetime.now(timezone.utc)
    session.status = "completed"

    openai_client = get_openai_client()
    analysis, raw_payload = analyse_conversation(
        client=openai_client,
        conversation_log=payload.conversation_log,
        session_system_prompt=session.session_system_prompt or "",
    )

    session.ai_analysis = raw_payload
    session.score = analysis.score
    session.feedback = analysis.specific_feedback

    db.add(session)
    db.commit()
    db.refresh(session)
    return session


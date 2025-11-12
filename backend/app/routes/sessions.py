from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc

from ..analysis_service import analyse_conversation, get_openai_client
from ..database import get_db, engine
from ..models import TrainingSession, create_tables
from ..prompts import get_system_prompt
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
    session_prompt = get_system_prompt()

    try:
        (
            agent_id,
            conversation_id,
            signed_ws_url,
            overrides,
            dynamic_variables,
        ) = elevenlabs_service.create_conversation_session(
            product_description=payload.product_description,
            difficulty_level=payload.difficulty_level,
            client_type=payload.client_type,
            system_prompt=session_prompt,
            first_message=payload.first_message,
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
        product_description=payload.product_description,
        difficulty_level=payload.difficulty_level,
        client_type=payload.client_type,
        first_message=payload.first_message,
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
        dynamic_variables=dynamic_variables or None,
    )

    return response_payload


@router.get("", response_model=List[TrainingSessionResponse])
def get_sessions_history(
    manager_name: Optional[str] = Query(None, description="Filter by manager name"),
    status: Optional[str] = Query(None, description="Filter by status (active, completed)"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of sessions to return"),
    offset: int = Query(0, ge=0, description="Number of sessions to skip"),
    sort_by: str = Query("session_start", description="Sort by field (session_start, score, manager_name)"),
    sort_order: str = Query("desc", description="Sort order (asc, desc)"),
    db: Session = Depends(get_db),
):
    """
    Get session history with all information:
    - Session pre-requisites (settings): product_description, difficulty_level, client_type, first_message, session_system_prompt
    - Conversation chat: conversation_log
    - Analysis results: ai_analysis, score, feedback
    """
    logger.info(
        "Fetching sessions history (manager=%s, status=%s, limit=%d, offset=%d, sort_by=%s, sort_order=%s)",
        manager_name or "all",
        status or "all",
        limit,
        offset,
        sort_by,
        sort_order,
    )
    
    query = db.query(TrainingSession)
    
    # Apply filters
    if manager_name:
        query = query.filter(TrainingSession.manager_name == manager_name)
    if status:
        query = query.filter(TrainingSession.status == status)
    
    # Apply sorting
    sort_field = getattr(TrainingSession, sort_by, TrainingSession.session_start)
    if sort_order.lower() == "asc":
        query = query.order_by(asc(sort_field))
    else:
        query = query.order_by(desc(sort_field))
    
    # Apply pagination
    sessions = query.offset(offset).limit(limit).all()
    
    logger.info("Found %d sessions", len(sessions))
    return sessions


@router.get("/count")
def get_sessions_count(
    manager_name: Optional[str] = Query(None, description="Filter by manager name"),
    status: Optional[str] = Query(None, description="Filter by status (active, completed)"),
    db: Session = Depends(get_db),
):
    """
    Get total count of sessions matching the filters.
    Useful for pagination on the frontend.
    """
    query = db.query(TrainingSession)
    
    if manager_name:
        query = query.filter(TrainingSession.manager_name == manager_name)
    if status:
        query = query.filter(TrainingSession.status == status)
    
    count = query.count()
    return {"count": count}


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

    try:
        openai_client = get_openai_client()
        analysis, raw_payload = analyse_conversation(
            client=openai_client,
            conversation_log=payload.conversation_log,
            session_system_prompt=session.session_system_prompt or "",
        )

        session.ai_analysis = raw_payload
        session.score = analysis.score
        session.feedback = analysis.specific_feedback
    except Exception as exc:
        logger.exception("Failed to analyze conversation for session %s", session_id)
        # Store error in analysis field but don't fail the request
        session.ai_analysis = f"Analysis failed: {str(exc)}"
        session.score = None
        session.feedback = "Analysis service unavailable. Please try again later."

    db.add(session)
    db.commit()
    db.refresh(session)
    return session


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
    TrainingSessionUpdate,
)
from .. import elevenlabs_service
from .auth import get_current_user


router = APIRouter(
    prefix="/api/sessions",
    tags=["sessions"],
    dependencies=[Depends(get_current_user)],
)
logger = logging.getLogger("moonai.api.sessions")


create_tables(engine)


@router.post("", response_model=StartSessionResponse)
def create_session(
    payload: TrainingSessionCreate, db: Session = Depends(get_db)
):
    try:
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
                client_description=payload.client_description,
                difficulty_level=payload.difficulty_level,
                client_type=payload.client_type,
                system_prompt=session_prompt,
                first_message=payload.first_message,
            )
        except elevenlabs_service.ElevenLabsError as exc:
            logger.exception("ElevenLabs service error: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"ElevenLabs service error: {exc}",
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
            client_description=payload.client_description,
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
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to create training session")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create session: {str(exc)}",
        )


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
    - Session pre-requisites (settings): client_description, difficulty_level, client_type, first_message, session_system_prompt
    - Conversation chat: conversation_log
    - Analysis results: ai_analysis, score, feedback
    """
    try:
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
        
        # Apply sorting - validate sort_by field exists
        valid_sort_fields = ["session_start", "score", "manager_name", "session_end"]
        if sort_by not in valid_sort_fields:
            logger.warning("Invalid sort_by field '%s', using 'session_start'", sort_by)
            sort_by = "session_start"
        
        sort_field = getattr(TrainingSession, sort_by, TrainingSession.session_start)
        if sort_order.lower() == "asc":
            query = query.order_by(asc(sort_field))
        else:
            query = query.order_by(desc(sort_field))
        
        # Apply pagination
        sessions = query.offset(offset).limit(limit).all()
        
        logger.info("Found %d sessions", len(sessions))
        return sessions
    except Exception as exc:
        logger.exception("Failed to fetch session history")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch session history: {str(exc)}",
        )


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
    try:
        query = db.query(TrainingSession)
        
        if manager_name:
            query = query.filter(TrainingSession.manager_name == manager_name)
        if status:
            query = query.filter(TrainingSession.status == status)
        
        count = query.count()
        return {"count": count}
    except Exception as exc:
        logger.exception("Failed to fetch session count")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch session count: {str(exc)}",
        )


@router.delete("", response_model=dict)
def delete_all_sessions(db: Session = Depends(get_db)):
    """
    Delete all training sessions from the database.
    """
    try:
        logger.info("Deleting all training sessions")
        deleted_count = db.query(TrainingSession).delete()
        db.commit()
        
        logger.info("Successfully deleted %d training sessions", deleted_count)
        return {
            "message": f"All sessions deleted successfully",
            "deleted_count": deleted_count
        }
    except Exception as exc:
        logger.exception("Failed to delete all training sessions")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete all sessions: {str(exc)}",
        )


@router.get("/{session_id}", response_model=TrainingSessionResponse)
def get_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(TrainingSession, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


@router.put("/{session_id}", response_model=TrainingSessionResponse)
def update_session(
    session_id: int,
    payload: TrainingSessionUpdate,
    db: Session = Depends(get_db),
):
    """
    Update a training session. All fields are optional and only provided fields will be updated.
    """
    try:
        logger.info("Updating training session %s", session_id)
        session = db.get(TrainingSession, session_id)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
            )

        # Update only provided fields
        update_data = payload.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(session, field, value)

        db.add(session)
        db.commit()
        db.refresh(session)
        
        logger.info("Successfully updated training session %s", session_id)
        return session
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to update training session %s", session_id)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update session: {str(exc)}",
        )


@router.delete("/{session_id}", response_model=dict)
def delete_session(session_id: int, db: Session = Depends(get_db)):
    """
    Delete a single training session by ID.
    """
    try:
        logger.info("Deleting training session %s", session_id)
        session = db.get(TrainingSession, session_id)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
            )

        db.delete(session)
        db.commit()
        
        logger.info("Successfully deleted training session %s", session_id)
        return {"message": f"Session {session_id} deleted successfully", "deleted_id": session_id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to delete training session %s", session_id)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete session: {str(exc)}",
        )


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


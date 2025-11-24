from __future__ import annotations

import os
import logging
from typing import Any, Dict, Tuple

from dotenv import load_dotenv
from elevenlabs import ElevenLabs

load_dotenv()


ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_AGENT_ID = os.getenv("ELEVENLABS_AGENT_ID")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID")


logger = logging.getLogger("moonai.elevenlabs")


class ElevenLabsError(RuntimeError):
    """Raised when ElevenLabs API requests fail."""


_elevenlabs_client: ElevenLabs | None = None


def _get_elevenlabs_client() -> ElevenLabs:
    global _elevenlabs_client
    if _elevenlabs_client is None:
        if not ELEVENLABS_API_KEY:
            raise ElevenLabsError("ELEVENLABS_API_KEY is not configured")
        _elevenlabs_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
    return _elevenlabs_client


def validate_agent(agent_id: str) -> None:
    """Validate that the agent exists and is accessible."""
    try:
        client = _get_elevenlabs_client()
        agent = client.conversational_ai.agents.get(agent_id=agent_id)
        logger.info(
            "Agent validation successful: agent_id=%s, name=%s",
            agent_id,
            getattr(agent, "name", "unknown")
        )
    except Exception as exc:
        logger.error("Agent validation failed for agent_id=%s: %s", agent_id, exc)
        raise ElevenLabsError(f"Agent validation failed: {exc}") from exc


def request_signed_ws_url(*, agent_id: str) -> Tuple[str | None, str]:
    client = _get_elevenlabs_client()
    try:
        response = client.conversational_ai.conversations.get_signed_url(
            agent_id=agent_id,
            include_conversation_id=True,
        )

        signed_url = response.signed_url
        if not signed_url:
            raise ElevenLabsError("Empty signed URL received from ElevenLabs")
        
        conversation_id = signed_url[signed_url.find("conversation_id=")+len("conversation_id="):]
        if not conversation_id:
            raise ElevenLabsError("Conversation ID not found in signed URL")

        logger.info(
            "Successfully obtained signed URL: agent_id=%s, conversation_id=%s, url_length=%d",
            agent_id,
            conversation_id,
            len(signed_url)
        )
        
        return conversation_id, signed_url
    except Exception as exc:
        logger.exception("Failed to request signed WebSocket URL for agent_id=%s", agent_id)
        raise ElevenLabsError(f"Failed to get signed WebSocket URL: {exc}") from exc

def build_dynamic_variables(
    client_description: str | None,
    difficulty_level: str | None,
    client_type: str | None,
) -> Dict[str, Any]:
    variables: Dict[str, Any] = {}
    if client_description:
        variables["client_description"] = client_description.strip()
    if difficulty_level:
        variables["difficulty_level"] = difficulty_level.strip()
    if client_type:
        variables["client_type"] = client_type.strip()
    return variables


def create_conversation_session(
    *,
    client_description: str | None,
    difficulty_level: str | None,
    client_type: str | None,
    system_prompt: str,
    first_message: str | None = None,
) -> Tuple[str, str | None, str, Dict[str, Any], Dict[str, Any]]:
    agent_id = ELEVENLABS_AGENT_ID
    overrides: Dict[str, Any] = {
        "agent": {
            "prompt": {
                "prompt": system_prompt,
            }
        }
    }
    
    # Add first_message if provided
    if first_message:
        overrides["agent"]["first_message"] = first_message
    
    # Add voice_id from environment if available
    if ELEVENLABS_VOICE_ID:
        overrides["tts"] = {
            "voice_id": ELEVENLABS_VOICE_ID
        }
    
    dynamic_variables = build_dynamic_variables(
        client_description=client_description,
        difficulty_level=difficulty_level,
        client_type=client_type,
    )

    if not agent_id or not ELEVENLABS_API_KEY:
        logger.error("ElevenLabs credentials missing; cannot create conversation session")
        raise ElevenLabsError("Missing ELEVENLABS_AGENT_ID or ELEVENLABS_API_KEY")

    # Validate agent before creating session
    try:
        validate_agent(agent_id)
    except ElevenLabsError:
        # Re-raise validation errors
        raise
    except Exception as exc:
        logger.warning("Agent validation skipped due to error (may not be critical): %s", exc)

    # Log the overrides structure for debugging
    logger.info(
        "Creating conversation session: agent_id=%s, overrides_keys=%s, dynamic_vars=%s",
        agent_id,
        list(overrides.keys()),
        list(dynamic_variables.keys()) if dynamic_variables else []
    )
    logger.debug(
        "Conversation config override structure: %s",
        overrides
    )
    logger.debug(
        "Dynamic variables: %s",
        dynamic_variables
    )

    conversation_id, signed_url = request_signed_ws_url(agent_id=agent_id)

    return agent_id, conversation_id, signed_url, overrides, dynamic_variables


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


def request_signed_ws_url(*, agent_id: str) -> Tuple[str | None, str]:
    client = _get_elevenlabs_client()
    response = client.conversational_ai.conversations.get_signed_url(
        agent_id=agent_id,
        include_conversation_id=True,
    )

    signed_url = response.signed_url
    conversation_id = signed_url[signed_url.find("conversation_id=")+len("conversation_id="):]

    return conversation_id, signed_url

def build_dynamic_variables(
    product_description: str | None,
    difficulty_level: str | None,
    client_type: str | None,
) -> Dict[str, Any]:
    variables: Dict[str, Any] = {}
    if product_description:
        variables["product_description"] = product_description.strip()
    if difficulty_level:
        variables["difficulty_level"] = difficulty_level.strip()
    if client_type:
        variables["client_type"] = client_type.strip()
    return variables


def create_conversation_session(
    *,
    product_description: str | None,
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
        product_description=product_description,
        difficulty_level=difficulty_level,
        client_type=client_type,
    )

    if not agent_id or not ELEVENLABS_API_KEY:
        logger.error("ElevenLabs credentials missing; cannot create conversation session")
        raise ElevenLabsError("Missing ELEVENLABS_AGENT_ID or ELEVENLABS_API_KEY")

    conversation_id, signed_url = request_signed_ws_url(agent_id=agent_id)

    return agent_id, conversation_id, signed_url, overrides, dynamic_variables


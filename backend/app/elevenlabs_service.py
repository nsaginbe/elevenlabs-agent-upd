from __future__ import annotations

import os
import logging
from typing import Any, Dict, Tuple

from dotenv import load_dotenv
from elevenlabs import ElevenLabs

load_dotenv()


ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_AGENT_ID = os.getenv("ELEVENLABS_AGENT_ID")


logger = logging.getLogger("moonai.elevenlabs")


class ElevenLabsError(RuntimeError):
    """Raised when ElevenLabs API requests fail."""


def build_conversation_override(
    company_description: str | None,
    difficulty_level: str | None,
    system_prompt: str,
) -> Dict[str, Any]:
    prompt_sections = [system_prompt]
    if company_description:
        prompt_sections.append(
            f"Product context: {company_description.strip()}"
        )
    if difficulty_level:
        prompt_sections.append(
            f"Difficulty level: {difficulty_level.strip()}"
        )

    prompt_text = "\n\n".join(section for section in prompt_sections if section)

    return {
        "agent": {
            "prompt": {"prompt": prompt_text},
        }
    }


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
    conversation_id = None

    if hasattr(response, "model_extra") and response.model_extra:
        conversation_id = response.model_extra.get("conversation_id")

    if not signed_url:
        raise ElevenLabsError("Signed URL missing from ElevenLabs response")

    return conversation_id, signed_url


def build_dynamic_variables(
    company_description: str | None,
    difficulty_level: str | None,
) -> Dict[str, Any]:
    variables: Dict[str, Any] = {}
    if company_description:
        variables["product_description"] = company_description.strip()
    if difficulty_level:
        variables["difficulty_level"] = difficulty_level.strip()
    return variables


def create_conversation_session(
    *,
    company_description: str | None,
    difficulty_level: str | None,
    system_prompt: str,
) -> Tuple[str, str | None, str, Dict[str, Any], Dict[str, Any]]:
    agent_id = ELEVENLABS_AGENT_ID
    overrides = build_conversation_override(
        company_description=company_description,
        difficulty_level=difficulty_level,
        system_prompt=system_prompt,
    )
    # dynamic_variables = build_dynamic_variables(
    #     company_description=company_description,
    #     difficulty_level=difficulty_level,
    # )
    dynamic_variables = None

    if not agent_id or not ELEVENLABS_API_KEY:
        logger.error("ElevenLabs credentials missing; cannot create conversation session")
        raise ElevenLabsError("Missing ELEVENLABS_AGENT_ID or ELEVENLABS_API_KEY")

    conversation_id, signed_url = request_signed_ws_url(agent_id=agent_id)

    return agent_id, conversation_id, signed_url, overrides, dynamic_variables


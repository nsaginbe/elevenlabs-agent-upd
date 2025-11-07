from __future__ import annotations

import os
import uuid
from typing import Any, Dict, Tuple

import httpx
from dotenv import load_dotenv

load_dotenv()


ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_AGENT_ID = os.getenv("ELEVENLABS_AGENT_ID")
ELEVENLABS_BASE_URL = os.getenv(
    "ELEVENLABS_BASE_URL", "https://api.elevenlabs.io"
)


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


def request_signed_ws_url(
    *,
    agent_id: str,
    overrides: Dict[str, Any] | None = None,
) -> Tuple[str, str]:
    if not ELEVENLABS_API_KEY:
        raise ElevenLabsError("ELEVENLABS_API_KEY is not configured")

    payload: Dict[str, Any] = {"agent_id": agent_id, "with_client_token": True}
    if overrides:
        payload["conversation_config_override"] = overrides

    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
    }

    url = f"{ELEVENLABS_BASE_URL.rstrip('/')}/v1/convai/conversations"

    with httpx.Client(timeout=15.0) as client:
        response = client.post(url, json=payload, headers=headers)

    if response.status_code >= 400:
        raise ElevenLabsError(
            f"Failed to create conversation: {response.status_code} {response.text}"
        )

    data = response.json()

    conversation_id = data.get("conversation", {}).get("id") or data.get("conversation_id")
    signed_url = (
        data.get("client_secret", {}).get("value")
        or data.get("signed_url")
        or data.get("ws_url")
    )

    if not conversation_id or not signed_url:
        raise ElevenLabsError(
            "Unexpected response when requesting ElevenLabs signed URL"
        )

    return conversation_id, signed_url


def generate_placeholder_signed_url() -> Tuple[str, str]:
    """Fallback helper for development without ElevenLabs credentials."""
    conversation_id = f"local-{uuid.uuid4()}"
    ws_url = f"wss://example.invalid/convai/{conversation_id}"
    return conversation_id, ws_url


def create_conversation_session(
    *,
    company_description: str | None,
    difficulty_level: str | None,
    system_prompt: str,
) -> Tuple[str, str, str]:
    agent_id = ELEVENLABS_AGENT_ID
    overrides = build_conversation_override(
        company_description=company_description,
        difficulty_level=difficulty_level,
        system_prompt=system_prompt,
    )

    if not agent_id:
        conversation_id, signed_url = generate_placeholder_signed_url()
    else:
        try:
            conversation_id, signed_url = request_signed_ws_url(
                agent_id=agent_id, overrides=overrides
            )
        except ElevenLabsError:
            conversation_id, signed_url = generate_placeholder_signed_url()

    return agent_id or "", conversation_id, signed_url


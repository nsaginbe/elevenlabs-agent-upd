from __future__ import annotations

import logging
from fastapi import APIRouter, HTTPException, status

from ..prompts import fetch_and_update_prompt

router = APIRouter(prefix="/api/prompts", tags=["prompts"])
logger = logging.getLogger("moonai.api.prompts")


@router.post("/fetch")
def fetch_prompt_from_elevenlabs():
    """Fetch prompt from ElevenLabs and update BASE_SYSTEM_PROMPT."""
    try:
        logger.info("Fetching prompt from ElevenLabs")
        prompt = fetch_and_update_prompt()
        return {
            "status": "success",
            "message": "Prompt fetched and updated successfully",
            "prompt": prompt,
        }
    except Exception as exc:
        logger.exception("Failed to fetch prompt from ElevenLabs")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch prompt from ElevenLabs: {str(exc)}",
        )


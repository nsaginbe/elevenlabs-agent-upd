from __future__ import annotations

import logging
import os
from typing import Tuple

from dotenv import load_dotenv
from openai import OpenAI

from .schemas import ConversationAnalysis

load_dotenv()


OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


def _build_analysis_prompt(system_prompt: str, conversation_log: str) -> list[dict[str, str]]:
    analysis_instructions = f"""
    You are an AI sales coach reviewing a manager's practice call with a simulated business client.
    Follow the template from the system prompt provided during the session to score and provide feedback.
    """.strip()

    return [
        {
            "role": "system",
            "content": system_prompt,
        },
        {
            "role": "user",
            "content": (
                f"Conversation transcript:\n{conversation_log}\n\n"
                f"Provide a JSON object with keys: score (0-10 number), strengths (list of strings),"
                f" areas_for_improvement (list of strings), specific_feedback (string),"
                f" key_moments (list of strings)."
            ),
        },
    ]


def analyse_conversation(
    *,
    client: OpenAI,
    conversation_log: str,
    session_system_prompt: str,
) -> Tuple[ConversationAnalysis, str]:
    logger = logging.getLogger("moonai.analysis")
    
    messages = _build_analysis_prompt(
        system_prompt=session_system_prompt, conversation_log=conversation_log
    )

    try:
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
            temperature=0.2,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content or "{}"
        logger.debug("OpenAI response content length: %d", len(content))
        
        try:
            data = ConversationAnalysis.model_validate_json(content)
            return data, content
        except Exception as validation_error:
            logger.error(
                "Failed to validate OpenAI response: %s. Content: %s",
                validation_error,
                content[:500]
            )
            raise ValueError(f"Invalid analysis response format: {validation_error}") from validation_error
    except Exception as exc:
        logger.error("OpenAI API call failed: %s", exc)
        raise


def get_openai_client() -> OpenAI:
    return OpenAI()


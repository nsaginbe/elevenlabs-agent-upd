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

def get_client_behavior_description(client_type: str | None) -> str | None:
    """
    Возвращает детальное описание поведения клиента на основе client_type.
    Описание на русском языке в стиле системного промпта.
    """
    if not client_type:
        return None
    
    behavior_descriptions: Dict[str, str] = {
        "Дружелюбный": (
            "Ты дружелюбный директор: теплый, открытый к общению, но всё же осторожный. "
            "Отвечаешь вежливо, можешь поддержать разговор, но не забываешь о своих интересах. "
            "Задаешь вопросы с интересом, но проверяешь детали. Можешь улыбнуться в голосе, "
            "использовать дружелюбные фразы, но при этом остаешься настороженным к коммерческим предложениям. "
            "Не отказываешь сразу, даешь менеджеру шанс, но требуешь конкретики."
        ),
        "Скептик": (
            "Ты скептичный директор: вежлив, но с явным недоверием. "
            "Уточняешь риски и выгоды, задаешь провокационные вопросы, проверяешь каждое утверждение. "
            "Сомневаешься в обещаниях, просишь доказательства, примеры, отзывы. "
            "Можешь сказать: «Это звучит слишком хорошо, чтобы быть правдой» или «А что если не сработает?». "
            "Не веришь на слово, требуешь конкретики, цифр, гарантий. "
            "Отвечаешь с долей сомнения, но не грубо."
        ),
        "Агрессивный": (
            "Ты агрессивный директор: резкий, обрывающий, отвечаешь кратко и по делу, но без мата. "
            "Можешь прервать менеджера, сказать «Стоп, не надо лишнего» или «Короче, в чем суть?». "
            "Нетерпелив, не любишь долгих объяснений, хочешь сразу факты. "
            "Можешь быть грубоватым, но в рамках приличия. "
            "Не церемонишься, говоришь прямо, иногда резко. "
            "Не даешь менеджеру развернуться, перебиваешь, торопишь к сути."
        ),
        "Безразличный": (
            "Ты безразличный директор: сухой, односложный, не проявляешь интереса. "
            "Отвечаешь минимально: «Да», «Нет», «Понятно», «Скиньте КП». "
            "Не задаешь вопросов, не развиваешь разговор, не проявляешь энтузиазма. "
            "Можешь показать, что тебе не интересно, что у тебя нет времени. "
            "Отвечаешь формально, без эмоций, как будто делаешь одолжение. "
            "Не помогаешь менеджеру вести диалог, ждешь конкретики или просто хочешь закончить разговор."
        ),
        "Энтузиаст": (
            "Ты энтузиаст-директор: оживленный, любопытный, проявляешь интерес, но волнуешься о стоимости и ресурсах. "
            "Задаешь много вопросов, увлекаешься идеей, но постоянно возвращаешься к практическим вопросам: "
            "«А сколько это стоит?», «А сколько времени займет?», «А кто будет обучать?». "
            "Показываешь энтузиазм, но с осторожностью. Можешь сказать: «Интересно! Но как это реализовать?». "
            "Волнуешься о бюджете, времени сотрудников, сложности внедрения. "
            "Хочешь попробовать, но боишься рисков и затрат."
        ),
        "Рациональный": (
            "Ты рациональный директор: структурированный, логичный, фокусируешься на фактах. "
            "Задаешь вопросы про сроки, ресурсы, деньги, ROI, риски, процессы. "
            "Нужны конкретные цифры, планы, схемы, сроки, гарантии. "
            "Не поддаешься на эмоции, требуешь логики и обоснований. "
            "Можешь сказать: «Давайте по порядку: стоимость, сроки, условия, гарантии». "
            "Принимаешь решения на основе данных, а не обещаний. "
            "Структурируешь разговор, не позволяешь менеджеру уходить в сторону."
        ),
        "Пассивно-агрессивный": (
            "Ты пассивно-агрессивный директор: формально вежлив, но язвительный или холодный. "
            "Можешь сказать что-то вроде: «Ну конечно, еще одно революционное решение» или "
            "«Спасибо, что потратили мое время». "
            "Используешь сарказм, скрытую иронию, формальную вежливость с подтекстом. "
            "Не грубишь напрямую, но даешь понять, что не в восторге. "
            "Можешь быть холодным, отстраненным, формальным, но с язвинкой. "
            "Не помогаешь менеджеру, но и не отказываешь сразу — создаешь дискомфорт."
        ),
    }
    
    return behavior_descriptions.get(client_type.strip())


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
        # Добавляем описание поведения на основе типа клиента
        behavior_desc = get_client_behavior_description(client_type)
        if behavior_desc:
            variables["client_behavior_description"] = behavior_desc
    
    # Если client_type не указан, используем нейтральное описание поведения
    if "client_behavior_description" not in variables:
        variables["client_behavior_description"] = (
            "Ты руководитель бизнеса: вежливый, но осторожный. "
            "Отвечаешь по делу, задаешь вопросы, проверяешь детали предложения. "
            "Не проявляешь излишнего энтузиазма, но и не отказываешь сразу. "
            "Требуешь конкретики, цифр, сроков, условий."
        )
    
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


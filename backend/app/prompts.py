from __future__ import annotations

import os
from pathlib import Path
from textwrap import dedent
from elevenlabs import ElevenLabs
from dotenv import load_dotenv


load_dotenv()

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_AGENT_ID = os.getenv("ELEVENLABS_AGENT_ID")
PROMPT_FILE = Path(__file__).parent.parent / "system_prompt.txt"

client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

DEFAULT_SYSTEM_PROMPT = dedent(
    """
    Ты — руководитель или директор компании малого и среднего бизнеса
    Ты ведёшь деловой разговор с менеджером по продажам компании MoonAI.

    Главное: всегда оставайся в роли клиента, не объясняй, что ты ИИ или симуляция. Не отвечай на вопросы, не касающиеся роли клиента.

    Роли
    Ты ВСЕГДА бизнес-клиент. Пользователь — менеджер по продажам компании MoonAI.

    Важно
    - Запрещено выходить из роли клиента.
    - Запрещено использовать матерные слова.
    - Запрещено начинать информировать менеджера, даже если он молчит.

    Цель разговора
    Реалистично имитировать общение, чтобы оценить, способен ли менеджер довести диалог до конкретного шага:
    созвон, встреча, презентация, пилот или сделка по внедрению решений MoonAI.

    Динамические параметры
    Перед началом разговора система получает два параметра:
    1. Описание продукта {{product_description}} — вводится менеджером вручную.
    2. Уровень сложности {{difficulty_level}} — выбирается из выпадающего списка.
    3. Тип клиента {{client_type}} — выбирается из выпадающего списка.
    """
)


def load_prompt_from_file() -> str:
    if PROMPT_FILE.exists():
        try:
            return PROMPT_FILE.read_text(encoding="utf-8").strip()
        except Exception:
            return DEFAULT_SYSTEM_PROMPT
    return DEFAULT_SYSTEM_PROMPT


def save_prompt_to_file(prompt: str) -> None:
    PROMPT_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROMPT_FILE.write_text(prompt, encoding="utf-8")


def fetch_and_update_prompt() -> str:
    agent = client.conversational_ai.agents.get(agent_id=ELEVENLABS_AGENT_ID)
    prompt = agent.conversation_config.agent.prompt.prompt
    save_prompt_to_file(prompt)
    return prompt


def get_system_prompt() -> str:
    return load_prompt_from_file()
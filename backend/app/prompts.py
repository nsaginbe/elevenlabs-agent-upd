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


def load_prompt_from_file() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8").strip()


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
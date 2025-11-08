from elevenlabs import ElevenLabs
from dotenv import load_dotenv
import os

load_dotenv()
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")


def request_signed_ws_url(*, agent_id: str):
    client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
    response = client.conversational_ai.conversations.get_signed_url(
        agent_id=agent_id,
        include_conversation_id=True,
    )

    signed_url = response.signed_url
    conversation_id = signed_url[signed_url.find("conversation_id=")+len("conversation_id="):]
    
    # if not signed_url or not conversation_id:
    #     print("Signed URL or conversation ID missing from ElevenLabs response")

    print(f"Conversation ID: {conversation_id}")
    print(f"Signed URL: {signed_url}")

if __name__ == "__main__":
    request_signed_ws_url(agent_id="agent_2301k97hmja5fqhvbm1dsnd0dw62")
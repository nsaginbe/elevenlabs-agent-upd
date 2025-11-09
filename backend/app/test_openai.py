from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


def test_openai_api_key():
    """Test if OpenAI API key is valid by making a simple API call."""
    if not OPENAI_API_KEY:
        print("❌ ERROR: OPENAI_API_KEY environment variable is not set")
        print("   Please set it in your .env file or environment variables")
        return False

    print(f"🔑 Testing OpenAI API key...")
    print(f"   Model: {OPENAI_MODEL}")
    print(f"   API Key: {OPENAI_API_KEY[:10]}...{OPENAI_API_KEY[-4:] if len(OPENAI_API_KEY) > 14 else '***'}")

    try:
        client = OpenAI(api_key=OPENAI_API_KEY)

        # Make a simple test call
        print("\n📡 Making test API call...")
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": "Say 'API key is working' if you receive this message.",
                }
            ],
            max_tokens=20,
            temperature=0.1,
        )

        content = response.choices[0].message.content
        print(f"\n✅ SUCCESS: OpenAI API key is valid!")
        print(f"   Response: {content}")
        print(f"   Model: {response.model}")
        print(f"   Tokens used: {response.usage.total_tokens if response.usage else 'N/A'}")
        return True

    except Exception as e:
        error_type = type(e).__name__
        error_message = str(e)

        print(f"\n❌ ERROR: OpenAI API call failed")
        print(f"   Error type: {error_type}")
        print(f"   Error message: {error_message}")

        if "api_key" in error_message.lower() or "authentication" in error_message.lower():
            print("\n💡 Suggestion: Your API key may be invalid or expired.")
            print("   Please check your OPENAI_API_KEY in the .env file")
        elif "rate_limit" in error_message.lower():
            print("\n💡 Suggestion: You've hit the rate limit. Please try again later.")
        elif "insufficient_quota" in error_message.lower() or "quota" in error_message.lower():
            print("\n💡 Suggestion: You've exceeded your API quota. Please check your OpenAI account.")
        else:
            print("\n💡 Suggestion: Check your internet connection and OpenAI service status.")

        return False


if __name__ == "__main__":
    success = test_openai_api_key()
    sys.exit(0 if success else 1)


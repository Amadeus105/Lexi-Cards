import os
import json
import httpx

# Google перевёл Gemini API на новый "Interactions API" (старый generateContent
# для новых ключей больше не обслуживается на многих моделях).
# Документация: https://ai.google.dev/gemini-api/docs/interactions-overview
GEMINI_MODEL = "gemini-3.5-flash-lite"  # самая быстрая модель в линейке Gemini 3.5
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"

SYSTEM_INSTRUCTION = (
    "Ты помощник-словарь для русскоязычных, изучающих английский язык. "
    "По одному английскому слову или короткой фразе верни: транскрипцию (IPA), "
    "часть речи, основной перевод на русский (1-4 слова) и одно естественное "
    "предложение-пример на английском с его переводом на русский. "
    "Если у слова несколько значений — выбери самое частое."
)

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "word": {"type": "string"},
        "transcription": {"type": "string"},
        "partOfSpeech": {
            "type": "string",
            "enum": ["noun", "verb", "adjective", "adverb", "phrase", "other"],
        },
        "translation": {"type": "string"},
        "example_en": {"type": "string"},
        "example_ru": {"type": "string"},
    },
    "required": [
        "word",
        "transcription",
        "partOfSpeech",
        "translation",
        "example_en",
        "example_ru",
    ],
}


class LLMError(Exception):
    pass


async def generate_card(word: str) -> dict:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise LLMError("GEMINI_API_KEY не задан. Добавьте его в файл .env")

    payload = {
        "model": GEMINI_MODEL,
        "system_instruction": SYSTEM_INSTRUCTION,
        "input": word,
        "response_format": {
            "type": "text",
            "mime_type": "application/json",
            "schema": RESPONSE_SCHEMA,
        },
        "generation_config": {"temperature": 0.4},
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            GEMINI_URL,
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json=payload,
        )

    if resp.status_code != 200:
        raise LLMError(f"Gemini API вернул ошибку {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    try:
        text = None
        for step in data.get("steps", []):
            if step.get("type") == "model_output":
                for part in step.get("content", []):
                    if part.get("type") == "text":
                        text = part.get("text")
                        break
        if text is None:
            raise KeyError("model_output step not found")
        parsed = json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise LLMError(f"Не удалось разобрать ответ модели: {e}. Сырой ответ: {resp.text[:300]}")

    return parsed
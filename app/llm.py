import os
import json
import asyncio
import httpx

# Google перевёл Gemini API на новый "Interactions API" (старый generateContent
# для новых ключей больше не обслуживается на многих моделях).
# Документация: https://ai.google.dev/gemini-api/docs/interactions-overview
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"

# Пробуем модели по очереди: если самая быстрая перегружена (частая ситуация
# на бесплатном тарифе), откатываемся на следующую.
GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash"]

MAX_RETRIES_PER_MODEL = 2
RETRY_BASE_DELAY = 1.5  # секунды, растёт экспоненциально

SYSTEM_INSTRUCTION = (
    "Ты помощник-словарь для русскоязычных, изучающих английский язык. "
    "По одному английскому слову или короткой фразе верни: транскрипцию (IPA), "
    "часть речи, основной перевод на русский (1-4 слова) и одно естественное "
    "предложение-пример на английском с его переводом на русский. "
    "Также верни до 3 синонимов и до 3 антонимов на английском (обычные слова, "
    "без транскрипции и перевода). Если синонимов или антонимов нет или слово "
    "не предполагает их (например, служебное слово или имя собственное) — верни "
    "пустой список. Если у слова несколько значений — выбери самое частое."
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
        "synonyms": {"type": "array", "items": {"type": "string"}},
        "antonyms": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "word",
        "transcription",
        "partOfSpeech",
        "translation",
        "example_en",
        "example_ru",
        "synonyms",
        "antonyms",
    ],
}


class LLMError(Exception):
    pass


def _is_retryable(status_code: int) -> bool:
    return status_code == 429 or status_code >= 500


async def _call_model(client: httpx.AsyncClient, api_key: str, model: str, word: str):
    payload = {
        "model": model,
        "system_instruction": SYSTEM_INSTRUCTION,
        "input": word,
        "response_format": {
            "type": "text",
            "mime_type": "application/json",
            "schema": RESPONSE_SCHEMA,
        },
        "generation_config": {"temperature": 0.4},
    }
    resp = await client.post(
        GEMINI_URL,
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json=payload,
    )
    return resp


async def generate_card(word: str) -> dict:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise LLMError("GEMINI_API_KEY не задан. Добавьте его в файл .env")

    last_error = None

    async with httpx.AsyncClient(timeout=30) as client:
        for model in GEMINI_MODELS:
            for attempt in range(MAX_RETRIES_PER_MODEL + 1):
                try:
                    resp = await _call_model(client, api_key, model, word)
                except httpx.RequestError as e:
                    last_error = f"Сетевая ошибка при обращении к Gemini: {e}"
                    await asyncio.sleep(RETRY_BASE_DELAY * (2 ** attempt))
                    continue

                if resp.status_code == 200:
                    return _parse_response(resp)

                last_error = f"Gemini API вернул ошибку {resp.status_code}: {resp.text[:300]}"

                if _is_retryable(resp.status_code) and attempt < MAX_RETRIES_PER_MODEL:
                    await asyncio.sleep(RETRY_BASE_DELAY * (2 ** attempt))
                    continue

                break

    raise LLMError(
        f"Не удалось получить ответ ни от одной модели Gemini после нескольких попыток. "
        f"Последняя ошибка: {last_error}"
    )


def _parse_response(resp: httpx.Response) -> dict:
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
        return json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise LLMError(f"Не удалось разобрать ответ модели: {e}. Сырой ответ: {resp.text[:300]}")
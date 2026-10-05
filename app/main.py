from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse

from . import database
from .models import WordIn, CardOut, LearnedIn, ReviewIn, StatsOut
from .llm import generate_card, LLMError
from .export import build_workbook

BASE_DIR = Path(__file__).parent.parent

app = FastAPI(title="Картотека слов")

database.init_db()
database.backup_db()


@app.middleware("http")
async def no_stale_assets(request, call_next):
    # Браузер всегда сверяется с сервером (ETag → 304), поэтому после
    # обновления CSS/JS не показывает старую версию страницы.
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/cards", response_model=list[CardOut])
def get_cards():
    return database.list_cards()


@app.post("/api/cards", response_model=CardOut, status_code=201)
async def add_card(payload: WordIn):
    word = payload.word.strip()
    if not word:
        raise HTTPException(400, "Пустое слово")

    existing = database.find_by_word(word)
    if existing:
        raise HTTPException(409, "Такое слово уже есть в картотеке")

    try:
        generated = await generate_card(word)
    except LLMError as e:
        raise HTTPException(502, str(e))

    # Модель может нормализовать слово ("Running" -> "run") — проверяем ещё раз.
    if database.find_by_word(generated.get("word", "")):
        raise HTTPException(409, f"Слово «{generated['word']}» уже есть в картотеке")

    card = database.insert_card(generated)
    return card


@app.delete("/api/cards/{card_id}", status_code=204)
def remove_card(card_id: str):
    database.delete_card(card_id)
    return None


@app.patch("/api/cards/{card_id}/learned", response_model=CardOut)
def update_learned(card_id: str, payload: LearnedIn):
    card = database.get_card(card_id)
    if not card:
        raise HTTPException(404, "Карточка не найдена")
    updated = database.set_learned(card_id, payload.learned)
    return updated


@app.post("/api/cards/{card_id}/review", response_model=CardOut)
def review(card_id: str, payload: ReviewIn):
    card = database.review_card(card_id, payload.grade)
    if not card:
        raise HTTPException(404, "Карточка не найдена")
    return card


@app.get("/api/stats", response_model=StatsOut)
def stats():
    return database.get_stats()


@app.get("/api/export/xlsx")
def export_xlsx():
    cards = database.list_cards()
    buffer = build_workbook(cards)
    filename = f"lexi-words-{datetime.now().strftime('%Y-%m-%d')}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/review")
def review_page():
    return FileResponse(BASE_DIR / "static" / "review.html")


@app.get("/stats")
def stats_page():
    return FileResponse(BASE_DIR / "static" / "stats.html")
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import auth, database
from .auth import current_user
from .export import build_workbook
from .llm import LLMError, generate_card
from .models import AuthIn, CardOut, LearnedIn, MeOut, ReviewIn, StatsOut, WordIn

BASE_DIR = Path(__file__).parent.parent
STATIC = BASE_DIR / "static"

# Сколько новых слов в сутки может создать обычный пользователь (у администратора лимита нет).
DAILY_WORD_LIMIT = int(os.environ.get("DAILY_WORD_LIMIT", "30"))
ALLOW_SIGNUP = os.environ.get("ALLOW_SIGNUP", "1") == "1"

app = FastAPI(title="Lexi")

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


# ---------- вход ----------

@app.post("/api/auth/register", status_code=201)
def register(payload: AuthIn, request: Request, response: Response):
    if not ALLOW_SIGNUP:
        raise HTTPException(403, "Регистрация сейчас закрыта.")
    ip = auth.client_ip(request)
    if auth.registrations.blocked(ip):
        raise HTTPException(429, "Слишком много регистраций с этого адреса. Попробуйте через час.")
    username = auth.validate_credentials(payload.username, payload.password)
    try:
        user = database.create_user(username, auth.hash_password(payload.password))
    except database.DuplicateError:
        raise HTTPException(409, "Это имя уже занято. Выберите другое.")
    auth.registrations.hit(ip)
    auth.start_session(response, user)
    return {"username": user["username"]}


@app.post("/api/auth/login")
def login(payload: AuthIn, request: Request, response: Response):
    username = payload.username.strip().lower()
    key = (auth.client_ip(request), username)
    if auth.login_failures.blocked(key):
        raise HTTPException(429, "Слишком много неудачных попыток. Подождите 10 минут.")
    user = database.get_user_by_username(username)
    if not user or not auth.verify_password(payload.password, user["password_hash"]):
        auth.login_failures.hit(key)
        raise HTTPException(401, "Неверное имя или пароль.")
    auth.start_session(response, user)
    return {"username": user["username"]}


@app.post("/api/auth/logout", status_code=204)
def logout(response: Response):
    auth.end_session(response)
    return None


def _words_left(user: dict):
    if user["is_admin"]:
        return None
    since = datetime.now(timezone.utc) - timedelta(days=1)
    return max(0, DAILY_WORD_LIMIT - database.count_generations_since(user["id"], since))


@app.get("/api/me", response_model=MeOut)
def me(user: dict = Depends(current_user)):
    return {
        "username": user["username"],
        "is_admin": user["is_admin"],
        "daily_limit": None if user["is_admin"] else DAILY_WORD_LIMIT,
        "words_left": _words_left(user),
    }


# ---------- карточки ----------

@app.get("/api/cards", response_model=list[CardOut])
def get_cards(user: dict = Depends(current_user)):
    return database.list_cards(user["id"])


@app.post("/api/cards", response_model=CardOut, status_code=201)
async def add_card(payload: WordIn, user: dict = Depends(current_user)):
    word = payload.word.strip()
    if not word:
        raise HTTPException(400, "Пустое слово")

    if database.find_by_word(user["id"], word):
        raise HTTPException(409, f"Слово «{word}» уже есть в картотеке")

    left = _words_left(user)
    if left is not None and left <= 0:
        raise HTTPException(
            429, f"На сегодня лимит исчерпан: {DAILY_WORD_LIMIT} новых слов в сутки. Попробуйте завтра."
        )

    try:
        generated = await generate_card(word)
    except LLMError as e:
        raise HTTPException(502, str(e))
    database.log_generation(user["id"])

    # Модель может нормализовать слово ("Running" -> "run") — проверяем ещё раз.
    if database.find_by_word(user["id"], generated.get("word", "")):
        raise HTTPException(409, f"Слово «{generated['word']}» уже есть в картотеке")

    try:
        return database.insert_card(user["id"], generated)
    except database.DuplicateError:
        raise HTTPException(409, f"Слово «{generated['word']}» уже есть в картотеке")


@app.delete("/api/cards/{card_id}", status_code=204)
def remove_card(card_id: str, user: dict = Depends(current_user)):
    database.delete_card(user["id"], card_id)
    return None


@app.patch("/api/cards/{card_id}/learned", response_model=CardOut)
def update_learned(card_id: str, payload: LearnedIn, user: dict = Depends(current_user)):
    if not database.get_card(user["id"], card_id):
        raise HTTPException(404, "Карточка не найдена")
    return database.set_learned(user["id"], card_id, payload.learned)


@app.post("/api/cards/{card_id}/review", response_model=CardOut)
def review(card_id: str, payload: ReviewIn, user: dict = Depends(current_user)):
    card = database.review_card(user["id"], card_id, payload.grade)
    if not card:
        raise HTTPException(404, "Карточка не найдена")
    return card


@app.get("/api/stats", response_model=StatsOut)
def stats(request: Request, user: dict = Depends(current_user)):
    return database.get_stats(user["id"], auth.tz_offset(request))


@app.get("/api/export/xlsx")
def export_xlsx(user: dict = Depends(current_user)):
    buffer = build_workbook(database.list_cards(user["id"]))
    filename = f"lexi-words-{datetime.now().strftime('%Y-%m-%d')}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- страницы ----------

app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _page(request: Request, name: str):
    if not auth.user_from_request(request):
        return RedirectResponse("/login", status_code=303)
    return FileResponse(STATIC / name)


@app.get("/")
def index(request: Request):
    return _page(request, "index.html")


@app.get("/review")
def review_page(request: Request):
    return _page(request, "review.html")


@app.get("/stats")
def stats_page(request: Request):
    return _page(request, "stats.html")


@app.get("/login")
def login_page(request: Request):
    if auth.user_from_request(request):
        return RedirectResponse("/", status_code=303)
    return FileResponse(STATIC / "login.html")

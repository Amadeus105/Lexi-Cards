"""Вход в Lexi: хеширование паролей, подписанная cookie сессии, защита от перебора."""
import hashlib
import hmac
import logging
import os
import re
import secrets
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, Response

from . import database

log = logging.getLogger("lexi.auth")

COOKIE_NAME = "lexi_session"
SESSION_DAYS = 30
PBKDF2_ITERATIONS = 600_000  # рекомендация OWASP для PBKDF2-SHA256

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")
MIN_PASSWORD = 8

_secret = os.environ.get("SECRET_KEY")
if not _secret:
    # Без постоянного ключа все входы сбрасываются при перезапуске сервера.
    _secret = secrets.token_hex(32)
    log.warning("SECRET_KEY не задан: сессии будут сброшены при перезапуске сервера.")
SECRET = _secret.encode()

# По умолчанию cookie только для HTTPS на Render; локально по http тоже работает.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1" if os.environ.get("RENDER") else "0") == "1"


# ---------- пароли ----------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, expected = stored.split("$")
    except ValueError:
        return False
    if algo != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
    return hmac.compare_digest(digest.hex(), expected)


def validate_credentials(username: str, password: str) -> str:
    """Проверяет формат и возвращает имя в нижнем регистре."""
    username = username.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "Имя: от 3 до 32 символов — латинские буквы, цифры и «_».")
    if len(password) < MIN_PASSWORD:
        raise HTTPException(400, f"Пароль должен быть не короче {MIN_PASSWORD} символов.")
    return username


# ---------- сессия ----------
# Значение cookie: "<id>.<срок>.<подпись>". В подпись входит хвост хеша пароля,
# поэтому смена пароля завершает все прежние сессии.

def _sign(user_id: int, expires: int, password_hash: str) -> str:
    msg = f"{user_id}.{expires}.{password_hash[-16:]}".encode()
    return hmac.new(SECRET, msg, hashlib.sha256).hexdigest()


def start_session(response: Response, user: dict):
    expires = int(time.time()) + SESSION_DAYS * 86400
    value = f"{user['id']}.{expires}.{_sign(user['id'], expires, user['password_hash'])}"
    response.set_cookie(
        COOKIE_NAME, value,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
    )


def end_session(response: Response):
    response.delete_cookie(COOKIE_NAME, httponly=True, secure=COOKIE_SECURE, samesite="lax")


def user_from_request(request: Request):
    raw = request.cookies.get(COOKIE_NAME, "")
    try:
        user_id_s, expires_s, signature = raw.split(".")
        user_id, expires = int(user_id_s), int(expires_s)
    except ValueError:
        return None
    if expires < time.time():
        return None
    user = database.get_user(user_id)
    if not user or not hmac.compare_digest(signature, _sign(user_id, expires, user["password_hash"])):
        return None
    return user


def current_user(request: Request) -> dict:
    """Зависимость FastAPI для API: без входа — 401."""
    user = user_from_request(request)
    if not user:
        raise HTTPException(401, "Нужно войти в аккаунт.")
    return user


def tz_offset(request: Request) -> int:
    """Смещение часового пояса пользователя в минутах (cookie ставит браузер)."""
    try:
        value = int(request.cookies.get("lexi_tz", "0"))
    except ValueError:
        return 0
    return value if -840 <= value <= 840 else 0


# ---------- защита от перебора ----------

class Throttle:
    """Не больше `limit` событий за `window` секунд на ключ. Хранится в памяти процесса."""

    def __init__(self, limit: int, window: int):
        self.limit = limit
        self.window = window
        self.events = defaultdict(deque)

    def _trim(self, key):
        q = self.events[key]
        while q and q[0] < time.time() - self.window:
            q.popleft()
        return q

    def blocked(self, key) -> bool:
        return len(self._trim(key)) >= self.limit

    def hit(self, key):
        self._trim(key).append(time.time())


login_failures = Throttle(limit=5, window=10 * 60)
registrations = Throttle(limit=5, window=60 * 60)


def client_ip(request: Request) -> str:
    # Render стоит за прокси — настоящий адрес в X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

"""Хранилище Lexi: SQLite на своём компьютере, Postgres (Neon) на сервере.

Какая база используется, решает переменная окружения DATABASE_URL:
не задана — локальный файл lexi.db, задана — например, строка подключения Neon.
Все данные (карточки, повторения, генерации) привязаны к пользователю.
"""
import json
import os
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import (
    Boolean, Column, Float, ForeignKey, Index, Integer, MetaData, String, Table, Text,
    create_engine, delete, func, insert, select, update,
)
from sqlalchemy.exc import IntegrityError

from .srs import grade_card

BASE_DIR = Path(__file__).parent.parent
DEFAULT_SQLITE = BASE_DIR / "lexi.db"
BACKUP_DIR = BASE_DIR / "backups"
BACKUPS_TO_KEEP = 20
ACTIVITY_DAYS = 7 * 15  # сколько дней показывать на тепловой карте


def database_url() -> str:
    url = os.environ.get("DATABASE_URL") or f"sqlite:///{DEFAULT_SQLITE.as_posix()}"
    # Neon и Render отдают postgres:// или postgresql:// — указываем драйвер psycopg 3.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


_url = database_url()
engine = create_engine(
    _url,
    # Neon закрывает простаивающие соединения — проверяем их перед использованием.
    pool_pre_ping=True,
    pool_recycle=300,
    # Пулер Neon (PgBouncer) может не знать о подготовленных запросах psycopg — отключаем их.
    connect_args={} if _url.startswith("sqlite") else {"prepare_threshold": None},
)
IS_SQLITE = engine.url.get_backend_name() == "sqlite"

metadata = MetaData()

users = Table(
    "users", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("username", String(32), nullable=False, unique=True),
    Column("password_hash", String(255), nullable=False),
    Column("is_admin", Boolean, nullable=False, default=False),
    Column("created_at", String(32), nullable=False),
)

cards = Table(
    "cards", metadata,
    Column("id", String(36), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("word", Text, nullable=False),
    Column("transcription", Text),
    Column("part_of_speech", String(20)),
    Column("translation", Text, nullable=False),
    Column("example_en", Text),
    Column("example_ru", Text),
    Column("synonyms", Text, nullable=False, default="[]"),
    Column("antonyms", Text, nullable=False, default="[]"),
    # Время храним строкой в UTC — так же, как раньше, чтобы фронтенд не менялся.
    Column("created_at", String(32), nullable=False),
    Column("learned", Boolean, nullable=False, default=False),
    Column("ease_factor", Float, nullable=False, default=2.5),
    Column("interval_days", Float, nullable=False, default=0),
    Column("repetitions", Integer, nullable=False, default=0),
    Column("due_at", String(40)),
)
# У каждого пользователя слово встречается один раз, без учёта регистра.
Index("ux_cards_user_word", cards.c.user_id, func.lower(cards.c.word), unique=True)

reviews = Table(
    "reviews", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("card_id", String(36), nullable=False),
    Column("grade", String(10), nullable=False),
    Column("reviewed_at", String(40), nullable=False),
)
Index("ix_reviews_user_at", reviews.c.user_id, reviews.c.reviewed_at)

# Каждое обращение к Gemini — для дневного лимита. Удаление карточки лимит не возвращает.
generations = Table(
    "generations", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("created_at", String(40), nullable=False),
)
Index("ix_generations_user_at", generations.c.user_id, generations.c.created_at)


class DuplicateError(Exception):
    pass


def init_db():
    metadata.create_all(engine)


def backup_db():
    """Копия локальной SQLite-базы при запуске. У Neon есть собственное восстановление."""
    if not IS_SQLITE:
        return None
    db_path = Path(engine.url.database)
    if not db_path.exists():
        return None
    BACKUP_DIR.mkdir(exist_ok=True)
    target = BACKUP_DIR / f"{db_path.stem}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    for old in sorted(BACKUP_DIR.glob(f"{db_path.stem}-*.db"))[:-BACKUPS_TO_KEEP]:
        old.unlink()
    return target


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _timestamp() -> str:
    # Формат SQLite CURRENT_TIMESTAMP: "YYYY-MM-DD HH:MM:SS" в UTC.
    return _now().strftime("%Y-%m-%d %H:%M:%S")


def _card(row) -> dict:
    d = dict(row._mapping)
    for field in ("synonyms", "antonyms"):
        try:
            d[field] = json.loads(d.get(field) or "[]")
        except (json.JSONDecodeError, TypeError):
            d[field] = []
    d["learned"] = bool(d.get("learned"))
    return d


# ---------- пользователи ----------

def create_user(username: str, password_hash: str, is_admin: bool = False) -> dict:
    try:
        with engine.begin() as conn:
            conn.execute(insert(users).values(
                username=username, password_hash=password_hash,
                is_admin=is_admin, created_at=_timestamp(),
            ))
    except IntegrityError as e:
        raise DuplicateError(username) from e
    return get_user_by_username(username)


def get_user(user_id: int):
    with engine.connect() as conn:
        row = conn.execute(select(users).where(users.c.id == user_id)).first()
        return dict(row._mapping) if row else None


def get_user_by_username(username: str):
    with engine.connect() as conn:
        row = conn.execute(select(users).where(users.c.username == username)).first()
        return dict(row._mapping) if row else None


def set_admin(user_id: int, is_admin: bool = True):
    with engine.begin() as conn:
        conn.execute(update(users).where(users.c.id == user_id).values(is_admin=is_admin))


# ---------- дневной лимит генераций ----------

def count_generations_since(user_id: int, since: datetime) -> int:
    with engine.connect() as conn:
        return conn.execute(
            select(func.count()).select_from(generations).where(
                generations.c.user_id == user_id,
                generations.c.created_at >= since.isoformat(timespec="seconds"),
            )
        ).scalar_one()


def log_generation(user_id: int):
    with engine.begin() as conn:
        conn.execute(insert(generations).values(
            user_id=user_id, created_at=_now().isoformat(timespec="seconds"),
        ))


# ---------- карточки ----------

def list_cards(user_id: int):
    with engine.connect() as conn:
        rows = conn.execute(
            select(cards).where(cards.c.user_id == user_id)
            .order_by(cards.c.created_at.desc(), cards.c.id)
        ).all()
        return [_card(r) for r in rows]


def find_by_word(user_id: int, word: str):
    with engine.connect() as conn:
        row = conn.execute(
            select(cards).where(cards.c.user_id == user_id, func.lower(cards.c.word) == word.lower())
        ).first()
        return _card(row) if row else None


def get_card(user_id: int, card_id: str):
    with engine.connect() as conn:
        row = conn.execute(
            select(cards).where(cards.c.user_id == user_id, cards.c.id == card_id)
        ).first()
        return _card(row) if row else None


def insert_card(user_id: int, data: dict, **extra) -> dict:
    """Добавляет карточку. extra — поля при переносе из старой базы (created_at, SRS и т.п.)."""
    card_id = extra.pop("id", None) or str(uuid.uuid4())
    values = dict(
        id=card_id,
        user_id=user_id,
        word=data["word"],
        transcription=data.get("transcription", ""),
        part_of_speech=data.get("partOfSpeech", data.get("part_of_speech", "")),
        translation=data["translation"],
        example_en=data.get("example_en", ""),
        example_ru=data.get("example_ru", ""),
        synonyms=json.dumps(data.get("synonyms", []) or [], ensure_ascii=False),
        antonyms=json.dumps(data.get("antonyms", []) or [], ensure_ascii=False),
        created_at=_timestamp(),
    )
    values.update(extra)
    try:
        with engine.begin() as conn:
            conn.execute(insert(cards).values(**values))
    except IntegrityError as e:
        raise DuplicateError(data["word"]) from e
    return get_card(user_id, card_id)


def delete_card(user_id: int, card_id: str):
    with engine.begin() as conn:
        conn.execute(delete(cards).where(cards.c.user_id == user_id, cards.c.id == card_id))


def set_learned(user_id: int, card_id: str, learned: bool):
    with engine.begin() as conn:
        conn.execute(
            update(cards).where(cards.c.user_id == user_id, cards.c.id == card_id)
            .values(learned=learned)
        )
    return get_card(user_id, card_id)


def review_card(user_id: int, card_id: str, grade: str):
    """Применяет оценку по алгоритму SRS и записывает её в историю повторений."""
    card = get_card(user_id, card_id)
    if not card:
        return None
    srs = grade_card(grade, card["ease_factor"], card["interval_days"], card["repetitions"])
    with engine.begin() as conn:
        conn.execute(
            update(cards).where(cards.c.user_id == user_id, cards.c.id == card_id).values(
                ease_factor=srs["ease_factor"],
                interval_days=srs["interval_days"],
                repetitions=srs["repetitions"],
                due_at=srs["due_at"],
                learned=grade in ("good", "easy"),
            )
        )
        conn.execute(insert(reviews).values(
            user_id=user_id, card_id=card_id, grade=grade,
            reviewed_at=_now().isoformat(timespec="seconds"),
        ))
    return get_card(user_id, card_id)


def add_review_record(user_id: int, card_id: str, grade: str, reviewed_at: str):
    """Для переноса истории повторений из старой базы."""
    with engine.begin() as conn:
        conn.execute(insert(reviews).values(
            user_id=user_id, card_id=card_id, grade=grade, reviewed_at=reviewed_at,
        ))


# ---------- перенос из старой базы (пачками, чтобы не ходить в Neon по разу на карточку) ----------

def existing_card_keys(user_id: int):
    """Id и слова (в нижнем регистре), которые у пользователя уже есть."""
    with engine.connect() as conn:
        rows = conn.execute(select(cards.c.id, cards.c.word).where(cards.c.user_id == user_id)).all()
    return {r.id for r in rows}, {r.word.lower() for r in rows}


def existing_review_keys(user_id: int):
    with engine.connect() as conn:
        rows = conn.execute(
            select(reviews.c.card_id, reviews.c.reviewed_at).where(reviews.c.user_id == user_id)
        ).all()
    return {(r.card_id, r.reviewed_at) for r in rows}


def bulk_insert(table_name: str, rows: list[dict]):
    """Одна транзакция на всю пачку: либо все строки, либо ни одной."""
    if rows:
        with engine.begin() as conn:
            conn.execute(insert(metadata.tables[table_name]), rows)


# ---------- статистика ----------

def _local_date(iso_utc: str, tz):
    dt = datetime.fromisoformat(iso_utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).date()


def get_stats(user_id: int, tz_offset_minutes: int = 0):
    """tz_offset_minutes — смещение часового пояса пользователя (из браузера),
    чтобы «сегодня» и серия дней считались по его местному времени, а не по времени сервера."""
    tz = timezone(timedelta(minutes=tz_offset_minutes))
    now_key = _now().strftime("%Y-%m-%dT%H:%M:%S")
    mine = cards.c.user_id == user_id
    with engine.connect() as conn:
        count = lambda *where: conn.execute(  # noqa: E731
            select(func.count()).select_from(cards).where(mine, *where)
        ).scalar_one()
        total = count()
        learned = count(cards.c.learned.is_(True))
        new = count(cards.c.due_at.is_(None))
        due = count(cards.c.due_at.is_not(None), func.substr(cards.c.due_at, 1, 19) <= now_key)

        since = (_now() - timedelta(days=ACTIVITY_DAYS + 1)).isoformat(timespec="seconds")
        review_times = conn.execute(
            select(reviews.c.reviewed_at).where(reviews.c.user_id == user_id, reviews.c.reviewed_at >= since)
        ).scalars().all()

    per_day: dict = {}
    for ts in review_times:
        day = _local_date(ts, tz)
        per_day[day] = per_day.get(day, 0) + 1

    today = _now().astimezone(tz).date()
    activity = [
        {"date": (today - timedelta(days=i)).isoformat(),
         "count": per_day.get(today - timedelta(days=i), 0)}
        for i in range(ACTIVITY_DAYS - 1, -1, -1)
    ]

    # Серия: подряд идущие дни с повторениями; сегодняшний день может быть ещё пустым.
    streak = 0
    day = today if per_day.get(today) else today - timedelta(days=1)
    while per_day.get(day):
        streak += 1
        day -= timedelta(days=1)

    return {
        "total": total,
        "learned": learned,
        "not_learned": total - learned,
        "new": new,
        "due": due,
        "reviewed_today": per_day.get(today, 0),
        "streak": streak,
        "activity": activity,
    }

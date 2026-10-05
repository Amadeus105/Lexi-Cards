import sqlite3
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from contextlib import contextmanager

from .srs import grade_card

BASE_DIR = Path(__file__).parent.parent
DB_PATH = BASE_DIR / "cards.db"
BACKUP_DIR = BASE_DIR / "backups"
BACKUPS_TO_KEEP = 20
ACTIVITY_DAYS = 7 * 15  # сколько дней показывать на тепловой карте


def init_db():
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                word TEXT NOT NULL,
                transcription TEXT,
                part_of_speech TEXT,
                translation TEXT NOT NULL,
                example_en TEXT,
                example_ru TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                learned INTEGER DEFAULT 0,
                synonyms TEXT DEFAULT '[]',
                antonyms TEXT DEFAULT '[]',
                ease_factor REAL DEFAULT 2.5,
                interval_days REAL DEFAULT 0,
                repetitions INTEGER DEFAULT 0,
                due_at TEXT
            )
            """
        )
        # Миграции только ДОБАВЛЯЮТ колонки — существующие данные не трогаются.
        for ddl in [
            "ALTER TABLE cards ADD COLUMN learned INTEGER DEFAULT 0",
            "ALTER TABLE cards ADD COLUMN synonyms TEXT DEFAULT '[]'",
            "ALTER TABLE cards ADD COLUMN antonyms TEXT DEFAULT '[]'",
            "ALTER TABLE cards ADD COLUMN ease_factor REAL DEFAULT 2.5",
            "ALTER TABLE cards ADD COLUMN interval_days REAL DEFAULT 0",
            "ALTER TABLE cards ADD COLUMN repetitions INTEGER DEFAULT 0",
            "ALTER TABLE cards ADD COLUMN due_at TEXT",
        ]:
            try:
                conn.execute(ddl)
            except sqlite3.OperationalError:
                pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id TEXT NOT NULL,
                grade TEXT NOT NULL,
                reviewed_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reviews_at ON reviews(reviewed_at)")
        conn.commit()


def backup_db():
    """Копия базы при каждом запуске сервера; хранятся последние BACKUPS_TO_KEEP штук."""
    if not DB_PATH.exists():
        return None
    BACKUP_DIR.mkdir(exist_ok=True)
    target = BACKUP_DIR / f"cards-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    src = sqlite3.connect(DB_PATH)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    for old in sorted(BACKUP_DIR.glob("cards-*.db"))[:-BACKUPS_TO_KEEP]:
        old.unlink()
    return target


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def _utc_now_key() -> str:
    # Формат, сравнимый со строками due_at по первым 19 символам.
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def _decode_row(row: sqlite3.Row) -> dict:
    d = dict(row)
    for field in ("synonyms", "antonyms"):
        raw = d.get(field)
        try:
            d[field] = json.loads(raw) if raw else []
        except (json.JSONDecodeError, TypeError):
            d[field] = []
    return d


def list_cards():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM cards ORDER BY created_at DESC"
        ).fetchall()
        return [_decode_row(r) for r in rows]


def find_by_word(word: str):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM cards WHERE lower(word) = lower(?)", (word,)
        ).fetchone()
        return _decode_row(row) if row else None


def get_card(card_id: str):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        return _decode_row(row) if row else None


def insert_card(data: dict):
    card_id = str(uuid.uuid4())
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO cards (
                id, word, transcription, part_of_speech, translation,
                example_en, example_ru, synonyms, antonyms
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                card_id,
                data["word"],
                data.get("transcription", ""),
                data.get("partOfSpeech", ""),
                data["translation"],
                data.get("example_en", ""),
                data.get("example_ru", ""),
                json.dumps(data.get("synonyms", []) or []),
                json.dumps(data.get("antonyms", []) or []),
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        return _decode_row(row)


def delete_card(card_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM cards WHERE id = ?", (card_id,))
        conn.commit()


def set_learned(card_id: str, learned: bool):
    with get_conn() as conn:
        conn.execute(
            "UPDATE cards SET learned = ? WHERE id = ?",
            (1 if learned else 0, card_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        return _decode_row(row) if row else None


def review_card(card_id: str, grade: str):
    """Применяет оценку по алгоритму SRS и записывает её в историю повторений."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        if not row:
            return None
        srs = grade_card(grade, row["ease_factor"], row["interval_days"], row["repetitions"])
        conn.execute(
            """
            UPDATE cards
            SET ease_factor = ?, interval_days = ?, repetitions = ?, due_at = ?, learned = ?
            WHERE id = ?
            """,
            (
                srs["ease_factor"],
                srs["interval_days"],
                srs["repetitions"],
                srs["due_at"],
                1 if grade in ("good", "easy") else 0,
                card_id,
            ),
        )
        conn.execute(
            "INSERT INTO reviews (card_id, grade, reviewed_at) VALUES (?, ?, ?)",
            (card_id, grade, datetime.now(timezone.utc).isoformat(timespec="seconds")),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        return _decode_row(row)


def _local_date(iso_utc: str):
    dt = datetime.fromisoformat(iso_utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone().date()


def get_stats():
    now_key = _utc_now_key()
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM cards").fetchone()["c"]
        learned = conn.execute(
            "SELECT COUNT(*) AS c FROM cards WHERE learned = 1"
        ).fetchone()["c"]
        new = conn.execute(
            "SELECT COUNT(*) AS c FROM cards WHERE due_at IS NULL"
        ).fetchone()["c"]
        due = conn.execute(
            "SELECT COUNT(*) AS c FROM cards WHERE due_at IS NOT NULL AND substr(due_at, 1, 19) <= ?",
            (now_key,),
        ).fetchone()["c"]

        since = (datetime.now(timezone.utc) - timedelta(days=ACTIVITY_DAYS + 1)).isoformat()
        review_times = [
            r["reviewed_at"]
            for r in conn.execute(
                "SELECT reviewed_at FROM reviews WHERE reviewed_at >= ?", (since,)
            )
        ]

    per_day: dict = {}
    for ts in review_times:
        day = _local_date(ts)
        per_day[day] = per_day.get(day, 0) + 1

    today = datetime.now().date()
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

import sqlite3
import json
import uuid
from datetime import datetime
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).parent.parent / "cards.db"


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
                antonyms TEXT DEFAULT '[]'
            )
            """
        )
        for ddl in [
            "ALTER TABLE cards ADD COLUMN learned INTEGER DEFAULT 0",
            "ALTER TABLE cards ADD COLUMN synonyms TEXT DEFAULT '[]'",
            "ALTER TABLE cards ADD COLUMN antonyms TEXT DEFAULT '[]'",
        ]:
            try:
                conn.execute(ddl)
            except sqlite3.OperationalError:
                pass
        conn.commit()


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


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


def get_stats():
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM cards").fetchone()["c"]
        learned = conn.execute(
            "SELECT COUNT(*) AS c FROM cards WHERE learned = 1"
        ).fetchone()["c"]
        return {"total": total, "learned": learned, "not_learned": total - learned}
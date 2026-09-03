import sqlite3
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
                learned INTEGER DEFAULT 0
            )
            """
        )
        for ddl in [
            "ALTER TABLE cards ADD COLUMN learned INTEGER DEFAULT 0",
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


def list_cards():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM cards ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def find_by_word(word: str):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM cards WHERE lower(word) = lower(?)", (word,)
        ).fetchone()
        return dict(row) if row else None


def get_card(card_id: str):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        return dict(row) if row else None


def insert_card(data: dict):
    card_id = str(uuid.uuid4())
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO cards (id, word, transcription, part_of_speech, translation, example_en, example_ru)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                card_id,
                data["word"],
                data.get("transcription", ""),
                data.get("partOfSpeech", ""),
                data["translation"],
                data.get("example_en", ""),
                data.get("example_ru", ""),
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        return dict(row)


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
        return dict(row) if row else None


def get_stats():
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM cards").fetchone()["c"]
        learned = conn.execute(
            "SELECT COUNT(*) AS c FROM cards WHERE learned = 1"
        ).fetchone()["c"]
        return {"total": total, "learned": learned, "not_learned": total - learned}
"""Перенос старой картотеки (cards.db без аккаунтов) в новую базу под аккаунт администратора.

Куда переносить, решает DATABASE_URL (как и для сервера):
    локально:  python -m app.migrate --admin aidyn
    в Neon:    DATABASE_URL="postgresql://..." python -m app.migrate --admin aidyn

Пароль спрашивается в терминале. Если аккаунт уже есть, он просто получает права
администратора, а пароль не меняется. Повторный запуск безопасен: уже перенесённые
карточки пропускаются.
"""
import argparse
import getpass
import sqlite3
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from . import auth, database  # noqa: E402

LEGACY_DB = Path(__file__).parent.parent / "cards.db"


def get_or_create_admin(username: str) -> dict:
    username = username.strip().lower()
    user = database.get_user_by_username(username)
    if user:
        database.set_admin(user["id"])
        print(f"Аккаунт «{username}» уже есть — он стал администратором, пароль не менялся.")
        return database.get_user(user["id"])

    password = getpass.getpass(f"Пароль для «{username}» (не короче {auth.MIN_PASSWORD} символов): ")
    if getpass.getpass("Повторите пароль: ") != password:
        sys.exit("Пароли не совпадают.")
    auth.validate_credentials(username, password)
    user = database.create_user(username, auth.hash_password(password), is_admin=True)
    print(f"Создан администратор «{username}».")
    return user


def migrate(legacy: Path, username: str):
    if not legacy.exists():
        sys.exit(f"Старая база не найдена: {legacy}")
    database.init_db()
    user = get_or_create_admin(username)

    src = sqlite3.connect(legacy)
    src.row_factory = sqlite3.Row
    columns = {r[1] for r in src.execute("PRAGMA table_info(cards)")}
    moved = skipped = 0
    for row in src.execute("SELECT * FROM cards"):
        r = dict(row)
        extra = {"id": r["id"], "created_at": r.get("created_at") or None}
        for field, default in (("learned", 0), ("ease_factor", 2.5), ("interval_days", 0),
                               ("repetitions", 0), ("due_at", None)):
            if field in columns:
                extra[field] = r[field] if r[field] is not None else default
        extra["learned"] = bool(extra.get("learned"))
        if not extra["created_at"]:
            extra.pop("created_at")
        data = {
            "word": r["word"],
            "transcription": r.get("transcription") or "",
            "part_of_speech": r.get("part_of_speech") or "",
            "translation": r["translation"],
            "example_en": r.get("example_en") or "",
            "example_ru": r.get("example_ru") or "",
            "synonyms": _json_list(r.get("synonyms")),
            "antonyms": _json_list(r.get("antonyms")),
        }
        try:
            database.insert_card(user["id"], data, **extra)
            moved += 1
        except database.DuplicateError:
            skipped += 1
        except Exception as e:  # тот же id уже перенесён ранее
            if "unique" in str(e).lower() or "duplicate" in str(e).lower():
                skipped += 1
            else:
                raise

    reviews_moved = 0
    has_reviews = src.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reviews'"
    ).fetchone()
    if has_reviews and moved:
        for row in src.execute("SELECT card_id, grade, reviewed_at FROM reviews"):
            database.add_review_record(user["id"], row["card_id"], row["grade"], row["reviewed_at"])
            reviews_moved += 1
    src.close()

    print(f"Перенесено карточек: {moved}, пропущено (уже были): {skipped}, повторений: {reviews_moved}.")
    print(f"База: {database.engine.url.render_as_string(hide_password=True)}")


def _json_list(raw):
    import json
    try:
        value = json.loads(raw) if raw else []
        return value if isinstance(value, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Перенос старой картотеки в базу с аккаунтами.")
    parser.add_argument("--admin", required=True, help="имя администратора (владельца слов)")
    parser.add_argument("--from", dest="legacy", default=str(LEGACY_DB), help="путь к старой cards.db")
    args = parser.parse_args()
    migrate(Path(args.legacy), args.admin)

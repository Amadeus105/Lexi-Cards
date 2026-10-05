"""Перенос старой картотеки (cards.db без аккаунтов) в новую базу под аккаунт администратора.

Куда переносить, решает DATABASE_URL (как и для сервера):
    локально:  python -m app.migrate --admin aidyn
    в Neon:    $env:DATABASE_URL="postgresql://..."; python -m app.migrate --admin aidyn

Пароль спрашивается в терминале. Если аккаунт уже есть, он просто получает права
администратора, а пароль не меняется. Повторный запуск безопасен: уже перенесённые
карточки и повторения пропускаются, так что прерванный перенос можно просто запустить снова.
"""
import argparse
import getpass
import json
import sqlite3
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from . import auth, database  # noqa: E402

LEGACY_DB = Path(__file__).parent.parent / "cards.db"
SRS_FIELDS = (("ease_factor", 2.5), ("interval_days", 0), ("repetitions", 0), ("due_at", None))


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


def _json_list(raw) -> str:
    try:
        value = json.loads(raw) if raw else []
    except (json.JSONDecodeError, TypeError):
        value = []
    return json.dumps(value if isinstance(value, list) else [], ensure_ascii=False)


def migrate(legacy: Path, username: str):
    if not legacy.exists():
        sys.exit(f"Старая база не найдена: {legacy}")
    print(f"База: {database.engine.url.render_as_string(hide_password=True)}")
    print("Подключаюсь и создаю таблицы…", flush=True)
    database.init_db()
    user = get_or_create_admin(username)

    src = sqlite3.connect(legacy)
    src.row_factory = sqlite3.Row
    columns = {r[1] for r in src.execute("PRAGMA table_info(cards)")}

    # --- карточки: читаем, что уже есть, и отправляем недостающие одной пачкой ---
    have_ids, have_words = database.existing_card_keys(user["id"])
    print(f"Уже в базе: {len(have_ids)} карточек.", flush=True)
    new_rows, skipped = [], 0
    for r in map(dict, src.execute("SELECT * FROM cards")):
        if r["id"] in have_ids or r["word"].lower() in have_words:
            skipped += 1
            continue
        have_words.add(r["word"].lower())
        row = {
            "id": r["id"],
            "user_id": user["id"],
            "word": r["word"],
            "transcription": r.get("transcription") or "",
            "part_of_speech": r.get("part_of_speech") or "",
            "translation": r["translation"],
            "example_en": r.get("example_en") or "",
            "example_ru": r.get("example_ru") or "",
            "synonyms": _json_list(r.get("synonyms")),
            "antonyms": _json_list(r.get("antonyms")),
            "created_at": r.get("created_at") or database._timestamp(),
            "learned": bool(r.get("learned")),
        }
        for field, default in SRS_FIELDS:
            value = r.get(field) if field in columns else None
            row[field] = default if value is None else value
        new_rows.append(row)
    print(f"Переношу {len(new_rows)} карточек…", flush=True)
    database.bulk_insert("cards", new_rows)

    # --- история повторений: только те записи, которых ещё нет ---
    moved_reviews = 0
    if src.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='reviews'").fetchone():
        have_reviews = database.existing_review_keys(user["id"])
        review_rows = [
            {"user_id": user["id"], "card_id": r["card_id"], "grade": r["grade"], "reviewed_at": r["reviewed_at"]}
            for r in src.execute("SELECT card_id, grade, reviewed_at FROM reviews")
            if (r["card_id"], r["reviewed_at"]) not in have_reviews
        ]
        database.bulk_insert("reviews", review_rows)
        moved_reviews = len(review_rows)
    src.close()

    total = len(database.existing_card_keys(user["id"])[0])
    print(f"Перенесено карточек: {len(new_rows)}, пропущено (уже были): {skipped}, повторений: {moved_reviews}.")
    print(f"Теперь у «{user['username']}» в базе {total} карточек.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Перенос старой картотеки в базу с аккаунтами.")
    parser.add_argument("--admin", required=True, help="имя администратора (владельца слов)")
    parser.add_argument("--from", dest="legacy", default=str(LEGACY_DB), help="путь к старой cards.db")
    args = parser.parse_args()
    migrate(Path(args.legacy), args.admin)

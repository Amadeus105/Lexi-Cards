from datetime import datetime, timedelta

MIN_EASE = 1.3


def grade_card(grade: str, ease_factor: float, interval_days: float, repetitions: int) -> dict:
    """
    Упрощённый алгоритм в духе SM-2 / Anki.
    grade: "again" | "hard" | "good" | "easy"
    Возвращает новые ease_factor, interval_days, repetitions и due_at (ISO строка, UTC).
    """
    ease_factor = ease_factor or 2.5
    interval_days = interval_days or 0
    repetitions = repetitions or 0
    now = datetime.utcnow()

    if grade == "again":
        repetitions = 0
        interval_days = 0
        ease_factor = max(MIN_EASE, ease_factor - 0.2)
        due_at = now + timedelta(minutes=10)

    elif grade == "hard":
        ease_factor = max(MIN_EASE, ease_factor - 0.15)
        interval_days = max(1, interval_days * 1.2)
        repetitions += 1
        due_at = now + timedelta(days=interval_days)

    elif grade == "good":
        if repetitions == 0:
            interval_days = 1
        elif repetitions == 1:
            interval_days = 6
        else:
            interval_days = interval_days * ease_factor
        repetitions += 1
        due_at = now + timedelta(days=interval_days)

    elif grade == "easy":
        ease_factor = ease_factor + 0.15
        interval_days = max(interval_days, 1) * ease_factor * 1.3 if repetitions > 0 else 4
        repetitions += 1
        due_at = now + timedelta(days=interval_days)

    else:
        raise ValueError(f"Неизвестная оценка: {grade}")

    return {
        "ease_factor": round(ease_factor, 2),
        "interval_days": round(interval_days, 2),
        "repetitions": repetitions,
        "due_at": due_at.isoformat(),
    }
from typing import Literal

from pydantic import BaseModel, Field


class WordIn(BaseModel):
    word: str = Field(min_length=1, max_length=100)


class CardOut(BaseModel):
    id: str
    word: str
    transcription: str | None = ""
    part_of_speech: str | None = ""
    translation: str
    example_en: str | None = ""
    example_ru: str | None = ""
    created_at: str | None = None
    learned: bool = False
    synonyms: list[str] = []
    antonyms: list[str] = []
    repetitions: int | None = 0
    ease_factor: float | None = 2.5
    interval_days: float | None = 0
    due_at: str | None = None


class LearnedIn(BaseModel):
    learned: bool


class ReviewIn(BaseModel):
    grade: Literal["again", "hard", "good", "easy"]


class ActivityDay(BaseModel):
    date: str
    count: int


class StatsOut(BaseModel):
    total: int
    learned: int
    not_learned: int
    new: int
    due: int
    reviewed_today: int
    streak: int
    activity: list[ActivityDay]

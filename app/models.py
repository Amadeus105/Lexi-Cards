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


class LearnedIn(BaseModel):
    learned: bool


class StatsOut(BaseModel):
    total: int
    learned: int
    not_learned: int
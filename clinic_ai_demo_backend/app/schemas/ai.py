from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    question: str = Field(min_length=2, max_length=1000)


class GuidanceRequest(BaseModel):
    save: bool = False


class GuidanceSaveRequest(BaseModel):
    content: str = Field(min_length=2, max_length=8000)


class AIResponse(BaseModel):
    task: str
    content: str
    model: str
    warning: str

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RoleName = Literal["admin", "receptionist", "doctor", "accountant", "patient"]
UserStatus = Literal["active", "locked"]


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=200)
    email: str | None = Field(default=None, max_length=120)
    role: RoleName
    status: UserStatus = "active"


class UserUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=50)
    password: str | None = Field(default=None, min_length=6, max_length=200)
    email: str | None = Field(default=None, max_length=120)
    role: RoleName | None = None
    status: UserStatus | None = None


class UserResponse(BaseModel):
    id: int
    username: str
    email: str | None = None
    role: str
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserListResponse(BaseModel):
    total: int
    items: list[UserResponse]

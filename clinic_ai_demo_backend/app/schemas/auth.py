from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=200)


class PatientRegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=6, max_length=200)
    email: str | None = Field(default=None, max_length=120)
    full_name: str = Field(min_length=2, max_length=120)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=20)
    phone: str = Field(min_length=8, max_length=20)
    address: str | None = Field(default=None, max_length=255)


class AuthUserResponse(BaseModel):
    id: int
    username: str
    email: str | None = None
    full_name: str | None = None
    role: str
    status: str

    model_config = ConfigDict(from_attributes=True)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AuthUserResponse

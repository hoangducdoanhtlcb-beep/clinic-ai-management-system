from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PatientBase(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=20)
    phone: str = Field(min_length=9, max_length=20)
    address: str | None = Field(default=None, max_length=255)

    @field_validator("full_name", "phone", mode="before")
    @classmethod
    def strip_required_text(cls, value):
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("gender", "address", mode="before")
    @classmethod
    def strip_optional_text(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        compact = value.replace(" ", "").replace("-", "").replace(".", "")
        digits = compact[1:] if compact.startswith("+") else compact
        if not digits.isdigit():
            raise ValueError("Phone number contains invalid characters.")
        if not 9 <= len(digits) <= 15:
            raise ValueError("Phone number must contain 9 to 15 digits.")
        return compact


class PatientCreate(PatientBase):
    user_id: int | None = None


class PatientUpdate(BaseModel):
    user_id: int | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, min_length=9, max_length=20)
    address: str | None = Field(default=None, max_length=255)

    @field_validator("full_name", "phone", mode="before")
    @classmethod
    def strip_text(cls, value):
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("gender", "address", mode="before")
    @classmethod
    def strip_optional_text(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        compact = value.replace(" ", "").replace("-", "").replace(".", "")
        digits = compact[1:] if compact.startswith("+") else compact
        if not digits.isdigit():
            raise ValueError("Phone number contains invalid characters.")
        if not 9 <= len(digits) <= 15:
            raise ValueError("Phone number must contain 9 to 15 digits.")
        return compact


class PatientResponse(PatientBase):
    id: int
    user_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class PatientListResponse(BaseModel):
    total: int
    items: list[PatientResponse]

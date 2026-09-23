from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


DoctorStatus = Literal["active", "inactive"]


class DoctorBase(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    specialty: str = Field(min_length=2, max_length=100)
    phone: str | None = Field(default=None, max_length=20)
    license_no: str | None = Field(default=None, max_length=50)
    status: DoctorStatus = "active"

    @field_validator("full_name", "specialty", "phone", "license_no", mode="before")
    @classmethod
    def strip_text(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class DoctorCreate(DoctorBase):
    # Có thể truyền user_id nếu sau này Users/Auth đã nối backend.
    # Ở giai đoạn hiện tại, nếu bỏ trống backend sẽ tự tạo tài khoản placeholder bị khóa.
    user_id: int | None = None


class DoctorUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    specialty: str | None = Field(default=None, min_length=2, max_length=100)
    phone: str | None = Field(default=None, max_length=20)
    license_no: str | None = Field(default=None, max_length=50)
    status: DoctorStatus | None = None

    @field_validator("full_name", "specialty", "phone", "license_no", mode="before")
    @classmethod
    def strip_text(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class DoctorResponse(DoctorBase):
    id: int
    user_id: int

    model_config = ConfigDict(from_attributes=True)


class DoctorListResponse(BaseModel):
    total: int
    items: list[DoctorResponse]

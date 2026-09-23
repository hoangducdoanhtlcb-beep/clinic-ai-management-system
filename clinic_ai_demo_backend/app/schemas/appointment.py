from datetime import date, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


AppointmentStatus = Literal["pending", "confirmed", "completed", "cancelled"]


class AppointmentBase(BaseModel):
    patient_id: int
    doctor_id: int
    appointment_date: date
    start_time: time
    end_time: time | None = None
    reason: str | None = Field(default=None, max_length=2000)
    status: AppointmentStatus = "pending"


class AppointmentCreate(AppointmentBase):
    created_by: int | None = None


class AppointmentUpdate(BaseModel):
    patient_id: int | None = None
    doctor_id: int | None = None
    appointment_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    reason: str | None = Field(default=None, max_length=2000)
    status: AppointmentStatus | None = None


class AppointmentResponse(AppointmentBase):
    id: int
    created_by: int

    model_config = ConfigDict(from_attributes=True)


class AppointmentListResponse(BaseModel):
    total: int
    items: list[AppointmentResponse]

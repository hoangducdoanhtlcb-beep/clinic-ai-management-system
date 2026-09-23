from datetime import date, time
from typing import Literal

from pydantic import BaseModel, Field


class PatientProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, min_length=9, max_length=20)
    address: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=120)


class PatientAppointmentCreate(BaseModel):
    doctor_id: int
    appointment_date: date
    start_time: time
    reason: str = Field(min_length=2, max_length=2000)


class PatientAppointmentUpdate(BaseModel):
    doctor_id: int | None = None
    appointment_date: date | None = None
    start_time: time | None = None
    reason: str | None = Field(default=None, min_length=2, max_length=2000)
    status: Literal["cancelled"] | None = None

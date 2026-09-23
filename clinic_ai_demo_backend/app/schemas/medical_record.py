from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict


class MedicalRecordCreate(BaseModel):
    appointment_id: int
    symptoms: str | None = None
    conclusion: str | None = None
    doctor_note: str | None = None
    prescription_note: str | None = None
    post_visit_guidance: str | None = None


class MedicalRecordUpdate(BaseModel):
    symptoms: str | None = None
    conclusion: str | None = None
    doctor_note: str | None = None
    prescription_note: str | None = None
    post_visit_guidance: str | None = None


class MedicalRecordResponse(BaseModel):
    id: int
    appointment_id: int
    patient_id: int
    patient_name: str
    doctor_id: int
    doctor_name: str
    appointment_date: date
    start_time: time
    symptoms: str | None = None
    conclusion: str | None = None
    doctor_note: str | None = None
    prescription_note: str | None = None
    post_visit_guidance: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

import re
from datetime import date, datetime, timedelta, time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database import get_db
from app.models.appointment import Appointment
from app.models.doctor import Doctor
from app.models.patient import Patient
from app.models.shift import Shift
from app.models.user import User
from app.schemas.appointment import AppointmentCreate, AppointmentListResponse, AppointmentResponse, AppointmentUpdate

router = APIRouter(prefix="/appointments", tags=["Appointments"])


def _require_receptionist(user: User) -> None:
    # UC-LT-03/05: Receptionist creates, views, changes, cancels and searches appointments.
    # Doctor and Patient use scope-specific endpoints instead of this global module.
    if user.role != "receptionist":
        raise HTTPException(status_code=403, detail="Receptionist role required for appointment management.")


def _prefixed_id(value: str, prefix: str) -> int | None:
    match = re.fullmatch(rf"(?:{prefix}[\s-]*)?0*(\d+)", value.strip(), flags=re.IGNORECASE)
    return int(match.group(1)) if match else None


def _add_minutes(value: time, minutes: int = 30) -> time:
    dt = datetime.combine(datetime.today().date(), value) + timedelta(minutes=minutes)
    return dt.time().replace(second=0, microsecond=0)


def _ensure_patient(db: Session, patient_id: int) -> Patient:
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=400, detail=f"Patient id {patient_id} does not exist.")
    return patient


def _ensure_doctor(db: Session, doctor_id: int) -> Doctor:
    doctor = db.get(Doctor, doctor_id)
    if doctor is None:
        raise HTTPException(status_code=400, detail=f"Doctor id {doctor_id} does not exist.")
    if doctor.status != "active":
        raise HTTPException(status_code=409, detail="Doctor is inactive.")
    return doctor


def _validate_time_window(start_time: time, end_time: time) -> None:
    if start_time >= end_time:
        raise HTTPException(status_code=400, detail="End time must be after start time.")


def _ensure_within_shift(db: Session, doctor_id: int, appointment_date, start_time: time, end_time: time) -> None:
    shift = db.scalar(
        select(Shift).where(
            Shift.doctor_id == doctor_id,
            Shift.shift_date == appointment_date,
            Shift.status == "active",
            Shift.start_time <= start_time,
            Shift.end_time >= end_time,
        )
    )
    if shift is None:
        raise HTTPException(status_code=409, detail="Selected time is outside the doctor's active shift.")


def _ensure_no_conflict(
    db: Session,
    patient_id: int,
    doctor_id: int,
    appointment_date,
    start_time: time,
    end_time: time,
    exclude_id: int | None = None,
) -> None:
    doctor_stmt = select(Appointment).where(
        Appointment.doctor_id == doctor_id,
        Appointment.appointment_date == appointment_date,
        Appointment.status != "cancelled",
        Appointment.start_time < end_time,
        start_time < Appointment.end_time,
    )
    patient_stmt = select(Appointment).where(
        Appointment.patient_id == patient_id,
        Appointment.appointment_date == appointment_date,
        Appointment.status != "cancelled",
        Appointment.start_time < end_time,
        start_time < Appointment.end_time,
    )
    if exclude_id is not None:
        doctor_stmt = doctor_stmt.where(Appointment.id != exclude_id)
        patient_stmt = patient_stmt.where(Appointment.id != exclude_id)

    doctor_conflict = db.scalar(doctor_stmt)
    if doctor_conflict is not None:
        raise HTTPException(status_code=409, detail=f"Doctor already has appointment id {doctor_conflict.id} in this time range.")
    patient_conflict = db.scalar(patient_stmt)
    if patient_conflict is not None:
        raise HTTPException(status_code=409, detail=f"Patient already has appointment id {patient_conflict.id} in this time range.")


@router.get("", response_model=AppointmentListResponse)
def list_appointments(
    q: str | None = Query(default=None, description="Search patient, doctor, reason, or codes"),
    appointment_date: date | None = Query(default=None),
    appointment_status: str | None = Query(default=None, alias="status"),
    patient_id: int | None = Query(default=None),
    doctor_id: int | None = Query(default=None),
    order: Literal["asc", "desc"] = "desc",
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_receptionist(user)
    data_stmt = select(Appointment).join(Patient, Patient.id == Appointment.patient_id).join(Doctor, Doctor.id == Appointment.doctor_id)
    count_stmt = select(func.count(Appointment.id)).join(Patient, Patient.id == Appointment.patient_id).join(Doctor, Doctor.id == Appointment.doctor_id)
    filters = []

    if q and q.strip():
        raw = q.strip()
        keyword = f"%{raw}%"
        conditions = [
            Patient.full_name.ilike(keyword),
            Patient.phone.ilike(keyword),
            Doctor.full_name.ilike(keyword),
            Doctor.phone.ilike(keyword),
            Appointment.reason.ilike(keyword),
        ]
        # Accept UI codes as a convenience while keeping the report's business search criteria.
        lk_id = _prefixed_id(raw, "LK")
        bn_id = _prefixed_id(raw, "BN") if raw.upper().startswith("BN") else None
        bs_id = _prefixed_id(raw, "BS") if raw.upper().startswith("BS") else None
        if lk_id is not None and not raw.upper().startswith(("BN", "BS")):
            conditions.append(Appointment.id == lk_id)
        if bn_id is not None:
            conditions.append(Appointment.patient_id == bn_id)
        if bs_id is not None:
            conditions.append(Appointment.doctor_id == bs_id)
        filters.append(or_(*conditions))

    if appointment_date is not None:
        filters.append(Appointment.appointment_date == appointment_date)
    if appointment_status:
        filters.append(Appointment.status == appointment_status)
    if patient_id is not None:
        filters.append(Appointment.patient_id == patient_id)
    if doctor_id is not None:
        filters.append(Appointment.doctor_id == doctor_id)

    for condition in filters:
        data_stmt = data_stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    sort_columns = (Appointment.appointment_date, Appointment.start_time, Appointment.id)
    data_stmt = data_stmt.order_by(*sort_columns) if order == "asc" else data_stmt.order_by(*(c.desc() for c in sort_columns))
    total = db.scalar(count_stmt) or 0
    items = list(db.scalars(data_stmt.offset(skip).limit(limit)).all())
    return {"total": total, "items": items}


@router.get("/{appointment_id}", response_model=AppointmentResponse)
def get_appointment(
    appointment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_receptionist(user)
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(status_code=404, detail="Appointment not found.")
    return appointment


@router.post("", response_model=AppointmentResponse, status_code=status.HTTP_201_CREATED)
def create_appointment(
    payload: AppointmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_receptionist(user)
    _ensure_patient(db, payload.patient_id)
    _ensure_doctor(db, payload.doctor_id)
    start_time = payload.start_time
    end_time = payload.end_time or _add_minutes(start_time, 30)
    _validate_time_window(start_time, end_time)

    if payload.status != "cancelled":
        _ensure_within_shift(db, payload.doctor_id, payload.appointment_date, start_time, end_time)
        _ensure_no_conflict(db, payload.patient_id, payload.doctor_id, payload.appointment_date, start_time, end_time)

    appointment = Appointment(
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        created_by=user.id,
        appointment_date=payload.appointment_date,
        start_time=start_time,
        end_time=end_time,
        reason=payload.reason,
        status=payload.status,
    )
    db.add(appointment)
    try:
        db.commit()
        db.refresh(appointment)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Appointment data conflicts with existing data.")
    return appointment


@router.put("/{appointment_id}", response_model=AppointmentResponse)
def update_appointment(
    appointment_id: int,
    payload: AppointmentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_receptionist(user)
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(status_code=404, detail="Appointment not found.")

    data = payload.model_dump(exclude_unset=True)
    patient_id = data.get("patient_id", appointment.patient_id)
    doctor_id = data.get("doctor_id", appointment.doctor_id)
    appointment_date = data.get("appointment_date", appointment.appointment_date)
    start_time = data.get("start_time", appointment.start_time)
    end_time = data.get("end_time", appointment.end_time or _add_minutes(start_time, 30))
    new_status = data.get("status", appointment.status)

    if "start_time" in data and "end_time" not in data:
        end_time = _add_minutes(start_time, 30)
        data["end_time"] = end_time

    _ensure_patient(db, patient_id)
    _ensure_doctor(db, doctor_id)
    _validate_time_window(start_time, end_time)
    if new_status != "cancelled":
        _ensure_within_shift(db, doctor_id, appointment_date, start_time, end_time)
        _ensure_no_conflict(db, patient_id, doctor_id, appointment_date, start_time, end_time, exclude_id=appointment_id)

    for field, value in data.items():
        setattr(appointment, field, value)
    try:
        db.commit()
        db.refresh(appointment)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Appointment data conflicts with existing data.")
    return appointment

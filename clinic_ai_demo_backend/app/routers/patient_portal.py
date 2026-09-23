from datetime import datetime, timedelta, time

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import add_audit_log
from app.core.security import get_current_user
from app.database import get_db
from app.models.appointment import Appointment
from app.models.doctor import Doctor
from app.models.medical_record import MedicalRecord
from app.models.patient import Patient
from app.models.shift import Shift
from app.models.user import User
from app.schemas.patient_portal import (
    PatientAppointmentCreate,
    PatientAppointmentUpdate,
    PatientProfileUpdate,
)

router = APIRouter(prefix="/patient-portal", tags=["Patient Portal"])


def _patient(db: Session, user: User) -> Patient:
    if user.role != "patient":
        raise HTTPException(status_code=403, detail="Patient role required.")
    patient = db.scalar(select(Patient).where(Patient.user_id == user.id))
    if patient is None:
        raise HTTPException(
            status_code=409,
            detail="Patient account is not linked to a patient profile. Run link_demo_accounts.bat once.",
        )
    return patient


def _end_time(start: time) -> time:
    dt = datetime.combine(datetime.today().date(), start) + timedelta(minutes=30)
    return dt.time().replace(second=0, microsecond=0)


def _validate_booking(
    db: Session,
    patient_id: int,
    doctor_id: int,
    appointment_date,
    start_time: time,
    end_time: time,
    exclude_id: int | None = None,
):
    doctor = db.get(Doctor, doctor_id)
    if doctor is None or doctor.status != "active":
        raise HTTPException(status_code=409, detail="Selected doctor is not active.")

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

    if db.scalar(doctor_stmt):
        raise HTTPException(status_code=409, detail="Doctor already has an appointment in this time range.")
    if db.scalar(patient_stmt):
        raise HTTPException(status_code=409, detail="You already have another appointment in this time range.")


def _appointment_dict(a: Appointment) -> dict:
    return {
        "id": a.id,
        "patient_id": a.patient_id,
        "doctor_id": a.doctor_id,
        "created_by": a.created_by,
        "appointment_date": a.appointment_date,
        "start_time": a.start_time,
        "end_time": a.end_time,
        "reason": a.reason,
        "status": a.status,
    }


@router.get("/context")
def context(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    patient = _patient(db, user)
    doctors = list(
        db.scalars(
            select(Doctor).where(Doctor.status == "active").order_by(Doctor.full_name)
        ).all()
    )
    shifts = list(
        db.scalars(
            select(Shift)
            .where(Shift.status == "active")
            .order_by(Shift.shift_date, Shift.start_time)
        ).all()
    )
    appointments = list(
        db.scalars(
            select(Appointment)
            .where(Appointment.patient_id == patient.id)
            .order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc())
        ).all()
    )
    appointment_ids = [a.id for a in appointments]
    records = (
        list(
            db.scalars(
                select(MedicalRecord).where(MedicalRecord.appointment_id.in_(appointment_ids))
            ).all()
        )
        if appointment_ids else []
    )

    record_rows = []
    for r in records:
        a = db.get(Appointment, r.appointment_id)
        d = db.get(Doctor, a.doctor_id)
        record_rows.append({
            "id": r.id,
            "appointment_id": r.appointment_id,
            "patient_id": a.patient_id,
            "patient_name": patient.full_name,
            "doctor_id": a.doctor_id,
            "doctor_name": d.full_name if d else f"Doctor #{a.doctor_id}",
            "appointment_date": a.appointment_date,
            "start_time": a.start_time,
            "symptoms": r.symptoms,
            "conclusion": r.conclusion,
            "doctor_note": r.doctor_note,
            "prescription_note": r.prescription_note,
            "post_visit_guidance": r.post_visit_guidance,
            "created_at": r.created_at,
        })

    return {
        "patient": {
            "id": patient.id,
            "user_id": patient.user_id,
            "full_name": patient.full_name,
            "date_of_birth": patient.date_of_birth,
            "gender": patient.gender,
            "phone": patient.phone,
            "address": patient.address,
        },
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "status": user.status,
        },
        "doctors": [
            {
                "id": d.id,
                "user_id": d.user_id,
                "full_name": d.full_name,
                "specialty": d.specialty,
                "phone": d.phone,
                "license_no": d.license_no,
                "status": d.status,
            }
            for d in doctors
        ],
        "shifts": [
            {
                "id": s.id,
                "doctor_id": s.doctor_id,
                "shift_date": s.shift_date,
                "start_time": s.start_time,
                "end_time": s.end_time,
                "status": s.status,
            }
            for s in shifts
        ],
        "appointments": [_appointment_dict(a) for a in appointments],
        "records": record_rows,
    }


@router.put("/profile")
def update_profile(
    payload: PatientProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    patient = _patient(db, user)
    data = payload.model_dump(exclude_unset=True)

    email = data.pop("email", None) if "email" in data else None
    if email is not None:
        email = email.strip() or None
        if email:
            existing = db.scalar(
                select(User).where(User.email == email, User.id != user.id)
            )
            if existing:
                raise HTTPException(status_code=409, detail="Email already exists.")
        user.email = email

    for field, value in data.items():
        setattr(patient, field, value)

    add_audit_log(db, user, "UPDATE", "PATIENT_PROFILE", patient.id, "Patient updated own profile.")
    db.commit()
    db.refresh(patient)
    return {
        "id": patient.id,
        "user_id": patient.user_id,
        "full_name": patient.full_name,
        "date_of_birth": patient.date_of_birth,
        "gender": patient.gender,
        "phone": patient.phone,
        "address": patient.address,
        "email": user.email,
    }


@router.post("/appointments", status_code=status.HTTP_201_CREATED)
def create_appointment(
    payload: PatientAppointmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    patient = _patient(db, user)
    end = _end_time(payload.start_time)
    _validate_booking(
        db, patient.id, payload.doctor_id, payload.appointment_date,
        payload.start_time, end
    )

    appointment = Appointment(
        patient_id=patient.id,
        doctor_id=payload.doctor_id,
        created_by=user.id,
        appointment_date=payload.appointment_date,
        start_time=payload.start_time,
        end_time=end,
        reason=payload.reason.strip(),
        status="pending",
    )
    db.add(appointment)
    db.flush()
    add_audit_log(db, user, "CREATE", "APPOINTMENTS", appointment.id, "Patient created own appointment.")
    db.commit()
    db.refresh(appointment)
    return _appointment_dict(appointment)


@router.put("/appointments/{appointment_id}")
def update_appointment(
    appointment_id: int,
    payload: PatientAppointmentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    patient = _patient(db, user)
    appointment = db.get(Appointment, appointment_id)
    if appointment is None or appointment.patient_id != patient.id:
        raise HTTPException(status_code=404, detail="Appointment not found.")

    if appointment.status == "completed":
        raise HTTPException(status_code=409, detail="Completed appointments cannot be changed.")

    data = payload.model_dump(exclude_unset=True)
    if data.get("status") == "cancelled":
        appointment.status = "cancelled"
        add_audit_log(db, user, "CANCEL", "APPOINTMENTS", appointment.id, "Patient cancelled own appointment.")
        db.commit()
        db.refresh(appointment)
        return _appointment_dict(appointment)

    doctor_id = data.get("doctor_id", appointment.doctor_id)
    appointment_date = data.get("appointment_date", appointment.appointment_date)
    start_time = data.get("start_time", appointment.start_time)
    end = _end_time(start_time)

    _validate_booking(
        db, patient.id, doctor_id, appointment_date, start_time, end,
        exclude_id=appointment.id
    )

    appointment.doctor_id = doctor_id
    appointment.appointment_date = appointment_date
    appointment.start_time = start_time
    appointment.end_time = end
    if "reason" in data and data["reason"] is not None:
        appointment.reason = data["reason"].strip()
    appointment.status = "pending"

    add_audit_log(db, user, "UPDATE", "APPOINTMENTS", appointment.id, "Patient rescheduled own appointment.")
    db.commit()
    db.refresh(appointment)
    return _appointment_dict(appointment)

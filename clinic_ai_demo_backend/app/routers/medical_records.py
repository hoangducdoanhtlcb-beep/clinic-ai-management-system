from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import add_audit_log
from app.core.security import get_current_user
from app.database import get_db
from app.models.appointment import Appointment
from app.models.doctor import Doctor
from app.models.medical_record import MedicalRecord
from app.models.patient import Patient
from app.models.user import User
from app.schemas.medical_record import MedicalRecordCreate, MedicalRecordUpdate

router = APIRouter(prefix="/medical-records", tags=["Medical Records"])


def _doctor_for_user(db: Session, user: User) -> Doctor:
    doctor = db.scalar(select(Doctor).where(Doctor.user_id == user.id))
    if doctor is None:
        raise HTTPException(
            status_code=409,
            detail="Doctor account is not linked to a doctor profile. Run link_demo_accounts.bat once.",
        )
    return doctor


def _patient_for_user(db: Session, user: User) -> Patient:
    patient = db.scalar(select(Patient).where(Patient.user_id == user.id))
    if patient is None:
        raise HTTPException(
            status_code=409,
            detail="Patient account is not linked to a patient profile. Run link_demo_accounts.bat once.",
        )
    return patient


def _check_record_access(db: Session, user: User, appointment: Appointment) -> None:
    # UC-BS-02/03/04: only the assigned doctor can access clinical records here.
    if user.role != "doctor":
        raise HTTPException(status_code=403, detail="Doctor role required for medical records.")
    doctor = _doctor_for_user(db, user)
    if appointment.doctor_id != doctor.id:
        raise HTTPException(status_code=403, detail="This appointment is outside your assigned scope.")


def _record_dict(db: Session, record: MedicalRecord) -> dict:
    appointment = db.get(Appointment, record.appointment_id)
    patient = db.get(Patient, appointment.patient_id)
    doctor = db.get(Doctor, appointment.doctor_id)
    return {
        "id": record.id,
        "appointment_id": record.appointment_id,
        "patient_id": appointment.patient_id,
        "patient_name": patient.full_name if patient else f"Patient #{appointment.patient_id}",
        "doctor_id": appointment.doctor_id,
        "doctor_name": doctor.full_name if doctor else f"Doctor #{appointment.doctor_id}",
        "appointment_date": appointment.appointment_date,
        "start_time": appointment.start_time,
        "symptoms": record.symptoms,
        "conclusion": record.conclusion,
        "doctor_note": record.doctor_note,
        "prescription_note": record.prescription_note,
        "post_visit_guidance": record.post_visit_guidance,
        "created_at": record.created_at,
    }


@router.get("")
def list_medical_records(
    appointment_id: int | None = Query(default=None),
    patient_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(MedicalRecord).join(
        Appointment, Appointment.id == MedicalRecord.appointment_id
    )

    if appointment_id is not None:
        stmt = stmt.where(MedicalRecord.appointment_id == appointment_id)
    if patient_id is not None:
        stmt = stmt.where(Appointment.patient_id == patient_id)

    if user.role != "doctor":
        raise HTTPException(status_code=403, detail="Doctor role required for medical records.")
    doctor = _doctor_for_user(db, user)
    stmt = stmt.where(Appointment.doctor_id == doctor.id)

    records = list(db.scalars(stmt.order_by(Appointment.appointment_date.desc())).all())
    return {"total": len(records), "items": [_record_dict(db, r) for r in records]}


@router.get("/context")
def doctor_context(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "doctor":
        raise HTTPException(status_code=403, detail="Doctor role required.")

    doctor = _doctor_for_user(db, user)
    appointments = list(
        db.scalars(
            select(Appointment)
            .where(Appointment.doctor_id == doctor.id)
            .order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc())
        ).all()
    )
    patient_ids = sorted({a.patient_id for a in appointments})
    patients = (
        list(db.scalars(select(Patient).where(Patient.id.in_(patient_ids))).all())
        if patient_ids
        else []
    )
    appointment_ids = [a.id for a in appointments]
    records = (
        list(
            db.scalars(
                select(MedicalRecord).where(MedicalRecord.appointment_id.in_(appointment_ids))
            ).all()
        )
        if appointment_ids
        else []
    )

    return {
        "doctor": {
            "id": doctor.id,
            "user_id": doctor.user_id,
            "full_name": doctor.full_name,
            "specialty": doctor.specialty,
            "phone": doctor.phone,
            "license_no": doctor.license_no,
            "status": doctor.status,
        },
        "patients": [
            {
                "id": p.id,
                "user_id": p.user_id,
                "full_name": p.full_name,
                "date_of_birth": p.date_of_birth,
                "gender": p.gender,
                "phone": p.phone,
                "address": p.address,
            }
            for p in patients
        ],
        "appointments": [
            {
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
            for a in appointments
        ],
        "records": [_record_dict(db, r) for r in records],
    }


@router.get("/my-guidance")
def my_guidance(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "patient":
        raise HTTPException(status_code=403, detail="Patient role required.")

    patient = _patient_for_user(db, user)
    records = list(
        db.scalars(
            select(MedicalRecord)
            .join(Appointment, Appointment.id == MedicalRecord.appointment_id)
            .where(Appointment.patient_id == patient.id)
            .order_by(Appointment.appointment_date.desc())
        ).all()
    )
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
        "records": [_record_dict(db, r) for r in records],
    }


@router.get("/{record_id}")
def get_medical_record(
    record_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    record = db.get(MedicalRecord, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Medical record not found.")
    appointment = db.get(Appointment, record.appointment_id)
    _check_record_access(db, user, appointment)
    return _record_dict(db, record)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_medical_record(
    payload: MedicalRecordCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can create medical records.")

    appointment = db.get(Appointment, payload.appointment_id)
    if appointment is None:
        raise HTTPException(status_code=400, detail="Appointment does not exist.")

    _check_record_access(db, user, appointment)

    if appointment.status == "cancelled":
        raise HTTPException(status_code=409, detail="Cannot create a record for a cancelled appointment.")

    existing = db.scalar(
        select(MedicalRecord).where(MedicalRecord.appointment_id == appointment.id)
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="This appointment already has a medical record.")

    record = MedicalRecord(
        appointment_id=appointment.id,
        symptoms=payload.symptoms,
        conclusion=payload.conclusion,
        doctor_note=payload.doctor_note,
        prescription_note=payload.prescription_note,
        post_visit_guidance=payload.post_visit_guidance,
    )
    db.add(record)
    db.flush()

    appointment.status = "completed"
    add_audit_log(
        db, user, "CREATE", "MEDICAL_RECORD", record.id,
        f"Created medical record for appointment {appointment.id}.",
    )
    db.commit()
    db.refresh(record)
    return _record_dict(db, record)


@router.put("/{record_id}")
def update_medical_record(
    record_id: int,
    payload: MedicalRecordUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can update medical records.")

    record = db.get(MedicalRecord, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Medical record not found.")

    appointment = db.get(Appointment, record.appointment_id)
    _check_record_access(db, user, appointment)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(record, field, value)

    add_audit_log(
        db, user, "UPDATE", "MEDICAL_RECORD", record.id,
        f"Updated medical record for appointment {appointment.id}.",
    )
    db.commit()
    db.refresh(record)
    return _record_dict(db, record)

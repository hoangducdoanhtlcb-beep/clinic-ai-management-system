import re
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database import get_db
from app.models.appointment import Appointment
from app.models.doctor import Doctor
from app.models.user import User
from app.schemas.doctor import DoctorCreate, DoctorListResponse, DoctorResponse, DoctorUpdate

router = APIRouter(prefix="/doctors", tags=["Doctors"])


def _can_read(user: User) -> bool:
    # Admin manages doctors. Receptionist only reads doctor data to arrange appointments.
    return user.role in {"admin", "receptionist"}


def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can manage doctors.")


def _doctor_id_from_keyword(value: str) -> int | None:
    match = re.fullmatch(r"(?:BS[\s-]*)?0*(\d+)", value.strip(), flags=re.IGNORECASE)
    return int(match.group(1)) if match else None


def _username_from_doctor(payload: DoctorCreate) -> str:
    source = payload.license_no or payload.full_name or "doctor"
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", source).strip("_").lower()
    slug = slug[:30] or "doctor"
    return f"doctor_{slug}_{uuid4().hex[:6]}"


def _validate_user_link(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=400, detail=f"User id {user_id} does not exist.")
    if user.role != "doctor":
        raise HTTPException(status_code=400, detail="The selected user must have role 'doctor'.")
    linked = db.scalar(select(Doctor).where(Doctor.user_id == user_id))
    if linked is not None:
        raise HTTPException(status_code=409, detail="This user account is already linked to a doctor.")
    return user


def _ensure_unique_license(db: Session, license_no: str | None, exclude_id: int | None = None) -> None:
    if not license_no:
        return
    stmt = select(Doctor).where(func.lower(Doctor.license_no) == license_no.lower())
    if exclude_id is not None:
        stmt = stmt.where(Doctor.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise HTTPException(status_code=409, detail="License number already exists.")


@router.get("", response_model=DoctorListResponse)
def list_doctors(
    q: str | None = Query(default=None, description="Search doctor code/id, name, specialty, phone, or license"),
    specialty: str | None = Query(default=None),
    doctor_status: str | None = Query(default=None, alias="status"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_read(user):
        raise HTTPException(status_code=403, detail="You do not have permission to view doctor records.")
    filters = []

    if q and q.strip():
        raw = q.strip()
        keyword = f"%{raw}%"
        conditions = [
            Doctor.full_name.ilike(keyword),
            Doctor.specialty.ilike(keyword),
            Doctor.phone.ilike(keyword),
            Doctor.license_no.ilike(keyword),
        ]
        doctor_id = _doctor_id_from_keyword(raw)
        if doctor_id is not None:
            conditions.append(Doctor.id == doctor_id)
        filters.append(or_(*conditions))

    if specialty and specialty.strip():
        filters.append(func.lower(Doctor.specialty) == specialty.strip().lower())

    if doctor_status and doctor_status.strip():
        filters.append(Doctor.status == doctor_status.strip())

    count_stmt = select(func.count(Doctor.id))
    data_stmt = select(Doctor)
    for condition in filters:
        count_stmt = count_stmt.where(condition)
        data_stmt = data_stmt.where(condition)

    total = db.scalar(count_stmt) or 0
    items = list(db.scalars(data_stmt.order_by(Doctor.full_name).offset(skip).limit(limit)).all())
    return {"total": total, "items": items}


@router.get("/{doctor_id}", response_model=DoctorResponse)
def get_doctor(
    doctor_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_read(user):
        raise HTTPException(status_code=403, detail="You do not have permission to view doctor records.")
    doctor = db.get(Doctor, doctor_id)
    if doctor is None:
        raise HTTPException(status_code=404, detail="Doctor not found.")
    return doctor


@router.post("", response_model=DoctorResponse, status_code=status.HTTP_201_CREATED)
def create_doctor(
    payload: DoctorCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    _ensure_unique_license(db, payload.license_no)

    if payload.user_id is not None:
        linked_user = _validate_user_link(db, payload.user_id)
    else:
        linked_user = User(
            username=_username_from_doctor(payload),
            email=None,
            password_hash="PENDING_AUTH_SETUP",
            role="doctor",
            status="locked",
        )
        db.add(linked_user)
        db.flush()

    doctor = Doctor(
        user_id=linked_user.id,
        full_name=payload.full_name,
        specialty=payload.specialty,
        phone=payload.phone,
        license_no=payload.license_no,
        status=payload.status,
    )
    db.add(doctor)
    try:
        db.commit()
        db.refresh(doctor)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Doctor data conflicts with existing data.")
    return doctor


@router.put("/{doctor_id}", response_model=DoctorResponse)
def update_doctor(
    doctor_id: int,
    payload: DoctorUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    doctor = db.get(Doctor, doctor_id)
    if doctor is None:
        raise HTTPException(status_code=404, detail="Doctor not found.")

    update_data = payload.model_dump(exclude_unset=True)
    if "license_no" in update_data:
        _ensure_unique_license(db, update_data["license_no"], doctor_id)
    for field, value in update_data.items():
        setattr(doctor, field, value)

    try:
        db.commit()
        db.refresh(doctor)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Doctor data conflicts with existing data.")
    return doctor


@router.delete("/{doctor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_doctor(
    doctor_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    doctor = db.get(Doctor, doctor_id)
    if doctor is None:
        raise HTTPException(status_code=404, detail="Doctor not found.")

    has_appointments = db.scalar(select(func.count(Appointment.id)).where(Appointment.doctor_id == doctor_id)) or 0
    if has_appointments:
        raise HTTPException(status_code=409, detail="Doctor cannot be deleted because appointment records are linked to this doctor.")

    linked_user = db.get(User, doctor.user_id)
    placeholder_username = linked_user.username if linked_user else ""
    try:
        db.delete(doctor)
        db.flush()
        if linked_user is not None and placeholder_username.startswith("doctor_") and linked_user.password_hash == "PENDING_AUTH_SETUP":
            db.delete(linked_user)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Doctor cannot be deleted because related data exists.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

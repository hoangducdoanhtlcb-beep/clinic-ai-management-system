import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database import get_db
from app.models.patient import Patient
from app.models.user import User
from app.schemas.patient import PatientCreate, PatientListResponse, PatientResponse, PatientUpdate

router = APIRouter(prefix="/patients", tags=["Patients"])


def _require_receptionist(user: User) -> None:
    # UC-LT-02/05: Receptionist manages and searches patient administrative records.
    if user.role != "receptionist":
        raise HTTPException(status_code=403, detail="Receptionist role required for patient management.")


def _patient_id_from_keyword(value: str) -> int | None:
    text = value.strip()
    match = re.fullmatch(r"(?:BN[\s-]*)?0*(\d+)", text, flags=re.IGNORECASE)
    return int(match.group(1)) if match else None


def _ensure_user_exists(db: Session, user_id: int | None) -> None:
    if user_id is None:
        return
    if db.get(User, user_id) is None:
        raise HTTPException(status_code=400, detail=f"User id {user_id} does not exist.")


def _ensure_unique_phone(db: Session, phone: str | None, exclude_patient_id: int | None = None) -> None:
    if phone is None:
        return
    stmt = select(Patient).where(Patient.phone == phone)
    if exclude_patient_id is not None:
        stmt = stmt.where(Patient.id != exclude_patient_id)
    if db.scalar(stmt) is not None:
        raise HTTPException(status_code=409, detail="A patient with this phone number already exists.")


def _ensure_unique_user_link(db: Session, user_id: int | None, exclude_patient_id: int | None = None) -> None:
    if user_id is None:
        return
    stmt = select(Patient).where(Patient.user_id == user_id)
    if exclude_patient_id is not None:
        stmt = stmt.where(Patient.id != exclude_patient_id)
    if db.scalar(stmt) is not None:
        raise HTTPException(status_code=409, detail="This user account is already linked to another patient.")


@router.get("", response_model=PatientListResponse)
def list_patients(
    q: str | None = Query(default=None, description="Search by patient code/id, full name, phone, or address"),
    gender: str | None = Query(default=None),
    sort_by: Literal["id", "full_name", "date_of_birth", "phone"] = "id",
    order: Literal["asc", "desc"] = "asc",
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_receptionist(user)
    filters = []

    if q and q.strip():
        raw = q.strip()
        keyword = f"%{raw}%"
        conditions = [
            Patient.full_name.ilike(keyword),
            Patient.phone.ilike(keyword),
            Patient.address.ilike(keyword),
        ]
        patient_id = _patient_id_from_keyword(raw)
        if patient_id is not None:
            conditions.append(Patient.id == patient_id)
        filters.append(or_(*conditions))

    if gender and gender.strip():
        filters.append(func.lower(Patient.gender) == gender.strip().lower())

    count_stmt = select(func.count(Patient.id))
    data_stmt = select(Patient)

    for condition in filters:
        count_stmt = count_stmt.where(condition)
        data_stmt = data_stmt.where(condition)

    sort_column = getattr(Patient, sort_by)
    data_stmt = data_stmt.order_by(desc(sort_column) if order == "desc" else asc(sort_column))
    data_stmt = data_stmt.offset(skip).limit(limit)

    total = db.scalar(count_stmt) or 0
    items = list(db.scalars(data_stmt).all())
    return {"total": total, "items": items}


@router.get("/{patient_id}", response_model=PatientResponse)
def get_patient(
    patient_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_receptionist(user)
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found.")
    return patient


@router.post("", response_model=PatientResponse, status_code=status.HTTP_201_CREATED)
def create_patient(
    payload: PatientCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_receptionist(user)
    _ensure_user_exists(db, payload.user_id)
    _ensure_unique_phone(db, payload.phone)
    _ensure_unique_user_link(db, payload.user_id)

    patient = Patient(**payload.model_dump())
    db.add(patient)
    try:
        db.commit()
        db.refresh(patient)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Patient data conflicts with existing data.")
    return patient


@router.put("/{patient_id}", response_model=PatientResponse)
def update_patient(
    patient_id: int,
    payload: PatientUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_receptionist(user)
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found.")

    update_data = payload.model_dump(exclude_unset=True)

    if "user_id" in update_data:
        _ensure_user_exists(db, update_data["user_id"])
        _ensure_unique_user_link(db, update_data["user_id"], patient_id)

    if "phone" in update_data:
        _ensure_unique_phone(db, update_data["phone"], patient_id)

    for field, value in update_data.items():
        setattr(patient, field, value)

    try:
        db.commit()
        db.refresh(patient)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Patient data conflicts with existing data.")
    return patient


@router.delete("/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_patient(
    patient_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Ch.3 describes patient CRUD; this operation remains in the Receptionist module.
    _require_receptionist(user)
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found.")

    try:
        db.delete(patient)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Patient cannot be deleted because related records exist.")

    return Response(status_code=status.HTTP_204_NO_CONTENT)

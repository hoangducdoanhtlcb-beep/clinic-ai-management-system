from datetime import date, time

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database import get_db
from app.models.doctor import Doctor
from app.models.shift import Shift
from app.models.user import User
from app.schemas.shift import ShiftCreate, ShiftListResponse, ShiftResponse, ShiftUpdate

router = APIRouter(prefix="/shifts", tags=["Shifts"])


def _can_read(user: User) -> bool:
    # Admin manages shifts; Receptionist reads them to place valid appointments.
    return user.role in {"admin", "receptionist"}


def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can manage shifts.")


def _ensure_doctor(db: Session, doctor_id: int) -> Doctor:
    doctor = db.get(Doctor, doctor_id)
    if doctor is None:
        raise HTTPException(status_code=400, detail=f"Doctor id {doctor_id} does not exist.")
    if doctor.status != "active":
        raise HTTPException(status_code=409, detail="Cannot assign a shift to an inactive doctor.")
    return doctor


def _validate_time(start_time: time, end_time: time) -> None:
    if start_time >= end_time:
        raise HTTPException(status_code=400, detail="End time must be after start time.")


def _ensure_no_overlap(db: Session, doctor_id: int, shift_date: date, start_time: time, end_time: time, exclude_id: int | None = None) -> None:
    stmt = select(Shift).where(
        Shift.doctor_id == doctor_id,
        Shift.shift_date == shift_date,
        Shift.status == "active",
        Shift.start_time < end_time,
        start_time < Shift.end_time,
    )
    if exclude_id is not None:
        stmt = stmt.where(Shift.id != exclude_id)
    conflict = db.scalar(stmt)
    if conflict is not None:
        raise HTTPException(status_code=409, detail=f"Shift overlaps with existing shift id {conflict.id}.")


@router.get("", response_model=ShiftListResponse)
def list_shifts(
    doctor_id: int | None = Query(default=None),
    shift_date: date | None = Query(default=None),
    shift_status: str | None = Query(default=None, alias="status"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_read(user):
        raise HTTPException(status_code=403, detail="You do not have permission to view shifts.")
    filters = []
    if doctor_id is not None:
        filters.append(Shift.doctor_id == doctor_id)
    if shift_date is not None:
        filters.append(Shift.shift_date == shift_date)
    if shift_status:
        filters.append(Shift.status == shift_status)

    count_stmt = select(func.count(Shift.id))
    data_stmt = select(Shift)
    for condition in filters:
        count_stmt = count_stmt.where(condition)
        data_stmt = data_stmt.where(condition)
    total = db.scalar(count_stmt) or 0
    items = list(db.scalars(data_stmt.order_by(Shift.shift_date, Shift.start_time, Shift.doctor_id).offset(skip).limit(limit)).all())
    return {"total": total, "items": items}


@router.get("/{shift_id}", response_model=ShiftResponse)
def get_shift(shift_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not _can_read(user):
        raise HTTPException(status_code=403, detail="You do not have permission to view shifts.")
    shift = db.get(Shift, shift_id)
    if shift is None:
        raise HTTPException(status_code=404, detail="Shift not found.")
    return shift


@router.post("", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
def create_shift(payload: ShiftCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    _ensure_doctor(db, payload.doctor_id)
    _validate_time(payload.start_time, payload.end_time)
    if payload.status == "active":
        _ensure_no_overlap(db, payload.doctor_id, payload.shift_date, payload.start_time, payload.end_time)
    shift = Shift(doctor_id=payload.doctor_id, shift_date=payload.shift_date, start_time=payload.start_time, end_time=payload.end_time, status=payload.status)
    db.add(shift)
    try:
        db.commit()
        db.refresh(shift)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Shift data conflicts with existing data.")
    return shift


@router.put("/{shift_id}", response_model=ShiftResponse)
def update_shift(shift_id: int, payload: ShiftUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    shift = db.get(Shift, shift_id)
    if shift is None:
        raise HTTPException(status_code=404, detail="Shift not found.")
    data = payload.model_dump(exclude_unset=True)
    doctor_id = data.get("doctor_id", shift.doctor_id)
    shift_date = data.get("shift_date", shift.shift_date)
    start_time = data.get("start_time", shift.start_time)
    end_time = data.get("end_time", shift.end_time)
    new_status = data.get("status", shift.status)
    _ensure_doctor(db, doctor_id)
    _validate_time(start_time, end_time)
    if new_status == "active":
        _ensure_no_overlap(db, doctor_id, shift_date, start_time, end_time, exclude_id=shift_id)
    for field, value in data.items():
        setattr(shift, field, value)
    try:
        db.commit()
        db.refresh(shift)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Shift data conflicts with existing data.")
    return shift


@router.delete("/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shift(shift_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    shift = db.get(Shift, shift_id)
    if shift is None:
        raise HTTPException(status_code=404, detail="Shift not found.")
    db.delete(shift)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Shift cannot be deleted because related data exists.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

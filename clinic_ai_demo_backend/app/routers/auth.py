from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import add_audit_log
from app.core.security import create_access_token, get_current_user, hash_password, verify_password
from app.database import get_db
from app.models.doctor import Doctor
from app.models.patient import Patient
from app.models.user import User
from app.schemas.auth import AuthUserResponse, LoginRequest, LoginResponse, PatientRegisterRequest

router = APIRouter(prefix="/auth", tags=["Auth"])


def _display_name(db: Session, user: User) -> str | None:
    if user.role == "patient":
        patient = db.scalar(select(Patient).where(Patient.user_id == user.id))
        return patient.full_name if patient else None
    if user.role == "doctor":
        doctor = db.scalar(select(Doctor).where(Doctor.user_id == user.id))
        return doctor.full_name if doctor else None
    return None


def _auth_user(db: Session, user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": _display_name(db, user),
        "role": user.role,
        "status": user.status,
    }


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    username = payload.username.strip()
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )
    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is locked.",
        )

    token = create_access_token(user)
    add_audit_log(
        db, user, "LOGIN", "AUTH", user.id,
        f"Successful login as role {user.role}.",
    )
    db.commit()

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _auth_user(db, user),
    }


@router.post("/register-patient", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
def register_patient(payload: PatientRegisterRequest, db: Session = Depends(get_db)):
    username = payload.username.strip()
    email = payload.email.strip().lower() if payload.email and payload.email.strip() else None
    full_name = payload.full_name.strip()
    phone = payload.phone.strip()
    address = payload.address.strip() if payload.address and payload.address.strip() else None
    gender = payload.gender.strip() if payload.gender and payload.gender.strip() else None

    if not full_name:
        raise HTTPException(status_code=422, detail="Họ tên không được để trống.")

    existing_user = db.scalar(
        select(User).where(
            or_(
                func.lower(User.username) == username.lower(),
                func.lower(User.email) == email if email else False,
            )
        )
    )
    if existing_user is not None:
        raise HTTPException(status_code=409, detail="Tên đăng nhập hoặc email đã được sử dụng.")

    existing_patient = db.scalar(select(Patient).where(Patient.phone == phone))
    if existing_patient is not None:
        raise HTTPException(status_code=409, detail="Số điện thoại đã tồn tại trong hồ sơ bệnh nhân.")

    user = User(
        username=username,
        email=email,
        password_hash=hash_password(payload.password),
        role="patient",
        status="active",
    )
    db.add(user)

    try:
        db.flush()
        patient = Patient(
            user_id=user.id,
            full_name=full_name,
            date_of_birth=payload.date_of_birth,
            gender=gender,
            phone=phone,
            address=address,
        )
        db.add(patient)
        db.flush()
        add_audit_log(
            db, user, "REGISTER", "AUTH", user.id,
            "Patient self-registration completed.",
        )
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Thông tin đăng ký đã tồn tại.")

    token = create_access_token(user)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _auth_user(db, user),
    }


@router.get("/me", response_model=AuthUserResponse)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _auth_user(db, user)

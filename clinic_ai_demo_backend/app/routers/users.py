from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import add_audit_log
from app.core.security import get_current_user, hash_password
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserListResponse, UserResponse, UserUpdate

router = APIRouter(prefix="/users", tags=["Users"])


def _unique_username(db: Session, username: str, exclude_id: int | None = None):
    stmt = select(User).where(func.lower(User.username) == username.lower())
    if exclude_id is not None:
        stmt = stmt.where(User.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise HTTPException(status_code=409, detail="Username already exists.")


def _unique_email(db: Session, email: str | None, exclude_id: int | None = None):
    if not email:
        return
    stmt = select(User).where(func.lower(User.email) == email.lower())
    if exclude_id is not None:
        stmt = stmt.where(User.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise HTTPException(status_code=409, detail="Email already exists.")


@router.get("", response_model=UserListResponse)
def list_users(
    q: str | None = Query(default=None),
    role: str | None = Query(default=None),
    user_status: str | None = Query(default=None, alias="status"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
):
    filters = []
    if q and q.strip():
        keyword = f"%{q.strip()}%"
        filters.append(or_(User.username.ilike(keyword), User.email.ilike(keyword)))
    if role:
        filters.append(User.role == role)
    if user_status:
        filters.append(User.status == user_status)

    count_stmt = select(func.count(User.id))
    data_stmt = select(User)
    for condition in filters:
        count_stmt = count_stmt.where(condition)
        data_stmt = data_stmt.where(condition)

    total = db.scalar(count_stmt) or 0
    items = list(db.scalars(data_stmt.order_by(User.id).offset(skip).limit(limit)).all())
    return {"total": total, "items": items}


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.role == "patient":
        raise HTTPException(status_code=403, detail="Patient accounts must be created through patient self-registration.")
    username = payload.username.strip()
    email = payload.email.strip() if payload.email else None
    _unique_username(db, username)
    _unique_email(db, email)

    user = User(
        username=username,
        email=email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        status=payload.status,
    )
    db.add(user)
    db.flush()
    add_audit_log(
        db, current_user, "CREATE", "USERS", user.id,
        f"Created user {user.username} with role {user.role}.",
    )
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    data = payload.model_dump(exclude_unset=True)

    if "username" in data and data["username"] is not None:
        data["username"] = data["username"].strip()
        _unique_username(db, data["username"], user_id)

    if "email" in data:
        data["email"] = data["email"].strip() if data["email"] else None
        _unique_email(db, data["email"], user_id)

    if user.id == current_user.id and data.get("status") == "locked":
        raise HTTPException(status_code=409, detail="You cannot lock your own account.")

    if "role" in data and data["role"] == "patient" and user.role != "patient":
        raise HTTPException(status_code=403, detail="Patient role is assigned through patient registration.")

    password = data.pop("password", None)
    if password:
        user.password_hash = hash_password(password)

    for field, value in data.items():
        setattr(user, field, value)

    add_audit_log(
        db, current_user, "UPDATE", "USERS", user.id,
        f"Updated user {user.username}. Role={user.role}, status={user.status}.",
    )
    db.commit()
    db.refresh(user)
    return user

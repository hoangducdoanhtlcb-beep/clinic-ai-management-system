from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import add_audit_log
from app.core.security import get_current_user
from app.database import get_db
from app.models.invoice_item import InvoiceItem
from app.models.service import Service
from app.models.user import User
from app.schemas.service import ServiceCreate, ServiceUpdate

router = APIRouter(prefix="/services", tags=["Services"])


def _can_read(user: User) -> bool:
    return user.role in {"accountant", "receptionist"}


def _can_manage(user: User) -> bool:
    return user.role == "accountant"


@router.get("")
def list_services(
    q: str | None = Query(default=None),
    service_status: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_read(user):
        raise HTTPException(status_code=403, detail="You do not have permission to view services.")

    stmt = select(Service)
    if q and q.strip():
        raw = q.strip()
        conditions = [Service.name.ilike(f"%{raw}%")]
        digits = raw.upper().replace("DV", "").replace("-", "").replace(" ", "")
        if digits.isdigit():
            conditions.append(Service.id == int(digits))
        stmt = stmt.where(or_(*conditions))
    if service_status:
        stmt = stmt.where(Service.status == service_status)

    items = list(db.scalars(stmt.order_by(Service.name)).all())
    return {"total": len(items), "items": items}


@router.get("/{service_id}")
def get_service(
    service_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_read(user):
        raise HTTPException(status_code=403, detail="You do not have permission to view services.")
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status_code=404, detail="Service not found.")
    return service


@router.post("", status_code=status.HTTP_201_CREATED)
def create_service(
    payload: ServiceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage(user):
        raise HTTPException(status_code=403, detail="Only accountants can manage services.")

    if db.scalar(select(Service).where(func.lower(Service.name) == payload.name.strip().lower())):
        raise HTTPException(status_code=409, detail="Service name already exists.")

    service = Service(
        name=payload.name.strip(),
        unit_price=payload.unit_price,
        status=payload.status,
    )
    db.add(service)
    db.flush()
    add_audit_log(db, user, "CREATE", "SERVICES", service.id, f"Created service {service.name}.")
    db.commit()
    db.refresh(service)
    return service


@router.put("/{service_id}")
def update_service(
    service_id: int,
    payload: ServiceUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage(user):
        raise HTTPException(status_code=403, detail="Only accountants can manage services.")

    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status_code=404, detail="Service not found.")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        name = data["name"].strip()
        stmt = select(Service).where(
            func.lower(Service.name) == name.lower(),
            Service.id != service_id,
        )
        if db.scalar(stmt):
            raise HTTPException(status_code=409, detail="Service name already exists.")
        data["name"] = name

    for field, value in data.items():
        setattr(service, field, value)

    add_audit_log(db, user, "UPDATE", "SERVICES", service.id, f"Updated service {service.name}.")
    db.commit()
    db.refresh(service)
    return service


@router.delete("/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_service(
    service_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage(user):
        raise HTTPException(status_code=403, detail="Only accountants can manage services.")

    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status_code=404, detail="Service not found.")

    used = db.scalar(
        select(func.count(InvoiceItem.id)).where(InvoiceItem.service_id == service_id)
    ) or 0
    if used:
        raise HTTPException(
            status_code=409,
            detail="Service is already used in invoices. Set status to inactive instead of deleting.",
        )

    add_audit_log(db, user, "DELETE", "SERVICES", service.id, f"Deleted service {service.name}.")
    db.delete(service)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

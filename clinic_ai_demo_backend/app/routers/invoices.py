from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session

from app.core.audit import add_audit_log
from app.core.security import get_current_user
from app.database import get_db
from app.models.appointment import Appointment
from app.models.invoice import Invoice
from app.models.invoice_item import InvoiceItem
from app.models.patient import Patient
from app.models.service import Service
from app.models.user import User
from app.schemas.invoice import InvoiceCreate, InvoiceUpdate

router = APIRouter(prefix="/invoices", tags=["Invoices"])


def _allowed(user: User) -> bool:
    # UC-LT-04 and UC-KT-02/04: Receptionist and Accountant handle invoices/payments.
    return user.role in {"accountant", "receptionist"}


def _service_rows(db: Session, items) -> tuple[list[tuple[Service, int]], Decimal]:
    rows = []
    gross = Decimal("0.00")
    for item in items:
        service = db.get(Service, item.service_id)
        if service is None:
            raise HTTPException(status_code=400, detail=f"Service id {item.service_id} does not exist.")
        if service.status != "active":
            raise HTTPException(status_code=409, detail=f"Service '{service.name}' is inactive.")
        rows.append((service, item.quantity))
        gross += service.unit_price * item.quantity
    return rows, gross


def _validate_payment(payment_status: str, payment_method: str | None) -> tuple[str | None, datetime | None]:
    method = payment_method.strip() if payment_method else None
    if payment_status == "paid" and not method:
        raise HTTPException(status_code=400, detail="Payment method is required when invoice is paid.")
    if payment_status == "paid":
        return method, datetime.utcnow()
    return (None if payment_status == "cancelled" else method), None


def _invoice_dict(db: Session, invoice: Invoice) -> dict:
    appointment = db.get(Appointment, invoice.appointment_id) if invoice.appointment_id else None
    patient = db.get(Patient, appointment.patient_id) if appointment else None
    items = list(
        db.scalars(
            select(InvoiceItem)
            .where(InvoiceItem.invoice_id == invoice.id)
            .order_by(InvoiceItem.id)
        ).all()
    )
    item_data = []
    for item in items:
        service = db.get(Service, item.service_id)
        item_data.append({
            "id": item.id,
            "service_id": item.service_id,
            "service_name": service.name if service else f"Service #{item.service_id}",
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "line_total": item.unit_price * item.quantity,
        })

    return {
        "id": invoice.id,
        "appointment_id": invoice.appointment_id,
        "patient_id": appointment.patient_id if appointment else None,
        "patient_name": patient.full_name if patient else None,
        "patient_phone": patient.phone if patient else None,
        "appointment_date": appointment.appointment_date if appointment else None,
        "invoice_date": invoice.invoice_date,
        "discount_amount": invoice.discount_amount,
        "total_amount": invoice.total_amount,
        "payment_status": invoice.payment_status,
        "payment_method": invoice.payment_method,
        "paid_at": invoice.paid_at,
        "created_by": invoice.created_by,
        "items": item_data,
    }


@router.get("")
def list_invoices(
    q: str | None = Query(default=None),
    payment_status: str | None = Query(default=None, alias="status"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _allowed(user):
        raise HTTPException(status_code=403, detail="You do not have permission to view invoices.")

    stmt = (
        select(Invoice)
        .outerjoin(Appointment, Appointment.id == Invoice.appointment_id)
        .outerjoin(Patient, Patient.id == Appointment.patient_id)
    )
    if q and q.strip():
        raw = q.strip()
        keyword = f"%{raw}%"
        conditions = [
            Patient.full_name.ilike(keyword),
            Patient.phone.ilike(keyword),
            Invoice.payment_method.ilike(keyword),
        ]
        normalized = raw.upper().replace("-", "").replace(" ", "")
        if normalized.startswith("HD") and normalized[2:].isdigit():
            conditions.append(Invoice.id == int(normalized[2:]))
        elif normalized.startswith("LK") and normalized[2:].isdigit():
            conditions.append(Invoice.appointment_id == int(normalized[2:]))
        elif normalized.startswith("BN") and normalized[2:].isdigit():
            conditions.append(Patient.id == int(normalized[2:]))
        elif normalized.isdigit():
            conditions.extend([
                Invoice.id == int(normalized),
                Invoice.appointment_id == int(normalized),
            ])
        stmt = stmt.where(or_(*conditions))
    if payment_status:
        stmt = stmt.where(Invoice.payment_status == payment_status)

    invoices = list(
        db.scalars(
            stmt.order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
            .offset(skip)
            .limit(limit)
        ).all()
    )
    return {"total": len(invoices), "items": [_invoice_dict(db, i) for i in invoices]}


@router.get("/options")
def invoice_options(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _allowed(user):
        raise HTTPException(status_code=403, detail="You do not have permission to create invoices.")

    services = list(db.scalars(select(Service).order_by(Service.name)).all())
    appointments = list(
        db.scalars(
            select(Appointment)
            .where(Appointment.status != "cancelled")
            .order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc())
        ).all()
    )
    existing = {
        i.appointment_id: i.id
        for i in db.scalars(select(Invoice).where(Invoice.appointment_id.is_not(None))).all()
    }

    appointment_rows = []
    for a in appointments:
        patient = db.get(Patient, a.patient_id)
        appointment_rows.append({
            "id": a.id,
            "patient_id": a.patient_id,
            "patient_name": patient.full_name if patient else f"Patient #{a.patient_id}",
            "appointment_date": a.appointment_date,
            "start_time": a.start_time,
            "status": a.status,
            "existing_invoice_id": existing.get(a.id),
        })

    return {
        "services": [
            {
                "id": s.id,
                "name": s.name,
                "unit_price": s.unit_price,
                "status": s.status,
            }
            for s in services
        ],
        "appointments": appointment_rows,
    }


@router.get("/{invoice_id}")
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _allowed(user):
        raise HTTPException(status_code=403, detail="You do not have permission to view invoices.")
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    return _invoice_dict(db, invoice)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_invoice(
    payload: InvoiceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _allowed(user):
        raise HTTPException(status_code=403, detail="You do not have permission to create invoices.")

    if payload.appointment_id is not None:
        appointment = db.get(Appointment, payload.appointment_id)
        if appointment is None:
            raise HTTPException(status_code=400, detail="Appointment does not exist.")
        if appointment.status == "cancelled":
            raise HTTPException(status_code=409, detail="Cannot invoice a cancelled appointment.")
        existing = db.scalar(
            select(Invoice).where(Invoice.appointment_id == payload.appointment_id)
        )
        if existing is not None:
            raise HTTPException(status_code=409, detail=f"Appointment already has invoice id {existing.id}.")

    service_rows, gross = _service_rows(db, payload.items)
    if payload.discount_amount > gross:
        raise HTTPException(status_code=400, detail="Discount cannot exceed gross amount.")

    payment_method, paid_at = _validate_payment(payload.payment_status, payload.payment_method)
    total = gross - payload.discount_amount

    invoice = Invoice(
        appointment_id=payload.appointment_id,
        created_by=user.id,
        discount_amount=payload.discount_amount,
        total_amount=total,
        payment_status=payload.payment_status,
        payment_method=payment_method,
        paid_at=paid_at,
    )
    db.add(invoice)
    db.flush()

    for service, quantity in service_rows:
        db.add(
            InvoiceItem(
                invoice_id=invoice.id,
                service_id=service.id,
                quantity=quantity,
                unit_price=service.unit_price,
            )
        )

    add_audit_log(
        db, user, "CREATE", "INVOICES", invoice.id,
        f"Created invoice with total {total}.",
    )
    db.commit()
    db.refresh(invoice)
    return _invoice_dict(db, invoice)


@router.put("/{invoice_id}")
def update_invoice(
    invoice_id: int,
    payload: InvoiceUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _allowed(user):
        raise HTTPException(status_code=403, detail="You do not have permission to update invoices.")

    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found.")

    data = payload.model_dump(exclude_unset=True)

    if "appointment_id" in data:
        new_appointment_id = data["appointment_id"]
        if new_appointment_id is not None:
            appointment = db.get(Appointment, new_appointment_id)
            if appointment is None:
                raise HTTPException(status_code=400, detail="Appointment does not exist.")
            other = db.scalar(
                select(Invoice).where(
                    Invoice.appointment_id == new_appointment_id,
                    Invoice.id != invoice_id,
                )
            )
            if other:
                raise HTTPException(status_code=409, detail=f"Appointment already has invoice id {other.id}.")
        invoice.appointment_id = new_appointment_id

    current_items = list(
        db.scalars(select(InvoiceItem).where(InvoiceItem.invoice_id == invoice.id)).all()
    )

    if payload.items is not None:
        service_rows, gross = _service_rows(db, payload.items)
    else:
        service_rows = None
        gross = sum((item.unit_price * item.quantity for item in current_items), Decimal("0.00"))

    discount = payload.discount_amount if payload.discount_amount is not None else invoice.discount_amount
    if discount > gross:
        raise HTTPException(status_code=400, detail="Discount cannot exceed gross amount.")

    payment_status = payload.payment_status or invoice.payment_status
    payment_method_input = (
        payload.payment_method
        if "payment_method" in data
        else invoice.payment_method
    )
    payment_method, paid_at = _validate_payment(payment_status, payment_method_input)

    invoice.discount_amount = discount
    invoice.total_amount = gross - discount
    invoice.payment_status = payment_status
    invoice.payment_method = payment_method
    invoice.paid_at = paid_at if payment_status == "paid" else None

    if service_rows is not None:
        for item in current_items:
            db.delete(item)
        db.flush()
        for service, quantity in service_rows:
            db.add(
                InvoiceItem(
                    invoice_id=invoice.id,
                    service_id=service.id,
                    quantity=quantity,
                    unit_price=service.unit_price,
                )
            )

    add_audit_log(
        db, user, "UPDATE", "INVOICES", invoice.id,
        f"Updated invoice. Status: {invoice.payment_status}.",
    )
    db.commit()
    db.refresh(invoice)
    return _invoice_dict(db, invoice)


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _allowed(user):
        raise HTTPException(status_code=403, detail="You do not have permission to delete invoices.")

    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    if invoice.payment_status == "paid":
        raise HTTPException(
            status_code=409,
            detail="Paid invoices should not be deleted. Change workflow or keep them for audit history.",
        )

    add_audit_log(db, user, "DELETE", "INVOICES", invoice.id, "Deleted unpaid/cancelled invoice.")
    db.delete(invoice)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

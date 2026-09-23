from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.core.security import require_roles
from app.database import get_db
from app.models.appointment import Appointment
from app.models.doctor import Doctor
from app.models.invoice import Invoice
from app.models.invoice_item import InvoiceItem
from app.models.patient import Patient
from app.models.service import Service
from app.models.shift import Shift
from app.models.user import User

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/summary")
def report_summary(
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "accountant")),
):
    appointment_filters = []
    invoice_filters = []
    shift_filters = []

    if from_date:
        appointment_filters.append(Appointment.appointment_date >= from_date)
        invoice_filters.append(cast(Invoice.invoice_date, Date) >= from_date)
        shift_filters.append(Shift.shift_date >= from_date)
    if to_date:
        appointment_filters.append(Appointment.appointment_date <= to_date)
        invoice_filters.append(cast(Invoice.invoice_date, Date) <= to_date)
        shift_filters.append(Shift.shift_date <= to_date)

    appt_stmt = select(func.count(Appointment.id))
    shift_stmt = select(func.count(Shift.id))
    for cond in appointment_filters:
        appt_stmt = appt_stmt.where(cond)
    for cond in shift_filters:
        shift_stmt = shift_stmt.where(cond)

    appointments_total = db.scalar(appt_stmt) or 0
    shifts_total = db.scalar(shift_stmt) or 0
    patients_total = db.scalar(select(func.count(Patient.id))) or 0
    doctors_active = db.scalar(
        select(func.count(Doctor.id)).where(Doctor.status == "active")
    ) or 0

    status_stmt = select(Appointment.status, func.count(Appointment.id)).group_by(Appointment.status)
    for cond in appointment_filters:
        status_stmt = status_stmt.where(cond)
    status_rows = db.execute(status_stmt).all()
    appointments_by_status = {status_name: count for status_name, count in status_rows}

    invoice_stmt = select(Invoice)
    for cond in invoice_filters:
        invoice_stmt = invoice_stmt.where(cond)
    invoices = list(db.scalars(invoice_stmt).all())

    paid = [i for i in invoices if i.payment_status == "paid"]
    unpaid = [i for i in invoices if i.payment_status == "unpaid"]
    revenue = sum((i.total_amount for i in paid), Decimal("0.00"))
    average_paid = revenue / len(paid) if paid else Decimal("0.00")

    revenue_stmt = (
        select(cast(Invoice.invoice_date, Date).label("day"), func.sum(Invoice.total_amount))
        .where(Invoice.payment_status == "paid")
        .group_by("day")
        .order_by("day")
    )
    for cond in invoice_filters:
        revenue_stmt = revenue_stmt.where(cond)
    revenue_by_date = [
        {"date": day, "revenue": amount or Decimal("0.00")}
        for day, amount in db.execute(revenue_stmt).all()
    ]

    usage_stmt = (
        select(
            Service.id,
            Service.name,
            func.sum(InvoiceItem.quantity).label("quantity"),
            func.sum(InvoiceItem.quantity * InvoiceItem.unit_price).label("amount"),
        )
        .join(InvoiceItem, InvoiceItem.service_id == Service.id)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .where(Invoice.payment_status == "paid")
        .group_by(Service.id, Service.name)
        .order_by(func.sum(InvoiceItem.quantity).desc())
        .limit(10)
    )
    for cond in invoice_filters:
        usage_stmt = usage_stmt.where(cond)
    service_usage = [
        {
            "service_id": sid,
            "service_name": name,
            "quantity": int(quantity or 0),
            "amount": amount or Decimal("0.00"),
        }
        for sid, name, quantity, amount in db.execute(usage_stmt).all()
    ]

    return {
        "from_date": from_date,
        "to_date": to_date,
        "patients_total": patients_total,
        "doctors_active": doctors_active,
        "appointments_total": appointments_total,
        "appointments_by_status": appointments_by_status,
        "shifts_total": shifts_total,
        "invoices_total": len(invoices),
        "paid_invoices": len(paid),
        "unpaid_invoices": len(unpaid),
        "revenue": revenue,
        "average_paid_invoice": average_paid,
        "revenue_by_date": revenue_by_date,
        "service_usage": service_usage,
    }

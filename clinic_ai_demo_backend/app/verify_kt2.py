from sqlalchemy import func, select

from app.database import SessionLocal
from app.models.appointment import Appointment
from app.models.doctor import Doctor
from app.models.invoice import Invoice
from app.models.invoice_item import InvoiceItem
from app.models.medical_record import MedicalRecord
from app.models.patient import Patient
from app.models.service import Service
from app.models.shift import Shift
from app.models.system_log import SystemLog
from app.models.user import User


def verify():
    db = SessionLocal()
    try:
        tables = [
            ("users", User), ("patients", Patient), ("doctors", Doctor), ("system_logs", SystemLog),
            ("shifts", Shift), ("appointments", Appointment), ("medical_records", MedicalRecord),
            ("services", Service), ("invoices", Invoice), ("invoice_items", InvoiceItem),
        ]
        print("Clinic AI - KT2 database verification")
        print("=" * 52)
        counts = {}
        for name, model in tables:
            count = db.scalar(select(func.count()).select_from(model)) or 0
            counts[name] = count
            print(f"[OK] {name:<18} rows={count}")

        print("\nExpected demo scale:")
        checks = [
            ("patients >= 20", counts["patients"] >= 20),
            ("doctors >= 5", counts["doctors"] >= 5),
            ("appointments >= 20", counts["appointments"] >= 20),
            ("medical_records >= 10", counts["medical_records"] >= 10),
            ("invoices >= 14", counts["invoices"] >= 14),
        ]
        for label, ok in checks:
            print(f"[{'OK' if ok else 'CHECK'}] {label}")

        print("\nCore accounts:")
        for username in ["admin", "letan", "letan2", "bsan", "bsminh", "bslinh", "bskhoi", "bshuong", "ketoan", "benhnhan"]:
            user = db.scalar(select(User).where(User.username == username))
            print(f"[{'OK' if user else 'MISSING'}] {username:<10} role={user.role if user else '-'} status={user.status if user else '-'}")
    finally:
        db.close()


if __name__ == "__main__":
    verify()

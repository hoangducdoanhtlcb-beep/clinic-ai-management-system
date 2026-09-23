from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import select

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

DEMO_PREFIX = "[KT2-DEMO]"

PATIENT_NAMES = [
    "Hoàng Đức Doanh", "Trần Thu Trang", "Lê Hoàng Nam", "Phạm Ngọc Anh", "Nguyễn Minh Đức",
    "Vũ Khánh Linh", "Đỗ Quang Huy", "Bùi Thảo My", "Nguyễn Quốc Việt", "Trần Minh Châu",
    "Lương Khánh Linh", "Phan Anh Tuấn", "Đặng Thu Hà", "Ngô Đức Long", "Mai Phương Thảo",
    "Trịnh Minh Quân", "Lê Ngọc Mai", "Hoàng Văn Sơn", "Đỗ Minh Anh", "Nguyễn Thanh Tâm",
]

DOCTOR_ROWS = [
    ("bsan", "Giảng A Đông", "Răng hàm mặt", "0911001001", "DEMO-BS001"),
    ("bsminh", "BS. Nguyễn Văn Minh", "Nội tổng quát", "0911001002", "DEMO-BS002"),
    ("bslinh", "BS. Vũ Thùy Linh", "Tai Mũi Họng", "0911001003", "DEMO-BS003"),
    ("bskhoi", "BS. Trần Minh Khôi", "Da liễu", "0911001004", "DEMO-BS004"),
    ("bshuong", "BS. Lê Thu Hương", "Nhi khoa", "0911001005", "DEMO-BS005"),
]

SERVICE_ROWS = [
    ("Khám tổng quát", Decimal("200000")),
    ("Khám Răng hàm mặt", Decimal("250000")),
    ("Khám Tai Mũi Họng", Decimal("220000")),
    ("Khám Da liễu", Decimal("220000")),
    ("Khám Nhi", Decimal("180000")),
    ("Đo huyết áp", Decimal("30000")),
]


def get_user(db, username: str) -> User:
    user = db.scalar(select(User).where(User.username == username))
    if user is None:
        raise RuntimeError(f"Missing user '{username}'. Run app.seed_auth first.")
    return user


def ensure_patient(db, idx: int) -> Patient:
    username = "benhnhan" if idx == 1 else f"bn{idx:02d}"
    user = get_user(db, username)
    phone = f"0900001{idx:03d}"
    patient = db.scalar(select(Patient).where(Patient.user_id == user.id))
    if patient is None:
        patient = db.scalar(select(Patient).where(Patient.phone == phone))
    if patient is None:
        patient = Patient(user_id=user.id, full_name=PATIENT_NAMES[idx-1], phone=phone)
        db.add(patient)
    patient.user_id = user.id
    patient.full_name = PATIENT_NAMES[idx-1]
    patient.date_of_birth = date(1985 + (idx % 18), ((idx - 1) % 12) + 1, ((idx * 3) % 27) + 1)
    patient.gender = "Nam" if idx % 2 else "Nữ"
    patient.phone = phone
    patient.address = ["Thái Nguyên", "Sông Công", "Phổ Yên", "Đại Từ", "Đồng Hỷ"][idx % 5]
    db.flush()
    return patient


def ensure_doctor(db, row) -> Doctor:
    username, full_name, specialty, phone, license_no = row
    user = get_user(db, username)
    doctor = db.scalar(select(Doctor).where(Doctor.user_id == user.id))
    if doctor is None:
        doctor = db.scalar(select(Doctor).where(Doctor.license_no == license_no))
    if doctor is None:
        doctor = Doctor(user_id=user.id, full_name=full_name, specialty=specialty)
        db.add(doctor)
    doctor.user_id = user.id
    doctor.full_name = full_name
    doctor.specialty = specialty
    doctor.phone = phone
    doctor.license_no = license_no
    doctor.status = "active"
    db.flush()
    return doctor


def ensure_shift(db, doctor_id: int, shift_date: date) -> Shift:
    shift = db.scalar(select(Shift).where(
        Shift.doctor_id == doctor_id,
        Shift.shift_date == shift_date,
        Shift.start_time == time(8, 0),
        Shift.end_time == time(17, 0),
    ))
    if shift is None:
        shift = Shift(doctor_id=doctor_id, shift_date=shift_date, start_time=time(8, 0), end_time=time(17, 0), status="active")
        db.add(shift)
    else:
        shift.status = "active"
    db.flush()
    return shift


def ensure_appointment(db, patient: Patient, doctor: Doctor, creator: User, appt_date: date, start: time, status_name: str, reason: str) -> Appointment:
    appt = db.scalar(select(Appointment).where(
        Appointment.patient_id == patient.id,
        Appointment.doctor_id == doctor.id,
        Appointment.appointment_date == appt_date,
        Appointment.start_time == start,
    ))
    end_dt = datetime.combine(appt_date, start) + timedelta(minutes=30)
    if appt is None:
        appt = Appointment(
            patient_id=patient.id,
            doctor_id=doctor.id,
            created_by=creator.id,
            appointment_date=appt_date,
            start_time=start,
            end_time=end_dt.time(),
            reason=reason,
            status=status_name,
        )
        db.add(appt)
    else:
        appt.created_by = creator.id
        appt.end_time = end_dt.time()
        appt.reason = reason
        appt.status = status_name
    db.flush()
    return appt


def ensure_record(db, appt: Appointment, idx: int) -> MedicalRecord:
    record = db.scalar(select(MedicalRecord).where(MedicalRecord.appointment_id == appt.id))
    if record is None:
        record = MedicalRecord(appointment_id=appt.id)
        db.add(record)
    record.symptoms = ["Đau đầu nhẹ", "Đau họng", "Đau răng khi ăn lạnh", "Mệt mỏi", "Dị ứng da"][idx % 5]
    record.conclusion = f"Kết luận demo lần khám {idx:02d}; theo dõi theo chỉ định bác sĩ."
    record.doctor_note = "Theo dõi triệu chứng và tái khám khi cần."
    record.prescription_note = "Nội dung đơn thuốc demo theo ghi chú của bác sĩ."
    record.post_visit_guidance = "Nghỉ ngơi, theo dõi tình trạng và tái khám đúng lịch."
    db.flush()
    return record


def ensure_service(db, name: str, price: Decimal) -> Service:
    service = db.scalar(select(Service).where(Service.name == name))
    if service is None:
        service = Service(name=name, unit_price=price, status="active")
        db.add(service)
    service.unit_price = price
    service.status = "active"
    db.flush()
    return service


def ensure_invoice(db, appt: Appointment, creator: User, service: Service, paid: bool, idx: int) -> Invoice:
    invoice = db.scalar(select(Invoice).where(Invoice.appointment_id == appt.id))
    if invoice is None:
        invoice = Invoice(
            appointment_id=appt.id,
            created_by=creator.id,
            discount_amount=Decimal("0.00"),
            total_amount=service.unit_price,
            payment_status="paid" if paid else "unpaid",
            payment_method="Tiền mặt" if paid else None,
            paid_at=datetime.utcnow() if paid else None,
            invoice_date=datetime.combine(appt.appointment_date, time(12, 0)),
        )
        db.add(invoice)
        db.flush()
    else:
        invoice.created_by = creator.id
        invoice.discount_amount = Decimal("0.00")
        invoice.total_amount = service.unit_price
        invoice.payment_status = "paid" if paid else "unpaid"
        invoice.payment_method = "Tiền mặt" if paid else None
        invoice.paid_at = datetime.utcnow() if paid else None
    item = db.scalar(select(InvoiceItem).where(InvoiceItem.invoice_id == invoice.id))
    if item is None:
        item = InvoiceItem(invoice_id=invoice.id, service_id=service.id, quantity=1, unit_price=service.unit_price)
        db.add(item)
    else:
        item.service_id = service.id
        item.quantity = 1
        item.unit_price = service.unit_price
    db.flush()
    return invoice


def ensure_log(db, user: User, action: str, module: str, entity_id: int | None, details: str) -> None:
    exists = db.scalar(select(SystemLog).where(SystemLog.details == details))
    if exists is None:
        db.add(SystemLog(user_id=user.id, action=action, module=module, entity_id=entity_id, details=details))


def seed_demo() -> None:
    db = SessionLocal()
    try:
        admin = get_user(db, "admin")
        receptionist = get_user(db, "letan")
        accountant = get_user(db, "ketoan")

        doctors = [ensure_doctor(db, row) for row in DOCTOR_ROWS]
        patients = [ensure_patient(db, i) for i in range(1, 21)]
        services = [ensure_service(db, *row) for row in SERVICE_ROWS]

        base = date.today()
        demo_dates = [base - timedelta(days=2), base - timedelta(days=1), base, base + timedelta(days=1)]
        for doctor in doctors:
            for d in demo_dates:
                ensure_shift(db, doctor.id, d)

        appointments = []
        reasons = [
            "Khám tổng quát", "Đau đầu, mệt mỏi", "Đau họng kéo dài", "Khám răng định kỳ", "Dị ứng da",
            "Tái khám", "Đau bụng nhẹ", "Ho kéo dài", "Kiểm tra sức khỏe", "Đau răng",
        ]
        for idx, patient in enumerate(patients, start=1):
            doctor = doctors[(idx - 1) % 5]
            block = (idx - 1) // 5
            appt_date = demo_dates[block]
            start = time(9 + ((idx - 1) % 3), 0)
            if idx <= 10:
                status_name = "completed"
            elif idx <= 15:
                status_name = "confirmed"
            elif idx == 20:
                status_name = "cancelled"
            else:
                status_name = "pending"
            appt = ensure_appointment(
                db, patient, doctor, receptionist, appt_date, start, status_name,
                f"{DEMO_PREFIX} {reasons[(idx - 1) % len(reasons)]}",
            )
            appointments.append(appt)

        for idx, appt in enumerate(appointments[:10], start=1):
            ensure_record(db, appt, idx)

        for idx, appt in enumerate(appointments[:14], start=1):
            ensure_invoice(db, appt, accountant if idx % 2 else receptionist, services[(idx - 1) % len(services)], idx <= 10, idx)

        ensure_log(db, admin, "LOGIN", "AUTH", admin.id, f"{DEMO_PREFIX} Admin login demo")
        ensure_log(db, receptionist, "SEARCH", "PATIENTS", patients[0].id, f"{DEMO_PREFIX} Receptionist searched patient records")
        ensure_log(db, get_user(db, "bsan"), "VIEW", "MEDICAL_RECORD", appointments[0].id, f"{DEMO_PREFIX} Doctor viewed assigned record")
        ensure_log(db, accountant, "VIEW", "INVOICES", None, f"{DEMO_PREFIX} Accountant reviewed invoices")

        db.commit()
        print("KT2 full demo seed completed.")
        print(f"- Patients: 20")
        print(f"- Doctors: 5")
        print(f"- Receptionists: 2 accounts")
        print(f"- Admin: 1 account")
        print(f"- Accountant: 1 account")
        print(f"- Appointments: at least 20 demo rows")
        print(f"- Medical records: at least 10 demo rows")
        print(f"- Invoices: at least 14 demo rows")
        print(f"- Services: at least 6 demo rows")
    finally:
        db.close()


if __name__ == "__main__":
    seed_demo()

from datetime import date

from sqlalchemy import select

from app.database import SessionLocal
from app.models.patient import Patient

DEMO_PATIENTS = [
    {"full_name": "Nguyễn Văn An", "date_of_birth": date(1995, 5, 12), "gender": "Nam", "phone": "0901000001", "address": "Hà Nội"},
    {"full_name": "Trần Thị Bình", "date_of_birth": date(1998, 8, 20), "gender": "Nữ", "phone": "0901000002", "address": "Hà Nội"},
    {"full_name": "Lê Minh Cường", "date_of_birth": date(1989, 2, 4), "gender": "Nam", "phone": "0901000003", "address": "Bắc Ninh"},
    {"full_name": "Phạm Thu Dung", "date_of_birth": date(2000, 11, 15), "gender": "Nữ", "phone": "0901000004", "address": "Hưng Yên"},
    {"full_name": "Đỗ Quốc Huy", "date_of_birth": date(1992, 7, 1), "gender": "Nam", "phone": "0901000005", "address": "Hải Phòng"},
    {"full_name": "Vũ Ngọc Lan", "date_of_birth": date(1997, 3, 9), "gender": "Nữ", "phone": "0901000006", "address": "Hà Nam"},
]


def seed_patients() -> None:
    db = SessionLocal()
    try:
        created = 0
        skipped = 0
        for row in DEMO_PATIENTS:
            existing = db.scalar(select(Patient).where(Patient.phone == row["phone"]))
            if existing is not None:
                skipped += 1
                continue
            db.add(Patient(**row))
            created += 1
        db.commit()
        print(f"Patient seed completed. Created: {created}, skipped: {skipped}.")
    finally:
        db.close()


if __name__ == "__main__":
    seed_patients()

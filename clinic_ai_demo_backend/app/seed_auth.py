from sqlalchemy import select

from app.core.security import hash_password
from app.database import SessionLocal
from app.models.user import User

DEMO_ACCOUNTS = [
    {"username": "admin", "password": "admin123", "email": "admin@clinic.local", "role": "admin"},
    {"username": "letan", "password": "123456", "email": "letan@clinic.local", "role": "receptionist"},
    {"username": "letan2", "password": "123456", "email": "letan2@clinic.local", "role": "receptionist"},
    {"username": "ketoan", "password": "123456", "email": "ketoan@clinic.local", "role": "accountant"},
    {"username": "bsan", "password": "123456", "email": "bsan@clinic.local", "role": "doctor"},
    {"username": "bsminh", "password": "123456", "email": "bsminh@clinic.local", "role": "doctor"},
    {"username": "bslinh", "password": "123456", "email": "bslinh@clinic.local", "role": "doctor"},
    {"username": "bskhoi", "password": "123456", "email": "bskhoi@clinic.local", "role": "doctor"},
    {"username": "bshuong", "password": "123456", "email": "bshuong@clinic.local", "role": "doctor"},
]

for i in range(1, 21):
    DEMO_ACCOUNTS.append({
        "username": "benhnhan" if i == 1 else f"bn{i:02d}",
        "password": "123456",
        "email": f"bn{i:02d}@example.com",
        "role": "patient",
    })


def seed_auth():
    db = SessionLocal()
    try:
        created = 0
        updated = 0
        for row in DEMO_ACCOUNTS:
            user = db.scalar(select(User).where(User.username == row["username"]))
            if user is None:
                user = User(
                    username=row["username"],
                    email=row["email"],
                    password_hash=hash_password(row["password"]),
                    role=row["role"],
                    status="active",
                )
                db.add(user)
                created += 1
            else:
                user.email = row["email"]
                user.password_hash = hash_password(row["password"])
                user.role = row["role"]
                user.status = "active"
                updated += 1
        db.commit()
        print(f"Auth seed completed. Created: {created}, updated: {updated}.")
        print("Core demo accounts:")
        for username in ["admin", "letan", "letan2", "bsan", "bsminh", "bslinh", "bskhoi", "bshuong", "ketoan", "benhnhan"]:
            row = next(x for x in DEMO_ACCOUNTS if x["username"] == username)
            print(f"- {row['username']} / {row['password']} ({row['role']})")
        print("- bn02 ... bn20 / 123456 (patient)")
    finally:
        db.close()


if __name__ == "__main__":
    seed_auth()

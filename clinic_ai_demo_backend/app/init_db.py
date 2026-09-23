from sqlalchemy import inspect

from app.database import Base, engine
import app.models  # noqa: F401


EXPECTED_TABLES = {
    "users",
    "patients",
    "doctors",
    "system_logs",
    "shifts",
    "appointments",
    "medical_records",
    "services",
    "invoices",
    "invoice_items",
}


def init_database() -> None:
    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    actual_tables = set(inspector.get_table_names())

    print("Database initialization completed.")
    print(f"Tables found: {len(actual_tables)}")

    for table in sorted(EXPECTED_TABLES):
        marker = "OK" if table in actual_tables else "MISSING"
        print(f"[{marker}] {table}")

    missing = EXPECTED_TABLES - actual_tables
    if missing:
        raise RuntimeError(
            "Some required tables were not created: " + ", ".join(sorted(missing))
        )


if __name__ == "__main__":
    init_database()

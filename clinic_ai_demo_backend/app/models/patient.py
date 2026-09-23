from datetime import date

from sqlalchemy import BigInteger, Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)

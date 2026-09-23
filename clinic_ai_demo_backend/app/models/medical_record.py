from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MedicalRecord(Base):
    __tablename__ = "medical_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    appointment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("appointments.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    symptoms: Mapped[str | None] = mapped_column(Text, nullable=True)
    conclusion: Mapped[str | None] = mapped_column(Text, nullable=True)
    doctor_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    prescription_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    post_visit_guidance: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

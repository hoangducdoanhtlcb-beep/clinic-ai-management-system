from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (
        CheckConstraint("discount_amount >= 0", name="ck_invoices_discount_nonnegative"),
        CheckConstraint("total_amount >= 0", name="ck_invoices_total_nonnegative"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    appointment_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("appointments.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    invoice_date: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    payment_status: Mapped[str] = mapped_column(String(20), nullable=False, default="unpaid")
    payment_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

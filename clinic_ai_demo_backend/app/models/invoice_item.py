from decimal import Decimal

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Integer, Numeric
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class InvoiceItem(Base):
    __tablename__ = "invoice_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_invoice_items_quantity_positive"),
        CheckConstraint("unit_price >= 0", name="ck_invoice_items_price_nonnegative"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    service_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("services.id", ondelete="RESTRICT"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

from decimal import Decimal

from sqlalchemy import BigInteger, CheckConstraint, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Service(Base):
    __tablename__ = "services"
    __table_args__ = (
        CheckConstraint("unit_price >= 0", name="ck_services_unit_price_nonnegative"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

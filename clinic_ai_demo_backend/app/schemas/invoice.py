from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

PaymentStatus = Literal["unpaid", "paid", "cancelled"]


class InvoiceItemInput(BaseModel):
    service_id: int
    quantity: int = Field(gt=0)


class InvoiceCreate(BaseModel):
    appointment_id: int | None = None
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)
    payment_status: PaymentStatus = "unpaid"
    payment_method: str | None = Field(default=None, max_length=30)
    items: list[InvoiceItemInput] = Field(min_length=1)


class InvoiceUpdate(BaseModel):
    appointment_id: int | None = None
    discount_amount: Decimal | None = Field(default=None, ge=0)
    payment_status: PaymentStatus | None = None
    payment_method: str | None = Field(default=None, max_length=30)
    items: list[InvoiceItemInput] | None = None

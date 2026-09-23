from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ServiceStatus = Literal["active", "inactive"]


class ServiceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    unit_price: Decimal = Field(ge=0)
    status: ServiceStatus = "active"


class ServiceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    unit_price: Decimal | None = Field(default=None, ge=0)
    status: ServiceStatus | None = None


class ServiceResponse(BaseModel):
    id: int
    name: str
    unit_price: Decimal
    status: str

    model_config = ConfigDict(from_attributes=True)

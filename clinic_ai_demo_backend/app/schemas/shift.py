from datetime import date, time
from typing import Literal

from pydantic import BaseModel, ConfigDict

ShiftStatus = Literal["active", "inactive"]


class ShiftBase(BaseModel):
    doctor_id: int
    shift_date: date
    start_time: time
    end_time: time
    status: ShiftStatus = "active"


class ShiftCreate(ShiftBase):
    pass


class ShiftUpdate(BaseModel):
    doctor_id: int | None = None
    shift_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    status: ShiftStatus | None = None


class ShiftResponse(ShiftBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class ShiftListResponse(BaseModel):
    total: int
    items: list[ShiftResponse]

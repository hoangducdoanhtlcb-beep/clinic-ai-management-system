from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db

router = APIRouter(
    prefix="/db-health",
    tags=["Database"],
)


@router.get("")
def database_health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {
            "status": "ok",
            "message": "PostgreSQL connection is working",
        }
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Database connection failed: {exc}",
        )

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.security import require_roles
from app.database import get_db
from app.models.system_log import SystemLog
from app.models.user import User

router = APIRouter(prefix="/logs", tags=["System Logs"])


@router.get("")
def list_logs(
    q: str | None = Query(default=None),
    module: str | None = Query(default=None),
    action: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin")),
):
    stmt = select(SystemLog).order_by(SystemLog.created_at.desc()).limit(limit)

    if q and q.strip():
        keyword = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                SystemLog.action.ilike(keyword),
                SystemLog.module.ilike(keyword),
                SystemLog.details.ilike(keyword),
            )
        )
    if module:
        stmt = stmt.where(SystemLog.module == module)
    if action:
        stmt = stmt.where(SystemLog.action == action)

    logs = list(db.scalars(stmt).all())
    items = []
    for entry in logs:
        actor = db.get(User, entry.user_id) if entry.user_id else None
        items.append({
            "id": entry.id,
            "user_id": entry.user_id,
            "username": actor.username if actor else None,
            "action": entry.action,
            "module": entry.module,
            "entity_id": entry.entity_id,
            "details": entry.details,
            "created_at": entry.created_at,
        })
    return {"total": len(items), "items": items}

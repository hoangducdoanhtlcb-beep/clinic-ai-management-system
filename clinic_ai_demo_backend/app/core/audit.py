from sqlalchemy.orm import Session

from app.models.system_log import SystemLog
from app.models.user import User


def add_audit_log(
    db: Session,
    user: User | None,
    action: str,
    module: str,
    entity_id: int | None = None,
    details: str | None = None,
) -> SystemLog:
    entry = SystemLog(
        user_id=user.id if user else None,
        action=action[:100],
        module=module[:50],
        entity_id=entity_id,
        details=details,
    )
    db.add(entry)
    return entry

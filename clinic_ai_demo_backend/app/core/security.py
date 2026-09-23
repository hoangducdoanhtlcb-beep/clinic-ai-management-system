import base64
import hashlib
import hmac
import json
import os
import time
from typing import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database import get_db
from app.models.user import User

_bearer = HTTPBearer(auto_error=False)
_ITERATIONS = 210_000


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64d(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${_b64e(salt)}${_b64e(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt_b64, digest_b64 = stored.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = _b64d(salt_b64)
        expected = _b64d(digest_b64)
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), salt, int(iterations)
        )
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def create_access_token(user: User) -> str:
    payload = {
        "sub": user.id,
        "role": user.role,
        "exp": int(time.time()) + settings.access_token_minutes * 60,
    }
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode())
    signature = hmac.new(
        settings.auth_secret.encode(), body.encode(), hashlib.sha256
    ).digest()
    return f"{body}.{_b64e(signature)}"


def decode_access_token(token: str) -> dict:
    try:
        body, signature_b64 = token.split(".", 1)
        expected = hmac.new(
            settings.auth_secret.encode(), body.encode(), hashlib.sha256
        ).digest()
        supplied = _b64d(signature_b64)
        if not hmac.compare_digest(expected, supplied):
            raise ValueError("invalid signature")
        payload = json.loads(_b64d(body))
        if int(payload.get("exp", 0)) < int(time.time()):
            raise ValueError("expired")
        return payload
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    payload = decode_access_token(credentials.credentials)
    user = db.get(User, int(payload["sub"]))
    if user is None or user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is unavailable or locked.",
        )
    return user


def require_roles(*roles: str) -> Callable:
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to use this function.",
            )
        return user
    return dependency

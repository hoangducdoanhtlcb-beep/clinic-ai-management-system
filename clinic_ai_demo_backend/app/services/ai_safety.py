import re

MAX_AI_INPUT_CHARS = 12000
MAX_AI_OUTPUT_CHARS = 8000

OUT_OF_SCOPE_PATTERNS = (
    r"\bchẩn đoán\b", r"\bbệnh gì\b", r"\bkê thuốc\b",
    r"\bthuốc gì\b", r"\bliều(?: lượng)?\b", r"\bđiều trị thế nào\b",
)


def is_medical_advice_request(text: str) -> bool:
    value = (text or "").lower()
    return any(re.search(pattern, value) for pattern in OUT_OF_SCOPE_PATTERNS)


def limit_text(text: str, max_chars: int = MAX_AI_INPUT_CHARS) -> str:
    value = (text or "").strip()
    if len(value) > max_chars:
        raise ValueError(f"Dữ liệu gửi AI vượt giới hạn {max_chars} ký tự.")
    return value


def validate_ai_output(text: str) -> str:
    value = (text or "").strip()
    if not value:
        raise ValueError("AI trả về phản hồi rỗng.")
    if len(value) > MAX_AI_OUTPUT_CHARS:
        raise ValueError("AI trả về phản hồi quá dài.")
    return value

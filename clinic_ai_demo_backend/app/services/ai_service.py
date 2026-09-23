import time
from pathlib import Path

import httpx

from app.core.config import settings
from app.services.ai_safety import limit_text, validate_ai_output

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"


class AIServiceError(RuntimeError):
    pass


def load_prompt(name: str, **values) -> str:
    template = (PROMPT_DIR / name).read_text(encoding="utf-8")
    return template.format(**values)


def _gemini(system_prompt: str, user_prompt: str) -> str:
    if not settings.ai_api_key:
        raise AIServiceError("AI_API_KEY chưa được cấu hình.")
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.ai_model}:generateContent"
    )
    # Gemini 3.x: keep the task deterministic through the system prompt and use
    # minimal thinking for these simple extraction/rewrite tasks. A larger output
    # budget prevents the visible answer from being cut off by reasoning tokens.
    generation_config = {
        "maxOutputTokens": max(settings.ai_max_output_tokens, 2048),
    }
    if settings.ai_model.startswith("gemini-3"):
        generation_config["thinkingConfig"] = {"thinkingLevel": "minimal"}

    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": generation_config,
    }
    response = httpx.post(
        url,
        params={"key": settings.ai_api_key},
        json=payload,
        timeout=settings.ai_timeout_seconds,
    )
    response.raise_for_status()
    data = response.json()
    try:
        candidate = data["candidates"][0]
        parts = candidate["content"]["parts"]
    except (KeyError, IndexError, TypeError) as exc:
        raise AIServiceError("Model trả về dữ liệu sai định dạng.") from exc

    # A Gemini Content can contain multiple Parts. Do not keep only parts[0].
    # Thought parts are internal reasoning and must not be shown to the user.
    texts = [
        str(part.get("text", ""))
        for part in parts
        if isinstance(part, dict) and part.get("text") and not part.get("thought", False)
    ]
    output = "".join(texts).strip()
    finish_reason = str(candidate.get("finishReason") or "").upper()
    if finish_reason == "MAX_TOKENS":
        raise AIServiceError(
            "AI dừng do đạt giới hạn đầu ra. Vui lòng thử lại; hệ thống không hiển thị bản tóm tắt bị cắt."
        )
    if not output:
        raise AIServiceError("Model không trả về phần nội dung có thể hiển thị.")
    return output


def _openai_compatible(system_prompt: str, user_prompt: str) -> str:
    if not settings.ai_api_key:
        raise AIServiceError("AI_API_KEY chưa được cấu hình.")
    base = settings.ai_base_url.rstrip("/")
    payload = {
        "model": settings.ai_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": settings.ai_temperature,
        "max_tokens": max(settings.ai_max_output_tokens, 2048),
    }
    response = httpx.post(
        f"{base}/chat/completions",
        headers={"Authorization": f"Bearer {settings.ai_api_key}"},
        json=payload,
        timeout=settings.ai_timeout_seconds,
    )
    response.raise_for_status()
    data = response.json()
    try:
        choice = data["choices"][0]
        output = choice["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise AIServiceError("Model trả về dữ liệu sai định dạng.") from exc
    if str(choice.get("finish_reason") or "").lower() == "length":
        raise AIServiceError(
            "AI dừng do đạt giới hạn đầu ra. Vui lòng thử lại; hệ thống không hiển thị nội dung bị cắt."
        )
    return output


def _provider_error_detail(response: httpx.Response) -> str:
    """Return a short provider error without exposing request URL/API key or PII."""
    try:
        data = response.json()
        message = data.get("error", {}).get("message") if isinstance(data, dict) else None
        if message:
            return str(message).replace("\n", " ")[:300]
    except (ValueError, TypeError, AttributeError):
        pass
    return "Không có mô tả lỗi từ nhà cung cấp."


def _retry_delay(response: httpx.Response | None, attempt: int) -> float:
    """Respect Retry-After when present; otherwise use 2s, 4s exponential backoff."""
    if response is not None:
        raw = response.headers.get("Retry-After")
        if raw:
            try:
                return min(max(float(raw), 1.0), 30.0)
            except ValueError:
                pass
    return float(2 ** attempt)


def generate(system_prompt: str, user_prompt: str) -> str:
    limit_text(system_prompt, 8000)
    limit_text(user_prompt)
    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        try:
            if settings.ai_provider == "gemini":
                output = _gemini(system_prompt, user_prompt)
            elif settings.ai_provider == "openai_compatible":
                output = _openai_compatible(system_prompt, user_prompt)
            else:
                raise AIServiceError("AI_PROVIDER không được hỗ trợ.")
            return validate_ai_output(output)
        except httpx.TimeoutException as exc:
            if attempt < max_attempts:
                time.sleep(_retry_delay(None, attempt))
                continue
            raise AIServiceError(
                "Dịch vụ AI bị timeout sau 3 lần thử. Vui lòng thử lại."
            ) from exc
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            detail = _provider_error_detail(exc.response)
            print(
                f"[AI] provider={settings.ai_provider} model={settings.ai_model} "
                f"HTTP={code} attempt={attempt}/{max_attempts}; {detail}"
            )
            if (code == 429 or 500 <= code <= 599) and attempt < max_attempts:
                time.sleep(_retry_delay(exc.response, attempt))
                continue
            if code == 429:
                raise AIServiceError(
                    "Dịch vụ AI đang vượt giới hạn sử dụng (rate limit) sau 3 lần thử. "
                    "Vui lòng chờ rồi thử lại."
                ) from exc
            if 500 <= code <= 599:
                raise AIServiceError(
                    f"Dịch vụ AI tạm thời không sẵn sàng (HTTP {code}) sau 3 lần thử."
                ) from exc
            raise AIServiceError(f"Dịch vụ AI trả lỗi HTTP {code}.") from exc
        except httpx.RequestError as exc:
            if attempt < max_attempts:
                time.sleep(_retry_delay(None, attempt))
                continue
            raise AIServiceError(
                "Không thể kết nối tới dịch vụ AI sau 3 lần thử."
            ) from exc
        except ValueError as exc:
            raise AIServiceError(str(exc)) from exc

    raise AIServiceError("Không thể hoàn tất yêu cầu AI.")

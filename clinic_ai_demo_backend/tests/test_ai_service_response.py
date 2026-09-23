import pytest

from app.services import ai_service


class FakeResponse:
    def __init__(self, data):
        self._data = data
        self.status_code = 200
        self.headers = {}

    def raise_for_status(self):
        return None

    def json(self):
        return self._data


def test_gemini_joins_all_non_thought_text_parts(monkeypatch):
    data = {
        "candidates": [{
            "content": {"parts": [
                {"text": "internal", "thought": True},
                {"text": "Phần 1. "},
                {"text": "Phần 2."},
            ]},
            "finishReason": "STOP",
        }]
    }
    monkeypatch.setattr(ai_service.settings, "ai_api_key", "test-key")
    monkeypatch.setattr(ai_service.settings, "ai_model", "gemini-3.5-flash")
    monkeypatch.setattr(ai_service.httpx, "post", lambda *a, **k: FakeResponse(data))
    assert ai_service._gemini("system", "user") == "Phần 1. Phần 2."


def test_gemini_rejects_truncated_max_tokens(monkeypatch):
    data = {
        "candidates": [{
            "content": {"parts": [{"text": "Nội dung bị cắt"}]},
            "finishReason": "MAX_TOKENS",
        }]
    }
    monkeypatch.setattr(ai_service.settings, "ai_api_key", "test-key")
    monkeypatch.setattr(ai_service.settings, "ai_model", "gemini-3.5-flash")
    monkeypatch.setattr(ai_service.httpx, "post", lambda *a, **k: FakeResponse(data))
    with pytest.raises(ai_service.AIServiceError, match="giới hạn đầu ra"):
        ai_service._gemini("system", "user")

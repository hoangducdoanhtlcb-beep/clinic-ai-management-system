import pytest

from app.services.ai_safety import is_medical_advice_request, limit_text, validate_ai_output


def test_blocks_medical_advice_question():
    assert is_medical_advice_request("Tôi bị đau đầu là bệnh gì?")
    assert is_medical_advice_request("Hãy kê thuốc cho tôi")


def test_allows_administrative_question():
    assert not is_medical_advice_request("Tôi đặt lịch khám như thế nào?")


def test_rejects_too_long_input():
    with pytest.raises(ValueError):
        limit_text("x" * 12001)


def test_rejects_empty_output():
    with pytest.raises(ValueError):
        validate_ai_output("   ")


def test_rejects_too_long_output():
    with pytest.raises(ValueError):
        validate_ai_output("x" * 8001)


def test_wait_time_question_is_not_medical_advice():
    # It may be answered only from supplied administrative process; prompt grounding handles unknown data.
    assert not is_medical_advice_request("Tôi sẽ phải đợi bao lâu để được khám?")

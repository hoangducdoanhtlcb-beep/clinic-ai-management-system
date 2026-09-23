from pathlib import Path

PROMPTS = Path(__file__).resolve().parents[1] / "app" / "prompts"


def read(name):
    return (PROMPTS / name).read_text(encoding="utf-8").lower()


def test_chatbot_prompt_forbids_inventing_unknown_process_data():
    text = read("chatbot_system.txt")
    assert "không tự suy đoán" in text
    assert "thời gian chờ" in text
    assert "không chẩn đoán" in text


def test_summary_prompt_requires_source_grounding():
    text = read("summary_system.txt")
    assert "không suy diễn" in text
    assert "không có dữ liệu" in text
    assert "không tạo thêm thuốc" in text


def test_guidance_prompt_is_draft_and_source_grounded():
    text = read("guidance_system.txt")
    assert "bản nháp" in text
    assert "không tự thêm thuốc" in text
    assert "không tuyên bố" in text

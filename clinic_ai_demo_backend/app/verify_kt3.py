from pathlib import Path

from app.core.config import settings
from app.services.ai_service import PROMPT_DIR


def main():
    expected = [
        "summary_system.txt", "summary_user.txt",
        "chatbot_system.txt", "chatbot_user.txt",
        "guidance_system.txt", "guidance_user.txt",
    ]
    missing = [name for name in expected if not (PROMPT_DIR / name).exists()]
    if missing:
        raise SystemExit(f"Missing prompts: {missing}")

    history_expected = [
        f"{task}_v{version}.txt"
        for task in ("summary", "chatbot", "guidance")
        for version in (1, 2, 3)
    ]
    history_dir = PROMPT_DIR / "history"
    missing_history = [name for name in history_expected if not (history_dir / name).exists()]
    if missing_history:
        raise SystemExit(f"Missing prompt history: {missing_history}")

    docs_dir = Path(__file__).resolve().parents[2] / "docs"
    expected_docs = [
        "PROMPT_EXPERIMENTS_KT3.md",
        "AI_TEST_CASES_KT3.md",
        "AI_SDLC_EVIDENCE_KT3.md",
        "REPORT_ALIGNMENT.md",
    ]
    missing_docs = [name for name in expected_docs if not (docs_dir / name).exists()]
    if missing_docs:
        raise SystemExit(f"Missing KT3 evidence docs: {missing_docs}")

    print("KT3 structure: OK")
    print(f"AI provider: {settings.ai_provider}")
    print(f"AI model: {settings.ai_model}")
    print("AI API key configured:", "YES" if settings.ai_api_key else "NO")
    print("6 production prompts: OK")
    print("Prompt history v1/v2/v3 for 3 tasks: OK")
    print("KT3 evidence documents: OK")


if __name__ == "__main__":
    main()

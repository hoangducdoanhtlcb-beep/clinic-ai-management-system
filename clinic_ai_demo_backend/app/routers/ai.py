import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import add_audit_log
from app.core.config import settings
from app.core.security import get_current_user
from app.database import get_db
from app.models.appointment import Appointment
from app.models.doctor import Doctor
from app.models.medical_record import MedicalRecord
from app.models.patient import Patient
from app.models.user import User
from app.schemas.ai import (
    AIResponse, ChatRequest, GuidanceRequest, GuidanceSaveRequest,
)
from app.services.ai_safety import is_medical_advice_request
from app.services.ai_service import AIServiceError, generate, load_prompt

router = APIRouter(prefix="/ai", tags=["AI - KT3"])
WARNING = "AI chỉ hỗ trợ hành chính, không thay thế bác sĩ và không tự chẩn đoán."


def _doctor(db: Session, user: User) -> Doctor:
    if user.role != "doctor":
        raise HTTPException(status_code=403, detail="Chỉ Bác sĩ được sử dụng chức năng này.")
    doctor = db.scalar(select(Doctor).where(Doctor.user_id == user.id))
    if doctor is None:
        raise HTTPException(status_code=409, detail="Tài khoản chưa liên kết hồ sơ Bác sĩ.")
    return doctor


def _log_ai(db: Session, user: User, task: str, entity_id: int | None, ok: bool, detail: str):
    add_audit_log(
        db, user, "AI_CALL_OK" if ok else "AI_CALL_ERROR", "AI", entity_id,
        f"task={task}; provider={settings.ai_provider}; model={settings.ai_model}; {detail}"[:1000],
    )


def _call(db: Session, user: User, task: str, entity_id: int | None, system: str, prompt: str) -> str:
    try:
        result = generate(system, prompt)
        _log_ai(db, user, task, entity_id, True, "completed")
        db.commit()
        return result
    except AIServiceError as exc:
        _log_ai(db, user, task, entity_id, False, str(exc))
        db.commit()
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/chat", response_model=AIResponse)
def chatbot(payload: ChatRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role != "patient":
        raise HTTPException(status_code=403, detail="Chatbot quy trình dành cho Bệnh nhân.")
    if is_medical_advice_request(payload.question):
        content = "Tôi chỉ hỗ trợ quy trình đặt lịch, chuẩn bị khám, tiếp nhận và thanh toán. Tôi không thể chẩn đoán, kê thuốc hoặc tư vấn điều trị; vui lòng trao đổi trực tiếp với bác sĩ."
        _log_ai(db, user, "chatbot", None, True, "blocked_out_of_scope_before_model")
        db.commit()
        return AIResponse(task="chatbot", content=content, model="safety-rule", warning=WARNING)
    system = load_prompt("chatbot_system.txt")
    prompt = load_prompt("chatbot_user.txt", question=payload.question.strip())
    content = _call(db, user, "chatbot", None, system, prompt)
    return AIResponse(task="chatbot", content=content, model=settings.ai_model, warning=WARNING)


@router.post("/summary/{patient_id}", response_model=AIResponse)
def summarize(patient_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doctor = _doctor(db, user)
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy bệnh nhân.")
    rows = list(db.execute(
        select(MedicalRecord, Appointment)
        .join(Appointment, Appointment.id == MedicalRecord.appointment_id)
        .where(Appointment.patient_id == patient_id, Appointment.doctor_id == doctor.id)
        .order_by(Appointment.appointment_date.desc())
    ).all())
    if not rows:
        raise HTTPException(status_code=404, detail="Không có hồ sơ thuộc phạm vi Bác sĩ được phép xem.")
    # Không gửi họ tên, điện thoại, địa chỉ, ngày sinh hoặc user_id tới model.
    safe_records = [{
        "appointment_date": a.appointment_date.isoformat(),
        "symptoms": r.symptoms or "Không có dữ liệu",
        "conclusion": r.conclusion or "Không có dữ liệu",
        "prescription_note": r.prescription_note or "Không có dữ liệu",
        "doctor_note": r.doctor_note or "Không có dữ liệu",
    } for r, a in rows]
    system = load_prompt("summary_system.txt")
    prompt = load_prompt("summary_user.txt", records=json.dumps(safe_records, ensure_ascii=False, indent=2))
    content = _call(db, user, "summary", patient_id, system, prompt)
    return AIResponse(task="summary", content=content, model=settings.ai_model, warning=WARNING)


@router.post("/guidance/{record_id}", response_model=AIResponse)
def guidance(record_id: int, payload: GuidanceRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doctor = _doctor(db, user)
    record = db.get(MedicalRecord, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiếu khám.")
    appointment = db.get(Appointment, record.appointment_id)
    if appointment is None or appointment.doctor_id != doctor.id:
        raise HTTPException(status_code=403, detail="Phiếu khám nằm ngoài phạm vi được phân công.")
    note = (record.doctor_note or "").strip()
    if not note:
        raise HTTPException(status_code=422, detail="Cần có ghi chú của Bác sĩ trước khi sinh hướng dẫn.")
    system = load_prompt("guidance_system.txt")
    prompt = load_prompt("guidance_user.txt", doctor_note=note)
    content = _call(db, user, "guidance", record_id, system, prompt)
    if payload.save:
        record.post_visit_guidance = content
        add_audit_log(db, user, "UPDATE", "MEDICAL_RECORD", record.id, "Saved AI-generated post-visit guidance after doctor request.")
        db.commit()
    return AIResponse(task="guidance", content=content, model=settings.ai_model, warning=WARNING)


@router.post("/guidance/{record_id}/save", response_model=AIResponse)
def save_guidance_draft(
    record_id: int,
    payload: GuidanceSaveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    doctor = _doctor(db, user)
    record = db.get(MedicalRecord, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiếu khám.")
    appointment = db.get(Appointment, record.appointment_id)
    if appointment is None or appointment.doctor_id != doctor.id:
        raise HTTPException(status_code=403, detail="Phiếu khám nằm ngoài phạm vi được phân công.")
    content = payload.content.strip()
    record.post_visit_guidance = content
    add_audit_log(
        db, user, "UPDATE", "MEDICAL_RECORD", record.id,
        "Doctor reviewed and saved AI-generated post-visit guidance.",
    )
    db.commit()
    return AIResponse(
        task="guidance-save", content=content, model="doctor-reviewed",
        warning=WARNING,
    )

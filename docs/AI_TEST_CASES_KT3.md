# TEST CASE AI — KT3

Nguyên tắc: chỉ ghi `PASS` khi đã có kết quả thực tế; `UNIT PASS` là test tự động; `PENDING E2E` là cần chạy/chụp lại trên máy có API key và quota hợp lệ.

| ID | Chức năng | Trường hợp | Kỳ vọng | Minh chứng hiện có | Trạng thái |
|---|---|---|---|---|---|
| AI-01 | Summary | Bác sĩ tóm tắt bệnh nhân thuộc phạm vi | 200, output có warning | Đã từng nhận HTTP 200 từ Gemini; phiên bản sau sửa truncation cần chụp lại | PENDING E2E FINAL |
| AI-02 | Summary | Bệnh nhân ngoài phạm vi/không có record thuộc bác sĩ | Không gửi AI; 404/403 | Đã quan sát 404 ở dữ liệu không phù hợp; UI sau đó được lọc lại | REVIEWED |
| AI-03 | Summary | Input quá dài | Từ chối an toàn, app không crash | Test tự động giới hạn input | UNIT PASS |
| AI-04 | Chatbot | Hỏi đặt lịch/giấy tờ/thanh toán | Trả lời theo quy trình | Đã nhận câu trả lời Gemini thật qua FastAPI | PASS |
| AI-05 | Chatbot | Hỏi chẩn đoán/kê thuốc | Chặn trước model, hướng gặp bác sĩ | Test safety tự động | UNIT PASS |
| AI-06 | Chatbot | Role không phải patient | 403 | Logic RBAC có trong router; cần ảnh/API khi nộp nếu muốn minh chứng E2E | PENDING E2E |
| AI-07 | Chatbot | Hỏi thời gian chờ khi nguồn không cung cấp | Không bịa số phút | Đã quan sát phản hồi an toàn sau prompt siết grounding | PASS |
| AI-08 | Guidance | Phiếu đúng bác sĩ + có doctor_note | Sinh bản nháp | Đã sinh bản nháp Gemini thật trên UI | PASS |
| AI-09 | Guidance | doctor_note rỗng | 422, không gọi model | Logic backend + UI chặn; nên chụp minh chứng | PENDING E2E |
| AI-10 | Guidance approval | Chưa duyệt | DB chưa đổi | Flow source đã tách draft/save | PENDING E2E FINAL |
| AI-11 | Guidance approval | Bác sĩ bấm Duyệt & lưu | Lưu DB; bệnh nhân xem được | Cần chạy/chụp bước cuối | PENDING E2E FINAL |
| AI-12 | Provider | Timeout | Retry rồi báo lỗi, app không crash | Đã gặp timeout thực tế; app tiếp tục hoạt động | PASS |
| AI-13 | Provider | HTTP 429 | Retry/backoff; hết lượt trả lỗi rõ | Đã gặp HTTP 429 thực tế, log cho thấy attempt 3/3 và API trả 503 có kiểm soát | PASS |
| AI-14 | Provider | Response rỗng/sai cấu trúc | Không hiển thị rác; báo lỗi | Test tự động | UNIT PASS |
| AI-15 | Provider | Gemini nhiều content.parts | Ghép đủ text, bỏ thought | Test tự động | UNIT PASS |
| AI-16 | Provider | finishReason=MAX_TOKENS | Không hiển thị output bị cắt | Test tự động | UNIT PASS |
| AI-17 | Privacy | Payload Summary | Không tên/SĐT/địa chỉ/ngày sinh/user_id | Code tạo `safe_records` tối thiểu sau RBAC | REVIEWED |
| AI-18 | UI | Markdown/escaped Markdown | Hiển thị rõ, không chèn HTML tùy ý | Renderer đã được sửa; cần ảnh cuối nếu dùng làm minh chứng | PENDING E2E FINAL |

## Kết quả kiểm tra tự động của bản đóng gói

- `python -m pytest -q`: **11 passed**.
- `python -m compileall -q app`: **PASS**.
- `node --check clinic_ai_demo/assets/app.js`: **PASS**.

## Checklist E2E cuối trước khi nộp

1. Chatbot: câu đúng phạm vi + câu vượt phạm vi.
2. Summary: chọn bệnh nhân có record của bác sĩ; output đủ 5 trường và đối chiếu DB.
3. Guidance: tạo bản nháp từ `doctor_note` → Duyệt & lưu → đăng nhập bệnh nhân xem lại.
4. Chụp warning AI và một minh chứng lỗi có kiểm soát (có thể dùng log 429 đã có).
5. Không chụp/đưa API key thật vào báo cáo.

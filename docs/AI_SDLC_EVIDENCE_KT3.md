# Minh chứng sử dụng AI trong SDLC - KT3

## Minh chứng 01 — Review tích hợp AI
- Mục tiêu: kiểm tra RBAC, PII, prompt, lỗi provider và UX trước khi demo KT3.
- Phần được review: `routers/ai.py`, `services/ai_service.py`, `services/ai_safety.py`, `prompts/*`, `assets/app.js`.
- Kết quả review: backend kiểm tra role trước khi lấy dữ liệu; summary chỉ gửi ngày khám/triệu chứng/kết luận/đơn thuốc/ghi chú; API key ở `.env`; có xử lý timeout, rate limit, response lỗi/rỗng.
- Điều chỉnh: tăng timeout mặc định lên 60 giây; siết chatbot không suy đoán dữ liệu hành chính không có nguồn; bổ sung renderer Markdown an toàn; hướng dẫn sau khám đổi thành bản nháp cần Bác sĩ duyệt trước khi lưu.
- Kiểm tra: Python compile + JavaScript syntax + pytest.

## Minh chứng 02 — Lỗi thực tế khi gọi model
- Quan sát: ban đầu provider trả HTTP 404; sau khi cấu hình model phù hợp, chatbot gọi model thật thành công.
- Quan sát tiếp: một request bị timeout; frontend nhận thông báo lỗi thay vì crash.
- Điều chỉnh: giữ cơ chế bắt timeout và tăng `AI_TIMEOUT_SECONDS` mặc định từ 20 lên 60 giây cho môi trường demo.

## Minh chứng 03 — Kiểm soát hallucination và human-in-the-loop
- Chatbot v3: nếu quy trình không có thời gian chờ/chi phí/chính sách thì phải nói chưa có thông tin, không tự tạo số liệu.
- Summary v3: cấm chẩn đoán/suy diễn, thiếu trường ghi “Không có dữ liệu”.
- Guidance v3: chỉ tạo bản nháp từ `doctor_note` + template; Bác sĩ phải bấm “Duyệt & lưu” trước khi ghi DB.

> Khi nộp: bổ sung ảnh Swagger/UI, log test và kết quả chạy prompt vòng 3. Không ghi kết quả model chưa chạy như thể đã chạy thật.

## Phase 3 - sửa lỗi sau kiểm thử tích hợp thực tế

Dựa trên log FastAPI khi chạy thật: chatbot trả 200; AI summary có 200/404/503; guidance có 503. Nhóm kiểm tra và sửa theo nguyên nhân thay vì thay API key/model:

- Danh sách AI Summary chỉ còn bệnh nhân có ít nhất một `medical_record` thuộc lịch của bác sĩ hiện tại; bệnh nhân chỉ có lịch nhưng chưa có phiếu khám không còn được đưa vào lựa chọn tóm tắt.
- AI service retry tối đa 3 lần cho timeout, HTTP 429 và HTTP 5xx với backoff ngắn.
- Log chẩn đoán chỉ ghi provider, model, HTTP status, số lần thử và thông báo lỗi provider; không ghi API key, prompt hay PII.
- Markdown renderer bỏ escape `\\*`, `\\_`, `\\`` do model trả về và hỗ trợ cả danh sách đánh số.
- Sau chỉnh sửa: Python compile OK, JavaScript syntax OK, 9/9 unit tests hiện có PASS. Kiểm thử Gemini end-to-end của Summary/Guidance cần chạy lại trên máy có API key thật.

## Phase 4 - Hoàn thiện AI Summary / Guidance

**Vấn đề thực tế:** AI Summary có lúc chỉ hiển thị một phần ngày khám; Guidance gặp 429 khi thử liên tục.

**Kiểm tra và điều chỉnh của nhóm:**
- Kiểm tra cấu trúc phản hồi Gemini: một `Content` có thể có nhiều `parts`; backend cũ chỉ lấy `parts[0]`.
- Ghép toàn bộ text parts không phải `thought`; nếu `finishReason=MAX_TOKENS` thì không hiển thị kết quả bị cắt.
- Tăng ngân sách output mặc định lên 2048 token và dùng mức thinking `minimal` cho Gemini 3.x ở các tác vụ trích xuất/biên soạn đơn giản.
- Summary bắt buộc đủ 5 trường cho mỗi lần khám; trường thiếu ghi `Không có dữ liệu`.
- 429/5xx/timeout dùng backoff 2 giây, 4 giây và tôn trọng `Retry-After` nếu provider gửi về.
- Guidance chỉ bật nút AI khi phiếu khám đã có `doctor_note`; AI chỉ tạo bản nháp, bác sĩ phải `Duyệt & lưu`.
- Markdown được chuẩn hóa/escape trước khi render.

**Xác minh tĩnh/unit test:** Python compile OK, JavaScript syntax OK, 11 unit tests PASS. Kết quả gọi Gemini end-to-end cần chạy trên máy có API key và được ghi riêng trong bảng test sau khi thực hiện.

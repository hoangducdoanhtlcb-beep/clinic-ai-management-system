# PHÒNG KHÁM ICTU — KT3 TÍCH HỢP AI

Hệ thống quản lý phòng khám của Nhóm 02, xây dựng bằng **HTML/CSS/JavaScript + FastAPI + SQLAlchemy + PostgreSQL/Docker**, tích hợp AI thật qua **Gemini API** (hoặc endpoint OpenAI-compatible). Bản này kế thừa nghiệp vụ KT2 và hoàn thiện phần KT3: AI nằm trong đúng luồng nghiệp vụ, có RBAC, giảm dữ liệu nhạy cảm, prompt tách khỏi code, kiểm soát đầu ra, log, xử lý lỗi và test.

> AI chỉ hỗ trợ nghiệp vụ. Hệ thống không dùng AI để tự chẩn đoán, tự kê thuốc, thay đổi kết luận của bác sĩ hoặc tự quyết định điều trị.

## 1. Chức năng hệ thống và vai trò

| Vai trò | Chức năng chính |
|---|---|
| Quản trị viên | Tài khoản/role, bác sĩ & chuyên khoa, ca làm, thống kê/báo cáo |
| Lễ tân | Hồ sơ bệnh nhân, đặt/đổi/hủy lịch, kiểm tra trùng lịch, hóa đơn/thanh toán tại quầy, tìm kiếm |
| Bác sĩ | Lịch được phân công, hồ sơ trong phạm vi được phép, phiếu khám, đơn thuốc, AI Summary, AI Guidance |
| Kế toán | Dịch vụ, hóa đơn/thanh toán, tra cứu tài chính, thống kê doanh thu |
| Bệnh nhân | Hồ sơ cá nhân, lịch cá nhân, chatbot quy trình, xem hướng dẫn sau khám đã được duyệt |

## 2. Ba chức năng AI của KT3

### 2.1 AI tóm tắt hồ sơ khám
`POST /api/ai/summary/{patient_id}` — chỉ Bác sĩ sử dụng. Backend kiểm tra Bác sĩ hiện tại, chỉ lấy `medical_records` thuộc lịch của chính Bác sĩ đó và chỉ gửi các trường cần thiết: thời gian khám, triệu chứng, kết luận, đơn thuốc và ghi chú bác sĩ. Không gửi họ tên, điện thoại, địa chỉ, ngày sinh hay `user_id` tới model.

Prompt bắt buộc AI giữ nguyên dữ kiện, không chẩn đoán/suy diễn, không tạo thuốc/chỉ định mới và ghi `Không có dữ liệu` khi trường nguồn bị thiếu.

### 2.2 Chatbot quy trình phòng khám
`POST /api/ai/chat` — dành cho Bệnh nhân. Chatbot chỉ hỗ trợ: đặt/đổi/hủy lịch, chuẩn bị trước khi khám, tiếp nhận, thanh toán và cách xem hướng dẫn sau khám. Quy trình được truyền trong prompt; model không được tự bịa thời gian chờ, chi phí, lịch trống hay chính sách chưa được cung cấp.

Câu hỏi có dấu hiệu yêu cầu chẩn đoán/kê thuốc/tư vấn điều trị được chặn bởi lớp safety trước khi gọi model và được hướng người dùng trao đổi với Bác sĩ.

### 2.3 AI hướng dẫn sau khám
`POST /api/ai/guidance/{record_id}` — chỉ Bác sĩ của phiếu khám được phép tạo **bản nháp** từ `doctor_note`. AI không được tự thêm thuốc, liều dùng, chẩn đoán, lịch tái khám hay chỉ định điều trị.

Bản nháp không tự lưu. Bác sĩ xem lại và bấm **Duyệt & lưu**, khi đó frontend gọi `POST /api/ai/guidance/{record_id}/save`; nội dung mới được lưu vào `post_visit_guidance` để Bệnh nhân xem.

## 3. Luồng tích hợp AI

```text
Frontend
   ↓
FastAPI Backend
   ↓
Xác thực + RBAC
   ↓
Lấy dữ liệu PostgreSQL đúng phạm vi
   ↓
Giảm PII / chỉ giữ dữ liệu cần thiết
   ↓
System Prompt + User Prompt
   ↓
AI Service → Gemini/OpenAI-compatible API
   ↓
Kiểm tra response + giới hạn output + xử lý lỗi
   ↓
Ghi audit log an toàn
   ↓
Frontend hiển thị kết quả + cảnh báo AI
```

API key chỉ nằm trong `.env` ở Backend; frontend không nhận API key. Audit log không lưu API key, prompt hay dữ liệu bệnh nhân đầy đủ.

## 4. Prompt và 3 vòng tối ưu

Prompt chạy chính thức nằm trong `clinic_ai_demo_backend/app/prompts/`:

```text
chatbot_system.txt       chatbot_user.txt
summary_system.txt       summary_user.txt
guidance_system.txt      guidance_user.txt
```

Ba phiên bản thiết kế của từng tác vụ nằm trong `app/prompts/history/` để minh chứng quá trình tối ưu. Nhật ký và kết quả thực tế nằm tại `docs/PROMPT_EXPERIMENTS_KT3.md`. Không sửa tài liệu thành PASS nếu chưa chạy model thật.

Các nguyên tắc prompt cuối: **grounded theo dữ liệu được cung cấp, không chẩn đoán, không suy diễn, không tạo dữ kiện, thiếu dữ liệu phải nói rõ, output ngắn gọn/có cấu trúc, Guidance luôn human-in-the-loop**.

## 5. An toàn và xử lý lỗi AI

Backend có kiểm soát: input quá dài; response rỗng; response sai cấu trúc; output quá dài; Gemini/OpenAI-compatible trả hết token; timeout; lỗi mạng; HTTP 429; HTTP 5xx; provider/model không hợp lệ. Với timeout/429/5xx hệ thống thử lại tối đa 3 lần với backoff; hết lượt sẽ trả lỗi có kiểm soát thay vì làm ứng dụng crash.

Kết quả AI trên giao diện luôn kèm cảnh báo: **AI chỉ hỗ trợ hành chính, không thay thế bác sĩ và không tự chẩn đoán.** Markdown từ model được escape/chuẩn hóa trước khi render.

## 6. Database

10 bảng chính:

```text
users
patients
doctors
system_logs
shifts
appointments
medical_records
services
invoices
invoice_items
```

Dữ liệu seed có tài khoản theo vai trò, bệnh nhân, bác sĩ, lịch khám, phiếu khám, dịch vụ, hóa đơn và ca làm để demo.

Tài khoản demo chính:

| Vai trò | Username | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Lễ tân | `letan`, `letan2` | `123456` |
| Bác sĩ | `bsan`, `bsminh`, `bslinh`, `bskhoi`, `bshuong` | `123456` |
| Kế toán | `ketoan` | `123456` |
| Bệnh nhân | `benhnhan`, `bn02` ... `bn20` | `123456` |

## 7. Chạy trên máy mới — lần đầu

### Yêu cầu trước khi chạy
- Windows 10/11.
- Python 3 đã cài và có trong PATH.
- Docker Desktop đã cài. BAT sẽ cố tự mở Docker Desktop nếu daemon chưa chạy.
- Có Gemini API key hợp lệ nếu muốn chạy AI thật.

Giải nén ZIP rồi **nhấp đúp `FIRST_TIME_SETUP.bat`**. Script tự động:

```text
Kiểm tra Python/Docker
→ tạo .venv
→ cài requirements.txt
→ tạo .env từ .env.example
→ yêu cầu nhập API key ở lần đầu
→ khởi động PostgreSQL
→ init database
→ seed tài khoản + dữ liệu demo
→ verify KT3
→ chạy pytest
→ gọi START_PROJECT.bat
→ mở trình duyệt
```

API key nhập ở lần đầu được ghi vào `.env` cục bộ. Không gửi `.env` cho người khác và không đưa API key thật vào Git/ZIP nộp bài.

## 8. Những lần chạy sau

Chỉ cần **nhấp đúp `START_PROJECT.bat`**. Script sẽ kiểm tra môi trường, cố khởi động Docker Desktop nếu cần, bật PostgreSQL, Backend, Frontend, chờ API sẵn sàng và mở trình duyệt.

Nếu phát hiện chưa có `.venv` hoặc `.env`, `START_PROJECT.bat` tự chuyển sang `FIRST_TIME_SETUP.bat`.

Địa chỉ:

```text
Frontend : http://localhost:5500
Backend  : http://127.0.0.1:8000
Swagger  : http://127.0.0.1:8000/docs
```

Giữ cửa sổ Backend và Frontend mở trong lúc sử dụng.

## 9. Cấu hình AI

File mẫu: `clinic_ai_demo_backend/.env.example`. File thật `.env` được tạo trên máy chạy.

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash
AI_API_KEY= <hãy nhập Key của bạn tại đây>
AI_TIMEOUT_SECONDS=60
AI_TEMPERATURE=0.2
AI_MAX_OUTPUT_TOKENS=2048
```

Nếu model trong tài khoản Gemini của bạn thay đổi/không còn khả dụng, cập nhật `AI_MODEL` theo model mà API key hiện tại được cấp quyền rồi khởi động lại Backend.

## 10. Kiểm thử KT3

Trong `clinic_ai_demo_backend` có thể chạy:

```bat
verify_kt3.bat
```

Script kiểm tra cấu trúc prompt/cấu hình và chạy toàn bộ unit test. Bộ source đóng gói này đã được kiểm tra tĩnh: **11 unit tests PASS**, Python compile PASS và JavaScript syntax PASS.

Kiểm thử end-to-end phụ thuộc API key/quota/provider tại thời điểm chạy. Các kết quả thực tế đã quan sát và các trường hợp còn cần chụp minh chứng được ghi trung thực trong `docs/AI_TEST_CASES_KT3.md`.

## 11. Tài liệu minh chứng chấm KT3

- `docs/PROMPT_EXPERIMENTS_KT3.md` — 3 vòng prompt và kết quả/điều chỉnh.
- `docs/AI_TEST_CASES_KT3.md` — đúng/sai/biên, unit test và E2E.
- `docs/AI_SDLC_EVIDENCE_KT3.md` — AI review/refactor/bảo mật và lỗi thực tế.
- `docs/REPORT_ALIGNMENT.md` — đối chiếu source với phạm vi báo cáo.

### Đối chiếu 10 tiêu chí KT3

| Tiêu chí | Minh chứng trong project |
|---|---|
| 1. AI tích hợp vào hệ thống | 3 API AI + UI theo đúng vai trò/nghiệp vụ |
| 2. Kết nối API/model | `ai_service.py`, `.env.example`, Gemini/OpenAI-compatible |
| 3. Prompt có hệ thống | `app/prompts/*`, tách system/user khỏi code |
| 4. Tối ưu prompt ≥3 vòng | `app/prompts/history/*` + `PROMPT_EXPERIMENTS_KT3.md` |
| 5. Dùng dữ liệu hệ thống có kiểm soát | Summary/Guidance lấy DB sau RBAC và giảm PII |
| 6. Output rõ ràng/cảnh báo | UI AI + Markdown an toàn + warning |
| 7. Xử lý lỗi/giới hạn AI | timeout, 429, 5xx, malformed, empty, too long, max token |
| 8. Kiểm thử | `tests/`, `AI_TEST_CASES_KT3.md`, `verify_kt3.bat` |
| 9. AI review/cải thiện code | `AI_SDLC_EVIDENCE_KT3.md` |
| 10. UX AI tự nhiên | AI nằm trong luồng Bệnh nhân/Bác sĩ; Guidance duyệt trước lưu |

## 12. Kịch bản demo khuyến nghị

1. Đăng nhập Bệnh nhân → Chatbot → hỏi cách đặt lịch/chuẩn bị/thanh toán → thử một câu hỏi chẩn đoán để chứng minh giới hạn.
2. Đăng nhập Bác sĩ → AI Summary → chọn bệnh nhân có phiếu khám thuộc Bác sĩ → đối chiếu tóm tắt với dữ liệu nguồn.
3. Mở phiếu khám có `doctor_note` → AI Guidance → xem bản nháp → **Duyệt & lưu**.
4. Đăng nhập Bệnh nhân tương ứng → kiểm tra hướng dẫn sau khám đã duyệt.
5. Nếu cần minh chứng lỗi AI, dùng log/test case đã ghi nhận; không cố tạo 429 trong buổi demo vì phụ thuộc quota provider.



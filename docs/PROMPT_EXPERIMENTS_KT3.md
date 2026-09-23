# NHẬT KÝ TỐI ƯU PROMPT — KT3

Mục tiêu: chứng minh prompt được thiết kế theo nghiệp vụ, có ít nhất 3 vòng cải tiến và không ghi nhận kết quả model chưa thực sự chạy. Các snapshot v1/v2/v3 nằm tại `clinic_ai_demo_backend/app/prompts/history/`; prompt đang dùng nằm trực tiếp trong `app/prompts/`.

## 1. Chatbot quy trình

| Vòng | Thiết kế / vấn đề | Điều chỉnh | Kết quả đã quan sát |
|---|---|---|---|
| V1 | Giới hạn chatbot ở nghiệp vụ hành chính, cấm chẩn đoán | Tách System/User prompt | Review thiết kế; thay bằng V2 |
| V2 | Cần grounding theo quy trình phòng khám thay vì kiến thức chung | Truyền quy trình đặt lịch, chuẩn bị, thanh toán; yêu cầu chỉ dùng nguồn được cung cấp | Gemini thật trả lời được câu hỏi đặt lịch, giấy tờ và thanh toán; Markdown lúc đầu hiển thị chưa đẹp |
| V3 | Model có thể suy đoán thời gian chờ/chi phí/chính sách | Cấm suy đoán; thiếu dữ liệu phải nói chưa có thông tin; giới hạn 180 từ; safety chặn câu hỏi y khoa trước model | Đã quan sát câu hỏi thời gian chờ được từ chối an toàn khi nguồn không có dữ liệu; renderer/safety tiếp tục được hoàn thiện |

Bộ câu hỏi kiểm tra: `Cách đặt lịch khám như thế nào?`, `Tôi cần chuẩn bị giấy tờ gì?`, `Thanh toán bằng hình thức nào?`, `Tôi sẽ phải đợi bao lâu?`, `Tôi đau đầu là bệnh gì?`.

## 2. AI Summary

| Vòng | Thiết kế / vấn đề | Điều chỉnh | Kết quả đã quan sát |
|---|---|---|---|
| V1 | Tóm tắt hồ sơ, cấm chẩn đoán | Chỉ gửi hồ sơ thuộc phạm vi Bác sĩ | Review thiết kế |
| V2 | Cần giảm hallucination khi trường thiếu | Cấm suy diễn, trường thiếu ghi `Không có dữ liệu` | Review thiết kế |
| V3 | Cần output ổn định và dễ đối chiếu | Bắt buộc 5 trường/lần khám; giảm PII; không thêm thuốc/chỉ định | Gemini thật đã từng trả 200 cho Summary; một lần output bị cắt, từ đó backend được sửa để ghép nhiều `parts`, phát hiện `MAX_TOKENS` và tăng output budget. Bản sau sửa cần chụp E2E cuối khi nộp |

Tiêu chí đối chiếu: đúng từng dữ kiện DB; đủ Thời gian/Triệu chứng/Kết luận/Đơn thuốc/Ghi chú; không xuất hiện PII bị loại; không có chẩn đoán hoặc chỉ định mới.

## 3. AI Guidance

| Vòng | Thiết kế / vấn đề | Điều chỉnh | Kết quả đã quan sát |
|---|---|---|---|
| V1 | Sinh hướng dẫn từ `doctor_note` | Chỉ dùng ghi chú Bác sĩ | Review thiết kế |
| V2 | Cần tránh model tự thêm thuốc/liều/chẩn đoán | Thêm template và cấm dữ kiện ngoài nguồn | Review thiết kế |
| V3 | Không nên để AI tự ghi nội dung vào hồ sơ | AI tạo bản nháp → Bác sĩ xem → `Duyệt & lưu`; thiếu trường dùng câu fallback | Gemini thật đã sinh được bản nháp Guidance trên UI. Quá trình thử cũng gặp HTTP 429 thực tế và hệ thống trả lỗi có kiểm soát. Cần chụp bước Duyệt & lưu + Bệnh nhân xem để hoàn thiện minh chứng E2E |

## 4. Prompt cuối cùng — nguyên tắc chung

- System Prompt xác định vai trò và giới hạn.
- User Prompt chỉ chứa nhiệm vụ và dữ liệu cần thiết.
- Backend kiểm tra RBAC trước khi dựng prompt.
- Summary giảm PII trước khi gọi model.
- Chatbot chỉ dựa trên quy trình được cung cấp.
- Guidance chỉ dựa trên `doctor_note` và template.
- Không chẩn đoán, không tự kê thuốc/liều, không tự thêm chỉ định điều trị.
- Thiếu nguồn thì nói thiếu, không bịa.
- Kết quả AI là hỗ trợ; Guidance bắt buộc Bác sĩ duyệt trước khi lưu.

## 5. Quy tắc ghi minh chứng

Khi nộp báo cáo, chỉ chuyển trạng thái E2E thành PASS sau khi đã chạy trên máy có API key/quota hợp lệ và có ảnh/log đối chiếu. Unit test có thể ghi PASS theo output `pytest` thực tế.

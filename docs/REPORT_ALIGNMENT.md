# Đối chiếu demo với BC_N02_P2

## Quyền tác nhân

- **Quản trị viên**: quản lý người dùng/role, bác sĩ & chuyên khoa, ca làm việc, thống kê & báo cáo.
- **Lễ tân**: hồ sơ bệnh nhân; đặt/xem/đổi/hủy lịch và kiểm tra trùng; hóa đơn & thanh toán tại quầy; tìm kiếm bệnh nhân và lịch khám.
- **Bác sĩ**: chỉ xem lịch được phân công; tra cứu hồ sơ trong phạm vi được phép; ghi triệu chứng/kết luận/phiếu khám; đơn thuốc; AI tóm tắt demo.
- **Kế toán**: dịch vụ; hóa đơn & thanh toán; tra cứu tài chính; thống kê doanh thu.
- **Bệnh nhân**: tự đăng ký/cập nhật tài khoản; đặt/xem/đổi/hủy lịch của chính mình; chatbot quy trình; hướng dẫn sau khám.

## Tìm kiếm

- Patient: mã BN/ID, họ tên, SĐT, địa chỉ.
- Appointment: bệnh nhân, bác sĩ, lý do; ngày/trạng thái; chấp nhận thêm mã LK/BN/BS để thao tác thuận tiện.
- Invoice: mã HD, bệnh nhân/SĐT, lịch khám, trạng thái thanh toán.
- Doctor record search: mã BN, tên, SĐT nhưng chỉ trong phạm vi lịch được phân công.
- Receptionist Search page: chỉ Patient + Appointment.
- Accountant Search page: Invoice/Payment + Service.
- Không có ô tìm kiếm chung ở topbar.

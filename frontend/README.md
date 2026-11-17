# Frontend

React + Vite + TypeScript, biểu đồ Recharts, socket.io-client cho dữ liệu thời gian thực. Giao diện tiếng Việt: đăng nhập, danh sách thiết bị, chi tiết thiết bị (số đo realtime, biểu đồ độ ẩm/ánh sáng, bơm/màn, ngưỡng, lịch sử lệnh, phiên bản firmware/phần cứng và lịch sử đổi firmware, bảng thống kê min/max/trung bình theo giờ/ngày, nút xuất CSV), cảnh báo, trang Tài khoản (sửa thông tin cá nhân, đổi mật khẩu, đăng xuất thu hồi token), quản lý thiết bị và người dùng (admin, gồm tạo/khóa/mở khóa tài khoản), nhật ký.

Đơn vị hiển thị: độ ẩm đất %, ánh sáng lux (lx), thời gian theo múi giờ trình duyệt (dữ liệu gốc và CSV là UTC).

Build thành static và phục vụ bằng nginx qua HTTPS (cổng 8443, chứng chỉ tự ký; cổng 8081 chuyển sang 8443), nginx chuyển `/api` và `/socket.io` sang backend. Nút điều khiển ẩn với viewer, nhưng quyền thật được backend kiểm tra.

Phát triển: `npm install && npm run dev` (proxy tới backend ở cổng 3001). Build: `npm run build`.
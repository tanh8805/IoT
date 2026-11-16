# Frontend

React + Vite + TypeScript, biểu đồ Recharts, socket.io-client cho dữ liệu thời gian thực. Giao diện tiếng Việt: đăng nhập, danh sách thiết bị, chi tiết thiết bị (số đo realtime, biểu đồ độ ẩm/ánh sáng, bơm/màn, ngưỡng, lịch sử lệnh), cảnh báo, quản lý thiết bị và người dùng (admin), nhật ký.

Build thành static và phục vụ bằng nginx (cổng 8081), nginx chuyển `/api` và `/socket.io` sang backend. Nút điều khiển ẩn với viewer, nhưng quyền thật được backend kiểm tra.

Phát triển: `npm install && npm run dev` (proxy tới backend ở cổng 3001). Build: `npm run build`.
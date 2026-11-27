# Bằng chứng kiểm thử

| File | Nội dung | Nguồn |
|---|---|---|
| `e2e-run.txt` | Kết quả `npm test` (e2e backend) | bản sao `tests/backend/last-e2e-run.txt` |
| `demo-run.txt` | Kết quả `node tests/backend/demo-check.mjs` (11 bước) | bản sao `tests/backend/last-demo-run.txt` |
| `metrics.sql` | Truy vấn đo độ trễ telemetry và độ trễ lệnh -> ack | xem mục 14.4 báo cáo |

## Ghi chú

- Hai file log là kết quả thật của lần chạy gần nhất được lưu trong repo (mốc thời gian trong log demo: 16/11/2026). Log chưa được chạy lại sau khi bộ test và báo cáo được cập nhật.
- Bộ test hiện tại có 31 test (18 trong `e2e.test.mjs`, 13 trong `e2e-extra.test.mjs`); log `e2e-run.txt` ghi 30 test, tất cả đạt.
- Trong `demo-run.txt`, số thiết bị mỗi vai trò thấy (7/2/2) và thời gian watchdog (37 s) là của môi trường chạy lúc đó; số liệu trong báo cáo lấy từ lần chạy sau.
- `metrics.sql` chỉ chứa câu truy vấn; số liệu độ trễ trong báo cáo đo trên cơ sở dữ liệu với thiết bị thật `chau-01`, dữ liệu này không nằm trong repo.
- Kết quả kiểm thử phân quyền broker (`tests/security/test_broker_acl.sh`) chưa có file log trong repo.

-- Truy vấn đo chỉ tiêu phi chức năng (mục 14.4 của báo cáo).
-- Chạy trên cơ sở dữ liệu của hệ thống, ví dụ:
--   docker compose exec postgres psql -U <user> -d <db> -f /dev/stdin < docs/evidence/metrics.sql
-- Thay 'chau-01' bằng mã thiết bị cần đo.

-- 1) Độ trễ thiết bị -> server: receivedAt - ts của các bản tin trong 30 phút gần nhất.
--    ts do thiết bị lấy từ NTP (độ phân giải 1 giây) nên sai số tới khoảng 1 giây.
SELECT count(*)                                                        AS so_ban_tin,
       round(avg(extract(epoch FROM ("receivedAt" - ts)) * 1000))      AS tb_ms,
       round(min(extract(epoch FROM ("receivedAt" - ts)) * 1000))      AS nho_nhat_ms,
       round(max(extract(epoch FROM ("receivedAt" - ts)) * 1000))      AS lon_nhat_ms
FROM "Telemetry"
WHERE "deviceId" = 'chau-01'
  AND "receivedAt" > now() - interval '30 minutes';

-- 2) Độ trễ lệnh -> ack: ackedAt - createdAt của lệnh pump_on 1 giây đã được xác nhận.
SELECT count(*)                                                        AS so_lenh,
       round(avg(extract(epoch FROM ("ackedAt" - "createdAt")) * 1000)) AS tb_ms,
       round(min(extract(epoch FROM ("ackedAt" - "createdAt")) * 1000)) AS nho_nhat_ms,
       round(max(extract(epoch FROM ("ackedAt" - "createdAt")) * 1000)) AS lon_nhat_ms,
       count(*) FILTER (WHERE status = 'TIMEOUT')                      AS so_timeout
FROM "Command"
WHERE "deviceId" = 'chau-01'
  AND action = 'pump_on'
  AND "durationS" = 1
  AND "ackedAt" IS NOT NULL;

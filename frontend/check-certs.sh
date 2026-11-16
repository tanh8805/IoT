#!/bin/sh
# Chạy trước nginx: báo lỗi rõ ràng nếu chưa có chứng chỉ.
if [ ! -s /etc/nginx/certs/server.crt ] || [ ! -s /etc/nginx/certs/server.key ]; then
  echo "THIEU CHUNG CHI HTTPS: chua co deployment/certs/server.crt va server.key." >&2
  echo "Chay tu goc repo:  node deployment/scripts/gen-cert.mjs   roi:  docker compose up -d" >&2
  exit 1
fi

#!/bin/sh
set -e
# Ghép DATABASE_URL cho mạng nội bộ của compose (host `postgres`).
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"
npx prisma migrate deploy --schema database/prisma/schema.prisma
node database/seed.js
exec node dist/main.js

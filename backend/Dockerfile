# Build context là gốc repo (cần cả backend/ và database/).
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
COPY database/prisma ./database/prisma
RUN npm ci
RUN npx prisma generate --schema database/prisma/schema.prisma
COPY backend/tsconfig.json backend/nest-cli.json ./
COPY backend/src ./src
RUN npx nest build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY database ./database
COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]

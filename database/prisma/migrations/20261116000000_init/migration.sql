-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "DeviceState" AS ENUM ('REGISTERED', 'PROVISIONED', 'ACTIVE', 'OFFLINE', 'FAULT', 'MAINTENANCE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('PENDING', 'OK', 'ERROR', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('LOW_SOIL', 'AUTO_BLOCKED', 'DEVICE_OFFLINE', 'ABNORMAL_DATA');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "state" "DeviceState" NOT NULL DEFAULT 'REGISTERED',
    "lastSeenAt" TIMESTAMP(3),
    "lastTelemetry" JSONB,
    "soilThreshold" INTEGER NOT NULL DEFAULT 40,
    "luxClose" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "luxOpen" DOUBLE PRECISION NOT NULL DEFAULT 5000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAssignment" (
    "userId" INTEGER NOT NULL,
    "deviceId" TEXT NOT NULL,

    CONSTRAINT "DeviceAssignment_pkey" PRIMARY KEY ("userId","deviceId")
);

-- CreateTable
CREATE TABLE "DeviceStateHistory" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "from" "DeviceState",
    "to" "DeviceState" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "actor" TEXT NOT NULL DEFAULT 'system',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceStateHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Telemetry" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soilRaw" INTEGER NOT NULL,
    "soilPct" INTEGER NOT NULL,
    "lux" DOUBLE PRECISION,
    "pump" BOOLEAN NOT NULL,
    "curtain" TEXT,
    "autoBlocked" BOOLEAN NOT NULL,
    "fw" TEXT,

    CONSTRAINT "Telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Command" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "durationS" INTEGER,
    "status" "CommandStatus" NOT NULL DEFAULT 'PENDING',
    "msg" TEXT NOT NULL DEFAULT '',
    "userId" INTEGER,
    "username" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedAt" TIMESTAMP(3),

    CONSTRAINT "Command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigChange" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" INTEGER,
    "username" TEXT NOT NULL DEFAULT '',
    "oldValue" JSONB NOT NULL,
    "newValue" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'NEW',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedById" INTEGER,
    "ackedByName" TEXT,
    "ackedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "username" TEXT NOT NULL DEFAULT 'system',
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" JSONB,
    "ip" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestError" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT,
    "topic" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "IngestError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "DeviceStateHistory_deviceId_at_idx" ON "DeviceStateHistory"("deviceId", "at");

-- CreateIndex
CREATE INDEX "Telemetry_deviceId_ts_idx" ON "Telemetry"("deviceId", "ts");

-- CreateIndex
CREATE INDEX "Command_deviceId_createdAt_idx" ON "Command"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "ConfigChange_deviceId_at_idx" ON "ConfigChange"("deviceId", "at");

-- CreateIndex
CREATE INDEX "Alert_deviceId_type_status_idx" ON "Alert"("deviceId", "type", "status");

-- CreateIndex
CREATE INDEX "Alert_status_createdAt_idx" ON "Alert"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "IngestError_at_idx" ON "IngestError"("at");

-- AddForeignKey
ALTER TABLE "DeviceAssignment" ADD CONSTRAINT "DeviceAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAssignment" ADD CONSTRAINT "DeviceAssignment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceStateHistory" ADD CONSTRAINT "DeviceStateHistory_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Telemetry" ADD CONSTRAINT "Telemetry_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Command" ADD CONSTRAINT "Command_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigChange" ADD CONSTRAINT "ConfigChange_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;


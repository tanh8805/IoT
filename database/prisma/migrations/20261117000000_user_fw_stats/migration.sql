-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "fwVersion" TEXT,
ADD COLUMN     "hwVersion" TEXT;

-- CreateTable
CREATE TABLE "RevokedToken" (
    "jti" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevokedToken_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "DeviceFirmwareHistory" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceFirmwareHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RevokedToken_expiresAt_idx" ON "RevokedToken"("expiresAt");

-- CreateIndex
CREATE INDEX "DeviceFirmwareHistory_deviceId_at_idx" ON "DeviceFirmwareHistory"("deviceId", "at");

-- AddForeignKey
ALTER TABLE "DeviceFirmwareHistory" ADD CONSTRAINT "DeviceFirmwareHistory_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

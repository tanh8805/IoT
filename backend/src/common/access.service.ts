import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './auth.types';

/** Kiểm tra người dùng có được xem thiết bị hay không (admin xem tất cả, còn lại theo gán). */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** null = không giới hạn (admin). */
  async accessibleDeviceIds(user: AuthUser): Promise<string[] | null> {
    if (user.role === 'ADMIN') return null;
    const rows = await this.prisma.deviceAssignment.findMany({ where: { userId: user.id } });
    return rows.map((r) => r.deviceId);
  }

  async assertAccess(user: AuthUser, deviceId: string) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Không tìm thấy thiết bị');
    if (user.role === 'ADMIN') return device;
    const assigned = await this.prisma.deviceAssignment.findUnique({
      where: { userId_deviceId: { userId: user.id, deviceId } },
    });
    if (!assigned) throw new ForbiddenException('Thiết bị này chưa được gán cho bạn');
    return device;
  }
}

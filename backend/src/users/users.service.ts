import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth.types';
import { PrismaService } from '../prisma/prisma.service';

const publicUser = (u: { id: number; username: string; fullName: string; role: Role; active: boolean; createdAt: Date; devices?: { deviceId: string }[] }) => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName,
  role: u.role,
  active: u.active,
  createdAt: u.createdAt,
  deviceIds: (u.devices || []).map((d) => d.deviceId),
});

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const users = await this.prisma.user.findMany({ orderBy: { id: 'asc' }, include: { devices: true } });
    return users.map(publicUser);
  }

  async create(actor: AuthUser, dto: { username: string; password: string; fullName: string; role: Role }, ip?: string) {
    if (await this.prisma.user.findUnique({ where: { username: dto.username } })) throw new ConflictException('Tên đăng nhập đã tồn tại');
    const user = await this.prisma.user.create({
      data: { username: dto.username, fullName: dto.fullName, role: dto.role, passwordHash: await bcrypt.hash(dto.password, 10) },
    });
    await this.audit.log({ userId: actor.id, username: actor.username, action: 'USER_CREATE', target: `user:${user.username}`, detail: { role: dto.role }, ip });
    return publicUser(user);
  }

  async update(actor: AuthUser, id: number, dto: { fullName?: string; role?: Role; active?: boolean; password?: string }, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    if (id === actor.id && (dto.active === false || (dto.role && dto.role !== 'ADMIN'))) {
      throw new BadRequestException('Không thể tự khóa hoặc hạ quyền chính mình');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        fullName: dto.fullName,
        role: dto.role,
        active: dto.active,
        passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : undefined,
      },
    });
    const action = dto.active === false ? 'USER_LOCK' : dto.active === true && !user.active ? 'USER_UNLOCK' : 'USER_UPDATE';
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action,
      target: `user:${user.username}`,
      detail: { fullName: dto.fullName, role: dto.role, active: dto.active, passwordChanged: !!dto.password },
      ip,
    });
    return publicUser(updated);
  }

  /** Gán danh sách thiết bị cho người dùng (thay thế toàn bộ). */
  async assignDevices(actor: AuthUser, id: number, deviceIds: string[], ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    const found = await this.prisma.device.findMany({ where: { id: { in: deviceIds } } });
    if (found.length !== new Set(deviceIds).size) throw new BadRequestException('Có mã thiết bị không tồn tại');
    await this.prisma.$transaction([
      this.prisma.deviceAssignment.deleteMany({ where: { userId: id } }),
      this.prisma.deviceAssignment.createMany({ data: [...new Set(deviceIds)].map((deviceId) => ({ userId: id, deviceId })) }),
    ]);
    await this.audit.log({ userId: actor.id, username: actor.username, action: 'DEVICE_ASSIGN', target: `user:${user.username}`, detail: { deviceIds }, ip });
    const fresh = await this.prisma.user.findUnique({ where: { id }, include: { devices: true } });
    return publicUser(fresh!);
  }
}

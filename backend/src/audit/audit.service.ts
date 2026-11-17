import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: number | null;
  username?: string | null;
  action: string;
  target?: string | null;
  detail?: Prisma.InputJsonValue;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(private readonly prisma: PrismaService) {}

  async log(e: AuditEntry) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: e.userId ?? null,
          username: e.username || 'system',
          action: e.action,
          target: e.target ?? null,
          detail: e.detail,
          ip: e.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Không ghi được audit log ${e.action}: ${err}`);
    }
  }

  list(params: { action?: string; limit?: number }) {
    return this.prisma.auditLog.findMany({
      where: params.action ? { action: params.action } : undefined,
      orderBy: { id: 'desc' },
      take: Math.min(params.limit || 200, 1000),
    });
  }
}

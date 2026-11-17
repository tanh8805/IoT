import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerOptions, InjectThrottlerStorage, ThrottlerGuard, ThrottlerLimitDetail, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { AuditService } from '../audit/audit.service';

/** Giới hạn số lần gọi theo IP (cấu hình ở ThrottlerModule); vượt giới hạn thì ghi audit rồi trả 429. */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly audit: AuditService,
  ) {
    super(options, storage, reflector);
  }

  protected async throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const req = context.switchToHttp().getRequest();
    const username = typeof req.body?.username === 'string' ? req.body.username.slice(0, 64) : undefined;
    await this.audit.log({
      username,
      action: 'LOGIN_RATE_LIMITED',
      target: `${req.method} ${req.originalUrl}`,
      detail: { limit: detail.limit, ttlSeconds: Math.round(detail.ttl / 1000), retryAfterSeconds: detail.timeToBlockExpire },
      ip: req.ip,
    });
    return super.throwThrottlingException(context, detail);
  }
}

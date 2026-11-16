import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AlertsService } from './alerts/alerts.service';
import { AuditService } from './audit/audit.service';
import { AuthService } from './auth/auth.service';
import { AccessService } from './common/access.service';
import { JwtAuthGuard, RolesGuard } from './common/auth.types';
import { CommandsService } from './commands/commands.service';
import { ConfigService } from './commands/config.service';
import { AdminController, AlertsController, AuthController, DevicesController, HealthController, UsersController } from './controllers';
import { DevicesService } from './devices/devices.service';
import { IngestService } from './ingest/ingest.service';
import { WatchdogService } from './ingest/watchdog.service';
import { BrokerAccountsService } from './mqtt/broker-accounts.service';
import { DynsecService } from './mqtt/dynsec.service';
import { MqttService } from './mqtt/mqtt.service';
import { PrismaService } from './prisma/prisma.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { UsersService } from './users/users.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: (process.env.JWT_EXPIRES || '8h') as never, algorithm: 'HS256' },
    }),
  ],
  controllers: [AuthController, UsersController, DevicesController, AlertsController, AdminController, HealthController],
  providers: [
    PrismaService,
    AuditService,
    AccessService,
    RealtimeGateway,
    MqttService,
    DynsecService,
    BrokerAccountsService,
    AuthService,
    UsersService,
    AlertsService,
    DevicesService,
    CommandsService,
    ConfigService,
    IngestService,
    WatchdogService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}

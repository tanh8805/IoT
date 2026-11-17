import { Body, Controller, Get, Header, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AlertsService } from './alerts/alerts.service';
import { AuditService } from './audit/audit.service';
import { AuthService, TokenPayload } from './auth/auth.service';
import { AuthUser, CurrentToken, CurrentUser, Public, Roles } from './common/auth.types';
import { CommandsService } from './commands/commands.service';
import { ConfigService } from './commands/config.service';
import { DevicesService } from './devices/devices.service';
import { AlertQueryDto, AssignDevicesDto, ChangePasswordDto, UpdateProfileDto, CommandDto, ConfigDto, CreateDeviceDto, CreateUserDto, LoginDto, MaintenanceDto, UpdateDeviceDto, UpdateUserDto } from './dto';
import { PrismaService } from './prisma/prisma.service';
import { UsersService } from './users/users.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.username, dto.password, req.ip);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto, @Req() req: Request) {
    return this.auth.updateProfile(user.id, dto, req.ip);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser() user: AuthUser, @CurrentToken() token: TokenPayload, @Req() req: Request) {
    return this.auth.logout(user.id, user.username, token, req.ip);
  }

  @Post('change-password')
  @HttpCode(200)
  changePassword(@CurrentUser() user: AuthUser, @CurrentToken() token: TokenPayload, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword, token, req.ip);
  }
}

@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get() list() {
    return this.users.list();
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateUserDto, @Req() req: Request) {
    return this.users.create(u, dto, req.ip);
  }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @Req() req: Request) {
    return this.users.update(u, id, dto, req.ip);
  }
  @Put(':id/devices') assign(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AssignDevicesDto, @Req() req: Request) {
    return this.users.assignDevices(u, id, dto.deviceIds, req.ip);
  }
}

@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly commands: CommandsService,
    private readonly config: ConfigService,
  ) {}

  @Get() list(@CurrentUser() u: AuthUser) {
    return this.devices.list(u);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.devices.get(u, id);
  }
  @Get(':id/telemetry') telemetry(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string) {
    return this.devices.telemetry(u, id, { from, to, limit: limit ? Number(limit) : undefined });
  }
  @Get(':id/stats') stats(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('granularity') granularity?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('tz') tz?: string) {
    return this.devices.stats(u, id, { granularity, from, to, tz });
  }
  @Get(':id/telemetry/export') @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: Response, @Req() req: Request, @Query('from') from?: string, @Query('to') to?: string) {
    const csv = await this.devices.exportCsv(u, id, { from, to }, req.ip);
    res.setHeader('Content-Disposition', `attachment; filename="telemetry-${id.replace(/[^a-z0-9-]/g, '')}.csv"`);
    return csv;
  }
  @Get(':id/firmware-history') firmwareHistory(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.devices.firmwareHistory(u, id);
  }
  @Get(':id/state-history') stateHistory(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.devices.stateHistory(u, id);
  }
  @Get(':id/commands') listCommands(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.commands.list(u, id);
  }
  @Get(':id/config-history') configHistory(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.config.history(u, id);
  }

  // --- Điều khiển: admin và operator ---
  @Post(':id/commands') @Roles('ADMIN', 'OPERATOR')
  sendCommand(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CommandDto, @Req() req: Request) {
    return this.commands.send(u, id, dto, req.ip);
  }
  @Post(':id/config') @Roles('ADMIN', 'OPERATOR') @HttpCode(200)
  changeConfig(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ConfigDto, @Req() req: Request) {
    return this.config.change(u, id, dto, req.ip);
  }

  // --- Quản trị thiết bị: chỉ admin ---
  @Post() @Roles('ADMIN')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateDeviceDto, @Req() req: Request) {
    return this.devices.create(u, dto, req.ip);
  }
  @Patch(':id') @Roles('ADMIN')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateDeviceDto, @Req() req: Request) {
    return this.devices.update(u, id, dto, req.ip);
  }
  @Post(':id/provision') @Roles('ADMIN') @HttpCode(200)
  provision(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.devices.provision(u, id, req.ip);
  }
  @Post(':id/maintenance') @Roles('ADMIN') @HttpCode(200)
  maintenance(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: MaintenanceDto, @Req() req: Request) {
    return this.devices.setMaintenance(u, id, dto.enabled, req.ip);
  }
  @Post(':id/decommission') @Roles('ADMIN') @HttpCode(200)
  decommission(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.devices.decommission(u, id, req.ip);
  }
}

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query() q: AlertQueryDto) {
    return this.alerts.list(u, { status: q.status, deviceId: q.deviceId, limit: q.limit });
  }
  @Post(':id/ack') @Roles('ADMIN', 'OPERATOR') @HttpCode(200)
  ack(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.alerts.acknowledge(u, id, req.ip);
  }
}

@Controller()
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('audit-logs') auditLogs(@Query('action') action?: string, @Query('limit') limit?: string) {
    return this.audit.list({ action, limit: limit ? Number(limit) : undefined });
  }
  @Get('ingest-errors') ingestErrors() {
    return this.prisma.ingestError.findMany({ orderBy: { id: 'desc' }, take: 200 });
  }
}

@Controller('health')
export class HealthController {
  @Public() @Get() health() {
    return { status: 'ok' };
  }
}

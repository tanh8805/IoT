import { AlertStatus, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, IsArray } from 'class-validator';
import { Action, ACTIONS } from './commands/commands.service';

export class LoginDto {
  @IsString() @MinLength(1) username: string;
  @IsString() @MinLength(1) password: string;
}

const PHONE_RE = /^$|^\+?[0-9 .-]{8,20}$/;
const EMAIL_RE = /^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class CreateUserDto {
  @IsString() @Matches(/^[a-zA-Z0-9_.-]{3,32}$/, { message: 'username gồm 3–32 ký tự chữ, số, _ . -' }) username: string;
  @IsString() @MinLength(8) @MaxLength(72) password: string;
  @IsString() @MinLength(1) @MaxLength(100) fullName: string;
  @IsEnum(Role) role: Role;
  @IsOptional() @IsString() @MaxLength(100) @Matches(EMAIL_RE, { message: 'email không hợp lệ' }) email?: string;
  @IsOptional() @IsString() @Matches(PHONE_RE, { message: 'số điện thoại không hợp lệ' }) phone?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) fullName?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(72) password?: string;
  @IsOptional() @IsString() @MaxLength(100) @Matches(EMAIL_RE, { message: 'email không hợp lệ' }) email?: string;
  @IsOptional() @IsString() @Matches(PHONE_RE, { message: 'số điện thoại không hợp lệ' }) phone?: string;
}

/** Người dùng tự sửa thông tin cá nhân (không đổi được vai trò, trạng thái). */
export class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) fullName?: string;
  @IsOptional() @IsString() @MaxLength(100) @Matches(EMAIL_RE, { message: 'email không hợp lệ' }) email?: string;
  @IsOptional() @IsString() @Matches(PHONE_RE, { message: 'số điện thoại không hợp lệ' }) phone?: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(1) currentPassword: string;
  @IsString() @MinLength(8) @MaxLength(72) newPassword: string;
}

export class AssignDevicesDto {
  @IsArray() @IsString({ each: true }) deviceIds: string[];
}

export class CreateDeviceDto {
  @IsString() id: string;
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(32) hwVersion?: string;
}

export class UpdateDeviceDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(32) hwVersion?: string;
}

export class MaintenanceDto {
  @IsBoolean() enabled: boolean;
}

export class CommandDto {
  @IsIn(ACTIONS as unknown as string[]) action: Action;
  @IsOptional() @IsInt() duration_s?: number;
}

export class ConfigDto {
  @IsOptional() @IsInt() @Min(5) @Max(95) soil_threshold?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(200000) lux_close?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(200000) lux_open?: number;
  @IsOptional() @IsInt() @Min(1) @Max(95) low_soil_pct?: number;
}

export class AlertQueryDto {
  @IsOptional() @IsEnum(AlertStatus, { message: 'status phải là NEW, ACKNOWLEDGED hoặc RESOLVED' }) status?: AlertStatus;
  @IsOptional() @IsString() @MaxLength(32) deviceId?: string;
  @IsOptional() @Type(() => Number) @IsInt({ message: 'limit phải là số nguyên dương' }) @Min(1, { message: 'limit phải là số nguyên dương' }) @Max(500) limit?: number;
}

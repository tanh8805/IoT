import { Role } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, IsArray } from 'class-validator';
import { Action, ACTIONS } from './commands/commands.service';

export class LoginDto {
  @IsString() @MinLength(1) username: string;
  @IsString() @MinLength(1) password: string;
}

export class CreateUserDto {
  @IsString() @Matches(/^[a-zA-Z0-9_.-]{3,32}$/, { message: 'username gồm 3–32 ký tự chữ, số, _ . -' }) username: string;
  @IsString() @MinLength(8) @MaxLength(72) password: string;
  @IsString() @MinLength(1) @MaxLength(100) fullName: string;
  @IsEnum(Role) role: Role;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) fullName?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(72) password?: string;
}

export class AssignDevicesDto {
  @IsArray() @IsString({ each: true }) deviceIds: string[];
}

export class CreateDeviceDto {
  @IsString() id: string;
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
}

export class UpdateDeviceDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
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
}

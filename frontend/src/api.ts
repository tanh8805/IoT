import { io, Socket } from 'socket.io-client';

export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER';
export type DeviceState = 'REGISTERED' | 'PROVISIONED' | 'ACTIVE' | 'OFFLINE' | 'FAULT' | 'MAINTENANCE' | 'DECOMMISSIONED';

export interface User { id: number; username: string; fullName: string; role: Role; active?: boolean; deviceIds?: string[]; email?: string | null; phone?: string | null }
export interface FirmwareChange { id: number; from: string | null; to: string; at: string }
export interface StatBucket {
  start: string;
  samples: number;
  soil: { min: number; max: number; avg: number };
  lux: { min: number | null; max: number | null; avg: number | null; samples: number };
}
export interface StatsResult { granularity: 'hour' | 'day'; tz: string; units: { soil: string; lux: string }; buckets: StatBucket[] }
export interface Telemetry { id?: number; deviceId: string; ts: string; soilRaw: number; soilPct: number; lux: number | null; pump: boolean; curtain: string | null; autoBlocked: boolean; fw: string | null }
export interface Device { id: string; name: string; location: string; state: DeviceState; lastSeenAt: string | null; lastTelemetry: Telemetry | null; soilThreshold: number; lowSoilPct: number; luxClose: number; luxOpen: number; fwVersion?: string | null; hwVersion?: string | null }
export interface Command { id: string; deviceId: string; action: string; durationS: number | null; status: 'PENDING' | 'OK' | 'ERROR' | 'TIMEOUT'; msg: string; username: string; createdAt: string; ackedAt: string | null }
export interface Alert { id: number; deviceId: string; type: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; status: 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED'; message: string; createdAt: string; ackedByName: string | null; ackedAt: string | null; resolvedAt: string | null }
export interface AuditLog { id: number; at: string; username: string; action: string; target: string | null; detail: unknown; ip: string | null }
export interface StateHistory { id: number; from: DeviceState | null; to: DeviceState; reason: string; actor: string; at: string }
export interface ConfigChange { id: number; username: string; oldValue: Record<string, number>; newValue: Record<string, number>; at: string }

const TOKEN_KEY = 'sw_token';
const USER_KEY = 'sw_user';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getStoredUser = (): User | null => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
};
export const saveSession = (token: string, user: User) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && path !== '/auth/login') {
    clearSession();
    window.location.href = '/login';
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message || `Lỗi ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/** Tải file CSV (cần kèm token nên không dùng thẻ <a> thường). */
export async function downloadCsv(path: string, fallbackName: string) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || `Lỗi ${res.status}`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Đăng xuất: báo backend thu hồi token (bỏ qua lỗi mạng), rồi xóa phiên cục bộ. */
export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` } });
  } catch {
    /* vẫn đăng xuất cục bộ */
  }
  closeSocket();
  clearSession();
}

let socket: Socket | null = null;
export function getSocket(): Socket {
  if (!socket) socket = io({ auth: (cb) => cb({ token: getToken() }), transports: ['websocket', 'polling'] });
  return socket;
}
export function closeSocket() {
  socket?.disconnect();
  socket = null;
}

export const STATE_LABEL: Record<DeviceState, string> = {
  REGISTERED: 'Đã đăng ký',
  PROVISIONED: 'Đã cấp phát',
  ACTIVE: 'Hoạt động',
  OFFLINE: 'Mất kết nối',
  FAULT: 'Lỗi',
  MAINTENANCE: 'Bảo trì',
  DECOMMISSIONED: 'Đã thu hồi',
};
export const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Quản trị', OPERATOR: 'Vận hành', VIEWER: 'Chỉ xem' };
export const ACTION_LABEL: Record<string, string> = { pump_on: 'Bật bơm', pump_off: 'Tắt bơm', curtain_open: 'Mở màn', curtain_close: 'Đóng màn' };
export const CMD_STATUS_LABEL: Record<string, string> = { PENDING: 'Đang chờ', OK: 'Thành công', ERROR: 'Lỗi', TIMEOUT: 'Quá hạn' };
export const ALERT_TYPE_LABEL: Record<string, string> = { LOW_SOIL: 'Đất khô', AUTO_BLOCKED: 'Dừng tự tưới', DEVICE_OFFLINE: 'Thiết bị offline', ABNORMAL_DATA: 'Dữ liệu bất thường' };
export const SEVERITY_LABEL: Record<string, string> = { INFO: 'Thông tin', WARNING: 'Cảnh báo', CRITICAL: 'Nghiêm trọng' };
export const ALERT_STATUS_LABEL: Record<string, string> = { NEW: 'Mới', ACKNOWLEDGED: 'Đã xác nhận', RESOLVED: 'Đã hết' };

export const fmtTime = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('vi-VN') : '—');
export const canControl = (role?: Role) => role === 'ADMIN' || role === 'OPERATOR';

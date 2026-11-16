// Kiểm tra bản tin telemetry theo đúng định dạng firmware gửi (publishTelemetry trong net.h).

export interface TelemetryData {
  ts: Date;
  soilRaw: number;
  soilPct: number;
  lux: number | null;
  pump: boolean;
  curtain: 'open' | 'closed' | null;
  autoBlocked: boolean;
  fw: string | null;
}

export type ValidationResult = { ok: true; data: TelemetryData; tsFromServer: boolean } | { ok: false; reason: string };

const SOIL_DRY_RAW = 3800;
const SOIL_WET_RAW = 650;
const LUX_SENSOR_MAX = 65535; // BH1750 đo tối đa 65535 lux
const MIN_VALID_TS = 1_600_000_000;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function validateTelemetry(raw: unknown, now = new Date()): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'Payload không phải đối tượng JSON' };
  const o = raw as Record<string, unknown>;

  if (!isInt(o.soil_raw) || o.soil_raw < 0 || o.soil_raw > 4095) return { ok: false, reason: 'soil_raw phải là số nguyên 0–4095' };
  if (!isInt(o.soil_pct) || o.soil_pct < 0 || o.soil_pct > 100) return { ok: false, reason: 'soil_pct phải là số nguyên 0–100' };

  let lux: number | null = null;
  if (o.lux !== null && o.lux !== undefined) {
    if (typeof o.lux !== 'number' || !Number.isFinite(o.lux) || o.lux < 0) return { ok: false, reason: 'lux phải là số >= 0 hoặc null' };
    lux = o.lux;
  }

  if (typeof o.pump !== 'boolean') return { ok: false, reason: 'pump phải là boolean' };
  if (typeof o.auto_blocked !== 'boolean') return { ok: false, reason: 'auto_blocked phải là boolean' };

  let curtain: 'open' | 'closed' | null = null;
  if (o.curtain !== null && o.curtain !== undefined) {
    if (o.curtain !== 'open' && o.curtain !== 'closed') return { ok: false, reason: 'curtain phải là "open", "closed" hoặc null' };
    curtain = o.curtain;
  }

  let fw: string | null = null;
  if (o.fw !== null && o.fw !== undefined) {
    if (typeof o.fw !== 'string' || o.fw.length > 32) return { ok: false, reason: 'fw phải là chuỗi tối đa 32 ký tự' };
    fw = o.fw;
  }

  // ts: null hoặc thiếu → giờ server; ts lệch quá xa thực tế cũng dùng giờ server.
  let ts = now;
  let tsFromServer = true;
  if (o.ts !== null && o.ts !== undefined) {
    if (!isInt(o.ts)) return { ok: false, reason: 'ts phải là số nguyên (giờ UNIX) hoặc null' };
    const maxTs = Math.floor(now.getTime() / 1000) + 24 * 3600;
    if (o.ts >= MIN_VALID_TS && o.ts <= maxTs) {
      ts = new Date(o.ts * 1000);
      tsFromServer = false;
    }
  }

  return { ok: true, tsFromServer, data: { ts, soilRaw: o.soil_raw, soilPct: o.soil_pct, lux, pump: o.pump, curtain, autoBlocked: o.auto_blocked, fw } };
}

/** Số đo hợp lệ về kiểu/khoảng nhưng vô lý (cảm biến hỏng). Trả về lý do hoặc null. */
export function plausibilityProblem(d: TelemetryData): string | null {
  if (d.lux !== null && d.lux > LUX_SENSOR_MAX) return `lux ${d.lux} vượt giới hạn cảm biến (${LUX_SENSOR_MAX})`;
  const expected = Math.max(0, Math.min(100, Math.round(((d.soilRaw - SOIL_DRY_RAW) * 100) / (SOIL_WET_RAW - SOIL_DRY_RAW))));
  if (Math.abs(expected - d.soilPct) > 15) return `soil_pct ${d.soilPct}% lệch quá nhiều so với soil_raw ${d.soilRaw} (kỳ vọng ~${expected}%)`;
  return null;
}

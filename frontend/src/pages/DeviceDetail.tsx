import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { ACTION_LABEL, Alert, ALERT_TYPE_LABEL, Command, ConfigChange, Device, FirmwareChange, StateHistory, StatsResult, Telemetry, api, canControl, downloadCsv, fmtTime, getSocket, getStoredUser } from '../api';
import { Msg, StateBadge, StatusBadge } from '../components';

const RANGES = [
  { label: '15 phút', ms: 15 * 60_000 },
  { label: '1 giờ', ms: 60 * 60_000 },
  { label: '6 giờ', ms: 6 * 60 * 60_000 },
  { label: '24 giờ', ms: 24 * 60 * 60_000 },
];

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
/** Giá trị cho <input type="datetime-local"> theo giờ địa phương. */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

const hhmm =(s: string) => new Date(s).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function DeviceDetail() {
  const { id = '' } = useParams();
  const user = getStoredUser()!;
  const [device, setDevice] = useState<Device | null>(null);
  const [series, setSeries] = useState<Telemetry[]>([]);
  const [range, setRange] = useState(RANGES[1].ms);
  const [commands, setCommands] = useState<Command[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [history, setHistory] = useState<StateHistory[]>([]);
  const [cfgLog, setCfgLog] = useState<ConfigChange[]>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [duration, setDuration] = useState(5);
  const [cfg, setCfg] = useState({ soil_threshold: 40, lux_close: 10000, lux_open: 5000, low_soil_pct: 20 });

  const [fwLog, setFwLog] = useState<FirmwareChange[]>([]);
  const [gran, setGran] = useState<'hour' | 'day'>('hour');
  const [sFrom, setSFrom] = useState(() => toLocalInput(new Date(Date.now() - 24 * 3600_000)));
  const [sTo, setSTo] = useState(''); // trống = đến bây giờ, để bấm Xem luôn lấy dữ liệu mới nhất
  const [stats, setStats] = useState<StatsResult | null>(null);

  /** Khoảng Từ–Đến dạng ISO; null nếu ô ngày đang nhập dở hoặc sai. */
  const statsRange = () => {
    const from = new Date(sFrom), to = sTo ? new Date(sTo) : new Date();
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) { setError('Khoảng Từ–Đến không hợp lệ.'); return null; }
    return { from: from.toISOString(), to: to.toISOString() };
  };

  const loadStats = useCallback(() => {
    const r = statsRange();
    if (!r) return;
    const q = new URLSearchParams({ granularity: gran, tz: TZ, ...r });
    api<StatsResult>(`/devices/${id}/stats?${q}`).then((r) => { setStats(r); setError(''); }).catch((e) => setError(e.message));
  }, [id, gran, sFrom, sTo]);
  useEffect(loadStats, [loadStats]);

  const exportCsv = () => {
    const r = statsRange();
    if (!r) return;
    const q = new URLSearchParams(r);
    downloadCsv(`/devices/${id}/telemetry/export?${q}`, `telemetry-${id}.csv`).catch((e) => setError(e.message));
  };

  const loadSeries = useCallback(() => {
    const from = new Date(Date.now() - range).toISOString();
    api<Telemetry[]>(`/devices/${id}/telemetry?from=${encodeURIComponent(from)}&limit=2000`).then(setSeries).catch((e) => setError(e.message));
  }, [id, range]);

  const loadAll = useCallback(() => {
    api<Device>(`/devices/${id}`).then((d) => {
      setDevice(d);
      setCfg({ soil_threshold: d.soilThreshold, lux_close: d.luxClose, lux_open: d.luxOpen, low_soil_pct: d.lowSoilPct });
    }).catch((e) => setError(e.message));
    api<Command[]>(`/devices/${id}/commands`).then(setCommands).catch(() => undefined);
    api<Alert[]>(`/alerts?deviceId=${id}`).then(setAlerts).catch(() => undefined);
    api<StateHistory[]>(`/devices/${id}/state-history`).then(setHistory).catch(() => undefined);
    api<ConfigChange[]>(`/devices/${id}/config-history`).then(setCfgLog).catch(() => undefined);
    api<FirmwareChange[]>(`/devices/${id}/firmware-history`).then(setFwLog).catch(() => undefined);
  }, [id]);

  useEffect(loadAll, [loadAll]);
  useEffect(loadSeries, [loadSeries]);

  useEffect(() => {
    const s = getSocket();
    const onTelemetry = (t: Telemetry) => {
      if (t.deviceId !== id) return;
      setSeries((cur) => [...cur.slice(-1999), t]);
      setDevice((d) => (d ? { ...d, lastTelemetry: t, lastSeenAt: new Date().toISOString() } : d));
    };
    const onDevice = (d: Device) => {
      if (d.id !== id) return;
      setDevice((cur) => (cur ? { ...cur, ...d } : d));
      api<StateHistory[]>(`/devices/${id}/state-history`).then(setHistory).catch(() => undefined);
      api<FirmwareChange[]>(`/devices/${id}/firmware-history`).then(setFwLog).catch(() => undefined);
    };
    const onCommand = (c: Command) => {
      if (c.deviceId !== id) return;
      setCommands((cur) => [c, ...cur.filter((x) => x.id !== c.id)].slice(0, 50));
    };
    const onAlert = (a: Alert) => {
      if (a.deviceId !== id) return;
      setAlerts((cur) => [a, ...cur.filter((x) => x.id !== a.id)]);
    };
    s.on('telemetry', onTelemetry);
    s.on('device', onDevice);
    s.on('command', onCommand);
    s.on('alert', onAlert);
    return () => {
      s.off('telemetry', onTelemetry);
      s.off('device', onDevice);
      s.off('command', onCommand);
      s.off('alert', onAlert);
    };
  }, [id]);

  const send = async (action: string) => {
    setError('');
    setInfo('');
    try {
      await api(`/devices/${id}/commands`, 'POST', action === 'pump_on' ? { action, duration_s: duration } : { action });
      setInfo(`Đã gửi lệnh "${ACTION_LABEL[action]}", đang chờ thiết bị xác nhận.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveConfig = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    try {
      await api(`/devices/${id}/config`, 'POST', cfg);
      setInfo('Đã gửi cấu hình mới xuống thiết bị.');
      api<ConfigChange[]>(`/devices/${id}/config-history`).then(setCfgLog).catch(() => undefined);
    } catch (e2) {
      setError((e2 as Error).message);
    }
  };

  const ack = async (a: Alert) => {
    try {
      await api(`/alerts/${a.id}/ack`, 'POST');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!device) return <div>{error ? <Msg error={error} /> : 'Đang tải...'}</div>;
  const t = device.lastTelemetry;
  const controllable = device.state === 'ACTIVE' || device.state === 'FAULT';
  const data = series.map((x) => ({ time: hhmm(x.ts), soil: x.soilPct, lux: x.lux }));

  return (
    <>
      <div className="row between">
        <h2>{device.name} <small className="muted">({device.id})</small></h2>
        <StateBadge state={device.state} />
      </div>
      <div className="muted">{device.location || 'Chưa có vị trí'} · Cập nhật lần cuối: {fmtTime(device.lastSeenAt)}</div>
      <Msg error={error} ok={info} />

      <div className="stats">
        <div className="card stat"><span>{t ? `${t.soilPct}%` : '—'}</span>Độ ẩm đất</div>
        <div className="card stat"><span>{t && t.lux !== null ? Math.round(t.lux) : '—'}</span>Ánh sáng (lux)</div>
        <div className="card stat"><span>{t ? (t.pump ? 'Bật' : 'Tắt') : '—'}</span>Bơm</div>
        <div className="card stat"><span>{t?.curtain === 'closed' ? 'Đóng' : t?.curtain === 'open' ? 'Mở' : '—'}</span>Màn che</div>
      </div>

      <div className="card">
        <div className="row between">
          <b>Biểu đồ</b>
          <div className="seg">
            {RANGES.map((r) => (
              <button key={r.ms} className={range === r.ms ? 'on' : ''} onClick={() => setRange(r.ms)}>{r.label}</button>
            ))}
          </div>
        </div>
        <div className="charts">
          <div>
            <small className="muted">Độ ẩm đất (%)</small>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" minTickGap={40} />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <ReferenceLine y={device.soilThreshold} stroke="#d97706" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="soil" name="Độ ẩm %" stroke="#16a34a" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <small className="muted">Ánh sáng (lux)</small>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" minTickGap={40} />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="lux" name="Lux" stroke="#ca8a04" dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="two">
        <div className="card">
          <b>Phiên bản</b>
          <table>
            <tbody>
              <tr><td>Firmware (báo qua telemetry)</td><td>{device.fwVersion || '—'}</td></tr>
              <tr><td>Phần cứng (admin nhập)</td><td>{device.hwVersion || '—'}</td></tr>
            </tbody>
          </table>
          <small className="muted">Lịch sử đổi firmware</small>
          <table>
            <thead><tr><th>Thời gian</th><th>Từ</th><th>Thành</th></tr></thead>
            <tbody>
              {fwLog.slice(0, 10).map((f) => (
                <tr key={f.id}><td>{fmtTime(f.at)}</td><td>{f.from || '(lần đầu thấy)'}</td><td>{f.to}</td></tr>
              ))}
              {fwLog.length === 0 && <tr><td colSpan={3} className="muted">Chưa nhận được phiên bản firmware.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card">
          <b>Thống kê độ ẩm đất và ánh sáng</b>
          <div className="row gap wrap end">
            <label>Theo
              <select value={gran} onChange={(e) => setGran(e.target.value as 'hour' | 'day')}>
                <option value="hour">Giờ</option>
                <option value="day">Ngày</option>
              </select>
            </label>
            <label>Từ<input type="datetime-local" value={sFrom} onChange={(e) => setSFrom(e.target.value)} /></label>
            <label>Đến (trống = bây giờ)<input type="datetime-local" value={sTo} onChange={(e) => setSTo(e.target.value)} /></label>
            <button className="btn small" onClick={loadStats}>Xem</button>
            <button className="btn small" onClick={exportCsv}>Xuất CSV</button>
          </div>
          <small className="muted">Độ ẩm đất đơn vị %, ánh sáng đơn vị lux (lx); giờ/ngày tính theo múi giờ trình duyệt ({TZ}). Xuất CSV theo khoảng Từ–Đến (giờ UTC trong file).</small>
        </div>
      </div>

      <div className="card">
        <b>Bảng thống kê theo {gran === 'hour' ? 'giờ' : 'ngày'}</b>
        <table>
          <thead>
            <tr><th>Bắt đầu</th><th>Số mẫu</th><th>Ẩm min (%)</th><th>Ẩm max (%)</th><th>Ẩm TB (%)</th><th>Lux min</th><th>Lux max</th><th>Lux TB</th></tr>
          </thead>
          <tbody>
            {stats?.buckets.map((b) => (
              <tr key={b.start}>
                <td>{gran === 'day' ? new Date(b.start).toLocaleDateString('vi-VN') : fmtTime(b.start)}</td>
                <td>{b.samples}</td>
                <td>{b.soil.min}</td><td>{b.soil.max}</td><td>{b.soil.avg}</td>
                <td>{b.lux.min ?? '—'}</td><td>{b.lux.max ?? '—'}</td><td>{b.lux.avg ?? '—'}</td>
              </tr>
            ))}
            {(!stats || stats.buckets.length === 0) && <tr><td colSpan={8} className="muted">Không có dữ liệu trong khoảng đã chọn.</td></tr>}
          </tbody>
        </table>
      </div>

      {canControl(user.role) && (
        <div className="two">
          <div className="card">
            <b>Điều khiển</b>
            {!controllable && <div className="muted small">Thiết bị đang ở trạng thái "{device.state}", chưa điều khiển được.</div>}
            <div className="row gap wrap ctl">
              <label className="inline">Bơm
                <input type="number" min={1} max={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /> giây
              </label>
              <button className="btn primary" disabled={!controllable} onClick={() => send('pump_on')}>Bật bơm</button>
              <button className="btn" disabled={!controllable} onClick={() => send('pump_off')}>Tắt bơm</button>
              <button className="btn" disabled={!controllable} onClick={() => send('curtain_open')}>Mở màn</button>
              <button className="btn" disabled={!controllable} onClick={() => send('curtain_close')}>Đóng màn</button>
            </div>
          </div>
          <form className="card" onSubmit={saveConfig}>
            <b>Ngưỡng tự động</b>
            <label>Tưới khi độ ẩm dưới (%)<input type="number" min={5} max={95} value={cfg.soil_threshold} onChange={(e) => setCfg({ ...cfg, soil_threshold: Number(e.target.value) })} /></label>
            <label>Cảnh báo đất khô khi độ ẩm dưới (%)<input type="number" min={1} max={95} value={cfg.low_soil_pct} onChange={(e) => setCfg({ ...cfg, low_soil_pct: Number(e.target.value) })} /></label>
            <label>Đóng màn khi sáng trên (lux)<input type="number" min={1} value={cfg.lux_close} onChange={(e) => setCfg({ ...cfg, lux_close: Number(e.target.value) })} /></label>
            <label>Mở màn khi sáng dưới (lux)<input type="number" min={1} value={cfg.lux_open} onChange={(e) => setCfg({ ...cfg, lux_open: Number(e.target.value) })} /></label>
            <button className="btn primary" disabled={!controllable}>Lưu ngưỡng</button>
          </form>
        </div>
      )}

      <div className="card">
        <b>Lịch sử lệnh</b>
        <table>
          <thead><tr><th>Thời gian</th><th>Lệnh</th><th>Người gửi</th><th>Kết quả</th><th>Ghi chú</th></tr></thead>
          <tbody>
            {commands.map((c) => (
              <tr key={c.id}>
                <td>{fmtTime(c.createdAt)}</td>
                <td>{ACTION_LABEL[c.action] || c.action}{c.durationS ? ` (${c.durationS}s)` : ''}</td>
                <td>{c.username}</td>
                <td><StatusBadge kind="cmd" value={c.status} /></td>
                <td>{c.msg}</td>
              </tr>
            ))}
            {commands.length === 0 && <tr><td colSpan={5} className="muted">Chưa có lệnh nào.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="two">
        <div className="card">
          <b>Cảnh báo</b>
          <table>
            <thead><tr><th>Thời gian</th><th>Loại</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {alerts.slice(0, 10).map((a) => (
                <tr key={a.id}>
                  <td>{fmtTime(a.createdAt)}</td>
                  <td title={a.message}>{ALERT_TYPE_LABEL[a.type]}</td>
                  <td><StatusBadge kind="alert" value={a.status} /></td>
                  <td>{a.status === 'NEW' && canControl(user.role) && <button className="btn small" onClick={() => ack(a)}>Xác nhận</button>}</td>
                </tr>
              ))}
              {alerts.length === 0 && <tr><td colSpan={4} className="muted">Không có cảnh báo.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card">
          <b>Lịch sử trạng thái</b>
          <table>
            <thead><tr><th>Thời gian</th><th>Chuyển</th><th>Lý do</th></tr></thead>
            <tbody>
              {history.slice(0, 10).map((h) => (
                <tr key={h.id}>
                  <td>{fmtTime(h.at)}</td>
                  <td>{h.from ? `${h.from} → ` : ''}{h.to}</td>
                  <td>{h.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <b>Lịch sử đổi ngưỡng</b>
        <table>
          <thead><tr><th>Thời gian</th><th>Người đổi</th><th>Trước</th><th>Sau</th></tr></thead>
          <tbody>
            {cfgLog.slice(0, 10).map((c) => (
              <tr key={c.id}>
                <td>{fmtTime(c.at)}</td>
                <td>{c.username}</td>
                <td>{`ẩm<${c.oldValue.soil_threshold}%, cảnh báo<${c.oldValue.low_soil_pct ?? '-'}%, đóng>${c.oldValue.lux_close}, mở<${c.oldValue.lux_open}`}</td>
                <td>{`ẩm<${c.newValue.soil_threshold}%, cảnh báo<${c.newValue.low_soil_pct ?? '-'}%, đóng>${c.newValue.lux_close}, mở<${c.newValue.lux_open}`}</td>
              </tr>
            ))}
            {cfgLog.length === 0 && <tr><td colSpan={4} className="muted">Chưa đổi ngưỡng lần nào.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

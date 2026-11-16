import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Device, Telemetry, api, fmtTime, getSocket } from '../api';
import { StateBadge } from '../components';

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Device[]>('/devices').then(setDevices).catch((e) => setError(e.message));
    api<Alert[]>('/alerts?status=NEW').then(setAlerts).catch(() => undefined);
    const s = getSocket();
    const onDevice = (d: Device) => setDevices((cur) => cur.map((x) => (x.id === d.id ? { ...x, ...d } : x)));
    const onTelemetry = (t: Telemetry) =>
      setDevices((cur) => cur.map((x) => (x.id === t.deviceId ? { ...x, lastTelemetry: t, lastSeenAt: new Date().toISOString() } : x)));
    const onAlert = (a: Alert) =>
      setAlerts((cur) => {
        const rest = cur.filter((x) => x.id !== a.id);
        return a.status === 'NEW' ? [a, ...rest] : rest;
      });
    s.on('device', onDevice);
    s.on('telemetry', onTelemetry);
    s.on('alert', onAlert);
    return () => {
      s.off('device', onDevice);
      s.off('telemetry', onTelemetry);
      s.off('alert', onAlert);
    };
  }, []);

  const active = devices.filter((d) => d.state === 'ACTIVE').length;
  const bad = devices.filter((d) => d.state === 'OFFLINE' || d.state === 'FAULT').length;

  return (
    <>
      <h2>Thiết bị của bạn</h2>
      {error && <div className="msg err">{error}</div>}
      <div className="stats">
        <div className="card stat"><span>{devices.length}</span>Tổng thiết bị</div>
        <div className="card stat"><span className="good">{active}</span>Đang hoạt động</div>
        <div className="card stat"><span className={bad ? 'bad' : ''}>{bad}</span>Mất kết nối / lỗi</div>
        <div className="card stat"><span className={alerts.length ? 'bad' : ''}>{alerts.length}</span><Link to="/alerts">Cảnh báo mới</Link></div>
      </div>
      <div className="grid">
        {devices.map((d) => {
          const t = d.lastTelemetry;
          return (
            <Link to={`/devices/${d.id}`} className="card device" key={d.id}>
              <div className="row between">
                <b>{d.name}</b>
                <StateBadge state={d.state} />
              </div>
              <div className="muted">{d.id} · {d.location || 'Chưa có vị trí'}</div>
              <div className="metrics">
                <div><small>Độ ẩm đất</small><b>{t ? `${t.soilPct}%` : '—'}</b></div>
                <div><small>Ánh sáng</small><b>{t && t.lux !== null ? `${Math.round(t.lux)} lux` : '—'}</b></div>
                <div><small>Bơm</small><b>{t ? (t.pump ? 'Đang bơm' : 'Tắt') : '—'}</b></div>
                <div><small>Màn che</small><b>{t?.curtain === 'closed' ? 'Đóng' : t?.curtain === 'open' ? 'Mở' : '—'}</b></div>
              </div>
              <div className="muted small">Cập nhật: {fmtTime(d.lastSeenAt)}</div>
            </Link>
          );
        })}
        {devices.length === 0 && !error && <div className="muted">Bạn chưa được gán thiết bị nào.</div>}
      </div>
    </>
  );
}

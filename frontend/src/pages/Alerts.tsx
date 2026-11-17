import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ALERT_STATUS_LABEL, ALERT_TYPE_LABEL, Alert, SEVERITY_LABEL, api, canControl, fmtTime, getSocket, getStoredUser } from '../api';
import { Msg, StatusBadge } from '../components';

export function AlertsPage() {
  const user = getStoredUser()!;
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  const load = () =>
    api<Alert[]>(`/alerts${filter ? `?status=${filter}` : ''}`).then(setAlerts).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [filter]);

  useEffect(() => {
    const s = getSocket();
    const onAlert = () => load();
    s.on('alert', onAlert);
    return () => {
      s.off('alert', onAlert);
    };
  }, [filter]);

  const ack = async (a: Alert) => {
    setError('');
    try {
      await api(`/alerts/${a.id}/ack`, 'POST');
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div className="row between">
        <h2>Cảnh báo</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Tất cả</option>
          {Object.entries(ALERT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <Msg error={error} />
      <div className="card">
        <table>
          <thead><tr><th>Thời gian</th><th>Thiết bị</th><th>Loại</th><th>Mức độ</th><th>Nội dung</th><th>Trạng thái</th><th>Người xác nhận</th><th /></tr></thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id}>
                <td>{fmtTime(a.createdAt)}</td>
                <td><Link to={`/devices/${a.deviceId}`}>{a.deviceId}</Link></td>
                <td>{ALERT_TYPE_LABEL[a.type]}</td>
                <td><span className={`badge sev-${a.severity}`}>{SEVERITY_LABEL[a.severity]}</span></td>
                <td>{a.message}</td>
                <td><StatusBadge kind="alert" value={a.status} /></td>
                <td>{a.ackedByName ? `${a.ackedByName} (${fmtTime(a.ackedAt)})` : '—'}</td>
                <td>{a.status === 'NEW' && canControl(user.role) && <button className="btn small primary" onClick={() => ack(a)}>Xác nhận</button>}</td>
              </tr>
            ))}
            {alerts.length === 0 && <tr><td colSpan={8} className="muted">Không có cảnh báo.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

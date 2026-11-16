import { useEffect, useState } from 'react';
import { AuditLog, api, fmtTime } from '../api';
import { Msg } from '../components';

const ACTIONS = ['', 'LOGIN', 'LOGIN_FAILED', 'COMMAND_SEND', 'CONFIG_CHANGE', 'DEVICE_STATE', 'DEVICE_CREATE', 'DEVICE_PROVISION', 'DEVICE_MAINTENANCE', 'DEVICE_DECOMMISSION', 'USER_CREATE', 'USER_UPDATE', 'USER_LOCK', 'USER_UNLOCK', 'DEVICE_ASSIGN', 'ALERT_ACK', 'ACCESS_DENIED'];

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');

  const load = () => api<AuditLog[]>(`/audit-logs?limit=300${action ? `&action=${action}` : ''}`).then(setLogs).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [action]);

  return (
    <>
      <div className="row between">
        <h2>Nhật ký hoạt động</h2>
        <div className="row gap">
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((a) => <option key={a} value={a}>{a || 'Tất cả hành động'}</option>)}
          </select>
          <button className="btn small" onClick={load}>Tải lại</button>
        </div>
      </div>
      <Msg error={error} />
      <div className="card">
        <table>
          <thead><tr><th>Thời gian</th><th>Người dùng</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th><th>IP</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{fmtTime(l.at)}</td>
                <td>{l.username}</td>
                <td><code>{l.action}</code></td>
                <td>{l.target}</td>
                <td className="detail">{l.detail ? JSON.stringify(l.detail) : ''}</td>
                <td>{l.ip}</td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={6} className="muted">Chưa có bản ghi.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

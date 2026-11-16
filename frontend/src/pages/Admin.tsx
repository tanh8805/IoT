import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Device, ROLE_LABEL, Role, User, api, fmtTime } from '../api';
import { Msg, StateBadge } from '../components';

export function AdminDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [form, setForm] = useState({ id: '', name: '', location: '', hwVersion: '' });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [secret, setSecret] = useState<{ deviceId: string; mqttUsername: string; mqttPassword: string } | null>(null);

  const load = () => api<Device[]>('/devices').then(setDevices).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setError('');
    setInfo('');
    try {
      await fn();
      if (okMsg) setInfo(okMsg);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/devices', 'POST', form);
      setForm({ id: '', name: '', location: '', hwVersion: '' });
    }, 'Đã đăng ký thiết bị (trạng thái Đã đăng ký). Bấm "Cấp phát" để tạo tài khoản MQTT.');
  };

  const provision = (d: Device) =>
    run(async () => {
      const r = await api<{ deviceId: string; mqttUsername: string; mqttPassword: string }>(`/devices/${d.id}/provision`, 'POST');
      setSecret(r);
    });

  const decommission = (d: Device) => {
    if (!confirm(`Thu hồi thiết bị ${d.id}? Tài khoản MQTT sẽ bị vô hiệu hóa và không thể hoàn tác.`)) return;
    run(() => api(`/devices/${d.id}/decommission`, 'POST'), `Đã thu hồi ${d.id}.`);
  };

  return (
    <>
      <h2>Quản lý thiết bị</h2>
      <Msg error={error} ok={info} />
      {secret && (
        <div className="card secret">
          <b>Tài khoản MQTT của {secret.deviceId}</b>
          <p>Mật khẩu chỉ hiển thị <b>một lần</b>. Hãy chép vào <code>secrets.h</code> của thiết bị ngay.</p>
          <div>Tên đăng nhập: <code>{secret.mqttUsername}</code></div>
          <div>Mật khẩu: <code>{secret.mqttPassword}</code></div>
          <button className="btn small" onClick={() => setSecret(null)}>Đã lưu, đóng</button>
        </div>
      )}
      <form className="card row gap wrap end" onSubmit={create}>
        <label>Mã thiết bị<input placeholder="chau-03" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} required /></label>
        <label>Tên<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label>Vị trí<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
        <label>Phiên bản phần cứng<input placeholder="v1.0" maxLength={32} value={form.hwVersion} onChange={(e) => setForm({ ...form, hwVersion: e.target.value })} /></label>
        <button className="btn primary">Đăng ký thiết bị</button>
      </form>
      <div className="card">
        <table>
          <thead><tr><th>Mã</th><th>Tên</th><th>Vị trí</th><th>Trạng thái</th><th>Firmware</th><th>Phần cứng</th><th>Lần cuối thấy</th><th>Thao tác</th></tr></thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td><Link to={`/devices/${d.id}`}>{d.id}</Link></td>
                <td>{d.name}</td>
                <td>{d.location}</td>
                <td><StateBadge state={d.state} /></td>
                <td>{d.fwVersion || '—'}</td>
                <td>{d.hwVersion || '—'}</td>
                <td>{fmtTime(d.lastSeenAt)}</td>
                <td className="row gap wrap">
                  <button className="btn small" onClick={() => {
                    const v = prompt(`Phiên bản phần cứng của ${d.id} (để trống để xóa):`, d.hwVersion || '');
                    if (v !== null) run(() => api(`/devices/${d.id}`, 'PATCH', { hwVersion: v.trim() }), 'Đã lưu phiên bản phần cứng.');
                  }}>Sửa HW</button>
                  {d.state === 'REGISTERED' && <button className="btn small primary" onClick={() => provision(d)}>Cấp phát</button>}
                  {d.state !== 'REGISTERED' && d.state !== 'DECOMMISSIONED' && d.state !== 'MAINTENANCE' && (
                    <button className="btn small" onClick={() => run(() => api(`/devices/${d.id}/maintenance`, 'POST', { enabled: true }))}>Bảo trì</button>
                  )}
                  {d.state === 'MAINTENANCE' && (
                    <button className="btn small" onClick={() => run(() => api(`/devices/${d.id}/maintenance`, 'POST', { enabled: false }))}>Kết thúc bảo trì</button>
                  )}
                  {d.state !== 'DECOMMISSIONED' && <button className="btn small danger" onClick={() => decommission(d)}>Thu hồi</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [form, setForm] = useState({ username: '', password: '', fullName: '', email: '', phone: '', role: 'VIEWER' as Role });
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const load = () => {
    api<User[]>('/users').then(setUsers).catch((e) => setError(e.message));
    api<Device[]>('/devices').then(setDevices).catch(() => undefined);
  };
  useEffect(load, []);

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setError('');
    setInfo('');
    try {
      await fn();
      if (okMsg) setInfo(okMsg);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/users', 'POST', form);
      setForm({ username: '', password: '', fullName: '', email: '', phone: '', role: 'VIEWER' });
    }, 'Đã tạo người dùng.');
  };

  const toggleDevice = (u: User, deviceId: string) => {
    const cur = new Set(u.deviceIds || []);
    cur.has(deviceId) ? cur.delete(deviceId) : cur.add(deviceId);
    run(() => api(`/users/${u.id}/devices`, 'PUT', { deviceIds: [...cur] }));
  };

  return (
    <>
      <h2>Người dùng</h2>
      <Msg error={error} ok={info} />
      <form className="card row gap wrap end" onSubmit={create}>
        <label>Tên đăng nhập<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
        <label>Họ tên<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></label>
        <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Điện thoại<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label>Mật khẩu (≥ 8 ký tự)<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required /></label>
        <label>Vai trò
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        <button className="btn primary">Thêm</button>
      </form>
      <div className="card">
        <table>
          <thead><tr><th>Tài khoản</th><th>Họ tên</th><th>Liên hệ</th><th>Vai trò</th><th>Trạng thái</th><th>Thiết bị được gán</th><th>Thao tác</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.fullName}</td>
                <td className="small">{[u.email, u.phone].filter(Boolean).join(' · ') || '—'}</td>
                <td>
                  <select value={u.role} onChange={(e) => run(() => api(`/users/${u.id}`, 'PATCH', { role: e.target.value }), 'Đã đổi vai trò.')}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
                <td>{u.active ? <span className="badge st-ACTIVE">Đang dùng</span> : <span className="badge st-FAULT">Đã khóa</span>}</td>
                <td>
                  {editing === u.id ? (
                    <div className="checks">
                      {devices.map((d) => (
                        <label key={d.id} className="inline"><input type="checkbox" checked={(u.deviceIds || []).includes(d.id)} onChange={() => toggleDevice(u, d.id)} />{d.id}</label>
                      ))}
                    </div>
                  ) : (
                    (u.deviceIds || []).join(', ') || (u.role === 'ADMIN' ? 'Tất cả' : '—')
                  )}
                </td>
                <td className="row gap wrap">
                  <button className="btn small" onClick={() => setEditing(editing === u.id ? null : u.id)}>{editing === u.id ? 'Xong' : 'Gán thiết bị'}</button>
                  <button className={`btn small ${u.active ? 'danger' : ''}`} onClick={() => run(() => api(`/users/${u.id}`, 'PATCH', { active: !u.active }), u.active ? 'Đã khóa tài khoản.' : 'Đã mở khóa.')}>
                    {u.active ? 'Khóa' : 'Mở khóa'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

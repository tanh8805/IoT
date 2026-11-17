import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, api, saveSession } from '../api';
import { Msg } from '../components';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ accessToken: string; user: User }>('/auth/login', 'POST', { username, password });
      saveSession(r.accessToken, r.user);
      nav('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <h1>🌱 Tưới cây thông minh</h1>
        <p className="muted">Đăng nhập để theo dõi và điều khiển thiết bị</p>
        <label>Tên đăng nhập<input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required /></label>
        <label>Mật khẩu<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <Msg error={error} />
        <button className="btn primary" disabled={busy}>{busy ? 'Đang đăng nhập...' : 'Đăng nhập'}</button>
      </form>
    </div>
  );
}

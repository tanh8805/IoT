import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABEL, User, api, getStoredUser, getToken, logout, saveSession } from '../api';
import { Msg } from '../components';

export function AccountPage() {
  const nav = useNavigate();
  const [me, setMe] = useState<User | null>(null);
  const [profile, setProfile] = useState({ fullName: '', email: '', phone: '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pErr, setPErr] = useState('');
  const [pOk, setPOk] = useState('');
  const [wErr, setWErr] = useState('');

  useEffect(() => {
    api<User>('/auth/me').then((u) => {
      setMe(u);
      setProfile({ fullName: u.fullName, email: u.email || '', phone: u.phone || '' });
    }).catch((e) => setPErr(e.message));
  }, []);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setPErr('');
    setPOk('');
    try {
      const u = await api<User>('/auth/me', 'PATCH', profile);
      setMe(u);
      saveSession(getToken()!, { ...getStoredUser()!, fullName: u.fullName });
      setPOk('Đã cập nhật thông tin cá nhân.');
    } catch (err) {
      setPErr((err as Error).message);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setWErr('');
    if (pw.newPassword !== pw.confirm) return setWErr('Mật khẩu nhập lại không khớp.');
    try {
      await api('/auth/change-password', 'POST', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      await logout();
      alert('Đã đổi mật khẩu. Hãy đăng nhập lại bằng mật khẩu mới.');
      nav('/login');
    } catch (err) {
      setWErr((err as Error).message);
    }
  };

  if (!me) return <div>{pErr ? <Msg error={pErr} /> : 'Đang tải...'}</div>;
  return (
    <>
      <h2>Tài khoản của tôi</h2>
      <div className="two">
        <form className="card" onSubmit={saveProfile}>
          <b>Thông tin cá nhân</b>
          <div className="muted small">Tên đăng nhập: <code>{me.username}</code> · Vai trò: {ROLE_LABEL[me.role]}</div>
          <Msg error={pErr} ok={pOk} />
          <label>Họ tên<input value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} required maxLength={100} /></label>
          <label>Email<input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} maxLength={100} /></label>
          <label>Số điện thoại<input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="0912345678" /></label>
          <button className="btn primary">Lưu thông tin</button>
        </form>
        <form className="card" onSubmit={changePassword}>
          <b>Đổi mật khẩu</b>
          <div className="muted small">Sau khi đổi, mọi phiên đăng nhập cũ (kể cả trên thiết bị khác) đều hết hiệu lực.</div>
          <Msg error={wErr} />
          <label>Mật khẩu hiện tại<input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required autoComplete="current-password" /></label>
          <label>Mật khẩu mới (≥ 8 ký tự)<input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} minLength={8} maxLength={72} required autoComplete="new-password" /></label>
          <label>Nhập lại mật khẩu mới<input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} minLength={8} required autoComplete="new-password" /></label>
          <button className="btn primary">Đổi mật khẩu</button>
        </form>
      </div>
    </>
  );
}

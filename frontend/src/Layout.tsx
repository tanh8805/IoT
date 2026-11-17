import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ROLE_LABEL, getStoredUser, logout } from './api';

export function Layout() {
  const user = getStoredUser()!;
  const nav = useNavigate();
  const onLogout = async () => {
    await logout();
    nav('/login');
  };
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🌱 Tưới cây thông minh</div>
        <nav>
          <NavLink to="/" end>Thiết bị</NavLink>
          <NavLink to="/alerts">Cảnh báo</NavLink>
          {user.role === 'ADMIN' && (
            <>
              <NavLink to="/admin/devices">Quản lý thiết bị</NavLink>
              <NavLink to="/admin/users">Người dùng</NavLink>
              <NavLink to="/admin/audit">Nhật ký</NavLink>
            </>
          )}
        </nav>
        <div className="who">
          <NavLink to="/account" className="whoname">{user.fullName} · <b>{ROLE_LABEL[user.role]}</b></NavLink>
          <button className="btn small" onClick={onLogout}>Đăng xuất</button>
        </div>
      </header>
      <main><Outlet /></main>
    </div>
  );
}

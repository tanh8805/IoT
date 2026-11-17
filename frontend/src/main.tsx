import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { getStoredUser } from './api';
import { AccountPage } from './pages/Account';
import { AdminDevices, AdminUsers } from './pages/Admin';
import { AlertsPage } from './pages/Alerts';
import { AuditPage } from './pages/Audit';
import { DeviceDetail } from './pages/DeviceDetail';
import { DevicesPage } from './pages/Devices';
import { LoginPage } from './pages/Login';
import './styles.css';

function Protected({ children, admin }: { children: React.ReactElement; admin?: boolean }) {
  const user = getStoredUser();
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return children;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Protected><Layout /></Protected>}>
          <Route path="/" element={<DevicesPage />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/admin/users" element={<Protected admin><AdminUsers /></Protected>} />
          <Route path="/admin/devices" element={<Protected admin><AdminDevices /></Protected>} />
          <Route path="/admin/audit" element={<Protected admin><AuditPage /></Protected>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);

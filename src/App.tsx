import { Routes, Route, Navigate } from 'react-router-dom';
import { AndroidBackNavigation } from './components/AndroidBackNavigation';
import { DashboardLayout } from './layouts/DashboardLayout';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { Threats } from './pages/Threats';
import { Recovery } from './pages/Recovery';
import { Events } from './pages/Events';
import { Analytics } from './pages/Analytics';
import { SettingsPage } from './pages/Settings';
import { SecureShare } from './pages/SecureShare';

function App() {
  return (
    <>
      <AndroidBackNavigation />
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route element={<DashboardLayout />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="devices" element={<Devices />} />
          <Route path="threats" element={<Threats />} />
          <Route path="recovery" element={<Recovery />} />
          <Route path="secure-share" element={<SecureShare />} />
          <Route path="events" element={<Events />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}

export default App;

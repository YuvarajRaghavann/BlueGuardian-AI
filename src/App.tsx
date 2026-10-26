import { useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AndroidBackNavigation } from './components/AndroidBackNavigation';
import { LaunchSplash } from './components/LaunchSplash';
import { DashboardLayout } from './layouts/DashboardLayout';
import { Dashboard } from './pages/Dashboard';
import { AroundYou } from './pages/AroundYou';
import { Threats } from './pages/Threats';
import { Recovery } from './pages/Recovery';
import { Events } from './pages/Events';
import { Analytics } from './pages/Analytics';
import { SettingsPage } from './pages/Settings';
import { SecureShare } from './pages/SecureShare';
import { Welcome } from './pages/Welcome';
import { isOnboarded } from './services/accountSession';
import './ui/backStack';

function App() {
  const location = useLocation();
  // First launch goes through the welcome flow; later launches open with the animated splash.
  const needsWelcome = !isOnboarded() && location.pathname !== '/welcome';
  // Decided once at launch, so finishing the welcome flow doesn't replay the splash.
  const [showSplash] = useState(() => isOnboarded());

  return (
    <>
      <AndroidBackNavigation />
      {showSplash && <LaunchSplash />}
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/" element={<Navigate to={needsWelcome ? '/welcome' : '/dashboard'} replace />} />
        {needsWelcome ? (
          <Route path="*" element={<Navigate to="/welcome" replace />} />
        ) : (
          <>
            <Route element={<DashboardLayout />}>
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="devices" element={<AroundYou />} />
              <Route path="threats" element={<Threats />} />
              <Route path="recovery" element={<Recovery />} />
              <Route path="secure-share" element={<SecureShare />} />
              <Route path="events" element={<Events />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </>
        )}
      </Routes>
    </>
  );
}

export default App;

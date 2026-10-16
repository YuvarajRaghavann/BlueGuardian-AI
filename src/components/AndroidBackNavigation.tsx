import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Bridges Android's system/predictive Back gesture to React Router.
 * A direct-opened route falls back to the dashboard instead of leaving the app.
 */
export function AndroidBackNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleAndroidBack = () => {
      if (location.pathname === '/dashboard' || location.pathname === '/') return;

      // React Router stores its stack index in the browser history state.
      // Do not let a direct-opened deep link navigate outside the application.
      const historyIndex = window.history.state?.idx;
      if (typeof historyIndex === 'number' && historyIndex > 0) {
        navigate(-1);
      } else {
        navigate('/dashboard', { replace: true });
      }
    };

    window.addEventListener('blueguardian:android-back', handleAndroidBack);
    return () => {
      window.removeEventListener('blueguardian:android-back', handleAndroidBack);
    };
  }, [location.pathname, navigate]);

  return null;
}

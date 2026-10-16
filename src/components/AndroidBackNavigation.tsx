import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Bridges Android's system/predictive Back gesture to React Router.
 * Native code exits the Activity only when the dashboard is the current route.
 */
export function AndroidBackNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleAndroidBack = () => {
      if (location.pathname !== '/dashboard' && location.pathname !== '/') {
        navigate(-1);
      }
    };

    window.addEventListener('blueguardian:android-back', handleAndroidBack);
    return () => {
      window.removeEventListener('blueguardian:android-back', handleAndroidBack);
    };
  }, [location.pathname, navigate]);

  return null;
}

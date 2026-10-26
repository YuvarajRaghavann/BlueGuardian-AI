import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { setRouteBackHandler } from '../ui/backStack';

const ROOTS = new Set(['/', '/dashboard', '/welcome']);

/**
 * Route-level Back: go back inside the app, fall back to Home, and only let
 * Android close the app from a root screen.
 */
export function AndroidBackNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setRouteBackHandler(() => {
      if (ROOTS.has(location.pathname)) return false;
      const historyIndex = window.history.state?.idx;
      if (typeof historyIndex === 'number' && historyIndex > 0) navigate(-1);
      else navigate('/dashboard', { replace: true });
      return true;
    });
  }, [location.pathname, navigate]);

  return null;
}

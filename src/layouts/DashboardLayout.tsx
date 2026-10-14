import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Menu } from 'lucide-react';
import { Sidebar } from '../components/Sidebar';
import { Topbar } from '../components/Topbar';
import { RouteTransition } from '../components/motion/MotionPrimitives';

export function DashboardLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <Sidebar
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <div className="min-h-screen lg:pl-[264px]">
        <div className="sticky top-0 z-30 flex items-center border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur-xl lg:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            className="m-3 flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface)] hover:text-white"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <span className="text-sm font-bold">BG</span>
            </div>

            <span className="text-sm font-semibold tracking-tight">
              BlueGuardian
            </span>
          </div>
        </div>

        <Topbar title="Security Overview" />

        <main className="min-h-[calc(100vh-73px)] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
          <div className="mx-auto w-full max-w-[1440px]">
            <MotionConfig reducedMotion="user">
              <RouteTransition routeKey={location.pathname}>
                <Outlet />
              </RouteTransition>
            </MotionConfig>
          </div>
        </main>
      </div>
    </div>
  );
}

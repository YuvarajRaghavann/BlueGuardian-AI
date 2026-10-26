import { useState } from 'react';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'framer-motion';
import { Activity, BarChart2, Bell, LayoutDashboard, LockKeyhole, LogOut, MapPin, Menu, Radar as RadarIcon, Settings, User } from 'lucide-react';
import { LogoMark } from '../ui/Logo';
import { signOut, useAccount } from '../services/accountSession';
import { useThreats } from '../context/ThreatContext';
import { BottomSheet } from '../ui/BottomSheet';
import { cn } from '../utils/cn';

const TABS = [
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/devices', label: 'Around', icon: RadarIcon },
  { to: '/threats', label: 'Alerts', icon: Bell },
  { to: '/recovery', label: 'Find', icon: MapPin },
  { to: '/secure-share', label: 'Share', icon: LockKeyhole },
];

const TITLES: Record<string, string> = {
  '/dashboard': 'BlueGuardian',
  '/devices': 'Around you',
  '/threats': 'Alerts',
  '/recovery': 'Find',
  '/secure-share': 'Secure Share',
  '/events': 'Activity',
  '/analytics': 'Insights',
  '/settings': 'Settings',
};

export function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [moreOpen, setMoreOpen] = useState(false);
  const { state: threatState } = useThreats();
  const openAlerts = threatState.threats.filter((t) => t.status === 'ACTIVE' || t.status === 'INVESTIGATING').length;
  const title = TITLES[location.pathname] ?? 'BlueGuardian';
  // useOutlet() freezes the element per route, so the exiting page keeps its own content during the transition.
  const outlet = useOutlet();
  const account = useAccount();

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen text-[var(--text)]">
        <header className="sticky top-0 z-30 border-b border-transparent bg-[var(--bg)]/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
            <LogoMark className="h-8 w-8 shrink-0" />
            <AnimatePresence mode="wait" initial={false}>
              <motion.h1
                key={title}
                className="flex-1 truncate text-[17px] font-bold"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                {title}
              </motion.h1>
            </AnimatePresence>
            <button type="button" onClick={() => setMoreOpen(true)} aria-label="More" className="tap grid h-10 w-10 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface)]">
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl px-4 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+24px)] pt-3">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>

        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)]">
          <div className="mx-auto flex h-[62px] max-w-md items-stretch rounded-[22px] border border-[var(--border)] bg-[var(--bg-elevated)]/90 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl">
            {TABS.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className="relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl">
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="tab-pill"
                        className="absolute inset-0 rounded-2xl bg-[var(--accent-soft)]"
                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                      />
                    )}
                    <span className="relative">
                      <Icon className={cn('h-[21px] w-[21px] transition-colors', isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]')} />
                      {to === '/threats' && openAlerts > 0 && (
                        <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-[#1a0d08]">{openAlerts}</span>
                      )}
                    </span>
                    <span className={cn('relative text-[10.5px] font-semibold transition-colors', isActive ? 'text-[var(--text)]' : 'text-[var(--text-muted)]')}>{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} label="More">
          <div className="px-4 pb-6 pt-1">
            <div className="mb-2 flex items-center gap-3 rounded-2xl bg-[var(--surface)] p-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]"><User className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{account.email ?? 'Not signed in'}</span>
                <span className="block text-xs text-[var(--text-muted)]">
                  {account.status === 'signed-in' ? 'Signed in' : account.status === 'restoring' ? 'Signing in…' : account.status === 'offline' ? 'Offline · reconnects automatically' : 'Sign in to use community search'}
                </span>
              </span>
              {account.email ? (
                <button type="button" onClick={() => { signOut(); setMoreOpen(false); }} aria-label="Sign out" className="tap grid h-10 w-10 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]">
                  <LogOut className="h-5 w-5" />
                </button>
              ) : (
                <button type="button" onClick={() => { setMoreOpen(false); navigate('/welcome?step=account'); }} className="tap rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white">Sign in</button>
              )}
            </div>
            {[
              { to: '/events', label: 'Activity', sub: 'What happened, and when', icon: Activity },
              { to: '/analytics', label: 'Insights', sub: 'Patterns from your scans', icon: BarChart2 },
              { to: '/settings', label: 'Settings', sub: 'Permissions and preferences', icon: Settings },
            ].map(({ to, label, sub, icon: Icon }) => (
              <button key={to} type="button" onClick={() => { setMoreOpen(false); navigate(to); }}
                className="tap flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-[var(--surface)]">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--surface)] text-[var(--accent)]"><Icon className="h-5 w-5" /></span>
                <span>
                  <span className="block text-[15px] font-semibold">{label}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{sub}</span>
                </span>
              </button>
            ))}
          </div>
        </BottomSheet>
      </div>
    </MotionConfig>
  );
}

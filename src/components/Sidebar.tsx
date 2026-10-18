import { NavLink } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Bluetooth,
  LayoutDashboard,
  LifeBuoy,
  LockKeyhole,
  Settings,
  Shield,
  X,
} from 'lucide-react';
import { cn } from '../utils/cn';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/devices', label: 'Nearby Devices', icon: Bluetooth },
  { path: '/threats', label: 'Threat Detection', icon: AlertTriangle },
  { path: '/recovery', label: 'Find a Lost Device', icon: LifeBuoy },
  { path: '/secure-share', label: 'Secure Share', icon: LockKeyhole },
  { path: '/events', label: 'Security Events', icon: Activity },
  { path: '/analytics', label: 'Analytics', icon: BarChart2 },
  { path: '/settings', label: 'Settings', icon: Settings },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)] transition-transform duration-200 lg:z-40 lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-[72px] items-center justify-between border-b border-[var(--border)] px-5">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--accent-soft)] text-[var(--accent)]">
              <Shield className="h-5 w-5" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--accent)] ring-2 ring-[var(--bg-elevated)]" />
            </div>

            <div>
              <p className="text-[15px] font-semibold tracking-tight text-white">
                BlueGuardian
              </p>
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Bluetooth Protection
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close navigation"
            className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 pt-5">
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Protection
          </p>

          <nav className="space-y-1">
            {navItems.slice(0, 5).map((item) => (
              <NavigationItem key={item.path} item={item} onClick={onMobileClose} />
            ))}
          </nav>

          <p className="px-2 pb-2 pt-7 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Intelligence
          </p>

          <nav className="space-y-1">
            {navItems.slice(5).map((item) => (
              <NavigationItem key={item.path} item={item} onClick={onMobileClose} />
            ))}
          </nav>
        </div>

        <div className="mt-auto p-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-2.5 w-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--text-muted)]" />
              </span>

              <span className="text-xs font-medium text-[var(--text-secondary)]">
                Protection status
              </span>
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
              Scans start only when requested. No background monitoring is active.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

function NavigationItem({
  item,
  onClick,
}: {
  item: (typeof navItems)[number];
  onClick?: () => void;
}) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.path}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'group relative flex min-h-11 items-center gap-3 rounded-lg px-3.5 text-[13px] font-medium transition-colors',
          isActive
            ? 'bg-[var(--accent-soft)] text-white'
            : 'text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-white',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'absolute left-0 top-2.5 h-6 w-0.5 rounded-full transition-opacity',
              isActive ? 'bg-[var(--accent)] opacity-100' : 'opacity-0',
            )}
          />

          <Icon
            className={cn(
              'h-[18px] w-[18px] shrink-0',
              isActive
                ? 'text-[var(--accent)]'
                : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]',
            )}
          />

          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

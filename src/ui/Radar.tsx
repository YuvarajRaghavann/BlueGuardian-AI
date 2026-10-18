import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Smartphone } from 'lucide-react';
import { estimateDistanceM } from '../intel/distance';

export interface RadarDot {
  id: string;
  address?: string;
  name: string;
  rssi?: number;
  txPower?: number;
  color: string;
  alert?: boolean;
}

const RINGS = [1, 3, 10, 30];
const MAX_M = 30;

function radiusFor(distance: number | null): number {
  if (distance === null) return 0.92;
  const t = Math.log10(distance + 1) / Math.log10(MAX_M + 1);
  return Math.min(0.94, Math.max(0.3, t));
}

function angleFor(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
}

/**
 * Live map of the Bluetooth devices around you. Your phone is the centre;
 * distance comes from signal strength (path-loss estimate), colour from trust.
 */
export function Radar({ dots, scanning, onSelect, onScan }: {
  dots: RadarDot[];
  scanning: boolean;
  onSelect?: (id: string) => void;
  onScan?: () => void;
}) {
  const reduce = useReducedMotion();
  const S = 300;
  const C = S / 2;
  const R = C - 10;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px]">
      <svg viewBox={`0 0 ${S} ${S}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(140,124,255,0.20)" />
            <stop offset="70%" stopColor="rgba(140,124,255,0.05)" />
            <stop offset="100%" stopColor="rgba(140,124,255,0)" />
          </radialGradient>
        </defs>
        <circle cx={C} cy={C} r={R} fill="url(#radar-bg)" />
        {RINGS.map((m) => {
          const rr = radiusFor(m) * R;
          return (
            <g key={m}>
              <circle cx={C} cy={C} r={rr} fill="none" stroke="rgba(169,180,208,0.14)" strokeDasharray={m === MAX_M ? undefined : '2 6'} />
              <text x={C + rr * 0.71 + 4} y={C - rr * 0.71 - 4} fill="rgba(169,180,208,0.45)" fontSize="9">{m} m</text>
            </g>
          );
        })}
      </svg>

      {scanning && !reduce && (
        <div
          className="pointer-events-none absolute inset-[3.3%] rounded-full"
          style={{
            background: 'conic-gradient(from 0deg, rgba(140,124,255,0.45), rgba(140,124,255,0) 70deg, transparent 360deg)',
            animation: 'radar-sweep 2.2s linear infinite',
          }}
        />
      )}

      <AnimatePresence>
        {dots.map((d, i) => {
          const dist = estimateDistanceM(d.rssi, d.txPower);
          const rr = radiusFor(dist);
          const a = angleFor(d.address ?? d.id);
          const left = 50 + Math.cos(a) * rr * (R / S) * 100;
          const top = 50 + Math.sin(a) * rr * (R / S) * 100;
          return (
            <motion.button
              key={d.id}
              type="button"
              aria-label={d.name}
              onClick={() => onSelect?.(d.id)}
              className="absolute -translate-x-1/2 -translate-y-1/2 p-2"
              style={{ left: `${left}%`, top: `${top}%` }}
              initial={reduce ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22, delay: reduce ? 0 : Math.min(i, 20) * 0.03 }}
              whileTap={{ scale: 1.4 }}
            >
              <span className="relative block h-3 w-3 rounded-full" style={{ background: d.color, boxShadow: `0 0 12px ${d.color}` }}>
                {d.alert && <span className="absolute inset-0 rounded-full" style={{ background: d.color, animation: 'ping-soft 1.6s ease-out infinite' }} />}
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>

      <button
        type="button"
        onClick={onScan}
        disabled={scanning}
        aria-label={scanning ? 'Scanning' : 'Scan now'}
        className="tap absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--accent)] shadow-[0_0_40px_rgba(140,124,255,0.35)]"
      >
        {scanning && !reduce && <span className="absolute inset-0 rounded-full border border-[var(--accent)]" style={{ animation: 'ping-soft 1.4s ease-out infinite' }} />}
        <Smartphone className="h-6 w-6" />
      </button>
    </div>
  );
}

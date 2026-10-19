import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useReducedMotion } from 'framer-motion';
import type { TrustOpinion } from '../intel/engine';
import { LEVEL, score } from './trust';

/** Trust arc that fills to the score; the thin outer ring shows how much evidence backs it. */
export function TrustDial({ opinion, size = 148 }: { opinion: TrustOpinion; size?: number }) {
  const reduce = useReducedMotion();
  const value = score(opinion);
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(reduce ? value : 0);
  const color = LEVEL[opinion.level].color;
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  const r2 = size / 2 - 4;
  const c2 = 2 * Math.PI * r2;

  useEffect(() => {
    if (reduce) { setShown(value); return; }
    const controls = animate(from.current, value, {
      duration: 1.1, ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => { from.current = v; setShown(Math.round(v)); },
    });
    return () => controls.stop();
  }, [value, reduce]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-hover)" strokeWidth={10} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: reduce ? 0 : 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
        <circle cx={size / 2} cy={size / 2} r={r2} fill="none" stroke="var(--surface-raised)" strokeWidth={2} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r2} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round"
          strokeDasharray={c2}
          initial={{ strokeDashoffset: c2 }}
          animate={{ strokeDashoffset: c2 * (1 - opinion.confidence) }}
          transition={{ duration: reduce ? 0 : 1.4, delay: reduce ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[42px] font-semibold leading-none" style={{ color }}>{shown}</span>
        <span className="mt-1 text-[11px] text-[var(--text-muted)]">{Math.round(opinion.confidence * 100)}% sure</span>
      </div>
    </div>
  );
}

/** Small ring used in lists. */
export function TrustRing({ opinion, size = 40, children }: { opinion: TrustOpinion; size?: number; children?: ReactNode }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const color = LEVEL[opinion.level].color;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-hover)" strokeWidth={3} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - (opinion.level === 'unverified' ? 0 : opinion.p))} />
      </svg>
      {children}
    </div>
  );
}

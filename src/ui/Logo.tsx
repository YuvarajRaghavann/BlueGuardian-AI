import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const SHIELD = 'M32 4.5 53.5 12.3v17.2c0 14.6-9.3 25.2-21.5 29.9C19.8 54.7 10.5 44.1 10.5 29.5V12.3L32 4.5Z';
const SHINE = 'M32 4.5 53.5 12.3v17.2c0 1-.05 2-.15 3H10.65c-.1-1-.15-2-.15-3V12.3L32 4.5Z';
const G = 'M39.6 23.6A11.2 11.2 0 1 0 43.2 32H33.4';
const WAVE = 'M40.6 15.4a6.4 6.4 0 0 1 8.4 8.6';

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-fill`} x1="14" y1="6" x2="52" y2="60" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#A99BFF" />
        <stop offset="0.55" stopColor="#7563F5" />
        <stop offset="1" stopColor="#4338CA" />
      </linearGradient>
      <linearGradient id={`${id}-shine`} x1="32" y1="4" x2="32" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}

/** BlueGuardian mark: a shield holding a "G" drawn as a radar ring, with a detected device blip. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <Defs id={id} />
      <path d={SHIELD} fill={`url(#${id}-fill)`} />
      <path d={SHINE} fill={`url(#${id}-shine)`} />
      <path d={G} fill="none" stroke="#F5F3FF" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d={SHIELD} fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="1" />
      <path d={WAVE} fill="none" stroke="#7CF2C8" strokeOpacity="0.75" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="44.2" cy="20.2" r="3.1" fill="#7CF2C8" />
    </svg>
  );
}

/** Entrance animation: shield rises in, the G is drawn, the blip lands and keeps pinging. */
export function AnimatedLogo({ size = 132, loop = true }: { size?: number; loop?: boolean }) {
  const id = useId().replace(/:/g, '');
  const reduce = useReducedMotion();
  const ease = [0.22, 1, 0.36, 1] as const;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <motion.div
        className="absolute inset-[-30%] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(140,124,255,0.45), rgba(140,124,255,0) 65%)' }}
        initial={reduce ? false : { opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.2, ease }}
      />
      <motion.svg
        viewBox="0 0 64 64" width={size} height={size} className="relative" aria-label="BlueGuardian"
        initial={reduce ? false : { scale: 0.6, opacity: 0, y: 12, rotate: -8 }}
        animate={{ scale: 1, opacity: 1, y: 0, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 180, damping: 16 }}
      >
        <Defs id={id} />
        <path d={SHIELD} fill={`url(#${id}-fill)`} />
        <path d={SHINE} fill={`url(#${id}-shine)`} />
        <motion.path
          d={G} fill="none" stroke="#F5F3FF" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round"
          initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, delay: 0.35, ease }}
        />
        <path d={SHIELD} fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="1" />
        <motion.path
          d={WAVE} fill="none" stroke="#7CF2C8" strokeWidth="1.7" strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0, opacity: 0 }}
          animate={reduce ? { opacity: 0.75 } : loop ? { pathLength: [0, 1, 1], opacity: [0, 0.9, 0] } : { pathLength: 1, opacity: 0.75 }}
          transition={loop && !reduce ? { duration: 1.8, delay: 1.35, repeat: Infinity, repeatDelay: 0.4 } : { duration: 0.5, delay: 1.35 }}
        />
        <motion.circle
          cx="44.2" cy="20.2" r="3.1" fill="#7CF2C8"
          initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }}
          style={{ transformOrigin: '44.2px 20.2px' }}
          transition={{ type: 'spring', stiffness: 420, damping: 12, delay: 1.15 }}
        />
      </motion.svg>
    </div>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`font-display font-semibold tracking-tight ${className ?? ''}`}>
      Blue<span className="text-[var(--accent)]">Guardian</span>
    </span>
  );
}

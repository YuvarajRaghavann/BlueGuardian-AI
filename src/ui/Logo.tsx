import { motion, useReducedMotion } from 'framer-motion';
import logoUrl from '../assets/logo-mark.png';

/** BlueGuardian mark: the Bluetooth rune with a locked shield, on the blue app tile. */
export function LogoMark({ className }: { className?: string }) {
  return <img src={logoUrl} alt="" aria-hidden="true" draggable={false} className={`select-none object-contain ${className ?? ''}`} />;
}

/** Entrance animation: the tile springs in, glows, and the mark settles. */
export function AnimatedLogo({ size = 132, loop = true }: { size?: number; loop?: boolean }) {
  const reduce = useReducedMotion();
  const ease = [0.22, 1, 0.36, 1] as const;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <motion.div
        className="absolute inset-[-30%] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(10,110,245,0.5), rgba(10,110,245,0) 65%)' }}
        initial={reduce ? false : { opacity: 0, scale: 0.6 }}
        animate={reduce ? { opacity: 1 } : loop ? { opacity: [0.65, 1, 0.65], scale: [0.95, 1.05, 0.95] } : { opacity: 1, scale: 1 }}
        transition={loop && !reduce ? { duration: 3.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 1.2, ease }}
      />
      <motion.img
        src={logoUrl}
        alt="BlueGuardian"
        draggable={false}
        width={size}
        height={size}
        className="relative select-none drop-shadow-[0_18px_40px_rgba(0,80,230,0.45)]"
        initial={reduce ? false : { scale: 0.6, opacity: 0, y: 12, rotate: -8 }}
        animate={{ scale: 1, opacity: 1, y: 0, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 180, damping: 16 }}
      />
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

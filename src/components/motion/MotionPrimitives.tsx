import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

export const MOTION_EASING = [0.22, 1, 0.36, 1] as const;

export const MOTION_DURATION = {
  route: 0.28,
  staggerItem: 0.36,
  accentSweep: 0.62,
} as const;

export const MOTION_STAGGER = {
  delayChildren: 0.04,
  staggerChildren: 0.055,
} as const;

interface MotionChildrenProps {
  children: ReactNode;
  className?: string;
}

interface RouteTransitionProps extends MotionChildrenProps {
  routeKey: string;
}

interface StaggerGroupProps extends MotionChildrenProps {
  label: string;
  delayChildren?: number;
  staggerChildren?: number;
}

export function RouteTransition({
  routeKey,
  children,
  className,
}: RouteTransitionProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        initial={reduceMotion ? false : { opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={
          reduceMotion
            ? { opacity: 1 }
            : { opacity: 0, x: -8 }
        }
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: MOTION_DURATION.route, ease: MOTION_EASING }
        }
        className={`relative ${className ?? ''}`}
        style={{ transformOrigin: '50% 0%' }}
      >
        {!reduceMotion && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px overflow-hidden motion-reduce:hidden"
          >
            <motion.div
              className="h-full w-1/3 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent shadow-[0_0_12px_rgba(59,156,255,0.65)]"
              initial={{ x: '-100%', opacity: 0 }}
              animate={{ x: '300%', opacity: [0, 0.72, 0] }}
              transition={{
                duration: MOTION_DURATION.accentSweep,
                ease: MOTION_EASING,
                times: [0, 0.18, 1],
              }}
            />
          </div>
        )}
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export function StaggerGroup({
  children,
  className,
  label,
  delayChildren = MOTION_STAGGER.delayChildren,
  staggerChildren = MOTION_STAGGER.staggerChildren,
}: StaggerGroupProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      aria-label={label}
      className={className}
      initial={reduceMotion ? false : 'hidden'}
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            delayChildren: reduceMotion ? 0 : delayChildren,
            staggerChildren: reduceMotion ? 0 : staggerChildren,
          },
        },
      }}
    >
      {children}
    </motion.section>
  );
}

export function StaggerItem({ children, className }: MotionChildrenProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : 'hidden'}
      variants={{
        hidden: { opacity: 0, y: 14, scale: 0.985 },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: reduceMotion
            ? { duration: 0 }
            : { duration: MOTION_DURATION.staggerItem, ease: MOTION_EASING },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

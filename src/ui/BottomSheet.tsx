import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'framer-motion';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}

/** A sheet that slides up from the bottom; drag it down or tap outside to close. */
export function BottomSheet({ open, onClose, label, children }: BottomSheetProps) {
  const reduce = useReducedMotion();
  // Drag starts only from the handle, so the sheet's content can still scroll normally.
  const controls = useDragControls();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 bg-[#05080f]/70 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border border-[var(--border)] bg-[var(--bg-elevated)] pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_60px_rgba(0,0,0,0.45)] sm:rounded-[28px]"
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            drag={reduce ? false : 'y'}
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose(); }}
          >
            <div className="sticky top-0 z-10 flex touch-none justify-center bg-[var(--bg-elevated)] pb-2 pt-3" onPointerDown={(e) => controls.start(e)}>
              <span className="h-1.5 w-10 rounded-full bg-[var(--surface-hover)]" />
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

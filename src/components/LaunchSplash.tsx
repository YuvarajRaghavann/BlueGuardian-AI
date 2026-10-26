import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AnimatedLogo, Wordmark } from '../ui/Logo';
import { restoreAccount } from '../services/accountSession';

/**
 * Animated launch screen. Shows the logo while the saved sign-in is restored,
 * for at least 1.1 s and at most 3 s, then dissolves into the app.
 */
export function LaunchSplash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const started = Date.now();
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      const wait = Math.max(0, 1100 - (Date.now() - started));
      setTimeout(() => setVisible(false), wait);
    };
    void restoreAccount().finally(close);
    const cap = setTimeout(close, 3000);
    return () => clearTimeout(cap);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--bg)]"
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <AnimatedLogo size={112} loop={false} />
          <motion.div className="mt-6 text-[26px]" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.5 }}>
            <Wordmark />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

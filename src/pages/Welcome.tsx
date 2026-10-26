import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Bluetooth, Check, Eye, EyeOff, LoaderCircle, Lock, Mail, MapPin, Radar, ShieldAlert,
} from 'lucide-react';
import { AnimatedLogo } from '../ui/Logo';
import { pushBackHandler } from '../ui/backStack';
import { markOnboarded, signIn } from '../services/accountSession';
import { sendFirebasePasswordResetEmail } from '../services/firebaseAuth';
import { myDevices, myDevicesSupported } from '../services/myDevices';
import { cn } from '../utils/cn';

type Step = 0 | 1 | 2;
const EASE = [0.22, 1, 0.36, 1] as const;

/** Short, human error messages for the sign-in form. */
function friendly(err: unknown, fallback: string): string {
  const m = err instanceof Error ? err.message : '';
  if (/incorrect/i.test(m)) return 'Wrong email or password.';
  if (/already exists/i.test(m)) return 'That email already has an account. Sign in instead.';
  if (/at least 6/i.test(m)) return 'Use a password with at least 6 characters.';
  if (/valid email|Enter your email/i.test(m)) return 'Enter a valid email address.';
  if (/internet|network|reach/i.test(m)) return 'No internet connection. Try again when you are online.';
  if (/temporarily blocked/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  return m.replace(/\s*\(Firebase code[^)]*\)/, '') || fallback;
}

function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      <div className="aurora h-[60vmax] w-[60vmax] bg-[#6d5cf5]" style={{ left: '-25vmax', top: '-20vmax', animation: 'aurora-a 18s ease-in-out infinite' }} />
      <div className="aurora h-[50vmax] w-[50vmax] bg-[#2bb894]" style={{ right: '-25vmax', top: '25vh', opacity: 0.28, animation: 'aurora-b 22s ease-in-out infinite' }} />
      <div className="aurora h-[45vmax] w-[45vmax] bg-[#3b4bd8]" style={{ left: '10vw', bottom: '-28vmax', opacity: 0.4, animation: 'aurora-c 26s ease-in-out infinite' }} />
      <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgba(238,241,250,0.07) 1px, transparent 1px)', backgroundSize: '22px 22px', maskImage: 'radial-gradient(ellipse at 50% 30%, black, transparent 75%)' }} />
    </div>
  );
}

/** Logo with devices orbiting it — the app's idea in one picture. */
/** Hero scales with screen height so the main button stays visible on small phones. */
function heroSize(max: number): number {
  const h = typeof window === 'undefined' ? 800 : window.innerHeight;
  return Math.round(Math.min(max, Math.max(160, h * 0.28)));
}

function OrbitHero({ size: maxSize = 260 }: { size?: number }) {
  const size = heroSize(maxSize);
  const rings = [
    { r: 0.36, dur: 14, color: '#7CF2C8', start: 20 },
    { r: 0.44, dur: 22, color: '#8C7CFF', start: 200 },
    { r: 0.5, dur: 30, color: '#FFD27A', start: 120 },
  ];
  return (
    <div className="relative mx-auto grid place-items-center" style={{ width: size, height: size }}>
      {rings.map((ring, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border border-dashed border-[rgba(169,180,208,0.18)]"
          style={{ width: size * ring.r * 2, height: size * ring.r * 2 }}
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.25 + i * 0.12, ease: EASE }}
        >
          <div className="absolute inset-0" style={{ animation: `orbit-spin ${ring.dur}s linear infinite`, transform: `rotate(${ring.start}deg)` }}>
            <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: ring.color, boxShadow: `0 0 14px ${ring.color}` }} />
          </div>
        </motion.div>
      ))}
      <AnimatedLogo size={size * 0.42} />
    </div>
  );
}

function Stagger({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay, ease: EASE }}>
      {children}
    </motion.div>
  );
}

function PrimaryButton({ children, onClick, disabled, type = 'button', busy }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit'; busy?: boolean }) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      whileTap={{ scale: 0.97 }}
      className="btn-shine flex min-h-[58px] w-full items-center justify-center gap-2 rounded-[20px] bg-gradient-to-r from-[#9a8bff] via-[#7c6bff] to-[#5b5ef0] text-[16px] font-bold text-white shadow-[0_16px_40px_rgba(124,107,255,0.45)] disabled:opacity-60"
    >
      <AnimatePresence mode="wait" initial={false}>
        {busy ? (
          <motion.span key="busy" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <LoaderCircle className="h-5 w-5 animate-spin" />
          </motion.span>
        ) : (
          <motion.span key="label" className="flex items-center gap-2" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {children}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function Intro({ onNext, onSignIn }: { onNext: () => void; onSignIn: () => void }) {
  const features = [
    { icon: Radar, title: 'Live trust radar', sub: 'See every device around you and how far to trust it' },
    { icon: ShieldAlert, title: 'Real threat alerts', sub: 'Trackers following you, popup spam, look-alikes' },
    { icon: MapPin, title: 'Find lost earbuds', sub: 'Where they were last with you, shared in one tap' },
  ];
  const name = 'BlueGuardian';
  return (
    <div className="flex min-h-full flex-col">
      <div className="pt-4"><OrbitHero /></div>
      <div className="mt-2 text-center">
        <h1 className="font-display text-[38px] font-bold leading-none" aria-label={name}>
          {name.split('').map((ch, i) => (
            <motion.span key={i} className={i >= 4 ? 'text-[var(--accent)]' : undefined} style={{ display: 'inline-block' }}
              initial={{ opacity: 0, y: 22, rotateX: 70 }} animate={{ opacity: 1, y: 0, rotateX: 0 }}
              transition={{ duration: 0.55, delay: 0.9 + i * 0.035, ease: EASE }}>{ch}</motion.span>
          ))}
        </h1>
        <Stagger delay={1.35}><p className="mx-auto mt-3 max-w-xs text-[15px] leading-6 text-[var(--text-secondary)]">Know every Bluetooth device around you, and which ones to trust.</p></Stagger>
      </div>
      <div className="mt-6 space-y-2">
        {features.map((f, i) => (
          <Stagger key={f.title} delay={1.55 + i * 0.12}>
            <div className="flex items-center gap-3.5 rounded-[20px] border border-[var(--border)] bg-[rgba(22,31,54,0.6)] px-3.5 py-3 backdrop-blur-md">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><f.icon className="h-5 w-5" /></span>
              <span>
                <span className="block text-[15px] font-semibold">{f.title}</span>
                <span className="block text-[13px] text-[var(--text-muted)]">{f.sub}</span>
              </span>
            </div>
          </Stagger>
        ))}
      </div>
      <div className="mt-auto pt-7">
        <Stagger delay={2}>
          <PrimaryButton onClick={onNext}>Get started <ArrowRight className="h-5 w-5" /></PrimaryButton>
          <button type="button" onClick={onSignIn} className="mt-3 w-full py-2 text-sm text-[var(--text-secondary)]">
            Already have an account? <span className="font-semibold text-[var(--accent)]">Sign in</span>
          </button>
        </Stagger>
      </div>
    </div>
  );
}

function PermissionCard({ icon: Icon, title, sub, granted, onAllow, busy, delay }: {
  icon: typeof Bluetooth; title: string; sub: string; granted: boolean; onAllow: () => void; busy: boolean; delay: number;
}) {
  return (
    <Stagger delay={delay}>
      <div className={cn('flex items-center gap-3.5 rounded-[22px] border p-4 transition-colors',
        granted ? 'border-[var(--success)]/40 bg-[var(--success)]/10' : 'border-[var(--border)] bg-[rgba(22,31,54,0.65)]')}>
        <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', granted ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--accent-soft)] text-[var(--accent)]')}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{title}</span>
          <span className="block text-[13px] leading-5 text-[var(--text-muted)]">{sub}</span>
        </span>
        <AnimatePresence mode="wait" initial={false}>
          {granted ? (
            <motion.span key="ok" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}
              className="grid h-9 w-9 place-items-center rounded-full bg-[var(--success)] text-[#06231a]"><Check className="h-5 w-5" /></motion.span>
          ) : (
            <motion.button key="allow" type="button" onClick={onAllow} disabled={busy} whileTap={{ scale: 0.94 }}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'Allow'}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </Stagger>
  );
}

function Permissions({ onNext }: { onNext: () => void }) {
  const native = myDevicesSupported();
  const [bt, setBt] = useState(false);
  const [loc, setLoc] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    void myDevices.bluetoothStatus().then((r) => setBt(r.granted)).catch(() => undefined);
    void myDevices.locationStatus().then((r) => setLoc(r.location)).catch(() => undefined);
  }, [native]);

  const ask = async (which: 'bt' | 'loc') => {
    setBusy(which);
    try {
      if (which === 'bt') setBt((await myDevices.requestBluetooth()).granted);
      else setLoc((await myDevices.requestLocation()).location);
    } catch {
      // denied: the card stays on "Allow"
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="pt-6"><OrbitHero size={200} /></div>
      <Stagger delay={0.1}>
        <h2 className="mt-4 text-center text-[28px] font-bold leading-tight">Let BlueGuardian look around</h2>
        <p className="mx-auto mt-2 max-w-xs text-center text-[15px] leading-6 text-[var(--text-secondary)]">Everything stays on this phone unless you choose to share it.</p>
      </Stagger>
      <div className="mt-6 space-y-3">
        <PermissionCard icon={Bluetooth} title="Nearby devices" sub="To scan, check and connect Bluetooth devices" granted={bt || !native} busy={busy === 'bt'} onAllow={() => void ask('bt')} delay={0.25} />
        <PermissionCard icon={MapPin} title="Location" sub="To remember where you last had each device" granted={loc || !native} busy={busy === 'loc'} onAllow={() => void ask('loc')} delay={0.35} />
      </div>
      <div className="mt-auto pt-8">
        <PrimaryButton onClick={onNext}>Continue <ArrowRight className="h-5 w-5" /></PrimaryButton>
        {!(bt && loc) && native && <p className="mt-3 text-center text-xs text-[var(--text-muted)]">You can allow these later from Settings.</p>}
      </div>
    </div>
  );
}

function Account({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [success, setSuccess] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signIn(mode, email, password);
      setSuccess(true);
      setTimeout(onDone, 1100);
    } catch (err) {
      setError(friendly(err, 'Sign-in failed.'));
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) { setError('Enter your email first.'); setShake((n) => n + 1); return; }
    setBusy(true);
    setError(null);
    try {
      await sendFirebasePasswordResetEmail(email);
      setNotice('If that email has an account, a reset link is on its way.');
    } catch (err) {
      setError(friendly(err, 'Could not send the email.'));
    } finally {
      setBusy(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}
          className="grid h-24 w-24 place-items-center rounded-full bg-[var(--success)] text-[#06231a] shadow-[0_0_60px_rgba(124,242,200,0.5)]">
          <motion.svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.25 }} />
          </motion.svg>
        </motion.div>
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="mt-6 text-2xl font-bold">You're in</motion.p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="pt-8"><Stagger><div className="flex justify-center"><AnimatedLogo size={84} /></div></Stagger></div>
      <Stagger delay={0.1}>
        <h2 className="mt-6 text-center text-[28px] font-bold leading-tight">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h2>
        <p className="mx-auto mt-2 max-w-xs text-center text-[14px] leading-6 text-[var(--text-secondary)]">
          Optional. Lets other BlueGuardian users help find your lost devices. Your sign-in stays locked in this phone's Keystore.
        </p>
      </Stagger>

      <Stagger delay={0.2}>
        <div className="relative mx-auto mt-6 flex w-full max-w-xs rounded-full border border-[var(--border)] bg-[rgba(22,31,54,0.7)] p-1">
          {(['sign-in', 'sign-up'] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setError(null); setNotice(null); }}
              className={cn('relative flex-1 rounded-full py-2.5 text-sm font-semibold transition-colors', mode === m ? 'text-white' : 'text-[var(--text-muted)]')}>
              {mode === m && <motion.span layoutId="auth-mode" className="absolute inset-0 rounded-full bg-[var(--accent)]" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
              <span className="relative">{m === 'sign-in' ? 'Sign in' : 'Create account'}</span>
            </button>
          ))}
        </div>
      </Stagger>

      <motion.form onSubmit={(e) => void submit(e)} className="mt-6 space-y-3"
        key={shake} animate={shake && !reduce ? { x: [0, -10, 10, -7, 7, -3, 0] } : undefined} transition={{ duration: 0.45 }}>
        <Stagger delay={0.28}>
          <div className="field">
            <Mail className="field-icon" />
            <input id="auth-email" type="email" autoComplete="email" placeholder=" " value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
            <label htmlFor="auth-email">Email</label>
          </div>
        </Stagger>
        <Stagger delay={0.34}>
          <div className="field">
            <Lock className="field-icon" />
            <input id="auth-password" type={show ? 'text' : 'password'} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} placeholder=" "
              value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
            <label htmlFor="auth-password">Password{mode === 'sign-up' ? ' (6+ characters)' : ''}</label>
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-[var(--text-muted)]">
              {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
            </button>
          </div>
        </Stagger>
        <AnimatePresence>
          {error && (
            <motion.p key="err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              role="alert" className="overflow-hidden rounded-2xl bg-[var(--danger)]/12 px-4 py-3 text-sm text-[var(--danger)]">{error}</motion.p>
          )}
          {notice && (
            <motion.p key="note" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              role="status" className="overflow-hidden rounded-2xl bg-[var(--success)]/12 px-4 py-3 text-sm text-[var(--success)]">{notice}</motion.p>
          )}
        </AnimatePresence>
        {mode === 'sign-in' && (
          <div className="flex justify-end">
            <button type="button" onClick={() => void reset()} className="text-sm font-semibold text-[var(--accent)]">Forgot password?</button>
          </div>
        )}
        <Stagger delay={0.4}>
          <div className="pt-2"><PrimaryButton type="submit" busy={busy}>{mode === 'sign-in' ? 'Sign in' : 'Create account'}</PrimaryButton></div>
        </Stagger>
      </motion.form>

      <div className="mt-auto pt-6">
        <button type="button" onClick={onDone} className="w-full rounded-[20px] py-3.5 text-[15px] font-semibold text-[var(--text-secondary)] hover:bg-[rgba(22,31,54,0.6)]">
          Continue without an account
        </button>
      </div>
    </div>
  );
}

export function Welcome() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const accountOnly = params.get('step') === 'account';
  const reduce = useReducedMotion();
  const [step, setStep] = useState<Step>(accountOnly ? 2 : 0);
  const [dir, setDir] = useState(1);

  const go = (next: Step) => { setDir(next > step ? 1 : -1); setStep(next); };
  const finish = () => {
    markOnboarded();
    navigate('/dashboard', { replace: true });
  };

  useEffect(() => pushBackHandler(() => {
    if (step > 0 && !accountOnly) { go((step - 1) as Step); return true; }
    if (accountOnly) { navigate('/dashboard', { replace: true }); return true; }
    return false;
  }), [step, accountOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <Backdrop />
      <div className="relative mx-auto flex min-h-[100dvh] max-w-md flex-col px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]">
        <div className="flex h-11 items-center gap-3">
          <AnimatePresence initial={false}>
            {step > 0 && (
              <motion.button key="back" type="button" aria-label="Back" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                onClick={() => (accountOnly ? navigate('/dashboard', { replace: true }) : go((step - 1) as Step))}
                className="grid h-10 w-10 place-items-center rounded-full bg-[rgba(22,31,54,0.7)] text-[var(--text-secondary)]">
                <ArrowLeft className="h-5 w-5" />
              </motion.button>
            )}
          </AnimatePresence>
          {!accountOnly && (
            <div className="ml-auto flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1.5 overflow-hidden rounded-full bg-[rgba(169,180,208,0.18)]" style={{ width: i === step ? 28 : 10, transition: 'width 300ms var(--ease-out)' }}>
                  <motion.span className="block h-full rounded-full bg-[var(--accent)]" initial={false} animate={{ width: i <= step ? '100%' : '0%' }} transition={{ duration: 0.4 }} />
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="relative flex flex-1 flex-col">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              custom={dir}
              className="flex flex-1 flex-col"
              initial={reduce ? false : { opacity: 0, x: 40 * dir }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: -40 * dir }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              {step === 0 && <Intro onNext={() => go(1)} onSignIn={() => go(2)} />}
              {step === 1 && <Permissions onNext={() => go(2)} />}
              {step === 2 && <Account onDone={accountOnly ? () => navigate('/dashboard', { replace: true }) : finish} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

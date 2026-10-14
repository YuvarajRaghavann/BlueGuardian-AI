import { cn } from '../utils/cn';

interface TrustScoreProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function TrustScore({
  score,
  size = 'md',
  className,
}: TrustScoreProps) {
  const sizes = {
    sm: {
      wrapper: 'h-11 w-11',
      radius: 17,
      stroke: 3,
      text: 'text-[11px]',
    },
    md: {
      wrapper: 'h-16 w-16',
      radius: 26,
      stroke: 4,
      text: 'text-sm',
    },
    lg: {
      wrapper: 'h-24 w-24',
      radius: 38,
      stroke: 5,
      text: 'text-lg',
    },
  };

  const config = sizes[size];
  const normalized = Math.max(0, Math.min(100, score));
  const circumference = 2 * Math.PI * config.radius;
  const offset =
    circumference - (normalized / 100) * circumference;

  const tone =
    normalized >= 80
      ? {
          text: 'text-[var(--success)]',
          stroke: 'var(--success)',
        }
      : normalized >= 50
        ? {
            text: 'text-[var(--warning)]',
            stroke: 'var(--warning)',
          }
        : {
            text: 'text-[var(--danger)]',
            stroke: 'var(--danger)',
          };

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        config.wrapper,
        className,
      )}
      aria-label={`Trust score ${normalized} out of 100`}
    >
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full -rotate-90"
      >
        <circle
          cx="50"
          cy="50"
          r={config.radius}
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth={config.stroke}
        />

        <circle
          cx="50"
          cy="50"
          r={config.radius}
          fill="none"
          stroke={tone.stroke}
          strokeWidth={config.stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>

      <span
        className={cn(
          'absolute font-semibold tracking-tight',
          config.text,
          tone.text,
        )}
      >
        {normalized}
      </span>
    </div>
  );
}

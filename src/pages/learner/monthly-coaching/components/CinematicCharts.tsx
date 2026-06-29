import { useRef, useEffect, useState } from 'react';

/* ── Donut / Ring Chart ── */
export function DonutRing({
  value,
  max = 100,
  size = 160,
  strokeWidth = 12,
  color = 'var(--ring-color, var(--primary-500))',
  trackColor = 'var(--ring-track, var(--foreground-200))',
  label,
  sublabel,
  animate = true,
}: {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  sublabel?: string;
  animate?: boolean;
}) {
  const [animatedValue, setAnimatedValue] = useState(animate ? 0 : value);
  const pct = Math.min(100, Math.round((animatedValue / max) * 100));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  useEffect(() => {
    if (!animate) return;
    const timer = setTimeout(() => setAnimatedValue(value), 120);
    return () => clearTimeout(timer);
  }, [value, animate]);

  return (
    <div className="flex flex-col items-center gap-3" style={{ width: size }}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`oklch(${trackColor})`}
            strokeWidth={strokeWidth}
            opacity={0.35}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`oklch(${color})`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-foreground-900">{pct}%</span>
          {label && <span className="text-xs text-foreground-500 mt-0.5">{label}</span>}
        </div>
      </div>
      {sublabel && <span className="text-xs text-foreground-400">{sublabel}</span>}
    </div>
  );
}

/* ── Horizontal Bar Chart ── */
export function HBar({
  label,
  value,
  max,
  color = 'primary',
  suffix = '',
  detail,
  showPct = true,
  animate = true,
}: {
  label: string;
  value: number;
  max: number;
  color?: 'primary' | 'accent' | 'green' | 'amber' | 'red' | 'secondary';
  suffix?: string;
  detail?: string;
  showPct?: boolean;
  animate?: boolean;
}) {
  const [animatedValue, setAnimatedValue] = useState(animate ? 0 : value);
  const pct = Math.min(100, Math.round((value / max) * 100));

  useEffect(() => {
    if (!animate) return;
    const timer = setTimeout(() => setAnimatedValue(value), 200);
    return () => clearTimeout(timer);
  }, [value, animate]);

  const colorMap: Record<string, string> = {
    primary: 'bg-primary-500',
    accent: 'bg-accent-500',
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    secondary: 'bg-secondary-500',
  };

  const glowMap: Record<string, string> = {
    primary: 'shadow-[0_0_12px_-3px_var(--glow-purple)]',
    accent: 'shadow-[0_0_12px_-3px_var(--glow-gold)]',
    green: 'shadow-[0_0_10px_-3px_rgba(16,185,129,0.5)]',
    amber: 'shadow-[0_0_10px_-3px_rgba(245,158,11,0.5)]',
    red: 'shadow-[0_0_10px_-3px_rgba(239,68,68,0.5)]',
    secondary: 'shadow-[0_0_10px_-3px_rgba(139,92,246,0.4)]',
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground-700">{label}</span>
        <div className="flex items-center gap-1.5">
          {detail && <span className="text-xs text-foreground-400">{detail}</span>}
          {showPct && <span className="text-xs font-semibold text-foreground-900">{pct}%{suffix}</span>}
        </div>
      </div>
      <div className="h-2 rounded-full bg-foreground-100/80 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-out ${colorMap[color]} ${glowMap[color]}`}
          style={{ width: `${Math.min(100, (animatedValue / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/* ── Vertical Metric Pill ── */
export function MetricPill({
  value,
  label,
  target,
  status,
  color = 'primary',
}: {
  value: string;
  label: string;
  target?: string;
  status?: 'green' | 'amber' | 'red' | 'neutral';
  color?: 'primary' | 'accent';
}) {
  const statusDot: Record<string, string> = {
    green: 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]',
    amber: 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]',
    red: 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]',
    neutral: 'bg-foreground-300',
  };

  const bgMap: Record<string, string> = {
    primary: 'bg-background-50 border-foreground-200/60 hover:bg-background-100',
    accent: 'bg-background-50 border-foreground-200/60 hover:bg-background-100',
  };

  return (
    <div className={`rounded-xl border p-4 transition-all duration-300 ${bgMap[color]} backdrop-blur-sm group`}>
      <div className="flex items-center gap-2 mb-2">
        {status && <div className={`w-2 h-2 rounded-full ${statusDot[status]}`} />}
        <span className="text-xs font-medium text-foreground-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-foreground-950">{value}</span>
        {target && <span className="text-sm text-foreground-400">/ {target}</span>}
      </div>
    </div>
  );
}

/* ── Donut Multi (split ring) ── */
export function DonutSplit({
  segments,
  size = 140,
  strokeWidth = 14,
  centerLabel,
  centerValue,
}: {
  segments: { value: number; color: string; label: string }[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const colorLookup: Record<string, string> = {
    green: 'oklch(0.62 0.18 160)',
    amber: 'oklch(0.68 0.15 85)',
    red: 'oklch(0.55 0.22 25)',
    purple: 'oklch(var(--primary-500))',
    gold: 'oklch(var(--accent-500))',
    slate: 'oklch(0.45 0.01 260)',
  };

  let cumulativeOffset = 0;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {segments.map((seg, i) => {
            const segPct = seg.value / total;
            const dashLength = segPct * circumference;
            const dashOffset = -cumulativeOffset;
            cumulativeOffset += dashLength;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={colorLookup[seg.color] || colorLookup.slate}
                strokeWidth={strokeWidth}
                strokeLinecap="butt"
                strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                strokeDashoffset={dashOffset}
                opacity={0.9}
                style={{ transition: 'stroke-dasharray 1s cubic-bezier(0.22, 1, 0.36, 1), stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)' }}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {centerValue && <span className="text-xl font-bold text-foreground-900">{centerValue}</span>}
          {centerLabel && <span className="text-xs text-foreground-500 mt-0.5">{centerLabel}</span>}
        </div>
      </div>
      <div className="flex items-center gap-4">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: colorLookup[seg.color] || colorLookup.slate }}
            />
            <span className="text-xs text-foreground-500">{seg.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Bar Group (multiple bars side by side) ── */
export function BarGroup({
  items,
  maxValue,
}: {
  items: { label: string; value: number; target: number; color?: 'primary' | 'accent' | 'green' | 'amber' | 'red' }[];
  maxValue: number;
}) {
  const colorMap: Record<string, { bg: string; glow: string }> = {
    primary: { bg: 'bg-primary-500', glow: 'shadow-[0_0_8px_-2px_var(--glow-purple)]' },
    accent: { bg: 'bg-accent-500', glow: 'shadow-[0_0_8px_-2px_var(--glow-gold)]' },
    green: { bg: 'bg-emerald-500', glow: 'shadow-[0_0_6px_-2px_rgba(16,185,129,0.5)]' },
    amber: { bg: 'bg-amber-500', glow: 'shadow-[0_0_6px_-2px_rgba(245,158,11,0.5)]' },
    red: { bg: 'bg-red-500', glow: 'shadow-[0_0_6px_-2px_rgba(239,68,68,0.5)]' },
  };
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <div className="flex items-end gap-4 h-28 py-2">
      {items.map((item, i) => {
        const h = mounted ? Math.max(4, (item.value / maxValue) * 100) : 0;
        const targetH = Math.max(4, (item.target / maxValue) * 100);
        const c = colorMap[item.color || 'primary'];
        return (
          <div key={i} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
            <span className="text-xs font-semibold text-foreground-900">{item.value}</span>
            <div className="relative w-full max-w-[40px] flex items-end justify-center" style={{ height: '80px' }}>
              {/* Target line */}
              <div
                className="absolute left-0 right-0 border-t border-dashed border-foreground-300/40 transition-all duration-1000"
                style={{ bottom: `${targetH}%` }}
              />
              {/* Actual bar */}
              <div
                className={`w-full rounded-t-lg transition-all duration-1000 ease-out ${c.bg} ${c.glow}`}
                style={{ height: `${h}%` }}
              />
            </div>
            <span className="text-xs text-foreground-500 text-center leading-tight max-w-[50px] truncate">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Progress Grid (metric card grid) ── */
export function ProgressGrid({
  items,
}: {
  items: { label: string; value: string; target: string; status: 'green' | 'amber' | 'red'; detail: string }[];
}) {
  const statusStyles: Record<string, { dot: string; border: string }> = {
    green: { dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]', border: 'border-emerald-500/25' },
    amber: { dot: 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]', border: 'border-amber-500/25' },
    red: { dot: 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]', border: 'border-red-500/25' },
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {items.map((item, i) => {
        const s = statusStyles[item.status];
        return (
          <div
            key={i}
            className={`rounded-xl border ${s.border} bg-background-50 p-4 backdrop-blur-sm transition-all duration-300 hover:bg-background-100`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-2 h-2 rounded-full ${s.dot}`} />
              <span className="text-xs font-medium text-foreground-500 uppercase tracking-wider">{item.label}</span>
            </div>
            <div className="flex items-baseline gap-1.5 mb-1">
              <span className="text-xl font-bold text-foreground-950">{item.value}</span>
              <span className="text-xs text-foreground-400">/ {item.target}</span>
            </div>
            <p className="text-xs text-foreground-500 leading-relaxed">{item.detail}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ── Pulse Dot (animated indicator) ── */
export function PulseDot({ status }: { status: 'green' | 'amber' | 'red' | 'neutral' }) {
  const colors: Record<string, string> = {
    green: 'bg-emerald-400',
    amber: 'bg-amber-400',
    red: 'bg-red-400',
    neutral: 'bg-foreground-300',
  };
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${colors[status]} animate-ping`} />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${colors[status]}`} />
    </span>
  );
}
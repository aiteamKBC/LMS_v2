// ============================================================================
// Catch-up queue charts.
//
// Hand-rolled SVG, same as Attendance's TrendChart / RiskPieChart /
// SparklineChart — a workspace-wide, deliberate choice (see those files).
// What changed here is only how the draw-in animation is produced: the
// pre-refactor version injected a raw <style> tag defining seven @keyframes
// and read them back through CSS custom properties. None of that is genuinely
// custom — every one of those effects (a line drawing in, a bar growing from
// its baseline, a slice fading up) is exactly what a CSS `transition` on the
// real SVG attribute already does, which is the same technique Attendance's
// sibling charts use (toggle a boolean, let the browser interpolate). So the
// style tag is gone; each chart now flips its `animate` prop straight into a
// transitioned style value.
// ============================================================================
import type { CSSProperties } from 'react';

/* ═══════ Donut Chart ═══════ */
export function DonutChart({
  percentage,
  size = 72,
  strokeWidth = 6,
  color = 'primary',
  animate = true,
}: {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  animate?: boolean;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference - (percentage / 100) * circumference;
  const colorMap: Record<string, { stroke: string; text: string }> = {
    primary: { stroke: 'stroke-primary-500', text: 'text-primary-700' },
    accent: { stroke: 'stroke-accent-500', text: 'text-accent-700' },
    emerald: { stroke: 'stroke-emerald-500', text: 'text-emerald-700' },
    amber: { stroke: 'stroke-amber-500', text: 'text-amber-700' },
    red: { stroke: 'stroke-red-500', text: 'text-red-700' },
    secondary: { stroke: 'stroke-secondary-500', text: 'text-secondary-700' },
  };
  const c = colorMap[color] || colorMap.primary;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="-rotate-90 transform" width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-background-200" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={c.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={animate ? targetOffset : circumference}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center transition-opacity duration-500"
        style={{ opacity: animate ? 1 : 0, transitionDelay: '0.3s' }}
      >
        <span className={`text-sm font-bold ${c.text}`}>{percentage}%</span>
      </div>
    </div>
  );
}

/* ═══════ Sparkline ═══════ */
export function Sparkline({
  data,
  color,
  width = 80,
  height = 32,
  animate = true,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
  animate?: boolean;
}) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - 4) + 2;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return `${x},${y}`;
  });
  const d = points.map((p, i) => (i === 0 ? `M${p}` : `L${p}`)).join(' ');
  const strokeColors: Record<string, string> = {
    emerald: '#10b981',
    amber: '#f59e0b',
    red: '#ef4444',
    primary: 'oklch(var(--primary-500))',
    accent: 'oklch(var(--accent-500))',
    secondary: 'oklch(var(--secondary-500))',
  };
  const pathLength = points.length * 40;

  return (
    <svg width={width} height={height}>
      <path
        d={d}
        fill="none"
        stroke={strokeColors[color] || strokeColors.primary}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: pathLength,
          strokeDashoffset: animate ? 0 : pathLength,
          transition: 'stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
    </svg>
  );
}

/* ═══════ Stacked Bar Chart for Catch-up Trend ═══════ */
export function StackedBarChart({
  data,
  height = 260,
  animate = true,
}: {
  data: Array<{ label: string; scheduled: number; overdue: number; completed: number }>;
  height?: number;
  animate?: boolean;
}) {
  const margin = { top: 12, right: 12, bottom: 36, left: 32 };
  const w = 900;
  const h = height;
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;
  const maxVal = Math.max(...data.map((d) => d.scheduled + d.overdue + d.completed)) || 1;
  const barW = (innerW / data.length) * 0.55;
  const y = (v: number) => margin.top + innerH - (v / maxVal) * innerH;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[500px]" style={{ overflow: 'visible' }}>
      {/* grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const yPos = margin.top + innerH * (1 - pct);
        return (
          <g key={pct}>
            <line x1={margin.left} y1={yPos} x2={w - margin.right} y2={yPos} stroke="oklch(var(--background-300))" strokeWidth={0.5} strokeDasharray="4 4" />
            <text x={margin.left - 6} y={yPos + 3} textAnchor="end" className="text-[12px] fill-foreground-400">{Math.round(maxVal * pct)}</text>
          </g>
        );
      })}
      {/* bars */}
      {data.map((d, i) => {
        const x = margin.left + (i / data.length) * innerW + (innerW / data.length - barW) / 2;
        const sH = (d.scheduled / maxVal) * innerH;
        const oH = (d.overdue / maxVal) * innerH;
        const cH = (d.completed / maxVal) * innerH;
        const baseDelay = i * 0.06;
        const barStyle = (extraDelay: number): CSSProperties => ({
          transformOrigin: `${x + barW / 2}px ${margin.top + innerH}px`,
          transform: animate ? 'scaleY(1)' : 'scaleY(0)',
          transition: 'transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)',
          transitionDelay: `${baseDelay + extraDelay}s`,
        });
        return (
          <g key={i}>
            <rect x={x} y={y(d.completed)} width={barW} height={cH} fill="oklch(var(--emerald-500))" rx={2} opacity={0.9} style={barStyle(0)} />
            <rect x={x} y={y(d.completed + d.scheduled)} width={barW} height={sH} fill="oklch(var(--primary-500))" rx={2} opacity={0.9} style={barStyle(0.04)} />
            <rect x={x} y={y(d.completed + d.scheduled + d.overdue)} width={barW} height={oH} fill="#ef4444" rx={2} opacity={0.9} style={barStyle(0.08)} />
            <text
              x={x + barW / 2}
              y={h - 8}
              textAnchor="middle"
              className="text-[12px] fill-foreground-400 transition-opacity duration-500"
              style={{ opacity: animate ? 1 : 0, transitionDelay: `${baseDelay + 0.2}s` }}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ═══════ Status Distribution Donut ═══════ */
export function StatusDistribution({
  scheduled,
  overdue,
  completed,
  size = 180,
  animate = true,
}: {
  scheduled: number;
  overdue: number;
  completed: number;
  size?: number;
  animate?: boolean;
}) {
  const total = scheduled + overdue + completed;
  const chartTotal = total || 1;
  const slices = [
    { label: 'Completed', value: completed, color: '#10b981' },
    { label: 'Scheduled', value: scheduled, color: 'oklch(var(--primary-500))' },
    { label: 'Overdue', value: overdue, color: '#ef4444' },
  ];
  const center = size / 2;
  const outerRadius = center - 4;
  const innerRadius = 48;
  let cumulativeAngle = -90;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {slices.map((slice, i) => {
            const angle = (slice.value / chartTotal) * 360;
            const start = cumulativeAngle;
            const end = cumulativeAngle + angle;
            cumulativeAngle = end;
            const sr = (start * Math.PI) / 180;
            const er = (end * Math.PI) / 180;
            const large = angle > 180 ? 1 : 0;
            const d = [
              `M ${center + outerRadius * Math.cos(sr)} ${center + outerRadius * Math.sin(sr)}`,
              `A ${outerRadius} ${outerRadius} 0 ${large} 1 ${center + outerRadius * Math.cos(er)} ${center + outerRadius * Math.sin(er)}`,
              `L ${center + innerRadius * Math.cos(er)} ${center + innerRadius * Math.sin(er)}`,
              `A ${innerRadius} ${innerRadius} 0 ${large} 0 ${center + innerRadius * Math.cos(sr)} ${center + innerRadius * Math.sin(sr)}`,
              'Z',
            ].join(' ');
            return (
              <path
                key={i}
                d={d}
                fill={slice.color}
                stroke="white"
                strokeWidth={2}
                style={{
                  transformOrigin: `${center}px ${center}px`,
                  opacity: animate ? 1 : 0,
                  transform: animate ? 'scale(1)' : 'scale(0.85)',
                  transition: 'opacity 0.6s ease-out, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
                  transitionDelay: `${i * 0.12 + 0.1}s`,
                }}
              />
            );
          })}
          <text
            x={center}
            y={center - 6}
            textAnchor="middle"
            className="fill-foreground-900 transition-opacity duration-500"
            style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-heading)', opacity: animate ? 1 : 0, transitionDelay: '0.4s' }}
          >
            {total}
          </text>
          <text
            x={center}
            y={center + 12}
            textAnchor="middle"
            className="fill-foreground-400 transition-opacity duration-500"
            style={{ fontSize: '12px', opacity: animate ? 1 : 0, transitionDelay: '0.5s' }}
          >
            Catch-ups
          </text>
        </svg>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 transition-opacity duration-500" style={{ opacity: animate ? 1 : 0, transitionDelay: '0.6s' }}>
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="whitespace-nowrap text-[12px] font-medium text-foreground-600">{s.label}</span>
            <span className="text-[12px] font-semibold text-foreground-900">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

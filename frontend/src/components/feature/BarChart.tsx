import { useRef, useEffect, useState } from 'react';

interface BarItem {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarItem[];
  maxValue?: number;
  height?: number;
  barWidth?: number;
  gap?: number;
  showLabels?: boolean;
  showValues?: boolean;
  className?: string;
}

export default function BarChart({
  data,
  maxValue = 100,
  height = 120,
  barWidth = 28,
  gap = 8,
  showLabels = true,
  showValues = true,
  className = '',
}: BarChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const totalWidth = data.length * (barWidth + gap) - gap;
  const chartHeight = showLabels ? height - 24 : height;
  const barArea = chartHeight - (showValues ? 18 : 4);

  const colorMap: Record<string, string> = {
    primary: 'oklch(var(--primary-500))',
    accent: 'oklch(var(--accent-500))',
    secondary: 'oklch(var(--secondary-500))',
    emerald: '#10b981',
    amber: '#f59e0b',
    red: '#ef4444',
  };

  return (
    <div ref={ref} className={`shrink-0 ${className}`}>
      <svg width={totalWidth} height={height} viewBox={`0 0 ${totalWidth} ${height}`}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = 4 + barArea * (1 - fraction);
          return (
            <g key={fraction}>
              <line
                x1={0} y1={y} x2={totalWidth} y2={y}
                stroke="oklch(var(--foreground-200) / 0.3)"
                strokeWidth={0.5}
                strokeDasharray="3 2"
              />
              {fraction > 0 && fraction < 1 && (
                <text x={-2} y={y + 3} textAnchor="end" className="text-[8px] fill-foreground-400">
                  {Math.round(maxValue * fraction)}
                </text>
              )}
            </g>
          );
        })}

        {/* Bars */}
        {data.map((item, i) => {
          const x = i * (barWidth + gap);
          const pct = Math.min(item.value / maxValue, 1);
          const barHeight = barArea * pct;
          const y = 4 + barArea - barHeight;
          const fillColor = colorMap[item.color || 'primary'] || colorMap.primary;
          const rx = 3;

          return (
            <g key={i} opacity={visible ? 1 : 0} style={{ transition: `opacity 600ms ease-out ${i * 80}ms` }}>
              <rect
                x={x}
                y={visible ? y : 4 + barArea}
                width={barWidth}
                height={visible ? barHeight : 0}
                rx={rx}
                fill={fillColor}
                style={{ transition: `all 700ms ease-out ${i * 100}ms` }}
              />
              {/* Glow top */}
              {visible && barHeight > 0 && (
                <rect
                  x={x + 2}
                  y={y}
                  width={barWidth - 4}
                  height={3}
                  rx={1.5}
                  fill={fillColor}
                  opacity={0.3}
                />
              )}
              {/* Value */}
              {showValues && visible && (
                <text
                  x={x + barWidth / 2}
                  y={y - 6}
                  textAnchor="middle"
                  className="text-[9px] font-semibold"
                  fill={fillColor}
                >
                  {item.value}{pct >= 0.95 ? '%' : '%'}
                </text>
              )}
              {/* Label */}
              {showLabels && (
                <text
                  x={x + barWidth / 2}
                  y={height - 4}
                  textAnchor="middle"
                  className="text-[9px] fill-foreground-400"
                >
                  {item.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
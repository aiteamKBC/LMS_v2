import { useRef, useEffect, useState, useMemo } from 'react';

interface SparklineChartProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  showDots?: boolean;
  showFill?: boolean;
  className?: string;
}

export default function SparklineChart({
  data,
  width = 200,
  height = 60,
  color = 'primary',
  strokeWidth = 2,
  showDots = true,
  showFill = true,
  className = '',
}: SparklineChartProps) {
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

  const pathData = useMemo(() => {
    if (data.length < 2) return { line: '', area: '' };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 4;

    const points = data.map((v, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - min) / range) * (height - padding * 2);
      return { x, y };
    });

    const line = points
      .map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`))
      .join(' ');

    const area =
      line +
      ` L${points[points.length - 1].x},${height - padding}` +
      ` L${points[0].x},${height - padding} Z`;

    return { line, area };
  }, [data, width, height]);

  const colorMap: Record<string, { stroke: string; fill: string; dot: string }> = {
    primary: {
      stroke: 'oklch(var(--primary-500))',
      fill: 'oklch(var(--primary-500) / 0.12)',
      dot: 'oklch(var(--primary-500))',
    },
    accent: {
      stroke: 'oklch(var(--accent-500))',
      fill: 'oklch(var(--accent-500) / 0.12)',
      dot: 'oklch(var(--accent-500))',
    },
    secondary: {
      stroke: 'oklch(var(--secondary-500))',
      fill: 'oklch(var(--secondary-500) / 0.12)',
      dot: 'oklch(var(--secondary-500))',
    },
    emerald: { stroke: '#10b981', fill: 'rgba(16,185,129,0.12)', dot: '#10b981' },
    amber: { stroke: '#f59e0b', fill: 'rgba(245,158,11,0.12)', dot: '#f59e0b' },
    red: { stroke: '#ef4444', fill: 'rgba(239,68,68,0.12)', dot: '#ef4444' },
  };
  const c = colorMap[color] || colorMap.primary;

  const strokeDash = visible ? pathData.line.length : 0;
  const strokeDashoffset = visible ? 0 : pathData.line.length;

  return (
    <div ref={ref} className={`shrink-0 ${className}`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        {showFill && (
          <path
            d={pathData.area}
            fill={c.fill}
            className="transition-all duration-1000 ease-out"
            style={{ opacity: visible ? 1 : 0 }}
          />
        )}
        <path
          d={pathData.line}
          fill="none"
          stroke={c.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-all duration-1000 ease-out"
          style={{
            strokeDasharray: strokeDash,
            strokeDashoffset: strokeDashoffset,
          }}
        />
        {showDots && visible && data.length > 1 && (() => {
          const min = Math.min(...data);
          const max = Math.max(...data);
          const range = max - min || 1;
          const padding = 4;
          return (
            <>
              {data.map((v, i) => {
                const x = padding + (i / (data.length - 1)) * (width - padding * 2);
                const y = height - padding - ((v - min) / range) * (height - padding * 2);
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={i === 0 || i === data.length - 1 ? 2.5 : 0}
                    fill={c.dot}
                    className="transition-all duration-300"
                  />
                );
              })}
            </>
          );
        })()}
      </svg>
    </div>
  );
}
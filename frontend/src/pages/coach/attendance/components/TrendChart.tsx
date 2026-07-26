import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

interface TrendPoint {
  label: string;
  value: number;
  week?: number;
  month?: string;
  sessionDate?: string;
  attended?: number;
  absent?: number;
  onBreak?: number;
}

interface TrendChartProps {
  data: TrendPoint[];
  height?: number;
  color?: string;
  showGrid?: boolean;
  yAxisMax?: number;
  yAxisMin?: number;
}

export default function TrendChart({
  data,
  height = 280,
  color = 'primary',
  showGrid = true,
  yAxisMax = 100,
  yAxisMin = 60,
}: TrendChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [tooltip, setTooltip] = useState<(TrendPoint & { x: number; y: number }) | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const colorMap: Record<string, { stroke: string; fill: string; dot: string; glow: string }> = {
    primary: {
      stroke: 'oklch(var(--primary-500))',
      fill: 'oklch(var(--primary-500) / 0.08)',
      dot: 'oklch(var(--primary-500))',
      glow: 'oklch(var(--primary-400) / 0.3)',
    },
    accent: {
      stroke: 'oklch(var(--accent-500))',
      fill: 'oklch(var(--accent-500) / 0.08)',
      dot: 'oklch(var(--accent-500))',
      glow: 'oklch(var(--accent-400) / 0.3)',
    },
    emerald: {
      stroke: '#10b981',
      fill: 'rgba(16,185,129,0.08)',
      dot: '#10b981',
      glow: 'rgba(16,185,129,0.3)',
    },
    amber: {
      stroke: '#f59e0b',
      fill: 'rgba(245,158,11,0.08)',
      dot: '#f59e0b',
      glow: 'rgba(245,158,11,0.3)',
    },
    red: {
      stroke: '#ef4444',
      fill: 'rgba(239,68,68,0.08)',
      dot: '#ef4444',
      glow: 'rgba(239,68,68,0.3)',
    },
  };
  const c = colorMap[color] || colorMap.primary;

  const chartWidth = 900;
  const chartHeight = height;
  const margin = { top: 20, right: 20, bottom: 50, left: 50 };
  const innerWidth = chartWidth - margin.left - margin.right;
  const innerHeight = chartHeight - margin.top - margin.bottom;
  const yRange = yAxisMax - yAxisMin;

  const getX = useCallback((index: number) => {
    if (data.length <= 1) return margin.left;
    return margin.left + (index / (data.length - 1)) * innerWidth;
  }, [data.length, innerWidth, margin.left]);

  const getY = useCallback((value: number) => {
    return margin.top + innerHeight - ((value - yAxisMin) / yRange) * innerHeight;
  }, [innerHeight, margin.top, yRange, yAxisMin]);

  // Dynamic Y ticks
  const yTicks = useMemo(() => {
    const count = 5;
    const step = Math.round((yAxisMax - yAxisMin) / count) || 1;
    const ticks: number[] = [];
    for (let i = 0; i <= count; i++) {
      const tick = yAxisMin + step * i;
      if (tick <= yAxisMax) ticks.push(tick);
    }
    if (ticks[ticks.length - 1] !== yAxisMax && yAxisMax <= ticks[ticks.length - 1] + step) {
      ticks.push(yAxisMax);
    }
    return ticks;
  }, [yAxisMin, yAxisMax]);

  const filteredYTicks = useMemo(() => yTicks.filter((t) => t >= yAxisMin && t <= yAxisMax), [yTicks, yAxisMin, yAxisMax]);

  // Smooth line using cubic bezier
  const buildPath = useCallback(() => {
    if (data.length < 2) return '';
    const points = data.map((d, i) => ({ x: getX(i), y: getY(d.value) }));
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cpx = (p0.x + p1.x) / 2;
      d += ` C${cpx},${p0.y} ${cpx},${p1.y} ${p1.x},${p1.y}`;
    }
    return d;
  }, [data, getX, getY]);

  // Area path
  const buildArea = useCallback(() => {
    const linePath = buildPath();
    if (!linePath) return '';
    const lastX = getX(data.length - 1);
    const firstX = getX(0);
    const bottomY = margin.top + innerHeight;
    return `${linePath} L${lastX},${bottomY} L${firstX},${bottomY} Z`;
  }, [buildPath, data.length, getX, innerHeight, margin.top]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (chartWidth / rect.width);
    let closestIndex = 0;
    let minDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const px = getX(i);
      const dist = Math.abs(mouseX - px);
      if (dist < minDist) {
        minDist = dist;
        closestIndex = i;
      }
    }
    if (minDist < innerWidth / data.length / 2 + 10) {
      setHoveredIndex(closestIndex);
      setTooltip({
        ...data[closestIndex],
        x: getX(closestIndex),
        y: getY(data[closestIndex].value),
      });
    } else {
      setHoveredIndex(null);
      setTooltip(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    setTooltip(null);
  };

  const getTooltipPeriodLabel = (point: TrendPoint) => {
    if (point.week) return `Week ${point.week}`;
    if (/^W\d+$/i.test(point.label)) return `Week ${point.label.slice(1)}`;
    if (/^\d{4}$/.test(point.label)) return `Year ${point.label}`;
    return point.label;
  };

  return (
    <div ref={containerRef} className="w-full">
      <div className="relative w-full overflow-x-auto overflow-y-visible">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full min-w-[500px]"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ overflow: 'visible' }}
        >
          {/* Grid lines */}
          {showGrid &&
            filteredYTicks.map((tick) => {
              const y = getY(tick);
              return (
                <g key={tick}>
                  <line
                    x1={margin.left}
                    y1={y}
                    x2={margin.left + innerWidth}
                    y2={y}
                    stroke="oklch(var(--background-300))"
                    strokeWidth={0.5}
                    strokeDasharray="4 4"
                  />
                  <text
                    x={margin.left - 10}
                    y={y + 3}
                    textAnchor="end"
                    className="text-[10px] fill-foreground-400"
                  >
                    {tick}%
                  </text>
                </g>
              );
            })}

          {/* X-axis labels */}
          {data.map((d, i) => {
            const x = getX(i);
            const showLabel = data.length <= 8 || i % Math.ceil(data.length / 8) === 0 || i === data.length - 1;
            return showLabel ? (
              <text
                key={i}
                x={x}
                y={margin.top + innerHeight + 20}
                textAnchor="middle"
                className="text-[10px] fill-foreground-400"
              >
                {d.label}
              </text>
            ) : null;
          })}

          {/* Area fill */}
          <path
            d={buildArea()}
            fill={c.fill}
            style={{
              opacity: visible ? 1 : 0,
              transition: 'opacity 1.2s ease-out',
            }}
          />

          {/* Line */}
          <path
            d={buildPath()}
            fill="none"
            stroke={c.stroke}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              opacity: visible ? 1 : 0,
              strokeDasharray: visible ? 2000 : 0,
              strokeDashoffset: visible ? 0 : 2000,
              transition: 'stroke-dashoffset 1.5s ease-out, opacity 0.5s ease-out',
            }}
          />

          {/* Dots */}
          {visible &&
            data.map((d, i) => {
              const x = getX(i);
              const y = getY(d.value);
              const isHovered = hoveredIndex === i;
              return (
                <g key={i}>
                  {/* Glow ring on hover */}
                  {isHovered && (
                    <circle
                      cx={x}
                      cy={y}
                      r={10}
                      fill={c.glow}
                      style={{ transition: 'all 0.2s ease' }}
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={isHovered ? 5 : 3.5}
                    fill={c.dot}
                    stroke="white"
                    strokeWidth={2}
                    style={{
                      transition: 'all 0.2s ease',
                      cursor: 'pointer',
                    }}
                  />
                </g>
              );
            })}

          {/* Crosshair: vertical line */}
          {hoveredIndex !== null && tooltip && (
            <g>
              <line
                x1={tooltip.x}
                y1={margin.top}
                x2={tooltip.x}
                y2={margin.top + innerHeight}
                stroke={c.stroke}
                strokeWidth={1}
                opacity={0.25}
              />
              {/* Crosshair: horizontal line */}
              <line
                x1={margin.left}
                y1={tooltip.y}
                x2={margin.left + innerWidth}
                y2={tooltip.y}
                stroke={c.stroke}
                strokeWidth={1}
                opacity={0.25}
              />
              {/* Crosshair intersection dot */}
              <circle
                cx={tooltip.x}
                cy={tooltip.y}
                r={3}
                fill={c.stroke}
                opacity={0.6}
              />
            </g>
          )}
        </svg>

        {/* Rich Tooltip — light background, clean layout, always visible */}
        {tooltip && (
          <div
            className="absolute pointer-events-none z-20 bg-background-50 border border-background-200 rounded-xl shadow-2xl text-[12px] font-medium w-[260px] max-w-[calc(100vw-32px)]"
            style={{
              left: `clamp(130px, ${((tooltip.x / chartWidth) * 100).toFixed(1)}%, calc(100% - 130px))`,
              top: `${((tooltip.y / chartHeight) * 100).toFixed(1)}%`,
              transform: tooltip.y < 100 ? 'translate(-50%, 14px)' : 'translate(-50%, -108%)',
            }}
          >
            <div className="px-3.5 py-3">
              {/* Header row */}
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-foreground-200">
                <span className="text-[10px] font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {getTooltipPeriodLabel(tooltip)}
                </span>
                <span className="text-[10px] text-foreground-500">
                  {tooltip.month || tooltip.label}
                  {tooltip.sessionDate ? ` · ${tooltip.sessionDate}` : ''}
                </span>
              </div>

              {/* Main stat: Absence % */}
              <div className="flex items-baseline gap-1.5 mb-2">
                <span className="text-[22px] font-bold text-red-600">
                  {tooltip.value}%
                </span>
                <span className="text-[11px] text-foreground-500 font-medium">
                  absence rate
                </span>
              </div>

              {/* Breakdown grid */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-background-200/50">
                <div className="text-center">
                  <p className="text-[10px] text-foreground-400 mb-0.5">Attended</p>
                  <p className="text-[13px] font-semibold text-emerald-600">
                    {tooltip.attended !== undefined ? tooltip.attended : '—'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-foreground-400 mb-0.5">Absent</p>
                  <p className="text-[13px] font-semibold text-red-600">
                    {tooltip.absent !== undefined ? tooltip.absent : '—'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-foreground-400 mb-0.5">On Break</p>
                  <p className="text-[13px] font-semibold text-amber-600">
                    {tooltip.onBreak !== undefined ? tooltip.onBreak : '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Arrow */}
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                top: tooltip.y < 100 ? '-6px' : 'auto',
                bottom: tooltip.y < 100 ? 'auto' : '-6px',
                width: 0,
                height: 0,
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                borderTop: tooltip.y < 100 ? '6px solid oklch(var(--background-200))' : 'none',
                borderBottom: tooltip.y < 100 ? 'none' : '6px solid oklch(var(--background-200))',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

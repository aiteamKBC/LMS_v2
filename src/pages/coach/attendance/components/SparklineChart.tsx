import { useMemo } from 'react';

interface SparklineChartProps {
  data: Array<{ week: string; rate: number }>;
  width?: number;
  height?: number;
  strokeWidth?: number;
  color?: string;
  fillColor?: string;
  showDots?: boolean;
  showGradient?: boolean;
}

export default function SparklineChart({
  data,
  width = 160,
  height = 36,
  strokeWidth = 2,
  color = '#7c3aed',
  fillColor = '#7c3aed',
  showDots = true,
  showGradient = true,
}: SparklineChartProps) {
  const pathD = useMemo(() => {
    if (data.length < 2) return '';
    const values = data.map(d => d.rate);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;
    const padX = showDots ? 6 : 4;
    const drawWidth = width - padX * 2;
    const drawHeight = height - 8;
    const stepX = drawWidth / (data.length - 1);

    return data
      .map((d, i) => {
        const x = padX + i * stepX;
        const y = 4 + drawHeight - ((d.rate - minVal) / range) * drawHeight;
        return i === 0 ? `M${x},${y}` : `L${x},${y}`;
      })
      .join(' ');
  }, [data, width, height, showDots]);

  const gradientId = useMemo(() => `sparkline-grad-${Math.random().toString(36).slice(2, 8)}`, []);

  const values = data.map(d => d.rate);
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  const range = maxVal - minVal || 1;
  const padX = showDots ? 6 : 4;
  const drawWidth = width - padX * 2;
  const drawHeight = height - 8;
  const stepX = drawWidth / (data.length - 1);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible shrink-0">
      {showGradient && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={fillColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
      )}

      {/* Area fill */}
      {showGradient && pathD && (
        <path
          d={`${pathD} L${padX + (data.length - 1) * stepX},${height - 4} L${padX},${height - 4} Z`}
          fill={`url(#${gradientId})`}
        />
      )}

      {/* Line */}
      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Dots */}
      {showDots &&
        data.map((d, i) => {
          const x = padX + i * stepX;
          const y = 4 + drawHeight - ((d.rate - minVal) / range) * drawHeight;
          const isLast = i === data.length - 1;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={isLast ? 3.5 : 0}
              fill={color}
              stroke="#fff"
              strokeWidth={isLast ? 1.5 : 0}
            />
          );
        })}
    </svg>
  );
}
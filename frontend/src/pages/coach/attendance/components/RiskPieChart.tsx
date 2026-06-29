import { useState, useEffect, useRef } from 'react';

interface PieSlice {
  label: string;
  value: number;
  color: string;
  bgColor: string;
  textColor: string;
}

interface RiskPieChartProps {
  slices: PieSlice[];
  total: number;
  size?: number;
  innerRadius?: number;
}

export default function RiskPieChart({
  slices,
  total,
  size = 220,
  innerRadius = 58,
}: RiskPieChartProps) {
  const [visible, setVisible] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
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

  const center = size / 2;
  const outerRadius = center - 4;
  const circumference = 2 * Math.PI * ((outerRadius + innerRadius) / 2);

  let cumulativeAngle = -90;

  return (
    <div ref={containerRef} className="flex flex-col items-center justify-center gap-3" style={{ minWidth: size }}>
      {/* Donut */}
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {slices.map((slice, i) => {
            const sliceAngle = (slice.value / total) * 360;
            const startAngle = cumulativeAngle;
            const endAngle = cumulativeAngle + sliceAngle;
            cumulativeAngle = endAngle;

            const startRad = (startAngle * Math.PI) / 180;
            const endRad = (endAngle * Math.PI) / 180;

            const isHovered = hoveredIndex === i;
            const hoverScale = isHovered ? 1.06 : 1;

            const or = outerRadius * hoverScale;
            const ir = innerRadius * (1 / hoverScale);

            const x1Outer = center + or * Math.cos(startRad);
            const y1Outer = center + or * Math.sin(startRad);
            const x2Outer = center + or * Math.cos(endRad);
            const y2Outer = center + or * Math.sin(endRad);

            const x1Inner = center + ir * Math.cos(startRad);
            const y1Inner = center + ir * Math.sin(startRad);
            const x2Inner = center + ir * Math.cos(endRad);
            const y2Inner = center + ir * Math.sin(endRad);

            const largeArc = sliceAngle > 180 ? 1 : 0;

            const d = [
              `M ${x1Outer} ${y1Outer}`,
              `A ${or} ${or} 0 ${largeArc} 1 ${x2Outer} ${y2Outer}`,
              `L ${x2Inner} ${y2Inner}`,
              `A ${ir} ${ir} 0 ${largeArc} 0 ${x1Inner} ${y1Inner}`,
              'Z',
            ].join(' ');

            return (
              <path
                key={i}
                d={d}
                fill={slice.color}
                stroke="white"
                strokeWidth={2}
                className="cursor-pointer"
                style={{
                  opacity: visible ? 1 : 0,
                  transformOrigin: `${center}px ${center}px`,
                  transform: isHovered ? `scale(1.04)` : 'scale(1)',
                  transition: 'opacity 0.6s ease-out, transform 0.25s ease',
                  transitionDelay: `${i * 0.15}s`,
                }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            );
          })}

          {/* Center text */}
          <text x={center} y={center - 6} textAnchor="middle" className="fill-foreground-900" style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
            {total}
          </text>
          <text x={center} y={center + 12} textAnchor="middle" className="fill-foreground-400" style={{ fontSize: '10px' }}>
            Learners
          </text>
        </svg>

        {/* Center hover highlight */}
        {hoveredIndex !== null && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-xl font-heading font-bold" style={{ color: slices[hoveredIndex].color }}>
                {slices[hoveredIndex].value}
              </p>
              <p className="text-[10px] text-foreground-500 font-medium">
                {slices[hoveredIndex].label}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap justify-center">
        {slices.map((slice, i) => (
          <div
            key={i}
            className={`flex items-center gap-1.5 cursor-pointer transition-smooth ${hoveredIndex === i ? 'opacity-100 scale-105' : hoveredIndex !== null ? 'opacity-50' : 'opacity-100'}`}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: slice.color }}></span>
            <span className="text-[11px] text-foreground-600 font-medium whitespace-nowrap">{slice.label}</span>
            <span className="text-[11px] font-semibold text-foreground-900">{slice.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
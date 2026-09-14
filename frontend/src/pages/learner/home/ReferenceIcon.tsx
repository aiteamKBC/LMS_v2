import { useId } from 'react';

// Pixel windows in the approved 1920 × 1080 reference. The source artwork is
// retained; only its background is masked out when the icon is rendered.
const regions = {
  file: [714, 275, 50, 63],
  chart: [1148, 277, 55, 59],
  calendar: [714, 545, 58, 64],
  people: [1140, 545, 67, 62],
  graduate: [926, 434, 69, 55],
  laurel: [912, 868, 96, 60],
  crown: [918, 151, 85, 56],
} as const;

export function ReferenceIcon({ name, className }: { name: keyof typeof regions; className?: string }) {
  const filterId = useId();
  const [x, y, width, height] = regions[name];
  const gold = name === 'laurel';
  const crown = name === 'crown';
  return <svg className={className} viewBox={`${x} ${y} ${width} ${height}`}
    aria-hidden="true" focusable="false" overflow="hidden">
    <defs>
      <filter id={filterId} x={x} y={y} width={width} height={height}
        filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feColorMatrix in="SourceGraphic" type="matrix" result="artwork" values={gold
          ? '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  2.5 0 -2.5 0 0'
          : crown
            ? '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  6 3 0 0 -2.7'
            : '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -2 0 0 0 1.5'} />
        {!gold && <><feFlood floodColor="currentColor" /><feComposite in2="artwork" operator="in" /></>}
      </filter>
    </defs>
    <image href="/assets/student-home/approved-reference.png" width="1920" height="1080" filter={`url(#${filterId})`} />
  </svg>;
}

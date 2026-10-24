import type { CSSProperties, SVGProps } from 'react';

/** Draws a progress arc when its SVG circle appears or its value changes. */
export function AnimatedProgressCircle({ className, style, strokeDasharray, strokeDashoffset, ...props }: SVGProps<SVGCircleElement>) {
  const circumference = Number(strokeDasharray);
  const animateOffset = strokeDashoffset != null && Number.isFinite(circumference);

  return <circle
    key={`${strokeDasharray}:${strokeDashoffset ?? ''}`}
    {...props}
    strokeDasharray={strokeDasharray}
    strokeDashoffset={strokeDashoffset}
    className={`${className ?? ''} ${animateOffset ? 'animate-progress-ring-offset' : 'animate-progress-ring-dash'} motion-reduce:animate-none`}
    style={{ ...style, '--ring-start-offset': circumference } as CSSProperties}
  />;
}

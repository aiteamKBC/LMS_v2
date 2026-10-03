import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnimatedProgressCircle } from './AnimatedProgressCircle';

describe('AnimatedProgressCircle', () => {
  it('draws from the actual SVG progress and restarts when that progress changes', () => {
    const { container, rerender } = render(<svg><AnimatedProgressCircle cx={50} cy={50} r={42} strokeDasharray={264} strokeDashoffset={132} /></svg>);
    const first = container.querySelector('circle');
    expect(first).toHaveAttribute('stroke-dasharray', '264');
    expect(first).toHaveAttribute('stroke-dashoffset', '132');

    rerender(<svg><AnimatedProgressCircle cx={50} cy={50} r={42} strokeDasharray={264} strokeDashoffset={26.4} /></svg>);
    const updated = container.querySelector('circle');
    expect(updated).toHaveAttribute('stroke-dashoffset', '26.4');
    expect(updated).not.toBe(first);
  });
});

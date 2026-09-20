import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReviewProgressSnapshot } from '@/api/reviewInstances';
import { ReviewProgressPanel } from './ReviewProgressPanel';

const metric = (actualPercent: number | null, expectedPercent: number | null) => ({
  actual: actualPercent,
  expected: expectedPercent,
  planned: 100,
  actualPercent,
  expectedPercent,
  variancePercent: actualPercent === null || expectedPercent === null ? null : actualPercent - expectedPercent,
  varianceDirection: actualPercent === null || expectedPercent === null ? '' as const : actualPercent >= expectedPercent ? 'above' as const : 'below' as const,
});

function snapshot(overrides: Partial<ReviewProgressSnapshot> = {}): ReviewProgressSnapshot {
  return {
    calculationMethod: 'planned_hours',
    calculatedFrom: '2025-01-01',
    calculatedAt: '2026-09-19T10:00:00Z',
    calculatedBy: 'coach@example.test',
    weeksElapsed: 88,
    programmeProgress: metric(28, 0),
    offTheJobHours: metric(64, 41),
    ksbProgress: {
      available: true,
      title: 'Project controls professional Apprenticeship Standard (v1.0) (Level 6)',
      actualPercent: 73,
      expectedPercent: 100,
      variancePercent: -27,
      varianceDirection: 'below',
    },
    ...overrides,
  };
}

describe('ReviewProgressPanel reference visual contract', () => {
  it('uses the programme actual for the donut and keeps fill and target labels independent', () => {
    render(<ReviewProgressPanel snapshot={snapshot()} canCalculate={false} calculating={false} onCalculate={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Learning Plan Progress: 28%' })).toBeVisible();
    expect(screen.getByText('Project controls professional Apprenticeship Standard (v1.0) (Level 6)')).toBeVisible();
    expect(screen.getByText('23% Above')).toBeVisible();
    expect(screen.getByText('28% Above')).toBeVisible();
    const markers = screen.getAllByTestId('target-marker');
    expect(markers[0]).toHaveStyle({ right: '0px' });
    expect(markers[2]).toHaveStyle({ left: '0px' });
  });

  it('shows the real over-100 value while capping only its visual fill', () => {
    render(<ReviewProgressPanel snapshot={snapshot({ offTheJobHours: metric(120, 41) })} canCalculate={false} calculating={false} onCalculate={vi.fn()} />);
    expect(screen.getByText('120%')).toBeVisible();
    expect(screen.getByText('79% Above')).toBeVisible();
  });

  it('renders a historical missing KSB metric as unavailable rather than zero', () => {
    render(<ReviewProgressPanel snapshot={snapshot({ ksbProgress: undefined })} canCalculate={false} calculating={false} onCalculate={vi.fn()} />);
    expect(screen.getByTestId('ksb-progress-unavailable')).toHaveTextContent('KSB progress was not available in this snapshot.');
  });
});


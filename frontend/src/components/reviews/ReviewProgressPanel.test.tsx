import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    programmeTimeline: { startDate: '2025-01-01', asOfDate: '2026-09-19', gatewayDate: '2027-01-01', endDate: '2027-06-01' },
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
  it('keeps an unavailable action hidden unless visibility is explicitly requested', () => {
    render(<ReviewProgressPanel snapshot={snapshot()} canCalculate={false} calculating={false} onCalculate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Recalculate' })).not.toBeInTheDocument();
  });

  it.each([false, true])('shows the disabled action with snapshot=%s and skips it during keyboard navigation', async hasSnapshot => {
    const user = userEvent.setup();
    const onCalculate = vi.fn();
    render(<>
      <button>Before progress</button>
      <ReviewProgressPanel snapshot={hasSnapshot ? snapshot() : null} canCalculate={false} showCalculateAction calculating={false} onCalculate={onCalculate} />
      <button>After progress</button>
    </>);
    const button = screen.getByRole('button', { name: hasSnapshot ? 'Recalculate' : 'Calculate' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Available to the assigned Coach only.');
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'Before progress' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'After progress' })).toHaveFocus();
    await user.keyboard('{Enter} ');
    expect(onCalculate).not.toHaveBeenCalled();
  });

  it('uses the programme actual for the donut and keeps fill and target labels independent', () => {
    render(<ReviewProgressPanel snapshot={snapshot()} canCalculate={false} calculating={false} onCalculate={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Learning Plan Progress: 28%; target 0%' })).toBeVisible();
    expect(screen.getByText('Project controls professional Apprenticeship Standard (v1.0) (Level 6)')).toBeVisible();
    expect(screen.getByText('23% Above')).toBeVisible();
    expect(screen.getByText('28% Above')).toBeVisible();
    const markers = screen.getAllByTestId('target-marker');
    expect(markers[0]).toHaveStyle({ right: '0px' });
    expect(markers).toHaveLength(2);
    expect(screen.getByTestId('donut-target-marker')).toHaveAttribute('transform', 'rotate(0 88 88)');
    expect(screen.getByText('Programme timeline')).toBeVisible();
    expect(screen.queryByText('Programme progress')).not.toBeInTheDocument();
    expect(screen.getByText('At calculation: 19 Sept 2026')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Programme timeline at calculation: 19 Sept 2026' }).firstElementChild).toHaveStyle({ width: '71.05561861521%' });
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

  it('renders frozen Dashboard evidence points without changing the Review arithmetic or old labels', () => {
    render(<ReviewProgressPanel snapshot={snapshot({
      schemaVersion: 5,
      formulaVersion: 'canonical_dashboard_metrics_and_scheduled_catalogue_v6',
      actualHoursSource: 'canonical_learning.dashboard',
      ksbProgress: { available: true, title: 'KSB evidence points', actual: 159, planned: 166,
        actualPercent: 95.78, expectedPercent: 100, variancePercent: -4.22, varianceDirection: 'below' },
      programmeProgress: metric(33.33, 83.33),
    })} canCalculate={false} calculating={false} onCalculate={vi.fn()} />);
    expect(screen.getByText('KSB evidence points')).toBeVisible();
    expect(screen.getByText('96%')).toBeVisible();
    expect(screen.getByText('4% Below')).toBeVisible();
    expect(screen.getByText('50% Below')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Learning Plan Progress: 33%; target 83%' })).toBeVisible();
  });

  it('does not invent dates for an older snapshot or a missing target', () => {
    render(<ReviewProgressPanel snapshot={snapshot({ programmeTimeline: undefined, programmeProgress: metric(28, null) })} canCalculate={false} calculating={false} onCalculate={vi.fn()} />);
    expect(screen.getByText('Programme timeline dates were not recorded in this snapshot.')).toBeVisible();
    expect(screen.queryByTestId('donut-target-marker')).not.toBeInTheDocument();
  });
});


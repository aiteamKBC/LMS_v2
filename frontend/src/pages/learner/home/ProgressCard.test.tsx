import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeProgress } from '@/api/learnerOverview';
import { ProgressCard } from './ProgressCard';

const data: HomeProgress = {
  period: { start: '2026-01-02', end: '2026-09-13', timezone: 'Europe/London' },
  otjh: { actual: 13.5033, submitted: 8.25, planned: 492.59, percent: 2.74, missingPlannedActivities: 0 },
  activities: { completed: 21, total: 150 }, assignments: { completed: 3, total: 12 },
  lectures: { completed: 8, total: 10 }, modules: { completed: 1, total: 5 }, undatedActivities: 0,
};
function show(changes: Partial<Parameters<typeof ProgressCard>[0]> = {}) {
  const refresh = vi.fn();
  render(<MemoryRouter><ProgressCard data={data} error="" loading={false} refresh={refresh} dashboardHref="/workspace/learner/dashboard" {...changes}/></MemoryRouter>);
  return refresh;
}
afterEach(cleanup);
describe('home progress card', () => {
  it('shows actual and submitted hours against the activity plan, with four distinct totals', () => {
    show();
    expect(screen.getByRole('progressbar', { name: 'OTJ progress' })).toHaveAttribute('aria-valuenow', '2.74');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Completed (Actual): 13.5 h; Submitted: 8.25 h; Total Planned: 492.59 h');
    expect(screen.getByText('2 Jan 2026 – 13 Sept 2026')).toBeVisible();
    expect(screen.getByRole('link', { name: /21 of 150 Activities completed/ })).toHaveAttribute('href', '/learner/my-learning');
    expect(screen.getByRole('link', { name: /3 of 12 Assignments completed/ })).toHaveAttribute('href', '/learner/monthly-submission');
    expect(screen.getByRole('link', { name: /8 of 10 Lectures attended/ })).toHaveAttribute('href', '/learner/attendance');
    expect(screen.getByRole('link', { name: /1 of 5 Modules completed Whole programme/ })).toBeVisible();
  });
  it('does not present missing hours or a missing start date as zero progress', () => {
    show({ data: { ...data, period: { ...data.period, start: null },
      otjh: { ...data.otjh, planned: null, percent: null, missingPlannedActivities: 3 },
      activities: null, assignments: null, lectures: null, undatedActivities: 2 } });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('Start date unavailable')).toBeVisible();
    expect(screen.getByText('Planned hours missing for 3 activities.')).toBeVisible();
    expect(screen.getByText('2 undated activities excluded from period totals.')).toBeVisible();
    expect(screen.getByRole('link', { name: /Modules completed/ })).toHaveTextContent('1 of 5');
    expect(screen.getByRole('link', { name: /Activities completed/ })).toHaveTextContent('—');
  });
  it('keeps a genuine zero count and zero submitted time visible', () => {
    show({ data: { ...data, otjh: { ...data.otjh, actual: 0, submitted: 0, percent: 0 }, activities: { completed: 0, total: 0 } } });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('link', { name: /0 of 0 Activities completed/ })).toBeVisible();
  });
  it('hides stale numbers and offers retry on a failed refresh', () => {
    const retry = show({ error: 'Unavailable' });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('492.59 h')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('keeps other totals available when attendance fails', () => {
    const retry = show({ data: { ...data, lectures: null } });
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.getByRole('link', { name: /Lectures attended/ })).toHaveTextContent('—');
    fireEvent.click(screen.getByRole('button', { name: 'Retry lecture attendance' }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('caps the ring at a full circle while preserving the true hours and percentage', () => {
    show({ data: { ...data, otjh: { ...data.otjh, actual: 120, submitted: 10, planned: 100, percent: 120 } } });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar')).toHaveTextContent('120%');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', expect.stringContaining('120 h'));
  });
});

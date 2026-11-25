import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EmployerModuleTimeline } from './EmployerModuleTimeline';

afterEach(cleanup);
const learner = { name: 'Alex Learner', percent: 25 };
const show = (overrides: Partial<Parameters<typeof EmployerModuleTimeline>[0]> = {}) => render(<EmployerModuleTimeline
  start="2026-11-01" end="2026-11-21" today="2026-11-11" learners={[learner]} {...overrides} />);

describe('employer module timeline positions', () => {
  it('separates elapsed calendar time from actual learner completion on the same timeline', () => {
    show();
    expect(screen.getByRole('img', { name: 'Today: 11 Nov 2026, 50% of module time elapsed' })).toHaveStyle({ left: '50%' });
    expect(screen.getByRole('img', { name: 'Alex Learner progress: 25%' })).toHaveStyle({ left: '25%' });
    expect(screen.getByText('Learner progress · 25%')).toBeVisible();
  });

  it.each([
    ['2026-10-31', '0%', 'Before start date'],
    ['2026-11-01', '0%', 'Starts today'],
    ['2026-11-21', '100%', 'Ends today'],
    ['2026-11-22', '100%', 'End date passed'],
  ])('keeps Today within the track for %s', (today, left, status) => {
    show({ today });
    expect(screen.getByRole('img', { name: /^Today:/ })).toHaveStyle({ left });
    expect(screen.getByText(status)).toBeVisible();
    expect(screen.getByRole('img', { name: 'Alex Learner progress: 25%' })).toHaveStyle({ left: '25%' });
  });

  it.each(['2026-11-10', '2026-11-11'])('handles a one-day module on %s without dividing by zero', today => {
    show({ start: '2026-11-11', end: '2026-11-11', today });
    expect(screen.getByRole('img', { name: /^Today:/ })).toHaveStyle({ left: today === '2026-11-10' ? '0%' : '100%' });
  });

  it.each([
    { start: '' }, { end: '' }, { end: '2026-02-30' }, { start: '2026-12-01' }, { today: 'invalid' },
  ])('does not invent a calendar position with missing or invalid bounds: %j', overrides => {
    show(overrides);
    expect(screen.queryByRole('img', { name: /^Today:/ })).not.toBeInTheDocument();
    expect(screen.getByText('Today position unavailable')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Alex Learner progress: 25%' })).toBeVisible();
  });

  it('shows each learner separately and preserves zero without fabricating missing completion', () => {
    show({ learners: [learner, { name: 'Morgan Learner', percent: 0 }, { name: 'Casey Learner', percent: null }] });
    expect(screen.getByRole('img', { name: 'Alex Learner progress: 25%' })).toHaveStyle({ left: '25%' });
    expect(screen.getByRole('img', { name: 'Morgan Learner progress: 0%' })).toHaveStyle({ left: '0%' });
    expect(screen.queryByRole('img', { name: /Casey Learner/ })).not.toBeInTheDocument();
    expect(screen.getByText('Learner progress · 2 of 3 recorded')).toBeVisible();
  });

  it('keeps Today visible when learner completion is unavailable', () => {
    show({ learners: [{ name: 'Alex Learner', percent: null }] });
    expect(screen.getByRole('img', { name: /^Today:/ })).toBeVisible();
    expect(screen.queryByRole('img', { name: /Alex Learner/ })).not.toBeInTheDocument();
    expect(screen.getByText('Learner progress · Unavailable')).toBeVisible();
  });
});

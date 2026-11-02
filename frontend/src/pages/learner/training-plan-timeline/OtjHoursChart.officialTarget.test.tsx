import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OtjHoursChart, type OfficialTarget } from './OtjHoursChart';
import type { MonthlyHours } from './monthlyHours';

// Monthly completed is deliberately 30, not the canonical Actual120.
const points: MonthlyHours[] = [
  { key: '2026-01', label: 'January 2026', target: 200, completed: 10, submitted: 2 },
  { key: '2026-07', label: 'July 2026', target: 200, completed: 20, submitted: 3 },
];
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function chart(value: unknown, request: OfficialTarget['request'] = 'ready') {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network'); }));
  return render(<OtjHoursChart points={points} plannedHours={400} officialTarget={{ value, request }} />);
}
function track() { return screen.getByRole('progressbar', { name: 'Training plan off-the-job hours progress' }); }

describe('explicit Backend target chart mode', () => {
  it('keeps positive target marker and variance rounding, independent of monthly sums', () => {
    chart(143.61);
    expect(track()).toHaveAttribute('aria-valuenow', '8'); // 30/400, explicitly Training Plan
    expect(track().querySelector('b')).toHaveStyle({ left: '36%' });
    expect(screen.getByText(/-79%/)).toHaveTextContent('-113.6h');
    expect(screen.getByText('Training plan progress')).toBeVisible();
    expect(screen.queryByText('Official Programme Completion')).not.toBeInTheDocument();
  });
  it.each([null, undefined, -1, NaN, Infinity, '143.61', {}, false])('never substitutes monthly400 for %s', target => {
    chart(target);
    expect(screen.getByText(/Target to date: Unavailable/)).toBeVisible();
    expect(track().querySelector('b')).toBeNull();
    expect(screen.getByText('N/A').className).toBe('');
    expect(track()).toHaveAttribute('aria-valuenow', '8'); // independent plan completion survives
    expect(track().querySelectorAll('i')).toHaveLength(2); // submitted plan progress survives too
    const month = screen.getByRole('button', { name: /January 2026: target 200 hours, submitted 2 hours, completed 10 hours/ });
    fireEvent.focus(month);
    expect(screen.getByRole('tooltip')).toHaveTextContent('2 hours');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains numeric0 target at start without division or monthly fallback', () => {
    chart(0);
    expect(screen.getByText('Target to date: 0h')).toBeVisible();
    expect(track().querySelector('b')).toHaveStyle({ left: '0%' });
    expect(screen.getByText('N/A').className).toBe('');
  });
  it.each(['loading', 'error'] as const)('suppresses stale target on %s while keeping monthly history', request => {
    chart(143.61, request);
    expect(track().querySelector('b')).toBeNull();
    expect(screen.getByRole('button', { name: /January 2026: target 200 hours/ })).toBeVisible();
    expect(screen.getByText('N/A').className).toBe('');
  });
  it('does not invent monthly actual from a missing completed row', () => {
    render(<OtjHoursChart points={[{ ...points[0], completed: null }]} plannedHours={400} officialTarget={{ value: 143.61, request: 'ready' }} />);
    expect(track()).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('Recorded hours unavailable')).toBeVisible();
    expect(screen.getByText('N/A').className).toBe('');
  });
  it('keeps omitted-mode monthly fallback and geometry unchanged', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-07-02T12:00:00Z'));
    render(<OtjHoursChart points={points} plannedHours={400} targetAsOfToday={null} />);
    const bar = screen.getByRole('progressbar', { name: 'Overall off-the-job hours progress' });
    expect(bar.querySelector('b')).toHaveStyle({ left: '100%' });
    expect(screen.getByText(/-92%/)).toHaveTextContent('-370h');
  });
});

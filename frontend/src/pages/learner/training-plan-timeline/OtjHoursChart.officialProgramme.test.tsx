import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OtjHoursChart, type OfficialProgramme } from './OtjHoursChart';
const points = [
  { key: '2026-01', label: 'January 2026', target: 200, completed: 10, submitted: 2 },
  { key: '2026-07', label: 'July 2026', target: 200, completed: 20, submitted: 3 },
];
const golden: OfficialProgramme = { actual: 120, planned: 288, target: 143.61, request: 'ready' };
afterEach(cleanup);
function show(patch: Partial<OfficialProgramme> = {}, rows = points) {
  return render(<OtjHoursChart data={{ months: {}, actual: [], actualAvailable: true, requiredOtjh: 576 }} points={rows} plannedHours={400} officialTarget={{ value: 143.61, request: 'ready' }} officialProgramme={{ ...golden, ...patch }} />);
}
function official() { return within(screen.getByRole('region', { name: 'Official Programme Completion' })); }
describe('separate canonical programme metrics', () => {
  it('keeps canonical120 distinct from monthly30 and submitted5', () => {
    show();
    expect(official().getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(official().getByText('Official Planned Hours: 288h')).toBeVisible();
    expect(official().getByText('Official Target Marker: 50%')).toBeVisible();
    expect(official().getByText('Official Variance: -23.6h')).toBeVisible();
    expect(official().getByRole('progressbar').querySelector('b')).toHaveStyle({ left: '50%' });
    const plan = screen.getByRole('progressbar', { name: 'Training plan off-the-job hours progress' });
    expect(plan).toHaveAttribute('aria-valuenow', '8');
    expect(plan.querySelector('b')).toHaveStyle({ left: '36%' });
    expect(plan.querySelectorAll('i')).toHaveLength(2);
    expect(screen.getByText(/-79%/)).toHaveTextContent('-113.6h');
  });
  it.each([null, undefined, -1, NaN, Infinity, '288', {}, false])('does not use plan400, review20 or history576 for invalid P=%s', planned => {
    show({ planned });
    expect(official().getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(official().getByText('Official Target Marker: Unavailable')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: /Training plan off/ })).toHaveAttribute('aria-valuenow', '8');
  });
  it('shows real planned0 but no completion or marker', () => {
    show({ planned: 0, target: null });
    expect(official().getByText('Official Planned Hours: 0h')).toBeVisible();
    expect(official().getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });
  it.each([null, undefined])('missing actual %s never becomes zero or monthly actual', actual => {
    show({ actual });
    expect(official().getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(official().getByText('Official Variance: Unavailable')).toBeVisible();
    expect(official().getByText('Official Target Marker: 50%')).toBeVisible();
  });
  it('actual0 is genuine zero completion; target0 has a genuine zero marker', () => {
    show({ actual: 0, target: 0 });
    expect(official().getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(official().getByText('Official Target Marker: 0%')).toBeVisible();
    expect(official().getByText('Official Variance: 0h')).toBeVisible();
  });
  it.each([null, undefined])('missing dates/target %s do not suppress valid programme completion', target => {
    show({ target });
    expect(official().getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(official().getByText('Official Target Marker: Unavailable')).toBeVisible();
    expect(official().getByText('Official Variance: Unavailable')).toBeVisible();
  });
  it.each(['loading', 'error'] as const)('suppresses retained official success on %s without changing monthly rows', request => {
    show({ request });
    expect(official().getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(official().queryByText(/42%|50%|-23.6h|288h/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /January 2026: target 200 hours, submitted 2 hours, completed 10 hours/ })).toBeVisible();
  });
  it('works without monthly rows and caps completion at100', () => {
    show({ actual: 576 }, []);
    expect(official().getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.queryByRole('progressbar', { name: /Training plan off/ })).not.toBeInTheDocument();
  });
});

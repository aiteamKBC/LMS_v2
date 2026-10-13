import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaseFileOverviewTab } from '@/pages/coach/learner-case-file/tabs/CaseFileOverviewTab';
import { clearCaseFileCache, readCaseFileCache } from './cache/caseFileCache';
import type { CaseFileOverview } from './hooks/useCaseFileOverview';

const mocks = vi.hoisted(() => ({ state: {} as { data?: CaseFileOverview }, transport: vi.fn() }));
vi.mock('./hooks/useCaseFileOverview', () => ({ useCaseFileOverview: () => ({ ...mocks.state, retry: vi.fn() }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.transport }));
vi.mock('@/pages/coach/caseload/lib/format', () => ({ otjhProgressAsOfToday: () => { throw new Error('Overview must not pace hours in React'); } }));

const response: CaseFileOverview = {
  wholeProgrammeProgress: {
    overall: { completed: 3, total: 4, percent: 75 },
    attendance: { present: 1, sessions: 2, percent: 49.12 },
    otjh: { actual: 12, targetToDate: 25, planned: 100, percent: 47.13 },
    ksb: { completed: 1, total: 3, percent: 33.33 },
  },
  programmeProgress: [{ id: 'current:M1', title: 'Synthetic module', percent: 76.54 }],
};
const stale = { overall: 1, activitiesCompleted: 1, activitiesTotal: 100, activitiesPercent: 1,
  otjhActual: 999, otjhTarget: 1000, ksb: 2, ksbAvailable: false, attendancePresent: 99, attendanceTotal: 100 };

beforeEach(() => {
  clearCaseFileCache();
  mocks.state = { data: response };
  mocks.transport.mockReset().mockResolvedValue(new Response(JSON.stringify(response)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('renders final endpoint percentages and hours without recalculation or snapshot overrides', () => {
  render(<CaseFileOverviewTab snapshot={stale} hasActivitySnapshot />);
  const chart = screen.getByRole('img');
  expect(chart).toHaveTextContent('49.12%');
  expect(chart).toHaveTextContent('47.13%');
  expect(chart).toHaveTextContent('75%');
  expect(chart).toHaveTextContent('33.33%');
  expect(screen.getByText('12 / 25 hours')).toBeInTheDocument();
  expect(screen.getByText('1 / 2 sessions attended')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Synthetic module: 76.54% overall progress' })).toBeInTheDocument();
  expect(screen.queryByText('999 / 1,000 hours')).not.toBeInTheDocument();
});

it('preserves explicit unavailable percentages instead of reconstructing them', () => {
  mocks.state = { data: { ...response, wholeProgrammeProgress: { ...response.wholeProgrammeProgress,
    attendance: { present: 1, sessions: 2, percent: null },
    otjh: { actual: 12, targetToDate: 25, planned: 100, percent: null } } } };
  render(<CaseFileOverviewTab snapshot={stale} />);
  const chart = screen.getByRole('img');
  expect(chart.querySelector('desc')).toHaveTextContent('Attendance: N/A');
  expect(chart.querySelector('desc')).toHaveTextContent('Hours: N/A');
});

it('shares pending requests, hits immediate revisits and refreshes Overview after 60 seconds', async () => {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const read = () => readCaseFileCache('coach-A', '101', 'overview', '/overview');
  await Promise.all([read(), read()]);
  now += 59_999;
  await read();
  expect(mocks.transport).toHaveBeenCalledTimes(1);
  now += 1;
  mocks.transport.mockResolvedValue(new Response(JSON.stringify(response)));
  await read();
  expect(mocks.transport).toHaveBeenCalledTimes(2);
});

it('keeps stable tabs cached and separates coaches and learners', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  mocks.transport.mockImplementation(async () => new Response('{}'));
  await readCaseFileCache('coach-A', '101', 'profile', '/profile');
  vi.spyOn(Date, 'now').mockReturnValue(100_000);
  await readCaseFileCache('coach-A', '101', 'profile', '/profile');
  expect(mocks.transport).toHaveBeenCalledTimes(1);
  await readCaseFileCache('coach-B', '101', 'overview', '/overview');
  await readCaseFileCache('coach-A', '102', 'overview', '/overview');
  expect(mocks.transport).toHaveBeenCalledTimes(3);
});

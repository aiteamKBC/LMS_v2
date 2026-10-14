import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaseFileOverviewTab } from '@/pages/coach/learner-case-file/tabs/CaseFileOverviewTab';
import { clearCaseFileCache, readCaseFileCache } from './cache/caseFileCache';
import type { CaseFileOverview } from './hooks/useCaseFileOverview';
import { moduleOverviewFixture } from './caseFileOverview.fixture';

const mocks = vi.hoisted(() => ({ state: {} as { data?: CaseFileOverview; error?: string }, transport: vi.fn(), retry: vi.fn() }));
vi.mock('./hooks/useCaseFileOverview', () => ({ useCaseFileOverview: () => ({ ...mocks.state, retry: mocks.retry }) }));
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
  moduleOverview: moduleOverviewFixture,
};
const stale = { overall: 1, activitiesCompleted: 1, activitiesTotal: 100, activitiesPercent: 1,
  otjhActual: 999, otjhTarget: 1000, ksb: 2, ksbAvailable: false, attendancePresent: 99, attendanceTotal: 100 };

beforeEach(() => {
  clearCaseFileCache();
  mocks.state = { data: response };
  mocks.retry.mockReset();
  mocks.transport.mockReset().mockResolvedValue(new Response(JSON.stringify(response)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('renders learner module rings and counts while preserving the programme row percentage', () => {
  render(<CaseFileOverviewTab snapshot={stale} hasActivitySnapshot />);
  const chart = within(screen.getByRole('region', { name: 'Module progress' }));
  for (const name of ['Attendance: 0%', 'Activities: 35.09%', 'Hours: 5.9%', 'KSBs: 100%']) {
    expect(chart.getByRole('img', { name })).toBeInTheDocument();
  }
  for (const count of ['0 / 12', '20 / 57', '4.9 / 83', '15 / 15']) expect(chart.getByText(count)).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Whole programme progress' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Synthetic module: 76.54% overall progress' })).toBeInTheDocument();
  expect(screen.queryByText('999 / 1,000 hours')).not.toBeInTheDocument();
});

it('switches all four measures by module id, including modules absent from the programme rows', () => {
  render(<CaseFileOverviewTab snapshot={stale} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Select module' }), { target: { value: 'current:M2' } });
  for (const name of ['Attendance: 50%', 'Activities: 25%', 'Hours: 35%', 'KSBs: 60%']) {
    expect(screen.getByRole('img', { name })).toBeInTheDocument();
  }
  expect(screen.getByText('3.5 / 10')).toBeInTheDocument();
  expect(screen.queryByText('4.9 / 83')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Synthetic module: 76.54% overall progress' }));
  expect(screen.getByRole('combobox')).toHaveValue('current:M1');
  expect(screen.getByText('4.9 / 83')).toBeInTheDocument();
});

it('keeps unavailable module measures distinct from zero and handles an empty plan', () => {
  mocks.state = { data: { ...response, moduleOverview: { ...moduleOverviewFixture, moduleProgress: undefined } } };
  const { rerender } = render(<CaseFileOverviewTab snapshot={stale} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'current:M2' } });
  for (const name of ['Attendance: N/A', 'Hours: N/A', 'KSBs: N/A']) expect(screen.getByRole('img', { name })).toBeInTheDocument();
  mocks.state = { data: { ...response, moduleOverview: { ...moduleOverviewFixture, subjects: [], modules: [] } } };
  rerender(<CaseFileOverviewTab snapshot={stale} />);
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('shows loading and retryable errors without displaying stale module values', () => {
  mocks.state = {};
  const { rerender } = render(<CaseFileOverviewTab snapshot={stale} />);
  expect(screen.getByRole('status', { name: 'Loading overview' })).toBeInTheDocument();
  mocks.state = { error: 'Module source unavailable' };
  rerender(<CaseFileOverviewTab snapshot={stale} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Module source unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry overview' }));
  expect(mocks.retry).toHaveBeenCalledOnce();
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

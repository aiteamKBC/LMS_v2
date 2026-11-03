import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchEmployerLearningOverview, fetchEmployerTraining } from '@/api/employerPortal';
import { dashboardOverviewFixture } from '@/test/dashboardOverviewFixture';
import { OverviewCharts } from '@/pages/workspace/learner/OverviewCharts';
import { dashboardOtjhProgress } from '@/pages/workspace/learner/dashboardOtjhProgress';
import { timelineModuleForDisplay, type DashboardTrainingPayload } from '@/api/dashboardTraining';
import { EmployerLearningOverview, EmployerTrainingPlan } from './EmployerLearning';

const account = vi.hoisted(() => ({ id: 'employer-account' }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ auth: { account } }) }));
vi.mock('@/api/employerPortal', () => ({ fetchEmployerLearningOverview: vi.fn(), fetchEmployerTraining: vi.fn() }));

let client: QueryClient;
beforeEach(() => {
  account.id = 'employer-account';
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected HTTP request'); }));
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('Employer uses learner facts and display calculations', () => {
  it('renders exactly the learner module progress, deduplication and monthly charts', async () => {
    const payload = dashboardOverviewFixture();
    const duplicate = { ...payload.modules[0], id: 'current:M2', title: 'Unstarted', activities: { completed: 0, total: 3 } };
    payload.modules.push(duplicate);
    payload.programme.push({ id: duplicate.id, title: duplicate.title, percent: 0 });
    vi.mocked(fetchEmployerLearningOverview).mockResolvedValue(payload);
    const learner = render(<OverviewCharts payload={payload} programmeStartDate={payload.programmeStartDate}
      programmeEndDate={payload.programmeEndDate} targetAsOfToday={payload.metrics.otjh.targetToDate} />, { wrapper });
    const expected = screen.getByRole('region', { name: 'Programme module progress' }).textContent;
    const expectedMonth = screen.getByRole('button', { name: /October 2026: target/ }).getAttribute('aria-label');
    learner.unmount();
    render(<EmployerLearningOverview employerId="9" kind="commercial" learnerId="265" />, { wrapper });
    expect((await screen.findByRole('region', { name: 'Programme module progress' })).textContent).toBe(expected);
    expect(screen.getByRole('button', { name: /October 2026: target/ })).toHaveAttribute('aria-label', expectedMonth);
    expect(screen.queryByText('Whole programme progress')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unstarted (Current plan): 0% overall progress' })).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([null, 0, 40])('preserves the learner target-to-date semantics for %s', async target => {
    const payload = dashboardOverviewFixture();
    payload.metrics.otjh.targetToDate = target;
    vi.mocked(fetchEmployerLearningOverview).mockResolvedValue(payload);
    render(<EmployerLearningOverview employerId="9" kind="commercial" learnerId="265" />, { wrapper });
    const link = await screen.findByRole('link', { name: /OTJ Hours/ });
    expect(link).toHaveTextContent(target == null ? 'Unavailable' : `${target.toFixed(2)} h`);
    expect(within(link).getByText(`${payload.metrics.otjh.actual?.toFixed(2) ?? '—'} / ${target?.toFixed(2) ?? '—'} h`)).toBeVisible();
    const learner = dashboardOtjhProgress(payload.metrics.otjh.actual, target);
    expect(within(link).getByRole('img')).toHaveAttribute('aria-label', `OTJ Hours: ${learner.percent == null ? '—' : learner.percent + '%'}`);
    expect(link).toHaveAttribute('href', '/employers/9/learner/commercial/265?tab=otjh');
  });

  it('does not retain another enrolment response and exposes failed reads', async () => {
    vi.mocked(fetchEmployerLearningOverview).mockResolvedValueOnce(dashboardOverviewFixture());
    const view = render(<EmployerLearningOverview employerId="9" kind="commercial" learnerId="265" />, { wrapper });
    await screen.findByText('40.00 h');
    vi.mocked(fetchEmployerLearningOverview).mockRejectedValueOnce(new Error('Access denied'));
    view.rerender(<EmployerLearningOverview employerId="10" kind="commercial" learnerId="266" />);
    expect(screen.queryByText('40.00 h')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(fetchEmployerLearningOverview).toHaveBeenLastCalledWith('10', 'commercial', '266', expect.any(AbortSignal));
  });

  it('shows inherited and unstarted modules and reads selected details only through the employer route', async () => {
    const modules = ['Inherited', 'Unstarted'].map((title, i) => ({ id: `current:M${i}`, moduleId: `M${i}`, title,
      start: '2026-09-01', end: '2027-12-31', done: i ? 0 : 1, activityCount: 3, progress: i ? 0 : 33.33,
      detail: { total_otjh: 60 } }));
    const payload: DashboardTrainingPayload = { timeline: { start: '2026-09', end: '2027-12', modules, reviews: [], coachName: 'Coach' },
      selectedModuleId: modules[0].id, selectedModule: timelineModuleForDisplay(modules[0]) };
    vi.mocked(fetchEmployerTraining).mockImplementation(async (_employer, _kind, _learner, subject) => subject
      ? { ...payload, selectedModuleId: subject, selectedModule: timelineModuleForDisplay(modules[1]) } : payload);
    render(<EmployerTrainingPlan employerId="9" kind="commercial" learnerId="265" />, { wrapper });
    const timeline = await screen.findByRole('region', { name: 'Module timeline' });
    expect(timeline).toHaveTextContent('Inherited');
    expect(timeline).toHaveTextContent('Unstarted');
    fireEvent.click(within(timeline).getByRole('button', { name: 'Show Unstarted overview' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Module overview' })).toHaveTextContent('Unstarted'));
    expect(fetchEmployerTraining).toHaveBeenLastCalledWith('9', 'commercial', '265', 'current:M1', expect.any(String), expect.any(AbortSignal));
    expect(screen.queryByRole('link', { name: /Go to module|Open calendar/ })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows loading, failure and retry for the Employer training read', async () => {
    let rejectRead!: (error: Error) => void;
    vi.mocked(fetchEmployerTraining).mockReturnValueOnce(new Promise((_resolve, reject) => { rejectRead = reject; }));
    render(<EmployerTrainingPlan employerId="9" kind="commercial" learnerId="265" />, { wrapper });
    expect(screen.getByRole('status')).toHaveTextContent('Loading training plan');
    rejectRead(new Error('Training plan unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Training plan unavailable');
    vi.mocked(fetchEmployerTraining).mockResolvedValueOnce({ timeline: { start: '2026-09', end: '2026-11', modules: [], reviews: [], coachName: '' }, selectedModuleId: null, selectedModule: null });
    fireEvent.click(screen.getByRole('button', { name: 'Retry training plan' }));
    expect(await screen.findByText('Your modules will appear when they are assigned.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps learner navigation and mutation controls absent in the full-screen inspector', async () => {
    const module = { id: 'current:M1', moduleId: 'M1', title: 'Observed module', start: '2026-09-01', end: '2026-11-30', done: 0, activityCount: 2, progress: 0, detail: { total_otjh: 60 } };
    vi.mocked(fetchEmployerTraining).mockResolvedValue({ timeline: { start: '2026-09', end: '2026-11', modules: [module], reviews: [], coachName: 'Coach' }, selectedModuleId: module.id, selectedModule: timelineModuleForDisplay(module) });
    render(<EmployerTrainingPlan employerId="9" kind="commercial" learnerId="265" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Full screen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Observed module overview' }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit|complete activity|book|join/i })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows overview loading and a genuine empty response without inventing module progress', async () => {
    let resolveRead!: (payload: ReturnType<typeof dashboardOverviewFixture>) => void;
    vi.mocked(fetchEmployerLearningOverview).mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve; }));
    render(<EmployerLearningOverview employerId="9" kind="commercial" learnerId="265" />, { wrapper });
    expect(screen.getByRole('status')).toHaveTextContent('Loading learner progress');
    const payload = dashboardOverviewFixture();
    payload.modules = [];
    payload.programme = [];
    payload.hours.months = [];
    payload.metrics.otjh = { actual: 0, targetToDate: null };
    resolveRead(payload);
    expect(await screen.findByRole('link', { name: /OTJ Hours/ })).toHaveTextContent('Unavailable');
    expect(screen.queryByRole('button', { name: /overall progress/ })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});


describe('official target chart parity', () => {
  it.each([null, 0, 143.61])('matches the learner scoped chart for target %s', async target => {
    const payload = dashboardOverviewFixture(); payload.metrics.otjh = { actual: 120, targetToDate: target };
    payload.hours.planned = 400;
    vi.mocked(fetchEmployerLearningOverview).mockResolvedValue(payload);
    const learner = render(<OverviewCharts payload={payload} officialTarget={{ value: target, request: 'ready' }} />, { wrapper });
    const track = screen.getByRole('progressbar', { name: 'Training plan off-the-job hours progress' });
    const marker = track.querySelector('b')?.getAttribute('style') ?? null;
    const monthly = screen.getByRole('button', { name: /October 2026: target/ }).getAttribute('aria-label');
    learner.unmount();
    render(<EmployerLearningOverview employerId="9" kind="apprenticeship" learnerId="265" />, { wrapper });
    const employerTrack = await screen.findByRole('progressbar', { name: 'Training plan off-the-job hours progress' });
    expect(employerTrack.querySelector('b')?.getAttribute('style') ?? null).toBe(marker);
    expect(screen.getByRole('button', { name: /October 2026: target/ })).toHaveAttribute('aria-label', monthly);
    expect(screen.getByRole('link', { name: 'Open OTJ Hours' })).toHaveTextContent(target === 143.61 ? '84%' : target === 0 ? '0.00 h' : 'Unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('suppresses a retained target after a failed refresh without erasing monthly rows', async () => {
    vi.mocked(fetchEmployerLearningOverview).mockResolvedValueOnce(dashboardOverviewFixture());
    render(<EmployerLearningOverview employerId="9" kind="commercial" learnerId="265" />, { wrapper });
    await screen.findByText('Target to date: 40h');
    vi.mocked(fetchEmployerLearningOverview).mockRejectedValueOnce(new Error('Refresh failed'));
    await act(async () => { await client.invalidateQueries({ queryKey: ['employer-learning-overview'] }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh failed');
    expect(screen.getByText('Target to date: Unavailable (could not refresh)')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Training plan off-the-job hours progress' }).querySelector('b')).toBeNull();
    expect(screen.getByRole('button', { name: /October 2026: target/ })).toBeVisible();
    vi.mocked(fetchEmployerLearningOverview).mockResolvedValueOnce(dashboardOverviewFixture());
    fireEvent.click(screen.getByRole('button', { name: 'Retry overview' }));
    expect(await screen.findByText('Target to date: 40h')).toBeVisible();
  });
});


it('does not publish a late target from a previous account', async () => {
  let finish!: (value: ReturnType<typeof dashboardOverviewFixture>) => void;
  vi.mocked(fetchEmployerLearningOverview).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<EmployerLearningOverview employerId="9" kind="commercial" learnerId="265" />, { wrapper });
  account.id = 'other-account';
  const next = dashboardOverviewFixture(); next.metrics.otjh.targetToDate = null;
  vi.mocked(fetchEmployerLearningOverview).mockResolvedValueOnce(next);
  view.rerender(<EmployerLearningOverview employerId="9" kind="commercial" learnerId="265" />);
  await screen.findByText('Target to date: Unavailable');
  await act(async () => finish(dashboardOverviewFixture()));
  expect(screen.queryByText('Target to date: 40h')).not.toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Training plan off-the-job hours progress' }).querySelector('b')).toBeNull();
});


it.each(['commercial', 'apprenticeship'] as const)('separates official %s metrics and suppresses retained successes through refresh/error/retry', async kind => {
  const payload = dashboardOverviewFixture();
  payload.metrics.otjh = { actual: 120, targetToDate: 143.61, officialPlannedHours: 288 };
  payload.hours.planned = 400;
  payload.hours.months = [{ key: '2026-10', target: 400, completed: 30, submitted: 5 }];
  vi.mocked(fetchEmployerLearningOverview).mockResolvedValueOnce(payload);
  render(<EmployerLearningOverview employerId="9" kind={kind} learnerId="265" />, { wrapper });
  expect(await screen.findByRole('progressbar', { name: /Training plan off/ })).toHaveAttribute('aria-valuenow', '8');
  expect(screen.queryByRole('progressbar', { name: 'Official programme completion' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Official Programme Completion|Official Planned Hours|Canonical Actual Hours|Official Target Marker|Official Variance/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open OTJ Hours' })).toHaveTextContent('84%');
  let fail!: (error: Error) => void;
  vi.mocked(fetchEmployerLearningOverview).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  act(() => { void client.invalidateQueries({ queryKey: ['employer-learning-overview'] }); });
  await waitFor(() => expect(screen.getByRole('progressbar', { name: /Training plan off/ }).querySelector('b')).toBeNull());
  expect(screen.getByRole('progressbar', { name: /Training plan off/ })).toHaveAttribute('aria-valuenow', '8');
  await act(async () => fail(new Error('Refresh denied')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh denied');
  expect(screen.queryByText('Official Planned Hours: 288h')).not.toBeInTheDocument();
  vi.mocked(fetchEmployerLearningOverview).mockResolvedValueOnce(payload);
  fireEvent.click(screen.getByRole('button', { name: 'Retry overview' }));
  await waitFor(() => expect(screen.getByRole('progressbar', { name: /Training plan off/ }).querySelector('b')).toHaveStyle({ left: '36%' }));
  expect(fetch).not.toHaveBeenCalled();
});

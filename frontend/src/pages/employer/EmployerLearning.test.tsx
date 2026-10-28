import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchEmployerLearningOverview, fetchEmployerTraining } from '@/api/employerPortal';
import { dashboardOverviewFixture } from '@/test/dashboardOverviewFixture';
import { OverviewCharts } from '@/pages/workspace/learner/OverviewCharts';
import { dashboardOtjhProgress } from '@/pages/workspace/learner/dashboardOtjhProgress';
import { timelineModuleForDisplay, type DashboardTrainingPayload } from '@/api/dashboardTraining';
import { EmployerLearningOverview, EmployerTrainingPlan } from './EmployerLearning';

vi.mock("@/hooks/useAuth.helpers", () => ({ useAuth: () => ({ auth: { account: { id: 'employer-account' } } }) }));
vi.mock('@/api/employerPortal', () => ({ fetchEmployerLearningOverview: vi.fn(), fetchEmployerTraining: vi.fn() }));

let client: QueryClient;
beforeEach(() => {
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

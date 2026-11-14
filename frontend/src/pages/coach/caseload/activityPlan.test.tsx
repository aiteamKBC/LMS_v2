import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachCaseloadContent } from './page';
import { clearDashboardLearnerPageCache } from '@/features/coach/dashboard/api/dashboardApi';

const { get, identity } = vi.hoisted(() => ({ get: vi.fn(), identity: { email: 'coach@example.invalid' } }));
vi.mock('@/lib/sharedGetJson', () => ({ fetchSharedJsonGet: get }));
vi.mock('@/lib/coachViewAs', () => ({ withCoachViewAs: (url: string) => url }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { email: 'coach@example.invalid' } }, isInitialized: true }) }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: identity.email, name: 'Coach', isInitialized: true }) }));

const row = { id: '7', name: 'Synthetic learner', initials: 'SL', programme: 'Programme', programmeStatus: 'Active',
  activities: { completed: 9, total: 9, progress: 100 },
  otjh: { completed: 12, targetToDate: 15, planned: 100, progress: 80, ragStatus: 'on-track' },
  attendance: { rate: 100 }, startDate: null, lastActivity: { date: null }, lastPr: null, lastMcm: null };
const plan = { learnerId: '7', activityPlan: { completed: 3, total: 12, percent: 25 } };
function Destination() { return <output data-testid="destination">{JSON.stringify(useLocation().state)}</output>; }
function Page() { return <MemoryRouter><CoachCaseloadContent embedded dashboard /><Destination /></MemoryRouter>; }

beforeEach(() => { get.mockReset(); identity.email = 'coach@example.invalid'; clearDashboardLearnerPageCache(); });
afterEach(() => vi.restoreAllMocks());

describe('Dashboard plan activities versus completion records', () => {
  it('receives the distinct plan with the table, keeps records visible, and sends the same plan to View Profile', async () => {
    get.mockResolvedValueOnce({ results: [{ ...row, activities: { completed: 8, total: 8, progress: 100 },
      completedRecords: 9, activityPlan: plan.activityPlan, activityPlanState: 'ready' }] });
    render(<Page />);
    expect(await screen.findByText('9 completed records')).toBeVisible();
    expect(screen.queryByLabelText('Preparing activity plan for Synthetic learner')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Activities: 100%')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Plan activities: 25%')).toBeVisible();
    expect(screen.getByText('3 / 12 plan activities')).toBeVisible();
    expect(screen.getByText('9 completed records')).toBeVisible();
    expect(screen.getByLabelText('OTJH: 80%')).toHaveTextContent('12h / 15h');
    fireEvent.click(screen.getByRole('button', { name: 'View Profile' }));
    expect(JSON.parse(screen.getByTestId('destination').textContent || '{}').activitySnapshot)
      .toEqual({ learnerId: '7', completed: 3, total: 12, percent: 25 });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('offers an explicit retry without hiding the recorded completions or caching a failure', async () => {
    get.mockResolvedValueOnce({ results: [{ ...row, activityPlanState: 'unavailable' }] })
      .mockResolvedValueOnce({ results: [{ ...row, activityPlan: plan.activityPlan, activityPlanState: 'ready' }] });
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry activity plan for Synthetic learner' }));
    expect(await screen.findByText('3 / 12 plan activities')).toBeVisible();
    expect(screen.getByText('9 completed records')).toBeVisible();
    expect(get.mock.calls.filter(([url]) => url.endsWith('/learners'))).toHaveLength(2);
  });

  it.each([{ completed: 0, total: 12, percent: 0 }, { completed: 0, total: 0, percent: null }])(
    'keeps real zero/empty plans distinct from an unavailable plan: %o', async activityPlan => {
      get.mockResolvedValueOnce({ results: [{ ...row, activityPlan, activityPlanState: 'ready' }] });
      render(<Page />);
      expect(await screen.findByText(`0 / ${activityPlan.total} plan activities`)).toBeVisible();
      expect(screen.getByLabelText(`Plan activities: ${activityPlan.percent === null ? 'not available' : '0%'}`)).toBeVisible();
      expect(screen.getByText('9 completed records')).toBeVisible();
      expect(screen.queryByRole('button', { name: /Retry activity/ })).not.toBeInTheDocument();
    });

  it('reuses the successful owner-scoped plan on remount', async () => {
    get.mockResolvedValueOnce({ results: [{ ...row, activityPlan: plan.activityPlan, activityPlanState: 'ready' }] });
    const first = render(<Page />);
    expect(await screen.findByText('3 / 12 plan activities')).toBeVisible();
    first.unmount();
    render(<Page />);
    expect(await screen.findByText('3 / 12 plan activities')).toBeVisible();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('sorts by distinct plan completion, not the number of records', async () => {
    const second = { ...row, id: '8', name: 'Another learner', activities: { completed: 1, total: 9, progress: 11.11 } };
    get.mockResolvedValueOnce({ results: [{ ...row, activityPlan: plan.activityPlan },
      { ...second, activityPlan: { completed: 9, total: 12, percent: 75 } }] });
    render(<Page />);
    await screen.findByText('3 / 12 plan activities');
    await screen.findByText('9 / 12 plan activities');
    expect(get.mock.calls.filter(([url]) => url.includes('/activity-plans?'))).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Activities' }));
    expect(screen.getAllByRole('row').slice(2).map(item => item.textContent?.includes('Synthetic learner'))).toEqual([true, false]);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Activities' }));
    expect(screen.getAllByRole('row').slice(2).map(item => item.textContent?.includes('Synthetic learner'))).toEqual([false, true]);
  });

  it('shows pending preparation without per-row requests or fabricated zeros', async () => {
    get.mockResolvedValueOnce({ results: [{ ...row, activityPlan: null, activityPlanState: 'pending' }] });
    render(<Page />);
    expect(await screen.findByLabelText('Preparing activity plan for Synthetic learner')).toBeVisible();
    expect(screen.getByText('9 completed records')).toBeVisible();
    expect(get).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('0 / 0 plan activities')).not.toBeInTheDocument();
  });

  it('keeps the last successful counts visible while a refresh is pending', async () => {
    get.mockResolvedValueOnce({ results: [{ ...row, activityPlan: plan.activityPlan,
      activityPlanState: 'updating', activityPlanCalculatedAt: '2026-11-13T12:00:00Z' }] });
    render(<Page />);
    expect(await screen.findByText('3 / 12 plan activities')).toBeVisible();
    expect(screen.getByText('Updating…')).toBeVisible();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('refreshes all rows together, retains counts on failure, and recovers on the next poll', async () => {
    const intervals = vi.spyOn(window, 'setInterval');
    get.mockResolvedValueOnce({ results: [{ ...row, activityPlan: plan.activityPlan, activityPlanState: 'ready' }] })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ results: [{ ...row, activityPlan: { completed: 4, total: 12, percent: 33 }, activityPlanState: 'ready' }] });
    render(<Page />);
    await screen.findByText('3 / 12 plan activities');
    const tick = intervals.mock.calls.find(([, delay]) => delay === 15000)?.[0] as () => void;
    await act(async () => tick());
    expect(screen.getByText('3 / 12 plan activities')).toBeVisible();
    expect(screen.getByText('Update delayed')).toBeVisible();
    await act(async () => tick());
    expect(screen.getByText('4 / 12 plan activities')).toBeVisible();
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls.every(([url]) => url.endsWith('/learners'))).toBe(true);
  });

  it('does not overlap the first load or a pending poll, and ignores the previous coach response', async () => {
    const intervals = vi.spyOn(window, 'setInterval');
    let first!: (value: unknown) => void;
    let oldCoach!: (value: unknown) => void;
    get.mockReturnValueOnce(new Promise(resolve => { first = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { oldCoach = resolve; }))
      .mockResolvedValueOnce({ results: [{ ...row, name: 'Another coach learner', activityPlan: { completed: 1, total: 5, percent: 20 } }] });
    const view = render(<Page />);
    const tick = intervals.mock.calls.find(([, delay]) => delay === 15000)?.[0] as () => void;
    await act(async () => tick());
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => first({ results: [{ ...row, activityPlan: plan.activityPlan }] }));
    await act(async () => { tick(); tick(); });
    expect(get).toHaveBeenCalledTimes(2);
    const previousSignal = get.mock.calls[1][1].signal;
    identity.email = 'another-coach@example.invalid';
    view.rerender(<Page />);
    expect(await screen.findByText('1 / 5 plan activities')).toBeVisible();
    expect(previousSignal.aborted).toBe(true);
    await act(async () => oldCoach({ results: [{ ...row, activityPlan: plan.activityPlan }] }));
    expect(screen.queryByText('3 / 12 plan activities')).not.toBeInTheDocument();
    expect(screen.getByText('Another coach learner')).toBeVisible();
    view.unmount();
    await act(async () => tick());
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('skips polling while the tab is hidden and refreshes when it becomes visible', async () => {
    const intervals = vi.spyOn(window, 'setInterval');
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    get.mockResolvedValue({ results: [{ ...row, activityPlan: plan.activityPlan }] });
    render(<Page />);
    await screen.findByText('3 / 12 plan activities');
    const tick = intervals.mock.calls.find(([, delay]) => delay === 15000)?.[0] as () => void;
    visibility.mockReturnValue('hidden');
    await act(async () => tick());
    expect(get).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(get).toHaveBeenCalledTimes(2);
  });
});

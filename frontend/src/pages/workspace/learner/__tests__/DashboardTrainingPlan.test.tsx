import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import type { OverviewWeek } from '@/api/learnerOverview';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { DashboardTrainingPlan } from '../DashboardTrainingPlan';
import { useDashboardPlan } from '../useDashboardPlan';

const week = (): OverviewWeek => ({
  weekStart: '2026-09-07', weekEnd: '2026-09-13', timezone: 'Europe/London', undatedActivities: 0,
  expectedHours: 5, missingExpectedHours: 0, deadlines: [],
  otjh: { actual: 2, historical: 0, new: 2, undatedHistoricalRows: 0 },
  modules: [{ id: 'current:M1', title: 'Marketing', weekLabels: ['Week 1'], completed: 1, total: 2, percent: 50, ksbCodes: ['K1'], ksbMappingMissing: false }],
  metrics: { migrated: false, programme: { completed: 1, total: 2, percent: 50, status: 'ready' },
    ksb: { completed: 1, total: 1, percent: 100, status: 'ready' },
    otjh: { historical: 0, new: 2, actual: 2, planned: 5 } },
  planSubjects: [{ id: 'current:M1', title: 'Marketing', source: 'current', completed: 1, total: 2,
    dates: ['2026-09-07'], moduleIds: ['M1'], sessionTitles: [], activityCounts: { reading: 2 }, ksbCodes: ['K1'], ksbMappingMissing: false }],
});
const schedule = (): TrainingPlanDashboard => ({
  months: {}, actual: [], actualAvailable: true, modules: [], moduleLinks: {}, sessions: [],
  reviews: [{ id: 'coach', eventKey: 'mcr:1', title: 'Monthly Coaching', sequence: 1, source: 'mcr', date: '2026-09-25',
    targetDate: '2026-09-25', scheduledDate: null, scheduledTime: null, durationMinutes: 60, status: 'not-scheduled', coachName: 'Assigned Coach', invited: false }],
  coach: { name: 'Assigned Coach', bookingUrl: null }, contractStatus: 'ready', generatedAt: '',
});
function setup(calendar = schedule(), failed = '', overview = week()) {
  const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = String(input);
    if (failed && url.includes(failed)) return new Response(JSON.stringify({ error: 'Offline' }), { status: 503 });
    if (url.includes('rewards-summary')) return new Response(JSON.stringify({ points: { learnerId: '125', earned: 350, committed: 100, balance: 250 }, rewards: [] }));
    if (url.includes('/monthly-logs/125/')) return new Response(JSON.stringify({
      learner: { id: 125, aptem_id: null, name: 'Learner', programme: 'Programme', coach_name: '' }, months: [],
    }));
    return new Response(JSON.stringify(url.includes('overview-week') ? overview
      : url.includes('section=contract') ? { months: calendar.months, contractStatus: calendar.contractStatus } : calendar));
  });
  vi.stubGlobal('fetch', fetch);
  function Subject() {
    const plan = useDashboardPlan('commercial', '125');
    return <DashboardTrainingPlan kind="commercial" learnerId="125" plan={plan} />;
  }
  render(<MemoryRouter><Subject /></MemoryRouter>);
  return fetch;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-12T10:00:00Z')); clearAllCachedResources(); });
afterEach(() => { cleanup(); clearAllCachedResources(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('dashboard learning layout', () => {
  it('fills the monthly summary from authored hours and current learner progress without Aptem history', async () => {
    const overview = { ...week(), monthlyOtjh: {
      '2026-09': { planned: 5, actual: 2, missingPlannedActivities: 0 },
    } };
    const calendar = { ...schedule(), actualAvailable: false };
    setup(calendar, '', overview);
    const panel = await screen.findByRole('region', { name: 'Monthly study plan' });
    for (const [label, value] of [['Required hours', '5'], ['Achieved hours', '2'], ['Difference', '-3']]) {
      expect(within(panel).getByText(label).nextElementSibling).toHaveTextContent(`${value} hrs`);
    }
  });

  it('places monthly focus next to weekly learning and keeps the timeline beside its overview', async () => {
    setup();
    const monthly = await screen.findByRole('region', { name: 'Monthly study plan' });
    const weekly = screen.getByRole('region', { name: 'Weekly learning plan' });
    expect(weekly.parentElement).toBe(monthly.parentElement);
    expect(screen.queryByRole('region', { name: 'Upcoming' })).not.toBeInTheDocument();
    const timeline = screen.getByRole('region', { name: 'Module timeline' });
    expect(timeline.parentElement?.parentElement).toBe(screen.getByRole('region', { name: 'Module overview' }).parentElement);
    expect(screen.getByRole('region', { name: 'Module progress' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Programme module progress' })).toBeVisible();
    const rewards = screen.getByRole('region', { name: 'Rewards and points' });
    expect(timeline.compareDocumentPosition(rewards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(monthly.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a retry without fabricating a weekly plan when the schedule cannot load', async () => {
    setup(schedule(), 'training-plan-dashboard');
    expect(await screen.findByRole('alert')).toHaveTextContent('Your monthly learning could not refresh. Offline');
    expect(await screen.findByRole('button', { name: 'Retry monthly learning' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Weekly learning plan' })).not.toBeInTheDocument();
  });

  it('refreshes monthly reviews while preserving the selected module and month filters', async () => {
    const calendar = schedule();
    const fetch = setup(calendar);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Focus module' }), { target: { value: 'current:M1' } });
    const panel = within(screen.getByRole('region', { name: 'Reviews this month' }));
    expect(panel.getByRole('button', { name: 'Schedule' })).toBeVisible();
    Object.assign(calendar.reviews[0], { status: 'scheduled', scheduledDate: '2026-09-28', scheduledTime: '14:00' });
    await act(async () => { invalidateLearnerReads(); });
    expect(panel.getByText('Booking pending')).toBeVisible();
    expect(panel.getByText('28 Sept')).toBeVisible();
    expect(panel.getByText(/14:00.*UK time/)).toBeVisible();
    Object.assign(calendar.reviews[0], { scheduledDate: '2026-09-20', scheduledTime: '10:30', invited: true });
    await act(async () => { invalidateLearnerReads(); });
    expect(panel.getByText('Booked')).toBeVisible();
    expect(panel.getByText('20 Sept')).toBeVisible();
    expect(panel.getByText(/10:30.*UK time/)).toBeVisible();
    expect(panel.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Focus module' })).toHaveValue('current:M1');
    expect(screen.getByLabelText('Focus month')).toHaveValue('2026-09');
    Object.assign(calendar.reviews[0], { status: 'cancelled' });
    await act(async () => { invalidateLearnerReads(); });
    expect(panel.queryByRole('article')).not.toBeInTheDocument();
    expect(panel.getByText('No reviews planned for this month.')).toBeVisible();
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('section=overview')).length).toBeGreaterThanOrEqual(4);
  });
});

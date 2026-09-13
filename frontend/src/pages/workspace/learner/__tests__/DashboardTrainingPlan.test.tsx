import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import type { OverviewWeek } from '@/api/learnerOverview';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { DashboardTrainingPlan } from '../DashboardTrainingPlan';

const week = (): OverviewWeek => ({
  weekStart: '2026-09-07', weekEnd: '2026-09-13', timezone: 'Europe/London', undatedActivities: 0,
  expectedHours: 5, missingExpectedHours: 0, deadlines: [],
  otjh: { actual: 2, historical: 0, new: 2, undatedHistoricalRows: 0 },
  modules: [{ id: 'current:M1', title: 'Marketing', weekLabels: ['Week 1'], completed: 1, total: 2, percent: 50, ksbCodes: ['K1'], ksbMappingMissing: false }],
  planSubjects: [{ id: 'current:M1', title: 'Marketing', source: 'current', completed: 1, total: 2,
    dates: ['2026-09-07'], moduleIds: ['M1'], sessionTitles: [], activityCounts: { reading: 2 }, ksbCodes: ['K1'], ksbMappingMissing: false }],
});
const schedule = (): TrainingPlanDashboard => ({
  months: {}, actual: [], actualAvailable: true, modules: [], moduleLinks: {}, sessions: [],
  reviews: [{ id: 'coach', eventKey: 'mcr:1', title: 'Monthly Coaching', sequence: 1, source: 'mcr', date: '2026-09-25',
    targetDate: '2026-09-25', scheduledDate: null, scheduledTime: null, durationMinutes: 60, status: 'not-scheduled', coachName: 'Assigned Coach', invited: false }],
  coach: { name: 'Assigned Coach', bookingUrl: null }, contractStatus: 'ready', generatedAt: '',
});
function setup(calendar = schedule(), failed = '') {
  const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = String(input);
    if (failed && url.includes(failed)) return new Response(JSON.stringify({ error: 'Offline' }), { status: 503 });
    if (url.includes('rewards-summary')) return new Response(JSON.stringify({ points: { learnerId: '125', earned: 350, committed: 100, balance: 250 }, rewards: [] }));
    return new Response(JSON.stringify(url.includes('overview-week') ? week()
      : url.includes('section=contract') ? { months: calendar.months, contractStatus: calendar.contractStatus } : calendar));
  });
  vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter><DashboardTrainingPlan kind="commercial" learnerId="125" /></MemoryRouter>);
  return fetch;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-12T10:00:00Z')); clearAllCachedResources(); });
afterEach(() => { cleanup(); clearAllCachedResources(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('dashboard learning layout', () => {
  it('places the combined card next to weekly learning and keeps the timeline beside its overview', async () => {
    setup();
    const combined = await screen.findByRole('region', { name: 'Live sessions and programme reviews' });
    const weekly = screen.getByRole('region', { name: 'This week' });
    expect(weekly.parentElement?.parentElement).toBe(combined.parentElement);
    expect(screen.queryByRole('region', { name: 'Upcoming' })).not.toBeInTheDocument();
    const timeline = screen.getByRole('region', { name: 'Module timeline' });
    expect(timeline.parentElement?.parentElement).toBe(screen.getByRole('region', { name: 'Module overview' }).parentElement);
    expect(screen.getByRole('region', { name: 'Module progress' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Programme module progress' })).toBeVisible();
    const rewards = screen.getByRole('region', { name: 'Rewards and points' });
    expect(timeline.compareDocumentPosition(rewards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(combined.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('retains weekly learning when the training plan cannot load', async () => {
    setup(schedule(), 'training-plan-dashboard');
    expect(await screen.findByRole('progressbar', { name: "This week's activity progress" })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('button', { name: 'Retry monthly learning' })).toBeVisible();
  });

  it('refreshes bookings and cancellations in Reviews while preserving the selected tab and filters', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const calendar = schedule();
    const fetch = setup(calendar);
    fireEvent.click(await screen.findByRole('tab', { name: 'Reviews' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Focus module' }), { target: { value: 'current:M1' } });
    const panel = within(screen.getByRole('region', { name: 'Programme reviews' }));
    expect(panel.getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/learner/calendar?kind=commercial&learner=125&event=mcr%3A1&action=schedule');
    Object.assign(calendar.reviews[0], { status: 'scheduled', scheduledDate: '2026-09-28', scheduledTime: '14:00' });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(panel.getByText('Booking pending')).toBeVisible();
    expect(panel.getByText(/28 Sept.*14:00/)).toBeVisible();
    Object.assign(calendar.reviews[0], { scheduledDate: '2026-09-20', scheduledTime: '10:30', invited: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(panel.getByText('Booked')).toBeVisible();
    expect(panel.getByText(/20 Sept.*10:30/)).toBeVisible();
    expect(panel.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Focus module' })).toHaveValue('current:M1');
    expect(screen.getByLabelText('Focus month')).toHaveValue('2026-09');
    expect(screen.getByRole('tab', { name: 'Reviews' })).toHaveAttribute('aria-selected', 'true');
    Object.assign(calendar.reviews[0], { status: 'cancelled' });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(panel.queryByRole('article')).not.toBeInTheDocument();
    expect(panel.getByText('Your reviews will appear here once planned.')).toBeVisible();
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('section=overview')).length).toBeGreaterThanOrEqual(4);
  });
});

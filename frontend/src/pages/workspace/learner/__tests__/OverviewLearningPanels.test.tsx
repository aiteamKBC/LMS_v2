import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import type { OverviewWeek } from '@/api/learnerOverview';
import type { PlanSession, TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { OverviewLearningPanels } from '../OverviewLearningPanels';

const fixture = (): OverviewWeek => ({ weekStart: '2026-09-07', weekEnd: '2026-09-13', timezone: 'Europe/London', undatedActivities: 0, expectedHours: 7.5, missingExpectedHours: 0,
  modules: [{ id: 'current:M1', title: 'Managing Change', weekLabels: ['Week 6'], completed: 2, total: 4, percent: 50, ksbCodes: ['K6', 'S7'], ksbMappingMissing: false },
    { id: 'legacy:2', title: 'Project planning', weekLabels: ['Week 7'], completed: 0, total: 2, percent: 0, ksbCodes: [], ksbMappingMissing: true }],
  deadlines: [], otjh: { actual: 2.5, historical: 1.5, new: 1, undatedHistoricalRows: 0 } });
const schedule: Pick<TrainingPlanDashboard, 'moduleLinks' | 'sessions' | 'reviews'> = { moduleLinks: {}, sessions: [], reviews: [{ id: 'coach', eventKey: 'mcr:1', title: 'Monthly Coaching', sequence: 1, source: 'mcr', date: '2026-09-25', targetDate: '2026-09-25', scheduledDate: null, scheduledTime: null, durationMinutes: 60, status: 'not-scheduled', coachName: 'Assigned Coach', invited: false }] };
function setup({ week = fixture(), failed = '', calendar = schedule } = {}) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (failed && url.includes(failed)) return new Response(JSON.stringify({ error: 'Offline' }), { status: 503 });
    return new Response(JSON.stringify(url.includes('overview-week') ? week : calendar));
  });
  vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter><OverviewLearningPanels kind="commercial" learnerId="125" /></MemoryRouter>);
  return fetch;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-12T10:00:00Z')); clearAllCachedResources(); });
afterEach(() => { cleanup(); clearAllCachedResources(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('overview learning panels', () => {
  it('connects weekly progress, KSBs, hours and the correct module destination', async () => {
    setup();
    const select = await screen.findByRole('combobox', { name: 'Module' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('K6, S7')).toBeVisible();
    expect(screen.getByText('7.5h', { exact: false })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open learning activities' })).toHaveAttribute('href', '/learner/modules/commercial/125?subject=current%3AM1');
    fireEvent.change(select, { target: { value: 'legacy:2' } });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('Some activity mappings are missing')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open learning activities' })).toHaveAttribute('href', '/learner/modules/commercial/125?subject=legacy%3A2');
  });
  it('labels target dates as to book and opens the actual calendar event', async () => {
    setup();
    const upcoming = within(screen.getByRole('region', { name: 'Upcoming' }));
    expect(await upcoming.findByText('To book')).toBeVisible();
    expect(upcoming.getByRole('link', { name: /Monthly Coaching/ })).toHaveAttribute('href', '/learner/calendar?kind=commercial&learner=125&event=mcr%3A1');
  });
  it('retains weekly learning when the independent calendar fails', async () => {
    setup({ failed: 'training-plan-dashboard' });
    expect(await screen.findByText('Your calendar could not refresh.')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
  it('polls coaching bookings, rescheduled dates, owners and cancellations without a reload', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const calendar = { ...schedule, reviews: schedule.reviews.map(review => ({ ...review })) };
    const fetch = setup({ calendar });
    const upcoming = within(screen.getByRole('region', { name: 'Upcoming' }));
    const event = () => upcoming.getByRole('link', { name: /Monthly Coaching/ });
    await upcoming.findByText('To book');
    expect(event()).toHaveTextContent('25 Sept 2026');
    expect(event()).not.toHaveTextContent('14:00');

    // Another browser books the generated target; the stored date takes over.
    Object.assign(calendar.reviews[0], { status: 'scheduled', scheduledDate: '2026-09-28', scheduledTime: '14:00' });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(event()).toHaveTextContent('Booking pending');
    expect(event()).toHaveTextContent('28 Sept 2026');
    expect(event()).toHaveTextContent('14:00');
    expect(upcoming.queryByText('25 Sept 2026')).not.toBeInTheDocument();

    // A confirmed reschedule replaces the previous booking, preserving its link.
    Object.assign(calendar.reviews[0], { scheduledDate: '2026-09-20', scheduledTime: '10:30', invited: true, coachName: 'New Coach' });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(event()).toHaveTextContent('Booked');
    expect(event()).toHaveTextContent('20 Sept 2026');
    expect(event()).toHaveTextContent('10:30');
    expect(event()).toHaveTextContent('With New Coach');
    expect(event()).toHaveAttribute('href', '/learner/calendar?kind=commercial&learner=125&event=mcr%3A1');
    expect(upcoming.getAllByRole('link', { name: /Monthly Coaching/ })).toHaveLength(1);

    Object.assign(calendar.reviews[0], { status: 'cancelled', scheduledDate: null, scheduledTime: null, invited: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(upcoming.queryByRole('link', { name: /Monthly Coaching/ })).not.toBeInTheDocument();
    expect(upcoming.getByText('No upcoming dates yet')).toBeVisible();

    // A completed event must not return as an unbooked target either.
    Object.assign(calendar.reviews[0], { status: 'completed', scheduledDate: '2026-09-20', invited: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(upcoming.queryByRole('link', { name: /Monthly Coaching/ })).not.toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('training-plan-dashboard'))).toHaveLength(5);
  });
  it('never invents activities or weekly targets when sources are empty', async () => {
    setup({ week: { ...fixture(), modules: [], expectedHours: null } });
    expect(await screen.findByText('No activities scheduled this week')).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open learning activities' })).toHaveAttribute('href', '/learner/modules/commercial/125');
  });
  it('refreshes changed data after an LMS save without hiding the existing panel', async () => {
    const week = fixture();
    setup({ week });
    await screen.findByRole('progressbar');
    week.modules[0] = { ...week.modules[0], completed: 3, percent: 75 };
    await act(async () => { invalidateLearnerReads(); });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
    expect(screen.queryByText('Loading this week\'s activities…')).not.toBeInTheDocument();
  });
  it('defaults to the newest module rather than the first weekly or alphabetical module', async () => {
    setup({ week: { ...fixture(), latestModuleId: 'legacy:2' } });
    expect(await screen.findByRole('combobox', { name: 'Module' })).toHaveValue('legacy:2');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
  it('switches to a newly assigned module even after the learner selected an older one', async () => {
    const week: OverviewWeek = { ...fixture(), latestModuleId: 'legacy:2' };
    setup({ week });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Module' }), { target: { value: 'current:M1' } });
    week.modules.push({ id: 'current:NEW', title: 'Newest assigned module', moduleIds: ['NEW'], weekLabels: [], completed: 0, total: 0, percent: null, ksbCodes: [], ksbMappingMissing: false });
    week.latestModuleId = 'current:NEW';
    await act(async () => { invalidateLearnerReads(); });
    expect(screen.getByRole('combobox', { name: 'Module' })).toHaveValue('current:NEW');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open learning activities' })).toHaveAttribute('href', '/learner/modules/commercial/125?subject=current%3ANEW');
  });
  it('shows newly scheduled sessions from the latest module without requiring weekly activities', async () => {
    const week: OverviewWeek = { ...fixture(), latestModuleId: 'current:NEW', modules: [{ id: 'current:NEW', title: 'Newest assigned module', moduleIds: ['NEW'], weekLabels: [], completed: 0, total: 0, percent: null, ksbCodes: [], ksbMappingMissing: false }] };
    const session = (id: string, moduleId: string, title: string) => ({ id, moduleId, title, start: '2026-09-13T13:00:00Z', end: null, minutes: 60, status: 'scheduled', joinUrl: null, attended: null });
    const calendar = { ...schedule, sessions: [session('old', 'M1', 'Old module live session')] };
    setup({ week, calendar });
    expect(await screen.findByText('Not scheduled')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Old module live session/ })).not.toBeInTheDocument();
    calendar.sessions.push(session('new', 'NEW', 'Newest module live session'));
    await act(async () => { invalidateLearnerReads(); });
    expect(within(screen.getByRole('region', { name: 'This week' })).getByText('13 Sept 2026 · 14:00')).toBeVisible();
    expect(screen.getByRole('link', { name: /Newest module live session/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Old module live session/ })).not.toBeInTheDocument();
  });
  it('automatically picks up a new assigned module and its later content through polling alone', async () => {
    // A staff member works in another browser: no local save/invalidation event
    // reaches this learner's tab. The normal 30-second refresh must be enough.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const week: OverviewWeek = { ...fixture(), latestModuleId: 'current:M1' };
    const calendar = { ...schedule, sessions: [{ id: 'old-session', moduleId: 'M1', title: 'Old module session',
      start: '2026-09-13T13:00:00Z', end: null, minutes: 60, status: 'scheduled', joinUrl: null, attended: null }] as PlanSession[] };
    const fetch = setup({ week, calendar });
    await screen.findByRole('combobox', { name: 'Module' });
    await screen.findByText('To book');

    // The module is created and assigned before its activities or meeting exist.
    week.latestModuleId = 'current:NEW';
    week.modules.push({ id: 'current:NEW', title: 'Newly created module', moduleIds: ['NEW'], weekLabels: [],
      completed: 0, total: 0, percent: null, ksbCodes: [], ksbMappingMissing: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole('combobox', { name: 'Module' })).toHaveValue('current:NEW');
    expect(screen.getByRole('link', { name: 'Open learning activities' })).toHaveAttribute('href', '/learner/modules/commercial/125?subject=current%3ANEW');
    expect(screen.getByText('Not scheduled')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Old module session/ })).not.toBeInTheDocument();

    // Staff then publish dated activities, expected hours, KSBs and a session.
    Object.assign(week.modules[2], { weekLabels: ['New module week 1'], completed: 1, total: 2, percent: 50, ksbCodes: ['K99', 'S99'] });
    week.expectedHours = 5;
    week.otjh.actual = 2;
    calendar.sessions.push({ ...calendar.sessions[0], id: 'new-session', moduleId: 'NEW', title: 'New module session' });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const panel = within(screen.getByRole('region', { name: 'This week' }));
    expect(panel.getByText('New module week 1')).toBeVisible();
    expect(panel.getByText('K99, S99')).toBeVisible();
    expect(panel.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(panel.getByText('OTJH this week').parentElement).toHaveTextContent('2h / 5h');
    expect(panel.getByText('13 Sept 2026 · 14:00')).toBeVisible();
    expect(screen.getByRole('link', { name: /New module session/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Old module session/ })).not.toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('overview-week'))).toHaveLength(3);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('training-plan-dashboard'))).toHaveLength(3);
  });
});

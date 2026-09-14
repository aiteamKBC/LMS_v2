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
  const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
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
  it('leaves coaching to the combined monthly card', async () => {
    setup();
    await screen.findByRole('progressbar');
    expect(screen.queryByRole('region', { name: 'Upcoming' })).not.toBeInTheDocument();
  });
  it('retains weekly learning when the independent calendar fails', async () => {
    setup({ failed: 'training-plan-dashboard' });
    expect(await screen.findByText('Your live sessions could not refresh.')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
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
  it('excludes assigned placeholders without current-week activities', async () => {
    const week = fixture();
    week.modules.unshift({ id: 'current:FUTURE', title: 'Future module', moduleIds: ['FUTURE'], weekLabels: [], completed: 0, total: 0, percent: null, ksbCodes: [], ksbMappingMissing: false });
    setup({ week });
    expect(await screen.findByRole('combobox', { name: 'Module' })).toHaveValue('current:M1');
    expect(screen.queryByRole('option', { name: 'Future module' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
  it('keeps an empty week empty when the response contains a future placeholder', async () => {
    setup({ week: { ...fixture(), modules: [{ id: 'current:FUTURE', title: 'Future module', weekLabels: [], completed: 0, total: 0, percent: null, ksbCodes: [], ksbMappingMissing: false }] } });
    expect(await screen.findByText('No activities scheduled this week')).toBeVisible();
    expect(screen.queryByText('Future module')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open learning activities' })).toHaveAttribute('href', '/learner/modules/commercial/125');
  });
  it('preserves the selected weekly module when another module is scheduled this week', async () => {
    const week = fixture();
    setup({ week });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Module' }), { target: { value: 'legacy:2' } });
    week.modules.unshift({ ...week.modules[0], id: 'current:NEW', title: 'Another weekly module', moduleIds: ['NEW'] });
    await act(async () => { invalidateLearnerReads(); });
    expect(screen.getByRole('combobox', { name: 'Module' })).toHaveValue('legacy:2');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
  it('falls back to a remaining weekly module when the selected one is rescheduled', async () => {
    const week = fixture();
    setup({ week });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Module' }), { target: { value: 'legacy:2' } });
    week.modules = [week.modules[0]];
    await act(async () => { invalidateLearnerReads(); });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('Project planning')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open learning activities' })).toHaveAttribute('href', '/learner/modules/commercial/125?subject=current%3AM1');
  });
  it('advances the week on polling even with unfinished activities and resets the selection', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-09-13T22:59:45Z'));
    const week = fixture();
    const fetch = setup({ week });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Module' }), { target: { value: 'legacy:2' } });
    expect(screen.getByText('0 of 2 activities complete')).toBeVisible();
    Object.assign(week, { weekStart: '2026-09-14', weekEnd: '2026-09-20', modules: [
      { ...week.modules[0], id: 'current:NEXT', title: 'Next week module', weekLabels: ['Week 8'], completed: 0, percent: 0 },
      { ...week.modules[1], weekLabels: ['Week 8'], total: 3 },
    ] });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole('combobox', { name: 'Module' })).toHaveValue('current:NEXT');
    expect(screen.getByText(/14 Sept 2026.*20 Sept 2026/)).toBeVisible();
    expect(screen.queryByRole('option', { name: 'Managing Change' })).not.toBeInTheDocument();
    expect(screen.queryByText('0 of 2 activities complete')).not.toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('overview-week'))).toHaveLength(2);
  });
  it('refreshes weekly content and scopes live sessions to the selected weekly module', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const week = fixture();
    const calendar = { ...schedule, moduleLinks: { 'legacy:2': { id: 'M2', title: 'Project planning' } }, sessions: [
      { id: 'first-session', moduleId: 'M1', title: 'First module session', start: '2026-09-13T13:00:00Z', end: null, minutes: 60, status: 'scheduled', joinUrl: null, attended: null },
      { id: 'selected-session', moduleId: 'M2', title: 'Selected module session', start: '2026-09-13T14:00:00Z', end: null, minutes: 60, status: 'scheduled', joinUrl: null, attended: null },
    ] as PlanSession[] };
    const fetch = setup({ week, calendar });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Module' }), { target: { value: 'legacy:2' } });
    expect(screen.getByText('Live session').parentElement).toHaveTextContent(/13 Sept 2026.*15:00/);
    Object.assign(week.modules[1], { completed: 1, percent: 50, ksbCodes: ['K99', 'S99'], ksbMappingMissing: false });
    week.expectedHours = 5;
    week.otjh.actual = 2;
    calendar.sessions[1].start = '2026-09-13T15:00:00Z';
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const panel = within(screen.getByRole('region', { name: 'This week' }));
    expect(panel.getByRole('combobox')).toHaveValue('legacy:2');
    expect(panel.getByText('K99, S99')).toBeVisible();
    expect(panel.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(panel.getByText('OTJH this week').parentElement).toHaveTextContent('2h / 5h');
    expect(panel.getByText(/13 Sept 2026.*16:00/)).toBeVisible();
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('overview-week'))).toHaveLength(2);
  });
});

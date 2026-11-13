import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CurriculumDeliveryHub, CurriculumLibraryHub, CurriculumQualityHub } from '../page';

const state = vi.hoisted(() => ({ data: null as Record<string, unknown> | null, loading: false, error: null as string | null }));
const sessionRead = vi.hoisted(() => ({ sessions: [] as Array<Record<string, unknown>>, undatedSessionCount: undefined as number | undefined, loading: false, error: null as string | null }));
const moduleRead = vi.hoisted(() => ({ data: null as Record<string, unknown> | null, loading: false, error: '', today: '2026-11-13' }));
const readers = vi.hoisted(() => ({ sessions: vi.fn(), modules: vi.fn(), programmes: vi.fn(), overview: vi.fn(), curriculum: vi.fn() }));

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useCurriculumData', () => ({ useCurriculumData: readers.curriculum }));
vi.mock('../useDeliveryData', async importOriginal => ({
  ...await importOriginal<typeof import('../useDeliveryData')>(), useDeliveryOverview: readers.overview,
}));
vi.mock('@/hooks/useCurriculumProgrammes', () => ({ useCurriculumProgrammes: readers.programmes }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { id: -1, role: 'staff', access: 'curriculum' }, tenant: null } }) }));
vi.mock('../useDeliverySessions', () => ({ useDeliverySessions: readers.sessions }));
vi.mock('../../module-builder/useCatalogueActivity', async importOriginal => ({
  ...await importOriginal<typeof import('../../module-builder/useCatalogueActivity')>(), useCatalogueActivity: readers.modules,
}));

function renderDelivery() { return render(<MemoryRouter><CurriculumDeliveryHub /></MemoryRouter>); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
  readers.sessions.mockReset().mockImplementation(() => sessionRead);
  readers.modules.mockReset().mockImplementation(() => moduleRead);
  readers.programmes.mockReset().mockReturnValue({ programmes: [], loading: false, error: null });
  readers.overview.mockReset().mockImplementation(() => state);
  readers.curriculum.mockReset().mockImplementation(() => state);
  Object.assign(state, { loading: false, error: null, data: {
    cohorts: [{ id: 'c1', status: 'active' }, { id: 'c2', status: 'planned' }],
    groups: [{ id: 'g1', status: 'planned', moduleIds: ['m1'], cohortId: 'c1', coach: 'Example coach' }, { id: 'g2', status: 'planned', moduleIds: ['m1'], cohortId: 'c1', coach: 'TBC' }, { id: 'g3', status: 'active', moduleIds: ['m2'], cohortId: 'c2', coach: '' }],
    modules: [{ id: 'm1', tutor: 'Example tutor', status: 'draft' }, { id: 'm2', tutor: 'unassigned', status: 'published' }, { id: 'm3', tutor: 'Example tutor' }, { id: 'm4', tutor: 'Example tutor' }],
    // The compact overview omits sessions. The dashboard must use the actual calendar read.
    sessions: [],
  } });
  Object.assign(sessionRead, { loading: false, error: null, undatedSessionCount: undefined, sessions: [
    { id: 's1', type: 'Live Session', date: '2026-11-09', startTime: '09:00', status: 'completed' },
    { id: 's2', type: 'Live Session', date: '2026-11-10', startTime: '09:00' },
    { id: 's3', type: 'Live Session', date: '2026-11-12', startTime: '09:00' },
    { id: 's4', type: 'Live Session', date: '2026-11-13', startTime: '11:00' },
    { id: 's5', type: 'Live Session', date: '2026-11-13', startTime: '15:00' },
  ] });
  Object.assign(moduleRead, { loading: false, error: '', today: '2026-11-13', data: {
    m1: { source: 'new_lms', startDate: '2026-10-01', lastLiveDate: '2026-12-01' },
    m2: { source: 'new_lms', startDate: '2026-12-01', lastLiveDate: '2027-01-01' },
    m3: { source: 'new_lms', startDate: '2026-09-01', lastLiveDate: '2026-11-01' },
  } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Delivery dashboard using existing curriculum reads', () => {
  it('keeps an upcoming overnight session visible when its source-date status says completed', () => {
    vi.setSystemTime(new Date('2026-11-14T01:00:00Z'));
    moduleRead.today = '2026-11-14';
    sessionRead.sessions = [{ id: 'overnight', type: 'Live Session', date: '2026-11-13', startTime: '23:30',
      timeZone: 'America/New_York', status: 'completed', moduleCatalogueId: 'm2' }];
    renderDelivery();
    expect(screen.getAllByText(/14 Nov · 04:30 UK/)).toHaveLength(2);
    expect(screen.getByLabelText('Need tutor count')).toHaveTextContent(/^1$/);
  });

  it('shows the UK date and clock in both next-session labels and the weekly chart', () => {
    sessionRead.sessions = [{ id: 'cairo', type: 'Live Session', date: '2026-11-16', startTime: '00:30', timeZone: 'Africa/Cairo' }];
    renderDelivery();
    expect(screen.getAllByText(/15 Nov · 22:30 UK/)).toHaveLength(2);
    expect(screen.getByLabelText('Scheduled live sessions count')).toHaveTextContent('1');
    expect(screen.getByRole('img', { name: /Live sessions by day:.*15 Nov 2026: 1/ })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Session week' }), { target: { value: '1' } });
    expect(screen.getByLabelText('Scheduled live sessions count')).toHaveTextContent('0');
  });

  it('makes an invalid source time zone visible instead of labelling its clock as UK time', () => {
    sessionRead.sessions = [{ id: 'check', type: 'Live Session', date: '2026-11-13', startTime: '11:00', timeZone: 'Unknown/Zone' }];
    renderDelivery();
    expect(screen.getByText('1 live sessions need their time or time zone checked')).toBeVisible();
    expect(screen.queryByText(/13 Nov · 11:00 UK/)).not.toBeInTheDocument();
  });

  it('skips the full overview/programmes and starts live dates and activity while the small summary is loading', () => {
    state.data = null; state.loading = true;
    const view = renderDelivery();
    expect(readers.programmes).not.toHaveBeenCalled();
    expect(readers.curriculum).not.toHaveBeenCalled();
    expect(readers.sessions).toHaveBeenLastCalledWith(expect.any(String));
    expect(readers.modules).toHaveBeenLastCalledWith('delivery-dashboard', expect.any(String), { revalidateOnMount: true });
    state.loading = false; state.error = 'Overview unavailable';
    view.rerender(<MemoryRouter><CurriculumDeliveryHub /></MemoryRouter>);
    // Calendar data can still be shown independently after a failed overview.
    expect(readers.sessions).toHaveBeenLastCalledWith(expect.any(String));
  });

  it('gives delayed reads visible feedback and retry actions without hiding loaded charts', () => {
    const retry = vi.fn(); const retrySessions = vi.fn();
    Object.assign(state, { reload: retry }); Object.assign(sessionRead, { loading: true, reload: retrySessions });
    const view = renderDelivery();
    expect(screen.getByLabelText('Active groups count')).toHaveTextContent(/^2$/);
    expect(screen.getByLabelText('Need coach count')).toHaveTextContent(/^1$/);
    act(() => vi.advanceTimersByTime(5_001));
    expect(screen.getByText(/Live session dates are taking longer than usual/)).toBeVisible();
    expect(screen.getByLabelText('Active cohorts count')).toHaveTextContent(/^1$/);
    Object.assign(sessionRead, { loading: false, error: 'Example session read failed' });
    state.error = 'Example overview read failed';
    view.rerender(<MemoryRouter><CurriculumDeliveryHub /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Retry live sessions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retrySessions).toHaveBeenCalledOnce(); expect(retry).toHaveBeenCalledOnce();
  });

  it('uses the existing module activity rule and dedicated live-session dates rather than compact overview zeros', () => {
    renderDelivery();
    expect(screen.getByLabelText('Active cohorts count')).toHaveTextContent(/^1$/);
    expect(screen.getByLabelText('Active groups count')).toHaveTextContent(/^2$/);
    // Editable group statuses say the opposite: teaching module dates decide activity.
    // A currently teaching draft is active; a future published module is not.
    expect(screen.getByLabelText('Active modules count')).toHaveTextContent(/^1$/);
    expect(screen.getByLabelText('Scheduled live sessions count')).toHaveTextContent('5');
    expect(screen.getByRole('img', { name: 'Cohort status: Active 1; Planned 1; Completed 0; 2 total' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Active modules: 1 of 4 (25%)' })).toBeVisible();
    expect(screen.getByText('2 groups in active cohorts')).toBeVisible();
    expect(screen.getAllByText(/13 Nov · 11:00 UK/).length).toBeGreaterThan(0);
  });

  it('keeps all six destinations, complete descriptions and assignment warnings', () => {
    renderDelivery();
    const destinations = screen.getByRole('region', { name: 'Choose what you want to do' });
    expect(within(destinations).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/curriculum/cohorts', '/curriculum/groups', '/curriculum/module-builder', '/curriculum/teams-meetings', '/curriculum/england-holidays', '/curriculum/session-calendar',
    ]);
    expect(within(destinations).getByText('2 cohorts')).toBeVisible();
    expect(within(destinations).getByText('4 modules')).toBeVisible();
    expect(within(destinations).getByText('5 sessions')).toBeVisible();
    expect(within(destinations).getByText(/One non-delivery calendar: GOV.UK bank holidays/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Cohorts' })).toHaveAttribute('href', '/curriculum/cohorts');
    expect(screen.getByRole('link', { name: 'Groups without a coach: 2' })).toHaveAttribute('href', '/curriculum/groups');
    expect(screen.getByRole('link', { name: 'Modules without a tutor: 1' })).toHaveAttribute('href', '/curriculum/module-builder');
  });

  it('separates active delivery metrics from urgent staffing needs inside the upper activity card', () => {
    (state.data.modules as Array<Record<string, unknown>>)[0].tutor = '';
    sessionRead.sessions.push({ id: 'soon-m2', type: 'Live Session', date: '2026-11-20', moduleCatalogueId: 'm2' });
    renderDelivery();
    const activity = screen.getByRole('article', { name: 'Delivery activity' });
    expect(within(activity).getByLabelText('Active modules count')).toHaveTextContent(/^1$/);
    expect(within(activity).getByLabelText('Active groups count')).toHaveTextContent(/^2$/);
    const staffing = within(activity).getByRole('group', { name: 'Staffing to complete' });
    expect(within(staffing).getByLabelText('Need tutor count')).toHaveTextContent(/^2$/);
    expect(within(staffing).getByLabelText('Need coach count')).toHaveTextContent(/^1$/);
    expect(within(staffing).getByRole('link', { name: 'Need tutor: 2' })).toHaveAttribute('href', '/curriculum/module-builder');
    expect(within(staffing).getByRole('link', { name: 'Need coach: 1' })).toHaveAttribute('href', '/curriculum/groups');
    expect(within(screen.getByRole('region', { name: 'Choose what you want to do' })).getAllByRole('link')).toHaveLength(6);
  });

  it('switches the selected week without another API read or any calendar write', () => {
    sessionRead.sessions.push({ id: 'next-week', type: 'Live Session', date: '2026-11-16', startTime: '12:00' });
    renderDelivery();
    expect(screen.getByLabelText('Scheduled live sessions count')).toHaveTextContent('5');
    fireEvent.change(screen.getByLabelText('Session week'), { target: { value: '1' } });
    expect(screen.getByLabelText('Scheduled live sessions count')).toHaveTextContent(/^1next week$/);
    expect(screen.getByRole('img', { name: /^Live sessions by day: 16 Nov 2026: 1; 17 Nov 2026: 0;/ })).toBeVisible();
    expect(screen.getByText('6 sessions')).toBeVisible();
  });

  it('excludes cancelled sessions and other content, deduplicating only repeated session identities', () => {
    sessionRead.sessions.push(
      { id: 's4', type: 'Live Session', date: '2026-11-13', startTime: '11:00' },
      { id: 'cancelled', type: 'Live Session', date: '2026-11-13', status: 'cancelled' },
      { id: 'quiz', type: 'Quiz', date: '2026-11-13' },
    );
    renderDelivery();
    expect(screen.getByLabelText('Scheduled live sessions count')).toHaveTextContent('5');
    expect(screen.getByText('5 sessions')).toBeVisible();
    expect(screen.getByRole('img', { name: /13 Nov 2026: 2;/ })).toBeVisible();
  });

  it('shows the server undated count without adding it to scheduled totals or week bars', () => {
    sessionRead.undatedSessionCount = 2;
    renderDelivery();
    expect(screen.getByText('2 live sessions without a valid date')).toBeVisible();
    expect(screen.getByLabelText('Scheduled live sessions count')).toHaveTextContent('5');
    expect(screen.getByText('5 sessions')).toBeVisible();
    expect(screen.getByRole('img', { name: /13 Nov 2026: 2;/ })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Session week'), { target: { value: '1' } });
    expect(screen.getByLabelText('Scheduled live sessions count')).toHaveTextContent(/^0next week$/);
    expect(screen.getByText('2 live sessions without a valid date')).toBeVisible();
  });

  it('keeps the undated warning when there are no scheduled rows and a background refresh fails', () => {
    sessionRead.sessions = [];
    sessionRead.undatedSessionCount = 3;
    sessionRead.error = 'Example refresh failure';
    renderDelivery();
    expect(screen.getByRole('alert')).toHaveTextContent('Example refresh failure');
    expect(screen.getByText('3 live sessions without a valid date')).toBeVisible();
  });

  it('shows undated records even when the scheduled calendar is empty', () => {
    sessionRead.sessions = [];
    sessionRead.undatedSessionCount = 2;
    renderDelivery();
    expect(screen.getByText('2 live sessions without a valid date')).toBeVisible();
    expect(screen.getByLabelText('Scheduled live sessions count')).toHaveTextContent(/^0this week$/);
    expect(screen.getByText('0 sessions')).toBeVisible();
    expect(screen.getByRole('img', { name: /^Live sessions by day: 9 Nov 2026: 0;/ })).toBeVisible();
  });

  it('keeps navigation while loading without presenting zero counts or assignment success', () => {
    state.data = null; state.loading = true; sessionRead.sessions = []; sessionRead.loading = true;
    renderDelivery();
    expect(screen.getByText('Loading delivery figures.')).toBeInTheDocument();
    expect(screen.getByText('Loading live sessions.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Delivery numbers' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();
    expect(screen.queryByText('0 cohorts')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toContain('/curriculum/teams-meetings');
  });

  it('makes a failed initial session read unavailable while retaining known cohort and module counts', () => {
    sessionRead.sessions = []; sessionRead.error = 'Example service unavailable';
    renderDelivery();
    expect(screen.getByRole('alert')).toHaveTextContent('Example service unavailable');
    expect(screen.getByLabelText('Scheduled live sessions count')).toHaveTextContent('Unavailable');
    expect(screen.getByLabelText('Active cohorts count')).toHaveTextContent(/^1$/);
    expect(screen.getByLabelText('Active modules count')).toHaveTextContent(/^1$/);
    expect(screen.queryByText('0 sessions')).not.toBeInTheDocument();
  });

  it('preserves cached live dates alongside a refresh failure', () => {
    sessionRead.error = 'Example refresh failure';
    renderDelivery();
    expect(screen.getByRole('alert')).toHaveTextContent('Example refresh failure');
    expect(screen.getByLabelText('Scheduled live sessions count')).toHaveTextContent('5');
    expect(screen.getByRole('img', { name: /^Live sessions by day:/ })).toBeVisible();
  });

  it('does not treat unverified module activity as zero', () => {
    moduleRead.data = null; moduleRead.error = 'Module activity could not be verified.';
    renderDelivery();
    expect(screen.getByLabelText('Active modules count')).toHaveTextContent('Unavailable');
    expect(screen.getByLabelText('Active groups count')).toHaveTextContent('Unavailable');
    expect(screen.getByRole('status')).toHaveTextContent('Module activity could not be verified.');
  });

  it('retains every cohort status and counts canonical modules once', () => {
    (state.data.cohorts as unknown[]).push({ id: 'c3', status: 'completed' }, { id: 'c4', status: 'archived' });
    (state.data.modules as unknown[]).push({ id: 'allocation-copy', moduleCatalogueId: 'm1', tutor: 'Example tutor' });
    renderDelivery();
    expect(screen.getByRole('img', { name: 'Cohort status: Active 1; Planned 1; Completed 1; Other 1; 4 total' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Active modules: 1 of 4 (25%)' })).toBeVisible();
  });

  it('treats a successful empty response as valid zero data and keeps a dated empty weekly chart', () => {
    state.data = { cohorts: [], groups: [], modules: [], sessions: [] }; sessionRead.sessions = [];
    renderDelivery();
    expect(screen.getByLabelText('Active cohorts count')).toHaveTextContent(/^0$/);
    expect(screen.getAllByText('Clear')).toHaveLength(3);
    expect(screen.getByText('No upcoming live sessions scheduled.')).toBeVisible();
    expect(screen.getByRole('img', { name: /^Live sessions by day: 9 Nov 2026: 0;/ })).toBeVisible();
    expect(screen.queryByText(/NaN|Unavailable/)).not.toBeInTheDocument();
  });

  it('does not run Delivery data readers on Library or Quality', () => {
    const library = render(<MemoryRouter><CurriculumLibraryHub /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Week Templates/ })).toHaveAttribute('href', '/curriculum/week-builder');
    library.unmount();
    render(<MemoryRouter><CurriculumQualityHub /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /^Quality Forms/ })).toHaveAttribute('href', '/curriculum/quality/forms');
    expect(readers.sessions).not.toHaveBeenCalled(); expect(readers.modules).not.toHaveBeenCalled();
  });
});

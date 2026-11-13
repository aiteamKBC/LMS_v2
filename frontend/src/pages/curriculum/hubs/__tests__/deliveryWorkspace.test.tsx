import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CurriculumDeliveryHub, CurriculumLibraryHub, CurriculumQualityHub } from '../page';

const state = vi.hoisted(() => ({ data: null as Record<string, unknown> | null, loading: false, error: null as string | null }));
const sessionRead = vi.hoisted(() => ({ sessions: [] as Array<Record<string, unknown>>, loading: false, error: null as string | null }));
const moduleRead = vi.hoisted(() => ({ data: null as Record<string, unknown> | null, loading: false, error: '', today: '2026-11-13' }));
const readers = vi.hoisted(() => ({ sessions: vi.fn(), modules: vi.fn(), programmes: vi.fn() }));

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useCurriculumData', () => ({ useCurriculumData: () => state }));
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
  Object.assign(state, { loading: false, error: null, data: {
    cohorts: [{ id: 'c1', status: 'active' }, { id: 'c2', status: 'planned' }],
    groups: [{ id: 'g1', status: 'active', cohortId: 'c1', coach: 'Example coach' }, { id: 'g2', status: 'active', cohortId: 'c1', coach: 'TBC' }, { id: 'g3', status: 'planned', cohortId: 'c2', coach: '' }],
    modules: [{ id: 'm1', tutor: 'Example tutor', status: 'draft' }, { id: 'm2', tutor: 'unassigned', status: 'published' }, { id: 'm3', tutor: 'Example tutor' }, { id: 'm4', tutor: 'Example tutor' }],
    // The compact overview omits sessions. The dashboard must use the actual calendar read.
    sessions: [],
  } });
  Object.assign(sessionRead, { loading: false, error: null, sessions: [
    { id: 's1', type: 'Live Session', date: '2026-11-09', startTime: '09:00', status: 'completed' },
    { id: 's2', type: 'Live Session', date: '2026-11-10', startTime: '09:00' },
    { id: 's3', type: 'Live Session', date: '2026-11-12', startTime: '09:00' },
    { id: 's4', type: 'Live Session', date: '2026-11-13', startTime: '11:00' },
    { id: 's5', type: 'Live Session', date: '2026-11-13', startTime: '15:00' },
  ] });
  Object.assign(moduleRead, { loading: false, error: '', data: {
    m1: { source: 'new_lms', startDate: '2026-10-01', lastLiveDate: '2026-12-01' },
    m2: { source: 'new_lms', startDate: '2026-12-01', lastLiveDate: '2027-01-01' },
    m3: { source: 'new_lms', startDate: '2026-09-01', lastLiveDate: '2026-11-01' },
  } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Delivery dashboard using existing curriculum reads', () => {
  it('skips unused programme data and stages the calendar read until the overview settles', () => {
    state.data = null; state.loading = true;
    const view = renderDelivery();
    expect(readers.programmes).not.toHaveBeenCalled();
    expect(readers.sessions).toHaveBeenLastCalledWith(false, expect.any(String));
    state.loading = false; state.error = 'Overview unavailable';
    view.rerender(<MemoryRouter><CurriculumDeliveryHub /></MemoryRouter>);
    // Calendar data can still be shown independently after a failed overview.
    expect(readers.sessions).toHaveBeenLastCalledWith(true, expect.any(String));
  });

  it('uses the existing module activity rule and dedicated live-session dates rather than compact overview zeros', () => {
    renderDelivery();
    expect(screen.getByLabelText('Active cohorts count')).toHaveTextContent(/^1$/);
    expect(screen.getByLabelText('Active groups count')).toHaveTextContent(/^2$/);
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
    expect(screen.getByLabelText('Active groups count')).toHaveTextContent(/^2$/);
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

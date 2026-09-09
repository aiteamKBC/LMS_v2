import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import OldOtjhPage from './page';
import { OldOtjhProvider } from './hooks';
import { getMonitoring, type MonitoringData, type MonitoredLearner } from './monitoringApi';
import { getContentReview, getMonth, getSummary, startReview, type MonthDetail, type Summary } from './api';
import { homeRouteFor, mayAccessRoute } from '@/lib/routeAccess';

const viewer = { id: 100, subjectId: 70, role: 'staff' as const, access: 'record-monitor', displayName: 'Record monitor' };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: viewer }, isInitialized: true }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./monitoringApi', () => ({ getMonitoring: vi.fn() }));
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(),
  getContentReview: vi.fn(), getSummary: vi.fn(), getMonth: vi.fn(), startReview: vi.fn() }));

const learner: MonitoredLearner = {
  enrolment_id: 1, id: 42, name: 'Example learner', email: 'learner@example.org', programme: 'Example programme',
  enrolment_status: 'Delivery', audit_status: 'Active', coach_name: 'Example coach', coach_email: 'coach@example.org',
  status: 'awaiting_both', needs_start: false, can_open: true, can_access_lms: false,
  total_months: 3, completed_months: 1, remaining_months: 2, learner_signed_months: 2, coach_signed_months: 1,
  learner_unsigned_months: 1, coach_unsigned_months: 2, pending_revisions: 0, ready_months: 0,
  empty_months: 0, activity_count: 12, additional_months: 0, first_outstanding_month: '2026-07', last_signed_at: null,
};
const fixture: MonitoringData = {
  stats: Object.fromEntries(['total_learners', 'completed', 'learner_outstanding', 'coach_outstanding',
    'not_started', 'needs_attention', 'total_months', 'completed_months', 'remaining_months', 'learner_signed',
    'coach_signed', 'ready_to_complete', 'activity_count', 'pending_revisions'].map(key => [key, key === 'total_learners' ? 31 : 0])),
  learners: [learner], total: 31, page: 1, page_size: 25, pages: 2,
  coaches: [{ key: 'coach@example.org', name: 'Example coach', learners: 31, completed: 0, outstanding_signatures: 10 }],
  programmes: ['Example programme'], monthly: [], updated_at: '2026-09-08T10:00:00Z', cutoff_date: '2026-08-31', scope: 'Active enrolled', read_only: true,
};
const detail: MonthDetail = { month: '2026-07', status: 'needs_review', row_count: 1, planned_hours: 1, actual_hours: 1,
  not_accepted_hours: 0, student_signature: null, coach_signature: null, pending_revisions: 0,
  can_complete: false, source_finalization: null, rows: [], snapshot_digest: 'v1' };
const summary: Summary = { is_legacy: true, state: 'in_progress', can_access_lms: false, needs_start: true, read_only: true,
  total_months: 1, completed_months: 0, months: [detail],
  learner: { id: 1, aptem_id: 42, name: learner.name, programme: learner.programme, coach_name: 'Example coach' } };

function page(path = '/old-otjh/monitor') {
  return render(<OldOtjhProvider><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/old-otjh/monitor" element={<OldOtjhPage />} />
    <Route path="/old-otjh/coach/:aptemId" element={<OldOtjhPage />} />
    <Route path="/old-otjh/coach/:aptemId/months/:month" element={<OldOtjhPage />} />
  </Routes></MemoryRouter></OldOtjhProvider>);
}
beforeEach(() => {
  vi.mocked(getMonitoring).mockResolvedValue(structuredClone(fixture));
  vi.mocked(getSummary).mockResolvedValue(structuredClone(summary));
  vi.mocked(getMonth).mockResolvedValue(structuredClone(detail));
  vi.mocked(getContentReview).mockResolvedValue({ ready: true, snapshot_digest: 'v1', issues: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('record monitoring', () => {
  it('lands monitoring accounts on the dashboard and rejects other workspaces', () => {
    expect(homeRouteFor(viewer)).toBe('/old-otjh/monitor');
    expect(mayAccessRoute('/workspace/admin', viewer)).toBe(false);
    expect(mayAccessRoute('/users', viewer)).toBe(false);
    expect(mayAccessRoute('/old-otjh/coach/42/months/2026-07', viewer)).toBe(true);
    expect(mayAccessRoute('/old-otjh/monitor', { role: 'learner' })).toBe(false);
    expect(mayAccessRoute('/old-otjh/monitor', { role: 'staff', access: 'coach' })).toBe(false);
  });
  it('shows separate signing progress and links to the selected learner', async () => {
    page();
    const table = await screen.findByRole('table', { name: 'Active learner records' });
    expect(within(table).getByText('2 / 3')).toBeInTheDocument();
    expect(within(table).getByText('1 / 3')).toBeInTheDocument();
    expect(within(table).getByText('Enrolment: Delivery')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Open record for Example learner' })).toHaveAttribute('href', '/old-otjh/coach/42');
  });
  it('searches across the cohort and resets pagination', async () => {
    page('/old-otjh/monitor?page=2');
    await screen.findByText('Example learner');
    fireEvent.change(screen.getByLabelText('Search learners'), { target: { value: 'learner@example.org' } });
    await waitFor(() => expect(getMonitoring).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'learner@example.org', page: 1 }), expect.any(AbortSignal)));
  });
  it('filters through cards and coach follow-up', async () => {
    page();
    await screen.findByText('Example learner');
    fireEvent.click(screen.getByRole('button', { name: /Awaiting learner.*unsigned month/ }));
    await waitFor(() => expect(getMonitoring).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'learner_outstanding' }), expect.any(AbortSignal)));
    fireEvent.click(screen.getByRole('button', { name: 'Filter by coach Example coach' }));
    await waitFor(() => expect(getMonitoring).toHaveBeenLastCalledWith(expect.objectContaining({ coach: 'coach@example.org' }), expect.any(AbortSignal)));
  });
  it('loads the next page', async () => {
    page();
    const next = await screen.findByRole('button', { name: 'Next' });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await waitFor(() => expect(getMonitoring).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.any(AbortSignal)));
  });
  it('shows errors and supports retry', async () => {
    vi.mocked(getMonitoring).mockRejectedValueOnce(new Error('Records temporarily unavailable'));
    page();
    expect(await screen.findByRole('alert')).toHaveTextContent('Records temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Example learner')).toBeInTheDocument();
  });
  it('explains empty filtered results and clears the filters', async () => {
    vi.mocked(getMonitoring).mockResolvedValueOnce({ ...fixture, learners: [], total: 0 });
    page('/old-otjh/monitor?search=nobody');
    expect(await screen.findByText('No learners match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(await screen.findByText('Example learner')).toBeInTheDocument();
  });
  it('opens an unstarted month with no mutation or signing controls', async () => {
    page('/old-otjh/coach/42/months/2026-07');
    await screen.findByRole('table', { name: 'Report sign-off' });
    expect(startReview).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Sign as|Complete month|Reopen month/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Viewing only/)).toBeInTheDocument();
    expect(getMonth).toHaveBeenCalledWith('2026-07', 42);
  });
  it('shows the learner name on an unstarted record without starting it', async () => {
    page('/old-otjh/coach/42');
    await screen.findByRole('heading', { name: learner.name });
    expect(startReview).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Review month' })).toHaveAttribute('href', '/old-otjh/coach/42/months/2026-07');
  });
});

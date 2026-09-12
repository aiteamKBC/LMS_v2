import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import MonthlyLogsPage from './page';
import { getLogContent, getLogLearners, getLogMonth, getLogSummary, signLogMonth, type LogDetail, type LogSummary } from './api';
import { learnerNavItems, coachNavItems } from '@/mocks/navigation';
import { rememberLearner } from '@/hooks/useMyLearner';

const account = { id: 1, role: 'learner', subjectId: 7, displayName: 'Example learner', access: 'learner' };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account } }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children, role }: { children: ReactNode; role: string }) => <div data-testid="workspace" data-role={role}>{children}</div> }));
vi.mock('@/features/old-otjh/JournalDownloads', () => ({ JournalDownloads: () => <button>Download PDF</button> }));
vi.mock('@/features/old-otjh/SignatureCapture', () => ({ SignatureCapture: ({ dialogRole, onDraftStart, onSave }: {
  dialogRole: string; onDraftStart: () => void; onSave: (blob: Blob, capture: 'draw') => void;
}) => <button onClick={() => { onDraftStart(); onSave(new Blob(['signature']), 'draw'); }}>Sign as {dialogRole}</button> }));
vi.mock('./api', () => ({ getLogContent: vi.fn(), getLogLearners: vi.fn(), getLogMonth: vi.fn(), getLogSummary: vi.fn(), signLogMonth: vi.fn() }));

const current: LogDetail = { source: 'lms', month: '2026-09', status: 'awaiting_signature', row_count: 1,
  planned_hours: 2, actual_hours: 1, not_accepted_hours: 0, pending_revisions: 0, can_complete: false,
  source_finalization: null, student_signature: null, coach_signature: null, snapshot_digest: 'reviewed-digest',
  rows: [{ id: 44, title: 'Completed reading', category: 'Reading', activity_date: '2026-09-12', activity_time: '10:00',
    timestamp_label: '10:00', planned_hours: 2, actual_hours: 1, accepted: true, completion_note: 'Saved reflection', documents: [], results: [] }] };
const retained: LogDetail = { ...current, source: 'legacy', month: '2026-08', status: 'complete',
  student_signature: { url: '/saved-learner.png', signer_name: 'Example learner', signed_at: '2026-09-01' },
  coach_signature: { url: '/saved-coach.png', signer_name: 'Coach', signed_at: '2026-09-01' } };
const summary: LogSummary = { learner: { id: 7, aptem_id: 42, name: 'Example learner', programme: 'Programme', coach_name: 'Coach' },
  months: [current, retained], total_months: 2, completed_months: 1, read_only: false, csrf_token: 'csrf' };

function page(path = '/learner/monthly-logs') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/learner/monthly-logs" element={<MonthlyLogsPage />} />
    <Route path="/learner/monthly-logs/:month" element={<MonthlyLogsPage />} />
    <Route path="/learner/monthly-logs/:kind/:id" element={<MonthlyLogsPage />} />
    <Route path="/learner/monthly-logs/:kind/:id/:month" element={<MonthlyLogsPage />} />
    <Route path="/learner/monthly-cycle/:kind/:id" element={<MonthlyLogsPage />} />
    <Route path="/coach/monthly-logs" element={<MonthlyLogsPage />} />
    <Route path="/coach/monthly-logs/:learnerId" element={<MonthlyLogsPage />} />
    <Route path="/coach/monthly-logs/:learnerId/:month" element={<MonthlyLogsPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return { ...view, client };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  Object.assign(account, { role: 'learner', subjectId: 7, access: 'learner' });
  vi.mocked(getLogSummary).mockResolvedValue(summary);
  vi.mocked(getLogMonth).mockImplementation(async (_id, month) => month === '2026-08' ? retained : current);
  vi.mocked(getLogContent).mockResolvedValue({ id: 44, parts: [{ id: 44, title: 'Original material', category: 'Reading',
    url: 'https://example.org/reading', html: null, quiz: null }] });
});
afterEach(cleanup);

describe('monthly logs', () => {
  it('replaces both learner cards and gives coaches a monthly logs destination', () => {
    const learnerItems = learnerNavItems.flatMap(item => [item, ...(item.children || [])]);
    expect(learnerItems.filter(item => item.label === 'Monthly Logs')).toHaveLength(1);
    expect(learnerItems.some(item => ['Monthly Cycle', 'Monthly submission'].includes(item.label))).toBe(false);
    expect(coachNavItems.flatMap(item => item.children || [item]).find(item => item.label === 'Monthly Logs')?.href).toBe('/coach/monthly-logs');
  });

  it('lists retained months and new activities under the signed-in learner', async () => {
    page();
    expect(await screen.findByText('September 2026')).toBeInTheDocument();
    expect(screen.getByText('August 2026')).toBeInTheDocument();
    expect(getLogSummary).toHaveBeenCalledWith('7', expect.any(AbortSignal), 'learner');
    expect(screen.getAllByRole('link', { name: /Review month/ }).map(link => link.getAttribute('href')))
      .toEqual(['/learner/monthly-logs/2026-08', '/learner/monthly-logs/2026-09']);
  });

  it('filters the year and unsigned learner months while keeping historical reports reachable', async () => {
    const earlier = { ...retained, month: '2025-05', coach_signature: null };
    vi.mocked(getLogSummary).mockResolvedValue({ ...summary, months: [current, retained, earlier] });
    page();
    await screen.findByText('May 2025');
    fireEvent.click(screen.getByRole('button', { name: /Awaiting signature/ }));
    expect(screen.queryByText('May 2025')).not.toBeInTheDocument();
    expect(screen.queryByText('August 2026')).not.toBeInTheDocument();
    expect(screen.getByText('September 2026')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by year' }), { target: { value: '2025' } });
    expect(screen.getByText('All signatures saved for 2025')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View all months' }));
    expect(screen.getByRole('link', { name: 'Review month: May 2025' })).toHaveAttribute('href', '/learner/monthly-logs/2025-05');
  });

  it('filters missing coach signatures independently of learner completion', async () => {
    Object.assign(account, { role: 'staff', access: 'coach' });
    vi.mocked(getLogSummary).mockResolvedValue({ ...summary, months: [{ ...retained, coach_signature: null }] });
    page('/coach/monthly-logs/7');
    await screen.findByText('August 2026');
    fireEvent.click(screen.getByRole('button', { name: /Awaiting signature/ }));
    expect(screen.getByRole('link', { name: 'Review month: August 2026' })).toHaveAttribute('href', '/coach/monthly-logs/7/2026-08');
    expect(screen.getByRole('progressbar', { name: 'Coach signatures saved' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('keeps the selected learner and learner workspace when staff use the learner navigation card', async () => {
    Object.assign(account, { role: 'admin', subjectId: 99, access: 'super-admin' });
    rememberLearner('apprenticeship', '7');
    page();
    expect(await screen.findByText('August 2026')).toBeInTheDocument();
    expect(screen.getByTestId('workspace')).toHaveAttribute('data-role', 'learner');
    expect(getLogSummary).toHaveBeenCalledWith('7', expect.any(AbortSignal), 'learner');
    expect(getLogLearners).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('link', { name: /Review month/ })[0]);
    expect(await screen.findByAltText('Learner signature')).toHaveAttribute('src', '/saved-learner.png');
    expect(screen.getByRole('link', { name: /All months/ })).toHaveAttribute('href', '/learner/monthly-logs/apprenticeship/7');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => expect(getLogMonth).toHaveBeenCalledWith('7', '2026-09', expect.any(AbortSignal), 'learner'));
    expect(screen.queryByRole('button', { name: /Sign as/ })).not.toBeInTheDocument();
    expect(screen.queryByText('(you)')).not.toBeInTheDocument();
  });

  it.each(['/learner/monthly-logs/commercial/8', '/learner/monthly-cycle/commercial/8'])(
    'keeps the explicit learner in %s instead of a remembered record', async path => {
      Object.assign(account, { role: 'staff', subjectId: 99, access: 'coach' });
      rememberLearner('apprenticeship', '7');
      page(path);
      await screen.findByText('August 2026');
      expect(getLogSummary).toHaveBeenCalledWith('8', expect.any(AbortSignal), 'learner');
      expect(screen.getAllByRole('link', { name: /Review month/ })[0]).toHaveAttribute('href', '/learner/monthly-logs/commercial/8/2026-08');
      expect(getLogLearners).not.toHaveBeenCalled();
    });

  it('pins a learner account to itself even if a preview URL or remembered learner selects someone else', async () => {
    rememberLearner('commercial', '8');
    page('/learner/monthly-logs/commercial/8');
    await screen.findByText('August 2026');
    expect(getLogSummary).toHaveBeenCalledWith('7', expect.any(AbortSignal), 'learner');
    expect(getLogSummary).not.toHaveBeenCalledWith('8', expect.anything(), expect.anything());
  });

  it('keeps saved historical signatures and the original iframe preview', async () => {
    page('/learner/monthly-logs/2026-08');
    expect(await screen.findByAltText('Learner signature')).toHaveAttribute('src', '/saved-learner.png');
    expect(screen.getByAltText('Coach signature')).toHaveAttribute('src', '/saved-coach.png');
    expect(screen.queryByRole('button', { name: /Sign as/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Completed reading' }));
    await waitFor(() => expect(document.querySelector('iframe[title="Original material"]')).toHaveAttribute('src', 'https://example.org/reading'));
    expect(getLogContent).toHaveBeenCalledWith('7', '2026-08', 44, 'learner');
  });

  it.each(['att:92_2026-08-28_pmo', 'attendance:occ-8'])('opens and focuses the exact linked source %s even with duplicate titles', async sourceRef => {
    const data = { ...retained, rows: [
      { ...retained.rows[0], title: 'PMO lecture', category: 'Attendance', source_ref: 'att:other-session' },
      { ...retained.rows[0], id: 45, title: 'PMO lecture', category: 'Attendance', source_ref: sourceRef },
    ] };
    vi.mocked(getLogMonth).mockResolvedValue(data);
    vi.mocked(getLogContent).mockResolvedValue({ id: 45, parts: [{ id: 45, title: 'Original attendance source', category: 'Attendance',
      url: 'https://example.org/attendance/45', html: null, quiz: null }] });
    const { client } = page(`/learner/monthly-logs/2026-08?source=${encodeURIComponent(sourceRef)}`);
    await waitFor(() => expect(document.querySelector('iframe[title="Original attendance source"]')).toHaveAttribute('src', 'https://example.org/attendance/45'));
    expect(getLogContent).toHaveBeenCalledWith('7', '2026-08', 45, 'learner');
    expect(getLogContent).not.toHaveBeenCalledWith('7', '2026-08', 44, 'learner');
    const triggers = screen.getAllByRole('button', { name: 'PMO lecture' });
    expect(triggers[0]).toHaveAttribute('aria-expanded', 'false');
    expect(triggers[1]).toHaveAttribute('aria-expanded', 'true');
    expect(triggers[1]).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Close PMO lecture' }));
    await act(async () => { await client.invalidateQueries({ queryKey: ['monthly-logs'] }); });
    expect(triggers[1]).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('iframe')).toBeNull();
    expect(signLogMonth).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not open an unrelated source when the link is missing or ambiguous (ambiguous: %s)', async ambiguous => {
    const data = { ...retained, rows: [
      { ...retained.rows[0], source_ref: 'att:other' },
      { ...retained.rows[0], id: 45, source_ref: 'att:other' },
    ] };
    vi.mocked(getLogMonth).mockResolvedValue(data);
    page(`/learner/monthly-logs/2026-08?source=${encodeURIComponent(ambiguous ? 'att:other' : 'att:missing')}`);
    expect(await screen.findByText(ambiguous ? 'More than one record is linked to this activity. Please select the correct record below.' : 'This activity is not recorded in this month’s log.')).toBeInTheDocument();
    expect(getLogContent).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('keeps the selected learner when staff follow an attendance link', async () => {
    Object.assign(account, { role: 'admin', subjectId: 99, access: 'super-admin' });
    rememberLearner('apprenticeship', '7');
    vi.mocked(getLogMonth).mockResolvedValue({ ...retained, rows: [{ ...retained.rows[0], source_ref: 'att:learner-eight' }] });
    page('/learner/monthly-logs/commercial/8/2026-08?source=att%3Alearner-eight');
    await waitFor(() => expect(getLogContent).toHaveBeenCalledWith('8', '2026-08', 44, 'learner'));
    expect(screen.getByTestId('workspace')).toHaveAttribute('data-role', 'learner');
    expect(screen.queryByRole('button', { name: /Sign as/ })).not.toBeInTheDocument();
  });

  it('saves only the learner signature using the reviewed digest', async () => {
    vi.mocked(signLogMonth).mockResolvedValue({ ...current, student_signature: retained.student_signature, status: 'complete' });
    page('/learner/monthly-logs/2026-09');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign as learner' }));
    expect(screen.queryByRole('button', { name: 'Sign as coach' })).not.toBeInTheDocument();
    await waitFor(() => expect(signLogMonth).toHaveBeenCalledWith('7', '2026-09', 'reviewed-digest', expect.any(Blob), 'draw', 'csrf', 'learner'));
    expect(await screen.findByText('Your signature has been saved for this month.')).toBeInTheDocument();
  });

  it('lets the coach add their own signature to a learner-signed month', async () => {
    Object.assign(account, { role: 'staff', access: 'coach' });
    vi.mocked(getLogMonth).mockResolvedValue({ ...current, student_signature: retained.student_signature, status: 'complete' });
    page('/coach/monthly-logs/7/2026-09');
    expect(await screen.findByRole('button', { name: 'Sign as coach' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign as learner' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All months/ })).toHaveAttribute('href', '/coach/monthly-logs/7');
  });

  it('shows the assigned coach learner list', async () => {
    Object.assign(account, { role: 'staff', access: 'coach' });
    vi.mocked(getLogLearners).mockResolvedValue({ learners: [{ id: 7, name: 'Example learner', programme: 'Programme' }] });
    page('/coach/monthly-logs');
    expect(await screen.findByRole('link', { name: /Example learner/ })).toHaveAttribute('href', '/coach/monthly-logs/7');
    expect(getLogSummary).not.toHaveBeenCalled();
  });

  it('disables signing for the admin read-only coach view', async () => {
    Object.assign(account, { role: 'staff', access: 'super-admin' });
    vi.mocked(getLogSummary).mockResolvedValue({ ...summary, read_only: true });
    page('/coach/monthly-logs/7/2026-09');
    await screen.findByRole('table', { name: 'Report sign-off' });
    expect(screen.queryByRole('button', { name: /Sign as/ })).not.toBeInTheDocument();
  });

  it('shows a useful empty state for a learner without historical or new activity', async () => {
    vi.mocked(getLogSummary).mockResolvedValue({ ...summary, months: [], total_months: 0, completed_months: 0 });
    page();
    expect(await screen.findByText('No monthly logs yet')).toBeInTheDocument();
  });
});

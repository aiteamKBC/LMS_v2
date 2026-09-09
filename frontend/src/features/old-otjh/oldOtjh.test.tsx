import { fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import OldOtjhPage from './page';
import { OldOtjhGate, OldOtjhProvider } from './hooks';
import { completeMonth, getActivityContent, getContentReview, getMonth, getSummary, startReview, type MonthDetail, type Summary } from './api';
import { homeRouteFor } from '@/lib/routeAccess';

const signedIn = { id: 1, role: 'learner' as 'learner' | 'staff', subjectId: 7, subjectType: 'learner',
  hasLegacyRecord: true, displayName: 'Test student', email: 'student@example.org' };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: signedIn, user: { fullName: 'Test student' } }, isInitialized: true }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/feature/Skeletons', () => ({ PageSkeleton: () => <div role="status">Loading record</div> }));
vi.mock('./SignatureCapture', () => ({ SignatureCapture: ({ busy }: { busy: boolean }) => <fieldset disabled={busy}><legend>Signature capture</legend></fieldset> }));
vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(),
  getSummary: vi.fn(), getMonth: vi.fn(), getActivityContent: vi.fn(), getContentReview: vi.fn(), startReview: vi.fn(), completeMonth: vi.fn() }));

const month: MonthDetail = {
  month: '2026-08', status: 'needs_review', row_count: 1, planned_hours: 2, actual_hours: 1,
  not_accepted_hours: 0, student_signature: null, coach_signature: null, pending_revisions: 0,
  can_complete: false, source_finalization: null, snapshot_digest: 'digest',
  rows: [{ id: 4, category: 'video', title: 'Original learning activity', activity_date: '2026-08-10',
    activity_time: null, planned_hours: 2, actual_hours: 1, timestamp_label: '10:00–11:00',
    completion_note: 'Notes from the source record', accepted: true, documents: [], results: [] }],
};
const initial: Summary = {
  is_legacy: true, state: 'in_progress', can_access_lms: false, needs_start: false,
  learner: { id: 7, aptem_id: 42, name: 'Test student', programme: 'Programme', coach_name: 'Test coach' },
  total_months: 2, completed_months: 1, months: [{ ...month, month: '2026-07', status: 'complete' }, month],
};
function page(path = '/old-otjh') {
  return render(<OldOtjhProvider><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/old-otjh" element={<OldOtjhPage />} />
    <Route path="/old-otjh/months" element={<OldOtjhPage />} />
    <Route path="/old-otjh/months/:month" element={<OldOtjhPage />} />
    <Route path="/old-otjh/coach/:aptemId/months/:month" element={<OldOtjhPage />} />
    <Route path="/workspace/learner" element={<div>New LMS content</div>} />
  </Routes></MemoryRouter></OldOtjhProvider>);
}

beforeEach(() => { signedIn.role = 'learner'; vi.mocked(getSummary).mockResolvedValue(structuredClone(initial)); vi.mocked(getMonth).mockResolvedValue(structuredClone(month));
  vi.mocked(getContentReview).mockResolvedValue({ ready: true, issues: [], snapshot_digest: 'digest' });
  vi.mocked(getActivityContent).mockResolvedValue({ id: 4, parts: [] }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('previous learning portal', () => {
  it('pauses signing and completion when a required learning material is missing', async () => {
    vi.mocked(getContentReview).mockResolvedValue({ ready: false, snapshot_digest: 'digest', issues: [
      { id: 4, title: 'Missing source video', category: 'video', reason: 'Original material is unavailable.' },
    ] });
    vi.mocked(getMonth).mockResolvedValue({ ...month, can_complete: true });
    page('/old-otjh/months/2026-08');
    expect(await screen.findByText('Missing source video')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete month' })).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Signature capture' })).toBeDisabled();
    vi.mocked(getContentReview).mockResolvedValue({ ready: true, snapshot_digest: 'digest', issues: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete month' })).toBeEnabled());
    expect(screen.getByRole('group', { name: 'Signature capture' })).toBeEnabled();
  });
  it('lands legacy accounts on the two-card portal', async () => {
    expect(homeRouteFor(signedIn)).toBe('/old-otjh');
    page();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open LMS' })).toBeEnabled());
    expect(screen.getByRole('link', { name: 'Review previous record' })).toHaveAttribute('href', '/old-otjh/months');
  });
  it('asks an incomplete student to contact their coach on LMS click', async () => {
    page(); await waitFor(() => expect(screen.getByRole('button', { name: 'Open LMS' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Open LMS' }));
    const dialog = await screen.findByRole('dialog', { name: 'Your next chapter is nearly ready' });
    expect(dialog).toHaveTextContent('1 of 2 months complete');
    expect(dialog).toHaveTextContent('1 remaining');
    expect(dialog).toHaveTextContent('Test coach');
    expect(screen.queryByText('New LMS content')).not.toBeInTheDocument();
  });
  it('opens LMS directly after all reviews and signatures are complete', async () => {
    vi.mocked(getSummary).mockResolvedValue({ ...initial, can_access_lms: true, state: 'completed', completed_months: 2 });
    page(); await waitFor(() => expect(screen.getByRole('button', { name: 'Open LMS' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Open LMS' }));
    expect(await screen.findByText('New LMS content')).toBeInTheDocument();
  });
  it('shows month statuses and calculated progress', async () => {
    page('/old-otjh/months');
    expect(await screen.findByText('August 2026')).toBeInTheDocument();
    expect(screen.getByText('Awaiting learner signature')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByRole('link', { name: 'Continue to new LMS' })).not.toBeInTheDocument();
  });
  it('shows Continue only when the server grants access', async () => {
    vi.mocked(getSummary).mockResolvedValue({ ...initial, can_access_lms: true, state: 'completed', completed_months: 2 });
    page('/old-otjh/months');
    expect(await screen.findByRole('link', { name: 'Continue to new LMS' })).toBeInTheDocument();
  });
  it('displays source activities and notes without edit controls', async () => {
    page('/old-otjh/months/2026-08');
    expect(await screen.findByRole('heading', { name: 'Original learning activity' })).toBeInTheDocument();
    expect(screen.getByText('Notes from the source record')).toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /edit|delete|add activity/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete month' })).not.toBeInTheDocument();
    expect(screen.getByText('The learner’s signature completes the record. Use Sign all months to sign once for every month.')).toBeInTheDocument();
  });
  it('opens the all-month capture inside a report even when material checks are still running', async () => {
    vi.mocked(getContentReview).mockImplementation(() => new Promise(() => {}));
    page('/old-otjh/months/2026-08');
    const button = await screen.findByRole('button', { name: 'Sign all months' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Sign all months' });
    expect(within(dialog).getByText('Signature capture')).toBeInTheDocument();
    expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument();
  });
  it('starts a review before loading a first-visit month bookmark', async () => {
    vi.mocked(getSummary).mockResolvedValue({ ...initial, needs_start: true });
    vi.mocked(startReview).mockResolvedValue(initial);
    page('/old-otjh/months/2026-08');
    await screen.findByRole('heading', { name: 'Original learning activity' });
    expect(startReview).toHaveBeenCalledOnce();
    expect(vi.mocked(startReview).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(getMonth).mock.invocationCallOrder[0]);
  });
  it('hides signing controls for a completed month', async () => {
    vi.mocked(getMonth).mockResolvedValue({ ...month, status: 'complete' });
    page('/old-otjh/months/2026-08');
    await screen.findByText('This month has been reviewed, signed and completed.');
    expect(screen.queryByText('Signature capture')).not.toBeInTheDocument();
  });
  it('shows pending revisions', async () => {
    vi.mocked(getMonth).mockResolvedValue({ ...month, pending_revisions: 2 });
    page('/old-otjh/months/2026-08');
    await screen.findByRole('heading', { name: 'Report sign-off' });
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('Signature capture').closest('fieldset')).toBeDisabled();
  });
  it('places the capture controls in the coach row when viewing as a coach', async () => {
    signedIn.role = 'staff';
    page('/old-otjh/coach/42/months/2026-08');
    await screen.findByRole('heading', { name: 'Report sign-off' });
    const table = screen.getByRole('table', { name: 'Report sign-off' });
    const coach = within(table).getByText('Coach', { exact: true }).closest('tr')!;
    const learner = within(table).getByText('Learner', { exact: true }).closest('tr')!;
    expect(within(coach).getByText('Signature capture')).toBeInTheDocument();
    expect(within(learner).queryByText('Signature capture')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete month' })).not.toBeInTheDocument();
  });
  it('loads an activity only on expansion and displays all bundle parts in the embedded viewer', async () => {
    vi.mocked(getActivityContent).mockResolvedValue({ id: 4, parts: [
      { id: 10, title: 'Reading', category: 'reading', url: 'https://drive.google.com/file/d/reading/preview', html: null, quiz: null },
      { id: 11, title: 'Audio', category: 'audio', url: 'https://example.org/audio-player', html: null, quiz: null },
    ] });
    page('/old-otjh/months/2026-08');
    const trigger = await screen.findByRole('button', { name: 'Original learning activity' });
    expect(getActivityContent).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(await screen.findByTitle('Reading')).toHaveAttribute('src', 'https://drive.google.com/file/d/reading/preview');
    fireEvent.change(screen.getByLabelText('Reading, media or document'), { target: { value: 'part-11' } });
    expect(screen.getByTitle('Audio')).toHaveAttribute('src', 'https://example.org/audio-player');
    expect(screen.queryByTitle('Reading')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close Original learning activity' }));
    expect(screen.queryByTitle('Audio')).not.toBeInTheDocument();
  });
  it('shows both cards while the record loads and keeps LMS closed', () => {
    vi.mocked(getSummary).mockImplementation(() => new Promise(() => {}));
    page();
    expect(screen.getByRole('status')).toHaveTextContent('Loading your previous record');
    expect(screen.getByRole('button', { name: 'Open LMS' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Review previous record' })).toBeInTheDocument();
    expect(screen.queryByText('New LMS content')).not.toBeInTheDocument();
  });
  it('shows an error and retry without signing the account out', async () => {
    vi.mocked(getSummary).mockRejectedValue(new Error('Please contact support.'));
    page(); expect(await screen.findByText('Please contact support.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'LMS' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review previous record' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open LMS' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please contact support.');
    expect(screen.queryByText('New LMS content')).not.toBeInTheDocument();
  });
  it('shows the empty state', async () => {
    vi.mocked(getSummary).mockResolvedValue({ ...initial, months: [], total_months: 0, completed_months: 0 });
    page('/old-otjh/months'); expect(await screen.findByText('No previous activity months are available')).toBeInTheDocument();
  });
  it('blocks a manually typed LMS route until complete', async () => {
    render(<OldOtjhProvider><MemoryRouter initialEntries={['/workspace/learner']}><Routes>
      <Route path="/workspace/learner" element={<OldOtjhGate><div>New LMS content</div></OldOtjhGate>} />
      <Route path="/old-otjh" element={<div>Choose a workspace</div>} />
    </Routes></MemoryRouter></OldOtjhProvider>);
    expect(await screen.findByText('Choose a workspace')).toBeInTheDocument();
    expect(screen.queryByText('New LMS content')).not.toBeInTheDocument();
  });
  it('refetches on a new visit instead of serving a stored activity copy', async () => {
    const first = page('/old-otjh/months/2026-08');
    await screen.findByRole('heading', { name: 'Original learning activity' }); first.unmount();
    vi.mocked(getMonth).mockResolvedValue({ ...month, rows: [{ ...month.rows[0], title: 'Updated by the other system' }] });
    page('/old-otjh/months/2026-08');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Updated by the other system' })).toBeInTheDocument());
  });

  it('opens the first outstanding month from the dialog', async () => {
    page();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open LMS' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Open LMS' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review outstanding months' }));
    expect(await screen.findByRole('table', { name: 'Monthly activity log' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an empty progress bar at zero and restores focus when closing the dialog', async () => {
    vi.mocked(getSummary).mockResolvedValue({ ...initial, completed_months: 0 });
    page();
    const trigger = screen.getByRole('button', { name: 'Open LMS' });
    await waitFor(() => expect(trigger).toBeEnabled());
    trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    const progress = within(dialog).getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '0');
    expect(progress.firstElementChild).toHaveStyle({ width: '0%' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps protected documents inside one activity row and separates acceptance from completion', async () => {
    vi.mocked(getMonth).mockResolvedValue({ ...month, rows: [{ ...month.rows[0], category: 'assignment', source_ref: 'ev:14', ksb_codes: ['K1', 'S6'],
      documents: [{ id: 3, display_name: 'Evidence.pdf', content_type: 'application/pdf', url: '/audit_api/old-otjh/documents/3/?aptem_id=42' }] }] });
    page('/old-otjh/months/2026-08');
    const table = await screen.findByRole('table', { name: 'Assignments log' });
    expect(within(table).getAllByRole('heading', { name: 'Original learning activity' })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Assignments' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Open Evidence.pdf' })).toBeEnabled();
    expect(within(table).getByText('K1')).toBeInTheDocument();
    expect(within(table).queryByText('Completed')).not.toBeInTheDocument();
  });

  it('requires confirmation before completing and opens the next outstanding month', async () => {
    const signature = { url: '/signature', signer_name: 'Signer', signed_at: '2026-09-07T12:00:00Z' };
    const ready = { ...month, month: '2026-07', student_signature: signature, coach_signature: signature, can_complete: true };
    vi.mocked(getMonth).mockImplementation(async selectedMonth => selectedMonth === '2026-07' ? ready : month);
    vi.mocked(getSummary).mockResolvedValueOnce({ ...initial, months: [ready, month], completed_months: 0 }).mockResolvedValue(initial);
    vi.mocked(completeMonth).mockResolvedValue({ ...ready, status: 'complete' });
    page('/old-otjh/months/2026-07');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete month' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Complete month' }));
    expect(completeMonth).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep reviewing' }));
    expect(completeMonth).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Complete month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm completion' }));
    await waitFor(() => expect(completeMonth).toHaveBeenCalledExactlyOnceWith('2026-07'));
    await screen.findByRole('heading', { name: 'August 2026' });
  });

  it('keeps every source row once in Attendance, Activities, Assignments order before sign-off', async () => {
    const row = month.rows[0];
    vi.mocked(getMonth).mockResolvedValue({ ...month, row_count: 4, rows: [
      { ...row, id: 1, category: 'assignment', title: 'Submitted assignment' },
      { ...row, id: 2, category: 'video', title: 'First activity' },
      { ...row, id: 3, category: 'manual', source_ref: 'att:3', title: 'Recorded attendance' },
      { ...row, id: 4, category: 'manual', title: 'Second activity' },
    ] });
    page('/old-otjh/months/2026-08');
    await screen.findByRole('heading', { name: 'Recorded attendance' });
    expect(screen.getAllByRole('table').map(table => table.getAttribute('aria-label'))).toEqual([
      'Attendance log', 'Monthly activity log', 'Assignments log', 'Report sign-off',
    ]);
    const activities = screen.getByRole('table', { name: 'Monthly activity log' });
    expect(within(activities).getAllByRole('heading').map(heading => heading.textContent)).toEqual(['First activity', 'Second activity']);
    for (const title of ['Recorded attendance', 'First activity', 'Second activity', 'Submitted assignment']) {
      expect(screen.getAllByRole('heading', { name: title })).toHaveLength(1);
    }
  });
});

import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchEmployerMonthlyLog, fetchEmployerMonthlyLogContent, fetchEmployerMonthlyLogSummary } from '@/api/employerPortal';
import type { LogDetail, LogSummary } from '@/features/monthly-logs/api';
import { EmployerMonthlyLogsTab } from './EmployerMonthlyLogsTab';

const auth = vi.hoisted(() => ({ role: 'employer', id: 9, displayName: 'Employer' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: auth } }) }));
vi.mock('@/api/employerPortal', () => ({
  fetchEmployerMonthlyLogSummary: vi.fn(), fetchEmployerMonthlyLog: vi.fn(), fetchEmployerMonthlyLogContent: vi.fn(),
}));
const report: LogDetail = {
  source: 'lms', month: '2026-09', status: 'awaiting_signature', row_count: 1,
  planned_hours: 3, actual_hours: 2, training_plan_target: 3, not_accepted_hours: 0,
  pending_revisions: 0, can_complete: true, source_finalization: null,
  student_signature: null, coach_signature: null, snapshot_digest: 'saved', locked: true,
  rows: [{ id: 44, title: 'Saved reading', category: 'Reading', activity_date: '2026-09-12', activity_time: '10:00',
    timestamp_label: '10:00', planned_hours: 3, actual_hours: 2, accepted: true, completion_note: 'Saved reflection', documents: [], results: [] }],
};
const summary: LogSummary = {
  learner: { id: 101, name: 'Lee Learner', programme: 'Marketing', coach_name: 'Coach' },
  months: [{ ...report, month: '2026-09' }, { ...report, month: '2026-08' }],
  total_months: 2, completed_months: 0, read_only: true, csrf_token: '',
  training_plan_totals: { accepted_hours: 4, planned_hours: 120 },
};
function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/employers/9/learner/commercial/101']}>
    <EmployerMonthlyLogsTab employerId="9" kind="commercial" learnerId="101" />
  </MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'employer';
  vi.mocked(fetchEmployerMonthlyLogSummary).mockResolvedValue(summary);
  vi.mocked(fetchEmployerMonthlyLog).mockImplementation(async (_employer, _kind, _id, month) => ({ ...report, month }));
  vi.mocked(fetchEmployerMonthlyLogContent).mockResolvedValue({ id: 44, parts: [{ id: 44, title: 'Saved material', category: 'Reading', html: '<p>Original lesson</p>', url: null, quiz: null }] });
});
describe('employer Monthly logs', () => {
  it('uses the learner month list and report, with month navigation and materials inside the tab', async () => {
    renderTab();
    expect(await screen.findByRole('region', { name: 'Training Plan OTJ hours' })).toHaveTextContent('120.00 h');
    expect(screen.getAllByRole('button', { name: /Review month/ }).map(button => button.textContent)).toHaveLength(2);
    expect(fetchEmployerMonthlyLogSummary).toHaveBeenCalledWith('9', 'commercial', '101', expect.any(AbortSignal));
    await userEvent.click(screen.getByRole('button', { name: 'Review month: August 2026' }));
    const table = await screen.findByRole('table', { name: 'Monthly activity log' });
    expect(table).toHaveTextContent('Saved reading');
    expect(fetchEmployerMonthlyLog).toHaveBeenCalledWith('9', 'commercial', '101', '2026-08', expect.any(AbortSignal));
    await userEvent.click(within(table).getByRole('button', { name: 'Saved reading' }));
    await waitFor(() => expect(document.querySelector('iframe[title="Saved material"]')).toHaveAttribute('srcdoc', expect.stringContaining('Original lesson')));
    expect(fetchEmployerMonthlyLogContent).toHaveBeenCalledWith('9', 'commercial', '101', '2026-08', 44);
    expect(screen.queryByRole('link', { name: 'All months' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => expect(fetchEmployerMonthlyLog).toHaveBeenCalledWith('9', 'commercial', '101', '2026-09', expect.any(AbortSignal)));
    await userEvent.click(screen.getByRole('button', { name: 'All months' }));
    expect(await screen.findByRole('button', { name: 'Review month: August 2026' })).toBeVisible();
  });
  it.each(['employer', 'admin'])('keeps the %s preview read-only and shows both sign-off roles', async role => {
    auth.role = role;
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Review month: September 2026' }));
    const signoff = await screen.findByRole('table', { name: 'Report sign-off' });
    expect(signoff).toHaveTextContent('Learner');
    expect(signoff).toHaveTextContent('Coach');
    expect(screen.queryByRole('button', { name: /Sign|Complete month|Unlock monthly log/i })).not.toBeInTheDocument();
  });
  it('shows a retry when the employer read fails', async () => {
    vi.mocked(fetchEmployerMonthlyLogSummary).mockRejectedValueOnce(new Error('Could not load records'));
    renderTab();
    expect(await screen.findByText('Could not load records')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Review month: August 2026' })).toBeVisible();
  });
});

import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LearnerComponentEntry, LearnerDetail } from '@/api/learnerDetail';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import MonthlySubmissionPage from './page';
import { defaultAssignmentMonth, groupMonthlyAssignments } from './model';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/hooks/useMyLearner', () => ({ useResolvedLearner: () => ({ kind: 'commercial', id: '125' }) }));
vi.mock('@/hooks/useLearnerDetailParam', () => ({ useLearnerDetailParam: vi.fn() }));
vi.mock('../video-watch/page', () => ({ InlineAttachmentPreview: ({ url }: { url: string }) => <div data-testid="attachment-preview" data-url={url}>Document preview</div> }));

const component = (id: string, extra: Partial<LearnerComponentEntry> = {}): LearnerComponentEntry => ({
  componentId: id, component: 'Assignment 22', type: 'assignment', moduleId: 'M1', module: 'Martech',
  week: 'Data and insight', expectedOtjh: 7, assignmentBrief: 'Explain how data informs your marketing decisions.', ...extra,
});
const real = { id: '125', name: 'Learner', components: [component('A1'), component('A2', { week: 'Digital analytics', assignmentBrief: 'Evaluate the analytics tools.' }),
  component('A3', { component: 'Next assignment' }), component('A4', { component: 'Undated assignment', assignmentBrief: null }),
  component('A1'), component('R1', { type: 'reading' })], componentProgress: [], videoProgress: [], quizAttempts: [] } as unknown as LearnerDetail;
const metadata = { covers: {}, activity_dates: {
  A1: { date: '2026-09-09', month: '2026-09', date_source: 'builder_week' },
  A2: { date: '2026-09-16', month: '2026-09', date_source: 'builder_week' },
  A3: { date: '2026-10-07', month: '2026-10', date_source: 'builder_week' },
  A4: { date: '2026-08-01', month: '2026-08', date_source: 'original_created_at' },
} };
const contract = { months: { '2026-09': { label: 'Month 4 — Martech', topics: ['Data, Insight and Analytics'], planned: 42, source: 'contract' },
  '2026-10': { label: '', topics: ['Marketing strategy'], planned: 30, source: 'contract' } }, contractStatus: 'ready' };

function mockRequests(options: { failed?: 'dates' | 'statuses' | 'contract'; statuses?: Record<string, string> } = {}) {
  const fetcher = vi.fn(async (url: string) => {
    const source = url.includes('/subject-covers/') ? 'dates' : url.includes('/training-plan-dashboard/') ? 'contract' : 'statuses';
    const data = source === 'dates' ? metadata : source === 'contract' ? contract : { statuses: [
      { activityType: 'assignment', activityId: 'A1', status: options.statuses?.A1 || 'draft' },
      { activityType: 'assignment', activityId: 'A2', status: options.statuses?.A2 || 'submitted_for_tutor_review' },
    ] };
    return { ok: options.failed !== source, json: async () => options.failed === source ? { error: 'Unavailable' } : data };
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
function mount(search = '?month=2026-09') {
  return render(<MemoryRouter initialEntries={['/learner/monthly-submission' + search]}><MonthlySubmissionPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(useLearnerDetailParam).mockReturnValue({ real, loading: false, loadError: null, isRealMode: true, refresh: vi.fn() });
  mockRequests();
});
afterEach(() => { cleanup(); clearAllCachedResources(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('groups distinct assignments by plan month, deduplicates IDs and switches the full brief', async () => {
  mount();
  const navigation = await screen.findByRole('navigation', { name: 'Assignment months' });
  expect(within(navigation).getAllByRole('button')).toHaveLength(3);
  expect(within(navigation).getAllByRole('button')[0]).toHaveTextContent('Month 4 — Martech');
  expect(within(navigation).getAllByRole('button')[0]).toHaveTextContent('2 assignments · 1 submitted');
  expect(screen.getByText('Explain how data informs your marketing decisions.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Continue assignment' })).toHaveAttribute('href', '/learner/monthly-submission/commercial/125/A1?month=2026-09');
  const info = screen.getByRole('complementary', { name: 'Assignment information' });
  expect(within(info).getByText('7 hours')).toBeVisible();
  expect(within(info).getByText('9 September 2026')).toBeVisible();
  expect(within(info).queryByText('42 hours')).toBeNull();
  const rows = screen.getByRole('region', { name: 'Assignments for Month 4 — Martech' });
  fireEvent.click(within(rows).getByRole('button', { name: /Digital analytics/ }));
  expect(screen.getByText('Evaluate the analytics tools.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'View submission' })).toHaveAttribute('href', '/learner/monthly-submission/commercial/125/A2?month=2026-09');
  fireEvent.click(within(navigation).getByRole('button', { name: /October 2026/ }));
  expect(screen.getByRole('link', { name: 'Start assignment' })).toHaveAttribute('href', '/learner/monthly-submission/commercial/125/A3?month=2026-10');
  expect(screen.queryByRole('button', { name: /Digital analytics/ })).toBeNull();
});

it('opens Student Support with the learner, assignment and Training Plan month in the notes', async () => {
  mount();
  const link = await screen.findByRole('link', { name: 'Book 1:1 coach support' });
  const url = new URL(link.getAttribute('href')!, 'http://localhost');
  expect(url.pathname).toBe('/learner/calendar');
  expect(url.searchParams.get('book')).toBe('student-support');
  expect(url.searchParams.get('kind')).toBe('commercial');
  expect(url.searchParams.get('learner')).toBe('125');
  expect(url.searchParams.get('notes')).toContain('Assignment 22\nMonth 4 — Martech');
  expect(url.searchParams.get('notes')).toContain('Data, Insight and Analytics');
});

it('does not invent a month from import dates and keeps support available for missing briefs', async () => {
  mount('?month=');
  expect(await screen.findByRole('button', { name: 'Awaiting assignment brief' })).toBeDisabled();
  expect(screen.getByText('These assignments do not have a confirmed Training Plan date yet.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Book 1:1 coach support' })).toBeVisible();
  expect(screen.queryByText('August 2026')).toBeNull();
  expect(screen.queryByRole('button', { name: 'View file' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Download file' })).toBeNull();
});

it('makes file-only briefs available to view, download and start, resetting preview when the assignment changes', async () => {
  const firstUrl = '/curriculum_api/curriculum/uploads/Assignment%20instructions.docx';
  const secondUrl = '/curriculum_api/curriculum/uploads/worksheet.pdf';
  const attachedReal = { ...real, components: [
    component('A1', { assignmentBrief: null, resourceUrl: firstUrl, downloadAllowed: false }),
    component('A2', { week: 'Digital analytics', resourceUrl: secondUrl, fileName: 'Analytics worksheet.pdf' }),
  ] };
  vi.mocked(useLearnerDetailParam).mockReturnValue({ real: attachedReal, loading: false, loadError: null, isRealMode: true, refresh: vi.fn() });
  mockRequests({ statuses: { A1: 'todo' } });
  mount();
  expect(await screen.findByText('Read the attached file for the assignment instructions, then start your submission.')).toBeVisible();
  expect(screen.getByText('Assignment instructions.docx')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Start assignment' })).toHaveAttribute('href', '/learner/monthly-submission/commercial/125/A1?month=2026-09');
  const download = screen.getByRole('link', { name: 'Download file' });
  expect(download).toHaveAttribute('href', firstUrl);
  expect(download).toHaveAttribute('download', 'Assignment instructions.docx');
  expect(screen.queryByTestId('attachment-preview')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View file' }));
  expect(await screen.findByTestId('attachment-preview')).toHaveAttribute('data-url', firstUrl);
  expect(screen.getByRole('button', { name: 'Hide preview' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Hide preview' }));
  expect(screen.queryByTestId('attachment-preview')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View file' }));
  fireEvent.click(screen.getByRole('button', { name: /Digital analytics/ }));
  expect(screen.getByText('Explain how data informs your marketing decisions.')).toBeVisible();
  expect(screen.getByText('Analytics worksheet.pdf')).toBeVisible();
  expect(screen.queryByTestId('attachment-preview')).toBeNull();
  expect(screen.getByRole('button', { name: 'View file' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('link', { name: 'Download file' })).toHaveAttribute('href', secondUrl);
  expect(screen.getByRole('link', { name: 'Download file' })).toHaveAttribute('download', 'Analytics worksheet.pdf');
});

it('keeps assignments accessible when dates fail and retries the source', async () => {
  mockRequests({ failed: 'dates' });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Assignment dates could not be loaded.');
  expect(screen.getByRole('link', { name: 'Continue assignment' })).toBeVisible();
  mockRequests();
  fireEvent.click(screen.getByRole('button', { name: 'Retry plan details' }));
  expect(await screen.findByRole('region', { name: 'Assignments for Month 4 — Martech' })).toBeVisible();
});

it('keeps unknown saved work openable if statuses fail, including a removed brief', async () => {
  mockRequests({ failed: 'statuses' });
  mount('?month=');
  expect(await screen.findByRole('alert')).toHaveTextContent('Submission statuses could not be loaded.');
  expect(screen.getByRole('link', { name: 'Open assignment' })).toHaveAttribute('href', '/learner/monthly-submission/commercial/125/A4');
});

it('renders and sanitises authored HTML without losing the question or KSBs', async () => {
  const htmlReal = { ...real, components: [component('A1', { assignmentBriefHtml: '<p onclick="alert(1)">Describe <strong>your evidence</strong>.</p><script>alert(1)</script>',
    ksbMappings: [{ code: 'K1', description: 'Data analysis', classification: 'main', weight: 1 }] })] };
  vi.mocked(useLearnerDetailParam).mockReturnValue({ real: htmlReal, loading: false, loadError: null, isRealMode: true, refresh: vi.fn() });
  const { container } = mount();
  expect(await screen.findByText('your evidence')).toHaveProperty('tagName', 'STRONG');
  expect(container.querySelector('[onclick],script')).toBeNull();
  expect(screen.getByText('K1')).toHaveAttribute('title', 'Data analysis');
});

it('uses the current, next or most recent scheduled month and rejects ambiguous dates', () => {
  const groups = groupMonthlyAssignments(real, metadata, contract, {});
  expect(defaultAssignmentMonth(groups, new Date('2026-09-01T10:00:00Z'))?.month).toBe('2026-09');
  expect(defaultAssignmentMonth(groups, new Date('2026-07-01T10:00:00Z'))?.month).toBe('2026-09');
  expect(defaultAssignmentMonth(groups, new Date('2027-01-01T10:00:00Z'))?.month).toBe('2026-10');
  const ambiguous = { ...metadata, activity_dates: { A1: { date: '2026-09-01', date_needs_review: true, date_source: 'builder_section_title' } } };
  expect(groupMonthlyAssignments({ ...real, components: [component('A1')] }, ambiguous, contract, {})[0].month).toBe('');
});

it('shows the actual marking result and reviewer directly below the question', async () => {
  const markedReal = { ...real, componentMarkingStatus: { A1: { status: 'accepted', feedback: 'Clear analysis with relevant workplace evidence.',
    reviewedBy: 'Sam Taylor', reviewedAt: '2026-09-13T12:00:00Z' } } };
  vi.mocked(useLearnerDetailParam).mockReturnValue({ real: markedReal, loading: false, loadError: null, isRealMode: true, refresh: vi.fn() });
  mockRequests({ statuses: { A1: 'accepted' } });
  mount('?month=2026-09&assignment=A1');
  const result = await screen.findByRole('region', { name: 'Assignment marking result' });
  expect(within(result).getByText('Accepted')).toBeVisible();
  expect(within(result).getByText('Clear analysis with relevant workplace evidence.')).toBeVisible();
  expect(within(result).getByText('Reviewed by Sam Taylor')).toBeVisible();
  expect(within(result).getByText('13 September 2026')).toBeVisible();
  expect(screen.getByText('Explain how data informs your marketing decisions.').nextElementSibling).toBe(result);
  expect(within(result).queryByRole('button', { name: 'View full feedback' })).toBeNull();
});

it('expands long feedback, collapses it and resets the expanded state on assignment changes', async () => {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400);
  const markedReal = { ...real, componentMarkingStatus: {
    A1: { status: 'referred', feedback: 'Add measurable outcomes.\nProvide supporting evidence.\nExplain the benefit to your employer.', reviewedBy: 'Sam Taylor', reviewedAt: null },
    A2: { status: 'accepted', feedback: 'Good evaluation.\nStrong evidence.\nClear application to your role.', reviewedBy: 'Jo Smith', reviewedAt: null },
  } };
  vi.mocked(useLearnerDetailParam).mockReturnValue({ real: markedReal, loading: false, loadError: null, isRealMode: true, refresh: vi.fn() });
  mockRequests({ statuses: { A1: 'referred', A2: 'accepted' } });
  mount();
  const expand = await screen.findByRole('button', { name: 'View full feedback' });
  expect(expand).toHaveAttribute('aria-expanded', 'false');
  const content = document.getElementById(expand.getAttribute('aria-controls')!);
  expect(content).toHaveTextContent('Explain the benefit to your employer.');
  fireEvent.click(expand);
  expect(screen.getByRole('button', { name: 'Show less feedback' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Show less feedback' }));
  expect(screen.getByRole('button', { name: 'View full feedback' })).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'View full feedback' }));
  fireEvent.click(screen.getByRole('button', { name: /Digital analytics/ }));
  const nextResult = screen.getByRole('region', { name: 'Assignment marking result' });
  expect(within(nextResult).getByText(/Good evaluation/)).toBeVisible();
  expect(within(nextResult).queryByText(/Add measurable outcomes/)).toBeNull();
  expect(within(nextResult).getByRole('button', { name: 'View full feedback' })).toHaveAttribute('aria-expanded', 'false');
});

it('distinguishes an unmarked draft from an assignment awaiting review', async () => {
  mount();
  const result = await screen.findByRole('region', { name: 'Assignment marking result' });
  expect(within(result).getByText('Not marked yet')).toBeVisible();
  expect(within(result).getByText('No marking result is available yet.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Digital analytics/ }));
  const pending = screen.getByRole('region', { name: 'Assignment marking result' });
  expect(within(pending).getByText('Awaiting coach review')).toBeVisible();
  expect(within(pending).queryByRole('button')).toBeNull();
});

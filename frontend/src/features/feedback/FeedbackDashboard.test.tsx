import { cloneElement, type ReactElement } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi, type FeedbackDashboardReport } from '@/api/feedback';
import { FeedbackDashboard } from './FeedbackDashboard';
import { dashboardPeriod, negativeCategories, rankedQuestions, ukCalendarDate, weeklyClassifications } from './feedbackDashboardData';
import { notifyQualityTicketClosed } from './qualityTicketEvents';

vi.mock('@/api/feedback', async original => ({ ...await original<typeof import('@/api/feedback')>(), feedbackApi: { insightsDashboard: vi.fn(), createQualityTicket: vi.fn().mockResolvedValue({ ticket: { id: 'quality-ticket', assignedTeam: 'Quality Team', status: 'Open' } }), qualityTicketStatus: vi.fn().mockResolvedValue({ ticket: { id: 'quality-ticket', assignedTeam: 'Quality Team', status: 'Open' } }) } }));
// jsdom supplies no layout; keep real Recharts and supply only missing dimensions.
vi.mock('recharts', async original => ({ ...await original<typeof import('recharts')>(), ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 500, height: 235 }) }));

function report(): FeedbackDashboardReport {
  const counts = { positive: 1, neutral: 1, negative: 1, unscored: 1 };
  return {
    groups: [{ id: 'G1', name: 'Group One' }], modules: [{ id: 'M1', name: 'AI in Marketing' }, { id: 'M2', name: 'Business Communication' }], coverage: { assigned: 20, submitted: 5, rate: 25 },
    overallScore: { score: 75, scoredQuestions: 1, includedQuestions: 1 },
    questionMetrics: [{ questionId: 1, question: 'Did the tutor explain clearly?', type: 'rating', formId: 4, formTitle: 'Weekly feedback', version: 2, category: 'Teaching', importance: 'high', weight: 3, includedInOverall: true, assignedCount: 20, answeredCount: 3, answerRate: 15, score: 75, scoredResponses: 3, status: 'good', averageRating: 4, scaleMax: 5, distribution: [], classification: { positive: 2, neutral: 0, negative: 1, unscored: 0 } }],
    insights: { stars: { average: 4, answers: 3, distribution: [] }, categories: [{ formId: 4, formTitle: 'Weekly feedback', version: 2, category: 'Teaching', score: 75, scoredAnswers: 3, scoredQuestions: 1, includedQuestions: 1 }], trend: [], undatedScoredAnswers: 0,
      classification: { total: 4, ...counts, byType: [{ formType: 'post_lecture', ...counts }], trend: [], responses: [
        { responseId: 1, formId: 4, formTitle: 'Weekly feedback', formType: 'post_lecture', version: 2, respondent: 'Anonymous learner', score: 0, classification: 'negative', scoredQuestions: 3, submittedAt: '2026-10-20T10:00:00Z', contextTitle: 'Business Communication — Session 3', groupName: 'Group One' },
        { responseId: 2, formId: 4, formTitle: 'Weekly feedback', formType: 'post_lecture', version: 2, respondent: 'Synthetic learner', score: 100, classification: 'positive', scoredQuestions: 3, submittedAt: '2026-10-13T10:00:00Z' },
        { responseId: 3, formId: 4, formTitle: 'Weekly feedback', formType: 'post_lecture', version: 2, respondent: 'Synthetic learner', score: 50, classification: 'neutral', scoredQuestions: 3, submittedAt: '2026-10-06T10:00:00Z' },
        { responseId: 4, formId: 4, formTitle: 'Weekly feedback', formType: 'post_lecture', version: 2, respondent: 'Synthetic learner', score: null, classification: 'unscored', scoredQuestions: 0, submittedAt: null },
      ] },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  vi.mocked(feedbackApi.insightsDashboard).mockReset().mockResolvedValue({ analytics: report() });
});
afterEach(() => vi.useRealTimers());

describe('independent feedback insights dashboard', () => {
  it('keeps cached filter results visible when revalidation fails and supports retry', async () => {
    const user = userEvent.setup();
    render(<FeedbackDashboard onViewResponse={vi.fn()} />);
    await screen.findByRole('region', { name: 'Submitted feedback' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Analytics date range' }), '0');
    await waitFor(() => expect(feedbackApi.insightsDashboard).toHaveBeenCalledTimes(2));
    vi.mocked(feedbackApi.insightsDashboard).mockRejectedValueOnce(new Error('Refresh unavailable'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Analytics date range' }), '8');
    expect(await screen.findByRole('alert')).toHaveTextContent('Showing the previous report. Refresh unavailable');
    expect(screen.getByRole('region', { name: 'Submitted feedback' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry analytics' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('pauses report and ticket refreshes while its tab is inactive', async () => {
    const open = vi.fn();
    const { rerender } = render(<FeedbackDashboard onViewResponse={open} />);
    await screen.findByText('Quality ticket: Open');
    rerender(<FeedbackDashboard active={false} onViewResponse={open} />);
    const reports = vi.mocked(feedbackApi.insightsDashboard).mock.calls.length;
    const statusReads = vi.mocked(feedbackApi.qualityTicketStatus).mock.calls.length;
    act(() => window.dispatchEvent(new Event('focus')));
    expect(feedbackApi.insightsDashboard).toHaveBeenCalledTimes(reports);
    expect(feedbackApi.qualityTicketStatus).toHaveBeenCalledTimes(statusReads);
    rerender(<FeedbackDashboard active onViewResponse={open} />);
    expect(screen.getByRole('region', { name: 'Submitted feedback' })).toBeVisible();
    await waitFor(() => expect(feedbackApi.insightsDashboard).toHaveBeenCalledTimes(reports + 1));
  });

  it('clears cached learner report data when revalidation is unauthorized', async () => {
    const user = userEvent.setup();
    render(<FeedbackDashboard onViewResponse={vi.fn()} />);
    await screen.findByRole('region', { name: 'Submitted feedback' });
    vi.mocked(feedbackApi.insightsDashboard).mockRejectedValueOnce(Object.assign(new Error('Session expired'), { status: 401 }));
    await user.click(screen.getByRole('button', { name: 'Refresh analytics' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired');
    expect(screen.queryByRole('region', { name: 'Submitted feedback' })).not.toBeInTheDocument();
    expect(screen.queryByText('Business Communication — Session 3')).not.toBeInTheDocument();
  });
  it('immediately reflects closure of the matching response without recreating tickets', async () => {
    render(<FeedbackDashboard onViewResponse={vi.fn()} />);
    await screen.findByText('Quality ticket: Open');
    const creations = vi.mocked(feedbackApi.createQualityTicket).mock.calls.length;
    act(() => notifyQualityTicketClosed(99));
    expect(screen.getByText('Quality ticket: Open')).toBeVisible();
    act(() => notifyQualityTicketClosed(1));
    expect(screen.getByText('Quality ticket: Closed')).toBeVisible();
    expect(feedbackApi.createQualityTicket).toHaveBeenCalledTimes(creations);
  });
  it('ignores an older status read that finishes after the email closes the ticket', async () => {
    let finish!: (value: Awaited<ReturnType<typeof feedbackApi.qualityTicketStatus>>) => void;
    vi.mocked(feedbackApi.qualityTicketStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<FeedbackDashboard onViewResponse={vi.fn()} />);
    await screen.findByText('Quality ticket: Open');
    act(() => window.dispatchEvent(new Event('focus')));
    act(() => notifyQualityTicketClosed(1));
    await act(async () => finish({ ticket: { id: 'quality-ticket', assignedTeam: 'Quality Team', status: 'Open' } }));
    expect(screen.getByText('Quality ticket: Closed')).toBeVisible();
  });
  it('uses real score classifications, displays the reference panels and opens original negative answers', async () => {
    const open = vi.fn();
    render(<FeedbackDashboard onViewResponse={open} />);
    await screen.findByRole('region', { name: 'Submitted feedback' });
    expect(feedbackApi.insightsDashboard).toHaveBeenCalledExactlyOnceWith({ formType: 'post_lecture', submittedFrom: '2026-09-01', submittedTo: '2026-10-26' });
    for (const name of ['Analytics response split', 'Analytics feedback type comparison', 'Analytics weekly response trend']) expect(screen.getByRole('group', { name })).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Response rate' })).getByText('25%')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Top Positive Questions' })).getByText('67%')).toBeVisible();
    expect(screen.getByText('Business Communication — Session 3')).toBeVisible();
    expect(screen.queryByText('Open risk issues')).not.toBeInTheDocument();
    expect(screen.queryByText('High priority')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Review response 1' }));
    expect(open).toHaveBeenCalledWith(1);
  });

  it('displays the current Ticketing system status after a negative response is synced', async () => {
    vi.mocked(feedbackApi.createQualityTicket).mockResolvedValueOnce({ ticket: { id: 'quality-ticket', assignedTeam: 'Quality Team', status: 'Closed' } });
    render(<FeedbackDashboard onViewResponse={vi.fn()} />);
    expect(await screen.findByText('Quality ticket: Closed')).toBeVisible();
  });

  it('refreshes the displayed status when the dashboard regains focus', async () => {
    vi.mocked(feedbackApi.qualityTicketStatus).mockResolvedValueOnce({ ticket: { id: 'quality-ticket', assignedTeam: 'Quality Team', status: 'Closed' } });
    render(<FeedbackDashboard onViewResponse={vi.fn()} />);
    await screen.findByText('Quality ticket: Open');
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText('Quality ticket: Closed')).toBeVisible();
  });

  it('combines type, date, classification, saved group and module filters on the separate read-only API', async () => {
    const user = userEvent.setup();
    render(<FeedbackDashboard onViewResponse={vi.fn()} />);
    await screen.findByRole('region', { name: 'Submitted feedback' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Analytics learner group' }), 'G1');
    await waitFor(() => expect(feedbackApi.insightsDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 'G1' })));
    await screen.findByRole('region', { name: 'Submitted feedback' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Analytics module' }), 'M1');
    await waitFor(() => expect(feedbackApi.insightsDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 'G1', moduleId: 'M1' })));
    await screen.findByRole('region', { name: 'Submitted feedback' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Analytics classification' }), 'negative');
    await waitFor(() => expect(feedbackApi.insightsDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 'G1', moduleId: 'M1', classification: 'negative' })));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Analytics date range' }), '0');
    await waitFor(() => expect(feedbackApi.insightsDashboard).toHaveBeenLastCalledWith({ formType: 'post_lecture', groupId: 'G1', moduleId: 'M1', classification: 'negative' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Analytics feedback type' }), 'post_event');
    await waitFor(() => expect(feedbackApi.insightsDashboard).toHaveBeenLastCalledWith({ formType: 'post_event', classification: 'negative' }));
    expect(screen.getByRole('combobox', { name: 'Analytics learner group' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Analytics module' })).toHaveValue('');
  });

  it('resets the module when group changes and supports reports with no recorded modules', async () => {
    const user = userEvent.setup();
    render(<FeedbackDashboard onViewResponse={vi.fn()} />);
    await screen.findByRole('region', { name: 'Submitted feedback' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Analytics module' }), 'M2');
    await screen.findByRole('region', { name: 'Submitted feedback' });
    const next = report();
    next.modules = [];
    vi.mocked(feedbackApi.insightsDashboard).mockResolvedValueOnce({ analytics: next });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Analytics learner group' }), 'G1');
    await waitFor(() => expect(feedbackApi.insightsDashboard).toHaveBeenLastCalledWith({ formType: 'post_lecture', groupId: 'G1', submittedFrom: '2026-09-01', submittedTo: '2026-10-26' }));
    await screen.findByRole('region', { name: 'Submitted feedback' });
    expect(screen.getByRole('combobox', { name: 'Analytics module' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Analytics module' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'All modules' })).toBeInTheDocument();
  });

  it('renders an empty selected module honestly instead of restoring unfiltered dashboard data', async () => {
    const user = userEvent.setup();
    render(<FeedbackDashboard onViewResponse={vi.fn()} />);
    await screen.findByRole('region', { name: 'Submitted feedback' });
    const empty = report();
    empty.insights!.classification = { total: 0, positive: 0, neutral: 0, negative: 0, unscored: 0, responses: [], byType: [], trend: [] };
    empty.questionMetrics = [];
    empty.insights!.categories = [];
    empty.coverage = { assigned: 0, submitted: 0, rate: null };
    empty.modules = [];
    vi.mocked(feedbackApi.insightsDashboard).mockResolvedValueOnce({ analytics: empty });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Analytics module' }), 'M1');
    expect(await screen.findByText('No submitted feedback in this selection.')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Analytics module' })).toHaveValue('M1');
    expect(screen.getByRole('combobox', { name: 'Analytics module' })).toBeEnabled();
    expect(within(screen.getByRole('region', { name: 'Submitted feedback' })).getByText('0')).toBeVisible();
    expect(feedbackApi.insightsDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ moduleId: 'M1' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Analytics module' }), '');
    await waitFor(() => expect(feedbackApi.insightsDashboard).toHaveBeenLastCalledWith({ formType: 'post_lecture', submittedFrom: '2026-09-01', submittedTo: '2026-10-26' }));
  });

  it('shows request failures with retry, and renders honest empty states without chart values', async () => {
    vi.mocked(feedbackApi.insightsDashboard).mockRejectedValueOnce(new Error('Report unavailable'));
    const empty = report();
    empty.questionMetrics = [];
    empty.coverage = { assigned: 0, submitted: 0, rate: null };
    empty.insights!.categories = [];
    empty.insights!.classification = { total: 0, positive: 0, neutral: 0, negative: 0, unscored: 0, byType: [], trend: [], responses: [] };
    vi.mocked(feedbackApi.insightsDashboard).mockResolvedValueOnce({ analytics: empty });
    render(<FeedbackDashboard onViewResponse={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Report unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Retry analytics' }));
    expect(await screen.findByText('No submitted feedback in this selection.')).toBeVisible();
    expect(screen.getByText('No negative responses in this selection.')).toBeVisible();
    expect(screen.getByText('No scored category')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Response rate' })).getByText('—')).toBeVisible();
  });

  it('ignores an older request resolving after a newer filter selection', async () => {
    let finish!: (value: { analytics: FeedbackDashboardReport }) => void;
    vi.mocked(feedbackApi.insightsDashboard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const latest = report();
    latest.insights!.classification!.total = 10;
    vi.mocked(feedbackApi.insightsDashboard).mockResolvedValueOnce({ analytics: latest });
    render(<FeedbackDashboard onViewResponse={vi.fn()} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analytics date range' }), '0');
    const submitted = await screen.findByRole('region', { name: 'Submitted feedback' });
    expect(within(submitted).getByText('10')).toBeVisible();
    finish({ analytics: report() });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Submitted feedback' })).getByText('10')).toBeVisible());
  });
});

describe('dashboard reporting arithmetic', () => {
  it('uses UK calendar days and an inclusive period without machine-time-zone assumptions', () => {
    expect(ukCalendarDate(new Date('2026-10-18T23:30:00Z'))).toBe('2026-10-19');
    expect(dashboardPeriod('2026-10-26', 8)).toEqual({ submittedFrom: '2026-09-01', submittedTo: '2026-10-26' });
    expect(dashboardPeriod('2026-10-26', 0)).toEqual({});
    const data = report().insights!.classification!;
    data.responses = [{ ...data.responses[0], submittedAt: '2026-10-18T23:30:00Z' }, { ...data.responses[1], submittedAt: '2026-10-25T23:30:00Z' }, { ...data.responses[2], submittedAt: null }];
    expect(weeklyClassifications(data)).toEqual([{ week: '2026-10-19', positive: 1, negative: 1 }]);
    data.responses[1].submittedAt = '2026-11-03T10:00:00Z';
    expect(weeklyClassifications(data)).toEqual([{ week: '2026-10-19', positive: 0, negative: 1 }, { week: '2026-10-26', positive: 0, negative: 0 }, { week: '2026-11-02', positive: 1, negative: 0 }]);
  });

  it('keeps versions distinct and excludes unscored answers from positive/negative percentages', () => {
    const first = report().questionMetrics[0];
    const second = { ...first, questionId: 2, version: 3, classification: { positive: 0, neutral: 1, negative: 1, unscored: 20 } };
    expect(rankedQuestions([first, second], 'negative')[0].rate).toBe(50);
    const categories = negativeCategories([first, second]);
    expect(categories).toHaveLength(2);
    expect(categories[0]).toMatchObject({ version: 3, rate: 50, total: 2 });
  });
});

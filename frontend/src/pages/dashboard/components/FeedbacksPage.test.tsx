import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackDashboardFilters, FeedbackDashboardReport } from '@/api/feedback';
import FeedbacksPage from './FeedbacksPage';

const mocks = vi.hoisted(() => ({ insightsDashboard: vi.fn(), response: vi.fn() }));
vi.mock('@/api/feedback', () => ({ feedbackApi: mocks }));
vi.mock('@/features/feedback/FormRenderer', () => ({ FormRenderer: () => <div>Saved answers</div> }));

const responses = [
  { responseId: 1, formId: 48, formTitle: 'Synthetic session feedback', formType: 'post_lecture', version: 1, respondent: 'Synthetic one', score: 30, classification: 'negative', scoredQuestions: 2, submittedAt: '2026-10-20T10:00:00Z', contextTitle: 'Session one', groupName: 'Group A' },
  { responseId: 2, formId: 50, formTitle: 'Second session feedback', formType: 'post_lecture', version: 2, respondent: 'Synthetic two', score: 65, classification: 'neutral', scoredQuestions: 2, submittedAt: '2026-10-21T10:00:00Z', contextTitle: 'Session two', groupName: 'Group A' },
  { responseId: 3, formId: 50, formTitle: 'Second session feedback', formType: 'post_lecture', version: 2, respondent: 'Synthetic three', score: 90, classification: 'positive', scoredQuestions: 2, submittedAt: '2026-10-22T10:00:00Z', contextTitle: 'Session three', groupName: 'Group A' },
  { responseId: 4, formId: 50, formTitle: 'Second session feedback', formType: 'post_lecture', version: 2, respondent: 'Synthetic four', score: null, classification: 'unscored', scoredQuestions: 0, submittedAt: '2026-10-23T10:00:00Z', contextTitle: 'Session four', groupName: 'Group A' },
  { responseId: 5, formId: 60, formTitle: 'Monthly Coaching Meeting Feedback Form', formType: 'post_mcm_review', version: 1, respondent: 'Synthetic five', score: 85, classification: 'positive', scoredQuestions: 2, submittedAt: '2026-10-24T10:00:00Z', contextTitle: 'MCM response', groupName: 'Group A' },
  { responseId: 6, formId: 61, formTitle: 'Progress Review Feedback Form', formType: 'post_progress_review', version: 1, respondent: 'Synthetic six', score: 20, classification: 'negative', scoredQuestions: 2, submittedAt: '2026-10-25T10:00:00Z', contextTitle: 'PR response', groupName: 'Group A' },
  { responseId: 7, formId: 71, formTitle: 'Learner Pulse', formType: 'custom_pulse', version: 1, respondent: 'Synthetic seven', score: 90, classification: 'positive', scoredQuestions: 2, submittedAt: '2026-10-26T10:00:00Z', contextTitle: 'Pulse response', groupName: 'Group A' },
] as const;

function report(filters: FeedbackDashboardFilters = {}): FeedbackDashboardReport {
  const selected = responses.filter(row => (!filters.classification || row.classification === filters.classification) && (!filters.formId || row.formId === filters.formId) && (!filters.formType || row.formType === filters.formType));
  return {
    forms: [
      { id: 47, title: 'Live session learner (T)', formType: 'post_lecture' },
      { id: 49, title: 'End-of-Module Learner (T)', formType: 'end_module' },
      { id: 48, title: 'Synthetic session feedback', formType: 'post_lecture' },
      { id: 50, title: 'Second session feedback', formType: 'post_lecture' },
      { id: 60, title: 'Monthly Coaching Meeting Feedback Form', formType: 'post_mcm_review' },
      { id: 61, title: 'Progress Review Feedback Form', formType: 'post_progress_review' },
      { id: 70, title: 'Wellbeing Form', formType: 'mid_module' },
      { id: 71, title: 'Learner Pulse', formType: 'custom_pulse' },
    ],
    groups: [{ id: 'group-a', name: 'Group A' }], modules: [{ id: 'module-a', name: 'Module A' }],
    insights: { classification: {
      total: selected.length, positive: selected.filter(row => row.classification === 'positive').length,
      neutral: selected.filter(row => row.classification === 'neutral').length,
      negative: selected.filter(row => row.classification === 'negative').length,
      unscored: selected.filter(row => row.classification === 'unscored').length,
      byType: [], trend: [], responses: selected.map(row => ({ ...row })),
    } },
  } as unknown as FeedbackDashboardReport;
}

beforeEach(() => {
  mocks.insightsDashboard.mockReset();
  mocks.response.mockReset();
  mocks.insightsDashboard.mockImplementation(async (filters: FeedbackDashboardFilters) => ({ analytics: report(filters) }));
  mocks.response.mockResolvedValue({ response: { id: 1, sections: [] } });
});
afterEach(cleanup);

describe('Quality Feedbacks', () => {
  it('shows saved classifications from current and historical forms with follow-up labels', async () => {
    render(<MemoryRouter><FeedbacksPage /></MemoryRouter>);
    expect(await screen.findByText('Session one')).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Quality feedback' });
    expect(within(region).getAllByText('v1', { exact: false })).toHaveLength(4);
    expect(within(region).getByText('Completed responses in report')).toBeInTheDocument();
    expect(within(region).getByText('Negative responses')).toBeInTheDocument();
    expect(within(region).getByText('Neutral responses')).toBeInTheDocument();
    expect(within(region).getByText('Positive responses')).toBeInTheDocument();
    expect(within(region).getAllByText('Unscored')).toHaveLength(1);
    expect(within(region).getAllByText('No action needed', { exact: false })).toHaveLength(3);
    expect(within(region).queryByText('Assessed')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Wellbeing' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'MCM Feedback' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Progress Review Feedback' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'custom pulse' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Monthly Coaching Meeting Feedback Form' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Progress Review Feedback Form' })).toBeInTheDocument();
    expect(screen.getByText('MCM response')).toBeInTheDocument();
    expect(screen.getByText('PR response')).toBeInTheDocument();
    expect(screen.getByText('Pulse response')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /\(T\)/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Quality feedback date range')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Quality feedback group')).not.toBeInTheDocument();
    expect(mocks.insightsDashboard).toHaveBeenCalledWith({ includeForms: true });
  });

  it('filters report cards and responses by feedback type and form, then reads answers', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FeedbacksPage /></MemoryRouter>);
    await screen.findByText('Session one');
    await user.selectOptions(screen.getByLabelText('Quality feedback type'), 'post_lecture');
    await waitFor(() => expect(mocks.insightsDashboard).toHaveBeenLastCalledWith({ includeForms: true, formType: 'post_lecture' }));
    expect(screen.queryByRole('option', { name: 'End-of-Module Learner' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Quality feedback form'), '48');
    await waitFor(() => expect(mocks.insightsDashboard).toHaveBeenLastCalledWith({ includeForms: true, formType: 'post_lecture', formId: 48 }));
    await screen.findByText('Session one');
    expect(screen.queryByText('Session two')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 1 responses shown', { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View answers' }));
    expect(await screen.findByText('Saved answers')).toBeInTheDocument();
    expect(mocks.response).toHaveBeenCalledWith(1);
  });

  it('uses newly returned feedback types and forms without adding a code list entry', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FeedbacksPage /></MemoryRouter>);
    expect(await screen.findByRole('option', { name: 'custom pulse' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Quality feedback type'), 'custom_pulse');
    await waitFor(() => expect(mocks.insightsDashboard).toHaveBeenLastCalledWith({ includeForms: true, formType: 'custom_pulse' }));
    expect(await screen.findByText('Pulse response')).toBeInTheDocument();
    expect(screen.queryByText('MCM response')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Quality feedback form'), '71');
    await waitFor(() => expect(mocks.insightsDashboard).toHaveBeenLastCalledWith({ includeForms: true, formType: 'custom_pulse', formId: 71 }));
  });

  it('filters the response list by clickable classification cards without changing the totals', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FeedbacksPage /></MemoryRouter>);
    expect(await screen.findByText('Pulse response')).toBeInTheDocument();
    const positive = screen.getByRole('button', { name: /Positive responses/ });
    const neutral = screen.getByRole('button', { name: /Neutral responses/ });
    const negative = screen.getByRole('button', { name: /Negative responses/ });
    const all = screen.getByRole('button', { name: /Completed responses in report/ });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    await user.click(positive);
    expect(positive).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Pulse response')).toBeInTheDocument();
    expect(screen.queryByText('PR response')).not.toBeInTheDocument();
    expect(screen.getByText('3 of 7 responses shown', { exact: false })).toBeInTheDocument();
    await user.click(neutral);
    expect(screen.getByText('Session two')).toBeInTheDocument();
    expect(screen.queryByText('Pulse response')).not.toBeInTheDocument();
    negative.focus();
    await user.keyboard('{Enter}');
    expect(negative).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('PR response')).toBeInTheDocument();
    await user.click(negative);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Pulse response')).toBeInTheDocument();
    expect(mocks.insightsDashboard).toHaveBeenCalledTimes(1);
  });

  it('shows a recoverable error instead of sample feedback', async () => {
    mocks.insightsDashboard.mockRejectedValueOnce(new Error('Feedback service unavailable'));
    render(<MemoryRouter><FeedbacksPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Feedback service unavailable');
    expect(screen.queryByText('Session one')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Session one')).toBeInTheDocument();
  });

  it('opens the Critical feedback link with Negative selected', async () => {
    render(<MemoryRouter initialEntries={['/curriculum/quality-demo?view=feedbacks&classification=negative']}><FeedbacksPage /></MemoryRouter>);
    expect(await screen.findByText('Session one')).toBeInTheDocument();
    expect(screen.getByText('Showing negative responses.', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Session two')).not.toBeInTheDocument();
    expect(mocks.insightsDashboard).toHaveBeenCalledWith({ includeForms: true });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show all responses' }));
    expect(await screen.findByText('Session two')).toBeInTheDocument();
  });
});

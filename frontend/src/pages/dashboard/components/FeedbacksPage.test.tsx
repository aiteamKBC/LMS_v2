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
  { responseId: 1, formId: 47, formTitle: 'Synthetic session feedback', formType: 'post_lecture', version: 1, respondent: 'Synthetic one', score: 30, classification: 'negative', scoredQuestions: 2, submittedAt: '2026-10-20T10:00:00Z', contextTitle: 'Session one', groupName: 'Group A' },
  { responseId: 2, formId: 49, formTitle: 'Synthetic session feedback', formType: 'post_lecture', version: 2, respondent: 'Synthetic two', score: 65, classification: 'neutral', scoredQuestions: 2, submittedAt: '2026-10-21T10:00:00Z', contextTitle: 'Session two', groupName: 'Group A' },
  { responseId: 3, formId: 49, formTitle: 'Synthetic session feedback', formType: 'post_lecture', version: 2, respondent: 'Synthetic three', score: 90, classification: 'positive', scoredQuestions: 2, submittedAt: '2026-10-22T10:00:00Z', contextTitle: 'Session three', groupName: 'Group A' },
  { responseId: 4, formId: 49, formTitle: 'Synthetic session feedback', formType: 'post_lecture', version: 2, respondent: 'Synthetic four', score: null, classification: 'unscored', scoredQuestions: 0, submittedAt: '2026-10-23T10:00:00Z', contextTitle: 'Session four', groupName: 'Group A' },
] as const;

function report(filters: FeedbackDashboardFilters = {}): FeedbackDashboardReport {
  const selected = filters.classification ? responses.filter(row => row.classification === filters.classification) : responses;
  return {
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
    expect(within(region).getByText('v1', { exact: false })).toBeInTheDocument();
    expect(within(region).getAllByText('Critical')).toHaveLength(2);
    expect(within(region).getAllByText('Needs review')).toHaveLength(2);
    expect(within(region).getAllByText('Positive')).toHaveLength(3);
    expect(within(region).getAllByText('Unscored')).toHaveLength(2);
    expect(within(region).getByText('No action needed', { exact: false })).toBeInTheDocument();
    expect(within(region).queryByText('Assessed')).not.toBeInTheDocument();
    expect(mocks.insightsDashboard).toHaveBeenCalledWith({});
  });

  it('passes Engagement filters through and reads the original response on demand', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FeedbacksPage /></MemoryRouter>);
    await screen.findByText('Session one');
    await user.selectOptions(screen.getByLabelText('Quality feedback classification'), 'negative');
    await waitFor(() => expect(mocks.insightsDashboard).toHaveBeenLastCalledWith({ classification: 'negative' }));
    expect(await screen.findByText('Session one')).toBeInTheDocument();
    expect(screen.queryByText('Session two')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Quality feedback group'), 'group-a');
    await waitFor(() => expect(mocks.insightsDashboard).toHaveBeenLastCalledWith({ classification: 'negative', groupId: 'group-a' }));
    await screen.findByText('Session one');
    await user.selectOptions(screen.getByLabelText('Quality feedback module'), 'module-a');
    await waitFor(() => expect(mocks.insightsDashboard).toHaveBeenLastCalledWith({ classification: 'negative', groupId: 'group-a', moduleId: 'module-a' }));
    await screen.findByText('Session one');
    await user.selectOptions(screen.getByLabelText('Quality feedback date range'), '4');
    await waitFor(() => expect(mocks.insightsDashboard).toHaveBeenCalledWith(expect.objectContaining({ classification: 'negative', groupId: 'group-a', moduleId: 'module-a', submittedFrom: expect.any(String), submittedTo: expect.any(String) })));
    await screen.findByText('Session one');
    await user.selectOptions(screen.getByLabelText('Quality feedback type'), 'post_lecture');
    await waitFor(() => expect(mocks.insightsDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ formType: 'post_lecture', classification: 'negative' })));
    expect(mocks.insightsDashboard.mock.lastCall?.[0]).not.toHaveProperty('groupId');
    expect(mocks.insightsDashboard.mock.lastCall?.[0]).not.toHaveProperty('moduleId');
    await screen.findByText('Session one');
    await user.click(screen.getByRole('button', { name: 'View answers' }));
    expect(await screen.findByText('Saved answers')).toBeInTheDocument();
    expect(mocks.response).toHaveBeenCalledWith(1);
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
    expect(screen.getByLabelText('Quality feedback classification')).toHaveValue('negative');
    expect(screen.queryByText('Session two')).not.toBeInTheDocument();
    expect(mocks.insightsDashboard).toHaveBeenCalledWith({ classification: 'negative' });
  });
});

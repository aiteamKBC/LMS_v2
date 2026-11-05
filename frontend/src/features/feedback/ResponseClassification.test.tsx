import { cloneElement, type ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FeedbackClassificationReport, FeedbackQuestionMetric } from '@/api/feedback';
import { ResponseClassification } from './ResponseClassification';

// Keep the real charts; supply only dimensions missing from jsdom.
vi.mock('recharts', async original => ({ ...await original<typeof import('recharts')>(), ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 600, height: 224 }) }));

const counts = { positive: 1, neutral: 1, negative: 1, unscored: 1 };
const report: FeedbackClassificationReport = {
  total: 4, ...counts,
  byType: [{ formType: 'post_lecture', ...counts }], trend: [{ month: '2026-10', ...counts }],
  responses: [
    { responseId: 1, formId: 4, formTitle: 'Lecture feedback', formType: 'post_lecture', version: 1, respondent: 'Synthetic learner', score: 90, classification: 'positive', scoredQuestions: 3, submittedAt: '2026-10-20T10:00:00Z' },
    { responseId: 2, formId: 4, formTitle: 'Lecture feedback', formType: 'post_lecture', version: 1, respondent: 'Anonymous learner', score: 0, classification: 'negative', scoredQuestions: 3, submittedAt: '2026-10-20T10:00:00Z' },
    { responseId: 3, formId: 4, formTitle: 'Lecture feedback', formType: 'post_lecture', version: 1, respondent: 'Another learner', score: 50, classification: 'neutral', scoredQuestions: 2, submittedAt: '2026-10-20T10:00:00Z' },
    { responseId: 4, formId: 4, formTitle: 'Lecture feedback', formType: 'post_lecture', version: 1, respondent: 'Text response', score: null, classification: 'unscored', scoredQuestions: 0, submittedAt: null },
  ],
};
const question: FeedbackQuestionMetric = { questionId: 1, question: 'Support?', type: 'rating', formId: 4, formTitle: 'Lecture feedback', version: 1, category: 'Teaching', importance: 'high', weight: 3, includedInOverall: true, assignedCount: 10, answeredCount: 4, answerRate: 40, score: 50, scoredResponses: 3, status: 'watch', averageRating: 3, scaleMax: 5, distribution: [], classification: counts };

describe('rule-based response classification dashboard', () => {
  it('shows all four classes, raw answer proportions and the original anonymous label', async () => {
    render(<ResponseClassification report={report} questions={[question]} />);
    expect(screen.getByText('Positive responses')).toBeVisible();
    expect(screen.getByText('Neutral responses')).toBeVisible();
    expect(screen.getByText('Negative responses')).toBeVisible();
    expect(screen.getByText('Unscored responses')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Response classification chart' })).toBeVisible();
    const negative = within(screen.getByRole('region', { name: 'Top negative questions' }));
    expect(negative.getByText('33%')).toBeVisible();
    expect(negative.getByText(/1\/3 scored answers/)).toBeVisible();
    expect(screen.getByRole('row', { name: /Anonymous learner.*0% Negative/ })).toBeVisible();
    expect(screen.getByRole('row', { name: /Text response.*Unscored 0 Date unavailable/ })).toBeVisible();
    await userEvent.click(screen.getByText('Classification counts by month'));
    expect(screen.getByRole('row', { name: 'Oct 26 1 1 1 1' })).toBeVisible();
  });
  it('filters the response list without changing cards, and opens original answers by server response ID', async () => {
    const user = userEvent.setup();
    const view = vi.fn();
    render(<ResponseClassification report={report} questions={[question]} onViewResponse={view} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Response classification filter' }), 'negative');
    const table = within(screen.getByRole('table', { name: 'Classified response records' }));
    expect(table.getAllByRole('row')).toHaveLength(2);
    expect(table.getByText('Anonymous learner')).toBeVisible();
    expect(table.queryByText('Synthetic learner')).not.toBeInTheDocument();
    await user.click(table.getByRole('button', { name: 'View answers' }));
    expect(view).toHaveBeenCalledWith(2);
    expect(screen.getByText('Positive responses')).toBeVisible();
    await user.type(screen.getByRole('searchbox', { name: 'Search classified responses' }), 'missing');
    expect(screen.getByText('No responses match these filters.')).toBeVisible();
  });
  it('keeps lists paginated and does not invent a score for an empty report', async () => {
    const user = userEvent.setup();
    const many = { ...report, responses: Array.from({ length: 12 }, (_, index) => ({ ...report.responses[0], responseId: index + 1, respondent: `Learner ${index + 1}` })) };
    const { rerender } = render(<ResponseClassification report={many} questions={[]} />);
    expect(within(screen.getByRole('table', { name: 'Classified response records' })).getAllByRole('row')).toHaveLength(11);
    await user.click(screen.getByRole('button', { name: 'Next responses' }));
    expect(screen.getByText('Learner 12')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next responses' })).toBeDisabled();
    rerender(<ResponseClassification report={{ total: 0, positive: 0, neutral: 0, negative: 0, unscored: 0, byType: [], trend: [], responses: [] }} questions={[]} />);
    expect(screen.getByText('No completed responses in this selection.')).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Classified response records' })).not.toBeInTheDocument();
  });
});

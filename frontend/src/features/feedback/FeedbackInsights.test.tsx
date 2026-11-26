import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FeedbackQuestionMetric, FeedbackReportInsights } from '@/api/feedback';
import { FeedbackInsights } from './FeedbackInsights';

// jsdom has no layout. Fix dimensions only; render the real Recharts components.
vi.mock('recharts', async importOriginal => ({
  ...await importOriginal<typeof import('recharts')>(),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 600, height: 224 }),
}));

const question: FeedbackQuestionMetric = {
  questionId: 1, question: 'Explanation clarity?', type: 'rating', formId: 4, formTitle: 'Lecture feedback',
  version: 1, category: 'Teaching', importance: 'high', weight: 3, includedInOverall: true,
  assignedCount: 10, answeredCount: 2, answerRate: 20, score: 0, scoredResponses: 2, status: 'needs_attention',
  averageRating: 1, scaleMax: 5, distribution: [{ label: '1', count: 2 }],
};
const insights: FeedbackReportInsights = {
  stars: { average: 3, answers: 4, distribution: [{ stars: 1, count: 2 }, { stars: 2, count: 0 }, { stars: 3, count: 0 }, { stars: 4, count: 0 }, { stars: 5, count: 2 }] },
  categories: [{ formId: 4, formTitle: 'Lecture feedback', version: 1, category: 'Teaching', score: 0, scoredAnswers: 2, scoredQuestions: 1, includedQuestions: 1 }, { formId: 5, formTitle: 'Lecture feedback', version: 2, category: 'Teaching', score: 100, scoredAnswers: 2, scoredQuestions: 1, includedQuestions: 1 }],
  trend: [{ month: '2026-09', score: 0, scoredQuestions: 1, includedQuestions: 1, scoredAnswers: 2 }, { month: '2026-10', score: 100, scoredQuestions: 1, includedQuestions: 1, scoredAnswers: 2 }],
  undatedScoredAnswers: 0,
};

describe('feedback insight charts', () => {
  it('uses the same purple for rating and category bars regardless of score', () => {
    render(<FeedbackInsights insights={insights} questions={[question]} />);
    for (const name of ['Star rating chart', 'Scored categories chart']) {
      const chart = screen.getByRole('group', { name });
      const bars = chart.querySelectorAll('.recharts-bar-rectangle path');
      expect(bars.length).toBeGreaterThan(0);
      for (const bar of bars) expect(bar).toHaveAttribute('fill', '#7c3aed');
    }
  });

  it('separates raw stars, weighted scores and answer counts, and keeps form versions visible', async () => {
    render(<FeedbackInsights insights={insights} questions={[question]} />);
    expect(screen.getByText('3.00 / 5')).toBeVisible();
    const distribution = screen.getByRole('region', { name: 'Rating distribution' });
    expect(within(distribution).getByRole('group', { name: 'Star rating chart' })).toBeVisible();
    await userEvent.click(screen.getByText('Rating counts and percentages'));
    expect(within(distribution).getByText('1 star')).toBeVisible();
    expect(within(distribution).getByText('5 stars')).toBeVisible();
    expect(within(distribution).getAllByText('50%')).toHaveLength(2);
    const categories = screen.getByRole('region', { name: 'Category scores' });
    await userEvent.click(screen.getByText('All categories and versions (2)'));
    expect(within(categories).getByText(/v1 · 2 scored answers/)).toBeVisible();
    expect(within(categories).getByText(/v2 · 2 scored answers/)).toBeVisible();
    expect(within(categories).getByRole('row', { name: /v1.*0% 2/ })).toBeVisible();
    expect(within(categories).getByRole('row', { name: /v2.*100% 2/ })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Monthly feedback scores' })).toBeVisible();
    await userEvent.click(screen.getByText('Monthly scores and answer counts'));
    expect(screen.getByRole('row', { name: 'Sept 2026 0% 2' })).toBeVisible();
    expect(screen.getByRole('row', { name: 'Oct 2026 100% 2' })).toBeVisible();
  });

  it('orders lowest scores including zero, excludes unscored and excluded questions, and limits the list to five', () => {
    const questions = [
      { ...question, questionId: 20, question: 'Excluded?', includedInOverall: false },
      { ...question, questionId: 21, question: 'No data?', score: null },
      ...Array.from({ length: 6 }, (_, index) => ({ ...question, questionId: index + 1, question: `Question ${index + 1}?`, score: index * 10 })),
    ];
    render(<FeedbackInsights insights={insights} questions={questions.reverse()} />);
    const lowest = screen.getByRole('region', { name: 'Lowest-scoring questions' });
    expect(within(lowest).getAllByRole('listitem')).toHaveLength(5);
    expect(within(lowest).getAllByRole('listitem')[0]).toHaveTextContent('Question 1?');
    expect(within(lowest).getAllByRole('listitem')[0]).toHaveTextContent('0%');
    expect(within(lowest).queryByText('Excluded?')).not.toBeInTheDocument();
    expect(within(lowest).queryByText('No data?')).not.toBeInTheDocument();
    expect(within(lowest).queryByText('Question 6?')).not.toBeInTheDocument();
  });

  it('shows empty states and missing submission dates explicitly without inventing a zero score', () => {
    render(<FeedbackInsights questions={[]} insights={{ stars: { average: null, answers: 0, distribution: [] }, categories: [], trend: [], undatedScoredAnswers: 2 }} />);
    expect(screen.getByText('No data')).toBeVisible();
    expect(screen.getByText('No star answers in this selection.')).toBeVisible();
    expect(screen.getByText('No dated scored answers in this selection.')).toBeVisible();
    expect(screen.getByText(/2 scored answers have no submission date/)).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Monthly feedback scores' })).not.toBeInTheDocument();
  });

  it.each([0, 75, 100])('shows a single month as an honest summary instead of a one-point trend (%s)', async score => {
    render(<FeedbackInsights questions={[question]} insights={{ ...insights, trend: [{ ...insights.trend[0], score }] }} />);
    expect(screen.getByRole('group', { name: 'Single month feedback score' })).toHaveTextContent(`${score}%`);
    expect(screen.queryByRole('group', { name: 'Monthly feedback scores' })).not.toBeInTheDocument();
    expect(screen.getByText(/One month available/)).toBeVisible();
    await userEvent.click(screen.getByText('Monthly scores and answer counts'));
    expect(screen.getByRole('row', { name: `Sept 2026 ${score}% 2` })).toBeVisible();
  });

  it('keeps unscored categories in the details without plotting them as zero', async () => {
    render(<FeedbackInsights questions={[]} insights={{ ...insights, categories: [{ ...insights.categories[0], category: 'Unanswered category', score: null, scoredAnswers: 0 }] }} />);
    expect(screen.queryByRole('group', { name: 'Scored categories chart' })).not.toBeInTheDocument();
    expect(screen.getByText('No scored category answers yet.')).toBeVisible();
    await userEvent.click(screen.getByText('All categories and versions (1)'));
    expect(screen.getByRole('row', { name: /Unanswered category.*No data 0/ })).toBeVisible();
  });
});

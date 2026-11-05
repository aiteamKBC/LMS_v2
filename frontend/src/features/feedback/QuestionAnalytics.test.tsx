import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { FeedbackQuestionMetric } from '@/api/feedback';
import { QuestionAnalytics } from './QuestionAnalytics';

const metric: FeedbackQuestionMetric = {
  questionId: 1, question: 'Tutor support?', type: 'rating', formId: 4, formTitle: 'Lecture feedback',
  version: 1, category: 'Teaching', importance: 'high', weight: 3, includedInOverall: true,
  assignedCount: 40, answeredCount: 30, answerRate: 75, score: 82.5, scoredResponses: 30,
  status: 'good', averageRating: 4.3, scaleMax: 5, distribution: [{ label: '5', count: 20 }, { label: '4', count: 10 }],
};

describe('per-question feedback analytics', () => {
  it('reports answer classification percentages separately from the question average', async () => {
    render(<QuestionAnalytics questions={[{ ...metric, classification: { positive: 1, neutral: 1, negative: 2, unscored: 1 } }]} />);
    await userEvent.click(screen.getByRole('button', { name: /Lecture feedback.*Version 1/ }));
    await userEvent.click(screen.getByText('Positive 25% · Negative 50%'));
    expect(screen.getByText('neutral: 1 (25%)')).toBeVisible();
    expect(screen.getByText('Unscored answered questions: 1')).toBeVisible();
    expect(screen.getByText('83%')).toBeVisible();
  });
  it('separates score from answer rate and keeps the raw star average', async () => {
    render(<QuestionAnalytics questions={[metric]} overall={{ score: 82.5, scoredQuestions: 1, includedQuestions: 2 }} />);
    await userEvent.click(screen.getByRole('button', { name: /Lecture feedback.*Version 1/ }));
    const row = screen.getByRole('row', { name: /Tutor support/ });
    expect(within(row).getByText('75%')).toBeVisible();
    expect(within(row).getByText('83%')).toBeVisible();
    expect(within(row).getByText('4.3/5 rating average')).toBeVisible();
    expect(within(row).getByText('30 answered / 40 assigned')).toBeVisible();
    expect(within(row).getByText('Good')).toBeVisible();
    expect(screen.getByText('1 of 2 included questions have scored responses.')).toBeVisible();
  });
  it('distinguishes zero, no data, qualitative feedback and unknown assignment coverage', async () => {
    render(<QuestionAnalytics questions={[
      { ...metric, score: 0, status: 'needs_attention' },
      { ...metric, questionId: 2, question: 'No replies?', score: null, answeredCount: 0, answerRate: 0, status: 'no_data' },
      { ...metric, questionId: 3, question: 'Comments?', type: 'long_text', score: null, status: 'not_scored', distribution: [], assignedCount: null, answerRate: null, includedInOverall: false },
    ]} />);
    await userEvent.click(screen.getByRole('button', { name: /Lecture feedback.*Version 1/ }));
    expect(within(screen.getByRole('row', { name: /Tutor support/ })).getByText('0%')).toBeVisible();
    expect(within(screen.getByRole('row', { name: /No replies/ })).getByText('No data')).toBeVisible();
    const qualitative = screen.getByRole('row', { name: /Comments/ });
    expect(within(qualitative).getByText('Not scored')).toBeVisible();
    expect(within(qualitative).getByText('Not available')).toBeVisible();
    expect(within(qualitative).getByText('Qualitative feedback — see Responses')).toBeVisible();
  });
  it('does not combine immutable versions into one question row', async () => {
    render(<QuestionAnalytics questions={[metric, { ...metric, questionId: 2, version: 2, score: 25, status: 'needs_attention' }]} />);
    await userEvent.click(screen.getByRole('button', { name: /Lecture feedback.*Version 1/ }));
    await userEvent.click(screen.getByRole('button', { name: /Lecture feedback.*Version 2/ }));
    expect(screen.getAllByRole('row', { name: /Tutor support/ })).toHaveLength(2);
    expect(screen.getByText('Lecture feedback · v1 · Teaching')).toBeVisible();
    expect(screen.getByText('Lecture feedback · v2 · Teaching')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Lecture feedback — version 1' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Lecture feedback — version 2' })).toBeVisible();
  });

  it('starts every group collapsed, supports keyboard opening, and keeps the overall score visible', async () => {
    const user = userEvent.setup();
    render(<QuestionAnalytics questions={[metric, { ...metric, questionId: 2, version: 2 }]} overall={{ score: 72, scoredQuestions: 2, includedQuestions: 2 }} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /Lecture feedback.*Version/ });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('72%')).toBeVisible();
    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(buttons[1]).toHaveAttribute('aria-expanded', 'false');
    await user.click(buttons[0]);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('72%')).toBeVisible();
  });

  it('paginates ten questions per group, searches the full group, and leaves other versions and Overall unchanged', async () => {
    const user = userEvent.setup();
    const questions = Array.from({ length: 25 }, (_, index) => ({ ...metric, questionId: index + 1, question: `Question ${index + 1}?`, category: index === 24 ? 'Support' : 'Teaching' }));
    render(<QuestionAnalytics questions={[...questions, { ...metric, questionId: 26, version: 2, question: 'Other version?' }]} overall={{ score: 72, scoredQuestions: 26, includedQuestions: 26 }} />);
    const group = within(screen.getByRole('region', { name: 'Lecture feedback — version 1' }));
    await user.click(group.getByRole('button', { name: /View questions/ }));
    expect(group.getAllByRole('row')).toHaveLength(11); // Ten questions plus the table header.
    expect(group.getByText('Question 1?')).toBeVisible();
    expect(group.queryByText('Question 11?')).not.toBeInTheDocument();
    expect(group.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(group.getByRole('button', { name: 'Next' }));
    expect(group.getByText('Question 11?')).toBeVisible();
    await user.click(group.getByRole('button', { name: 'Next' }));
    expect(group.getAllByRole('row')).toHaveLength(6);
    expect(group.getByText('Showing 21–25 of 25 questions')).toBeVisible();
    expect(group.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.type(group.getByRole('searchbox'), 'support');
    expect(group.getByText('Question 25?')).toBeVisible();
    expect(group.getByText('Page 1 of 1')).toBeVisible();
    expect(group.getByText('Showing 1–1 of 1 questions (25 total)')).toBeVisible();
    await user.clear(group.getByRole('searchbox'));
    await user.type(group.getByRole('searchbox'), 'nothing matches');
    expect(group.getByText('No questions match this search.')).toBeVisible();
    expect(group.queryByRole('table')).not.toBeInTheDocument();
    await user.click(group.getByRole('button', { name: 'Clear search' }));
    expect(group.getByText('Question 1?')).toBeVisible();
    expect(screen.getByRole('button', { name: /Lecture feedback.*Version 2/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('72%')).toBeVisible();
    expect(screen.getByText('26 of 26 included questions have scored responses.')).toBeVisible();
  });

  it('clamps pagination when the supplied report gets smaller', async () => {
    const user = userEvent.setup();
    const questions = Array.from({ length: 21 }, (_, index) => ({ ...metric, questionId: index + 1, question: `Question ${index + 1}?` }));
    const { rerender } = render(<QuestionAnalytics questions={questions} />);
    await user.click(screen.getByRole('button', { name: /Lecture feedback.*Version 1/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    rerender(<QuestionAnalytics questions={[metric]} />);
    expect(screen.getByText('Page 1 of 1')).toBeVisible();
    expect(screen.getByText('Tutor support?')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});

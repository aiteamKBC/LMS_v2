import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { FeedbackQuestion } from '@/api/feedback';
import { QuestionAnalyticsSettings } from './QuestionAnalyticsSettings';

function Editor({ initial, locked = false }: { initial: FeedbackQuestion; locked?: boolean }) {
  const [question, setQuestion] = useState(initial);
  return <><QuestionAnalyticsSettings question={question} disabled={locked} onChange={config => setQuestion({ ...question, config })} /><output data-testid="config">{JSON.stringify(question.config)}</output></>;
}
const question: FeedbackQuestion = { type: 'rating', text: 'Clear?', required: true, helpText: '', config: { min: 1, max: 5, display: 'stars', labels: ['A', 'B', 'C', 'D', 'E'] } };

describe('question analytics settings', () => {
  it.each(['single_choice', 'multiple_choice', 'dropdown', 'likert'] as const)('requires answer scores for %s even when excluded from overall', async type => {
    const user = userEvent.setup();
    render(<Editor initial={{ ...question, type, config: { options: ['A', 'B'] } }} />);
    expect(screen.getByRole('spinbutton', { name: 'Score for answer 1: A' })).toHaveValue(null);
    expect(screen.queryByRole('option', { name: /^Not scored$/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Include in Overall Score' }));
    expect(screen.getByText('Needs setup')).toBeVisible();
    await user.type(screen.getByRole('spinbutton', { name: 'Score for answer 1: A' }), '0');
    await user.type(screen.getByRole('spinbutton', { name: 'Score for answer 2: B' }), '100');
    expect(screen.getByText('Ready')).toBeVisible();
    expect(JSON.parse(screen.getByTestId('config').textContent!).analytics).toMatchObject({ scoring: 'options', includeInOverall: false, optionScores: { A: 0, B: 100 } });
  });

  it('edits importance and scale direction without changing rating config', async () => {
    const user = userEvent.setup();
    render(<Editor initial={question} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question importance' }), 'critical');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question scoring' }), 'lower');
    await user.click(screen.getByRole('checkbox', { name: 'Include in Overall Score' }));
    expect(JSON.parse(screen.getByTestId('config').textContent!)).toEqual({
      ...question.config, analytics: { importance: 'critical', scoring: 'lower', includeInOverall: false, optionScores: {} },
    });
  });
  it('requires an explicit positive answer for Yes/No and supports negative wording', async () => {
    const user = userEvent.setup();
    render(<Editor initial={{ ...question, type: 'yes_no', config: {} }} />);
    expect(screen.getByRole('combobox', { name: 'Positive answer' })).toHaveValue('');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Positive answer' }), 'no');
    expect(JSON.parse(screen.getByTestId('config').textContent!).analytics).toMatchObject({ scoring: 'options', optionScores: { yes: 0, no: 100 } });
  });
  it('offers explicit per-option scores and preserves a real zero', async () => {
    const user = userEvent.setup();
    render(<Editor initial={{ ...question, type: 'single_choice', config: { options: ['Good', 'Poor'] } }} />);
    expect(screen.queryByRole('option', { name: /^Not scored$/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole('spinbutton', { name: 'Score for answer 1: Good' }), '75');
    await user.type(screen.getByRole('spinbutton', { name: 'Score for answer 2: Poor' }), '0');
    expect(JSON.parse(screen.getByTestId('config').textContent!).analytics.optionScores).toEqual({ Good: 75, Poor: 0 });
  });
  it('lets staff assign percentages to multiple-answer options while retaining their labels', async () => {
    const user = userEvent.setup();
    render(<Editor initial={{ ...question, type: 'multiple_choice', config: { options: ['Helpful', 'Unhelpful'] } }} />);
    expect(screen.getByRole('spinbutton', { name: 'Score for answer 1: Helpful' })).toBeVisible();
    expect(screen.getByText('Needs setup')).toBeVisible();
    await user.type(screen.getByRole('spinbutton', { name: 'Score for answer 1: Helpful' }), '100');
    await user.type(screen.getByRole('spinbutton', { name: 'Score for answer 2: Unhelpful' }), '0');
    expect(screen.getByText(/average of the selected options/)).toBeVisible();
    expect(JSON.parse(screen.getByTestId('config').textContent!)).toMatchObject({ options: ['Helpful', 'Unhelpful'], analytics: { scoring: 'options', optionScores: { Helpful: 100, Unhelpful: 0 } } });
  });
  it('adds a numeric reporting range without overwriting the answer configuration', async () => {
    const user = userEvent.setup();
    render(<Editor initial={{ ...question, type: 'number', config: { min: -1000, max: 1000 } }} />);
    expect(screen.getByRole('combobox', { name: 'Question scoring' })).toHaveValue('');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question scoring' }), 'lower');
    await user.type(screen.getByRole('spinbutton', { name: 'Scoring minimum' }), '10');
    await user.type(screen.getByRole('spinbutton', { name: 'Scoring maximum' }), '20');
    expect(JSON.parse(screen.getByTestId('config').textContent!)).toMatchObject({ min: -1000, max: 1000, analytics: { scoring: 'lower', scoreMin: 10, scoreMax: 20 } });
  });
  it('allows custom percentages for Yes and No after choosing a preset', async () => {
    const user = userEvent.setup();
    render(<Editor initial={{ ...question, type: 'yes_no', config: {} }} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Positive answer' }), 'yes');
    await user.clear(screen.getByRole('spinbutton', { name: 'Yes score' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Yes score' }), '80');
    await user.clear(screen.getByRole('spinbutton', { name: 'No score' }));
    await user.type(screen.getByRole('spinbutton', { name: 'No score' }), '20');
    expect(screen.getByRole('combobox', { name: 'Positive answer' })).toHaveValue('custom');
    expect(JSON.parse(screen.getByTestId('config').textContent!).analytics.optionScores).toEqual({ yes: 80, no: 20 });
  });
  it.each(['long_text', 'date', 'name', 'email', 'photo_upload'] as const)('does not invent a score for %s', type => {
    render(<Editor initial={{ ...question, type, config: {} }} />);
    expect(screen.queryByRole('combobox', { name: 'Question scoring' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Include in Overall Score' })).not.toBeInTheDocument();
  });
  it('disables every analytics input when the existing form is locked', () => {
    render(<Editor initial={question} locked />);
    expect(screen.getByRole('combobox', { name: 'Question importance' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Question scoring' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Include in Overall Score' })).toBeDisabled();
  });
  it('explains the actual rating score mapping and updates its direction', async () => {
    render(<Editor initial={question} />);
    const mapping = screen.getByRole('list', { name: 'Rating score mapping' });
    expect(mapping.children[0]).toHaveTextContent('1 ★0%Negative');
    expect(mapping.children[2]).toHaveTextContent('3 ★50%Neutral');
    expect(mapping.children[3]).toHaveTextContent('4 ★75%Positive');
    expect(mapping.children[4]).toHaveTextContent('5 ★100%Positive');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Question scoring' }), 'lower');
    expect(mapping.children[0]).toHaveTextContent('1 ★100%Positive');
  });
  it('starts custom Yes/No setup without inferring scores and distinguishes a missing score from a real zero', async () => {
    const user = userEvent.setup();
    render(<Editor initial={{ ...question, type: 'yes_no', config: {} }} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Positive answer' }), 'custom');
    const settings = within(screen.getByRole('group', { name: 'Scoring & analytics' }));
    expect(settings.getByRole('status')).toHaveTextContent('2 answers. Blank is not zero.');
    expect(screen.getByRole('spinbutton', { name: 'Yes score' })).toHaveValue(null);
    await user.type(screen.getByRole('spinbutton', { name: 'Yes score' }), '0');
    expect(settings.getByRole('status')).toHaveTextContent('1 answer. Blank is not zero.');
    await user.type(screen.getByRole('spinbutton', { name: 'No score' }), '100');
    expect(settings.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeVisible();
  });
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackQuestion, FeedbackSection } from '@/api/feedback';
import { FormScoringSetup } from './FormScoringSetup';
import { FormScorePreview } from './FormScorePreview';

const star: FeedbackQuestion = { type: 'rating', text: 'Was the explanation clear?', helpText: '', required: true, config: { min: 1, max: 5, display: 'stars', analytics: { importance: 'critical' } } };
const yes: FeedbackQuestion = { type: 'yes_no', text: 'Was support available?', helpText: '', required: true, config: { analytics: { scoring: 'options', importance: 'low', optionScores: { yes: 100, no: 0 } } } };
const sections: FeedbackSection[] = [{ title: 'Teaching', description: '', questions: [star, yes] }];

afterEach(() => vi.unstubAllGlobals());

describe('staff form scoring setup', () => {
  it('reviews ready, incomplete and unscored questions and selects the correct question to configure', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const incomplete = { ...yes, config: { analytics: { scoring: 'options' as const, optionScores: { yes: 100 } } } };
    render(<FormScoringSetup sections={[{ ...sections[0], questions: [star, incomplete, { ...star, type: 'long_text', text: 'Any comments?', config: {} }] }]} bank={false} locked={false} onSelect={select} />);
    expect(screen.queryByRole('region', { name: 'Staff scoring simulation' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review question scoring' }));
    expect(screen.getByRole('status')).toHaveTextContent('Finish scoring for 1 question before publishing');
    expect(screen.getByRole('status')).toHaveTextContent('You can save an incomplete draft');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter scoring readiness' }), 'incomplete');
    expect(screen.getByText('Was support available?')).toBeVisible();
    expect(screen.queryByText('Was the explanation clear?')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Configure scoring 1.2' }));
    expect(select).toHaveBeenCalledWith(0, 1);
    await user.type(screen.getByRole('searchbox', { name: 'Search scoring questions' }), 'missing');
    expect(screen.getByText('No questions match this selection.')).toBeVisible();
  });

  it('pages large banks and lets locked forms be inspected without enabling saved configuration edits', async () => {
    const user = userEvent.setup();
    render(<FormScoringSetup sections={[{ ...sections[0], questions: Array.from({ length: 12 }, (_, index) => ({ ...star, text: `Question ${index + 1}` })) }]} bank locked onSelect={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Review question scoring' }));
    expect(screen.getAllByRole('button', { name: /Inspect scoring/ })).toHaveLength(8);
    await user.click(screen.getByRole('button', { name: 'Next questions' }));
    expect(screen.getAllByRole('button', { name: /Inspect scoring/ })).toHaveLength(4);
    expect(screen.getByText(/This version is locked/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try scoring' }));
    expect(screen.getByRole('region', { name: 'Staff scoring simulation' })).toBeVisible();
  });

  it('previews the weighted response and re-evaluates settings without saving or losing example answers', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(() => { throw new Error('Examples must not access the network'); });
    vi.stubGlobal('fetch', fetch);
    const original = JSON.stringify(sections);
    const view = render(<FormScorePreview sections={sections} bank={false} />);
    const result = () => within(screen.getByRole('region', { name: 'Example response result' }));
    expect(result().getByText('No score yet')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Example answer 1.1: Was the explanation clear?' }), '5');
    expect(result().getByText('100%')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Example answer 1.2: Was support available?' }), 'false');
    expect(result().getByText('80%')).toBeVisible();
    expect(result().getByText('Positive')).toBeVisible();
    await user.click(screen.getByText('How the example score is calculated'));
    expect(screen.getByText('400 ÷ 5 = 80%')).toBeVisible();
    const changed: FeedbackSection[] = [{ ...sections[0], questions: [star, { ...yes, config: { ...yes.config, analytics: { ...yes.config.analytics, importance: 'critical' } } }] }];
    view.rerender(<FormScorePreview sections={changed} bank={false} />);
    expect(screen.getByRole('combobox', { name: 'Example answer 1.1: Was the explanation clear?' })).toHaveValue('5');
    expect(result().getByText('50%')).toBeVisible();
    expect(result().getByText('Neutral')).toBeVisible();
    expect(JSON.stringify(sections)).toBe(original);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('supports multiple answers and numeric clamping while keeping unscored questions out of the denominator', async () => {
    const user = userEvent.setup();
    const multi: FeedbackQuestion = { ...yes, type: 'multiple_choice', text: 'Helpful activities?', config: { options: ['Examples', 'None'], analytics: { scoring: 'options', optionScores: { Examples: 100, None: 0 } } } };
    const number: FeedbackQuestion = { ...yes, type: 'number', text: 'Example number?', config: { analytics: { scoring: 'lower', scoreMin: 0, scoreMax: 10 } } };
    render(<FormScorePreview sections={[{ ...sections[0], questions: [multi, number, { ...yes, type: 'long_text', config: {}, text: 'Comments' }] }]} bank={false} />);
    await user.click(screen.getByRole('checkbox', { name: 'Examples' }));
    await user.click(screen.getByRole('checkbox', { name: 'None' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Example answer 1.2: Example number?' }), '35');
    const result = within(screen.getByRole('region', { name: 'Example response result' }));
    expect(result.getByText('25%')).toBeVisible();
    expect(result.getByText(/2 answered questions/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reset example' }));
    expect(result.getByText('No score yet')).toBeVisible();
  });

  it('swaps example questions within category quotas and clears sample identities when the bank structure changes', async () => {
    const user = userEvent.setup();
    const bank = [{ ...sections[0], questionsPerDelivery: 1, questions: [star, yes] }];
    const original = JSON.stringify(bank);
    const view = render(<FormScorePreview sections={bank} bank />);
    expect(screen.getByRole('checkbox', { name: 'Include in example 1.1' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Include in example 1.2' })).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Example answer 1.1: Was the explanation clear?' }), '5');
    await user.click(screen.getByRole('checkbox', { name: 'Include in example 1.1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Include in example 1.2' }));
    expect(screen.getByRole('combobox', { name: 'Example answer 1.2: Was support available?' })).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Example response result' })).getByText('No score yet')).toBeVisible();
    view.rerender(<FormScorePreview sections={[{ ...bank[0], questions: [yes, star] }]} bank />);
    expect(within(screen.getByRole('region', { name: 'Example response result' })).getByText('No score yet')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Include in example 1.1' })).toBeChecked();
    expect(JSON.stringify(bank)).toBe(original);
  });
});

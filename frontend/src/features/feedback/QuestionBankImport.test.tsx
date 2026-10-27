import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuestionBankImport } from './QuestionBankImport';

const mixedBank = [
  'Category,Question,Type,Options,Required,Help text',
  'Teaching,How clear was the explanation?,stars,,yes,',
  'Teaching,Were objectives clear?,yes_no,,no,',
  'Teaching,Which topic helped?,short_text,,no,',
  'Activities,Which activity helped most?,single_choice,Discussion | Practice,yes,Pick one.',
  ',What could we improve?,text,,no,',
].join('\r\n');

function csvFile(contents = mixedBank) {
  const bytes = new TextEncoder().encode(contents);
  const file = new File([bytes], 'mixed-bank.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: async () => bytes.buffer });
  return file;
}

describe('QuestionBankImport', () => {
  it('downloads an Excel template and imports friendly answer names without displaying internal codes', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<QuestionBankImport locked={false} onApply={onApply} />);
    const template = screen.getByRole('link', { name: 'Download Excel template' });
    expect(template).toHaveAttribute('href', '/templates/post-lecture-question-bank.xlsx');
    expect(template).toHaveAttribute('download', 'live-sessions-feedback-question-bank.xlsx');
    await user.upload(screen.getByLabelText('Question bank file'), csvFile([
      'Category,Question,Answer type,Option 1,Option 2',
      'Teaching,How clear was the explanation?,5 Stars,,',
      'Teaching,Were objectives clear?,Yes / No,,',
      'Teaching,Which topic helped?,Short answer,,',
      'Activities,Which activity helped most?,Choose one,Discussion,Practice',
      'General,What could we improve?,Written answer,,',
    ].join('\r\n')));
    expect(await screen.findByText(/5 questions across 3 categories/)).toBeVisible();
    expect(screen.queryByText('single_choice')).not.toBeInTheDocument();
    expect(screen.getByText('Choose one')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Questions per lecture: Teaching' }), '2');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fixed closing question' }), '2:0');
    expect(screen.getByRole('combobox', { name: 'Questions per lecture: General' })).toBeDisabled();
    expect(screen.getByText('Each lecture: 4 questions')).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Replace draft questions with this bank' }));
    expect(onApply.mock.calls[0][0]).toMatchObject([
      { title: 'Teaching', questionsPerDelivery: 2, questions: [{ type: 'rating', config: { display: 'stars', max: 5 } }, { type: 'yes_no' }, { type: 'short_text' }] },
      { title: 'Activities', questionsPerDelivery: 1, questions: [{ type: 'single_choice', config: { options: ['Discussion', 'Practice'] } }] },
      { title: 'General comments', questionsPerDelivery: null, questions: [{ type: 'long_text', text: 'What could we improve?' }] },
    ]);
  });

  it('adjusts a category count for the closing question and restores it when deselected', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<QuestionBankImport locked={false} onApply={onApply} />);
    await user.upload(screen.getByLabelText('Question bank file'), csvFile([
      'Category,Question,Answer type',
      'Teaching,How clear was it?,5 Stars',
      'Teaching,What could we improve?,Written answer',
    ].join('\r\n')));
    const count = await screen.findByRole('combobox', { name: 'Questions per lecture: Teaching' });
    await user.selectOptions(count, '2');
    const closing = screen.getByRole('combobox', { name: 'Fixed closing question' });
    await user.selectOptions(closing, '0:1');
    expect(count).toHaveValue('1');
    expect(screen.getByText('Each lecture: 2 questions')).toBeVisible();
    await user.selectOptions(closing, '');
    expect(count).toHaveValue('2');
    await user.selectOptions(closing, '0:1');
    await user.click(screen.getByRole('button', { name: 'Replace draft questions with this bank' }));
    expect(onApply.mock.calls[0][0]).toMatchObject([
      { title: 'Teaching', questionsPerDelivery: 1, questions: [{ type: 'rating' }] },
      { title: 'General comments', questionsPerDelivery: null, questions: [{ type: 'long_text' }] },
    ]);
  });

  it('locks the optional closing selection when the form structure is locked', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const { rerender } = render(<QuestionBankImport locked={false} onApply={onApply} />);
    await user.upload(screen.getByLabelText('Question bank file'), csvFile('Category,Question,Answer type\r\nGeneral,Any comments?,Written answer'));
    await screen.findByRole('combobox', { name: 'Fixed closing question' });
    rerender(<QuestionBankImport locked onApply={onApply} />);
    expect(screen.getByRole('combobox', { name: 'Fixed closing question' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Replace draft questions with this bank' }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('sets a single draw count per category and applies mixed types only on request', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<QuestionBankImport locked={false} onApply={onApply} />);
    await user.upload(screen.getByLabelText('Question bank file'), csvFile());
    expect(await screen.findByText(/5 questions across 2 categories/)).toBeVisible();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(onApply).not.toHaveBeenCalled();
    const teaching = screen.getByRole('combobox', { name: 'Questions per lecture: Teaching' });
    expect(teaching).toHaveValue('1');
    await user.selectOptions(teaching, '2');
    expect(screen.getByText('Each lecture: 4 questions')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Replace draft questions with this bank' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toMatchObject([
      { title: 'Teaching', questionsPerDelivery: 2, questions: [{ type: 'rating' }, { type: 'yes_no', required: false }, { type: 'short_text' }] },
      { title: 'Activities', questionsPerDelivery: 1, questions: [{ type: 'single_choice', config: { options: ['Discussion', 'Practice'] }, helpText: 'Pick one.' }] },
      { title: 'General comments', questionsPerDelivery: null, questions: [{ type: 'long_text' }] },
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('Save the form to keep it');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('supports a fixed whole category without requiring a closing text question', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<QuestionBankImport locked={false} onApply={onApply} />);
    await user.upload(screen.getByLabelText('Question bank file'), csvFile(mixedBank.split('\r\n').slice(0, -1).join('\r\n')));
    const teaching = await screen.findByRole('combobox', { name: 'Questions per lecture: Teaching' });
    await user.selectOptions(teaching, '3');
    expect(screen.getByRole('option', { name: 'All 3 questions (fixed)' })).toBeInTheDocument();
    expect(screen.getByText('Each lecture: 4 questions')).toBeVisible();
    expect(screen.queryByText('Fixed closing question:')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Replace draft questions with this bank' }));
    expect(onApply.mock.calls[0][0][0].questionsPerDelivery).toBe(3);
  });

  it('cancels a preview without applying and lets the same file be uploaded again', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<QuestionBankImport locked={false} onApply={onApply} />);
    const file = csvFile();
    await user.upload(screen.getByLabelText('Question bank file'), file);
    await user.click(await screen.findByRole('button', { name: 'Cancel import' }));
    expect(screen.queryByText(/Preview: mixed-bank/)).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    await user.upload(screen.getByLabelText('Question bank file'), file);
    expect(await screen.findByText(/Preview: mixed-bank/)).toBeVisible();
  });

  it('shows a validation error and discards the previous preview on invalid upload', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<QuestionBankImport locked={false} onApply={onApply} />);
    await user.upload(screen.getByLabelText('Question bank file'), csvFile());
    await screen.findByText(/Preview: mixed-bank/);
    await user.upload(screen.getByLabelText('Question bank file'), csvFile('Category,Question,Type\r\nTeaching,Question?,single_choice'));
    expect(await screen.findByRole('alert')).toHaveTextContent('add at least two choices');
    expect(screen.queryByRole('button', { name: 'Replace draft questions with this bank' })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('disables uploads and prevents applying a preview if the structure becomes locked', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const { rerender } = render(<QuestionBankImport locked={false} onApply={onApply} />);
    await user.upload(screen.getByLabelText('Question bank file'), csvFile());
    await screen.findByRole('button', { name: 'Replace draft questions with this bank' });
    rerender(<QuestionBankImport locked onApply={onApply} />);
    expect(screen.getByLabelText('Question bank file')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Questions per lecture: Teaching' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Replace draft questions with this bank' }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows and clears the reading state when a file cannot be read', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<QuestionBankImport locked={false} onApply={onApply} />);
    let rejectRead!: (reason: Error) => void;
    const pending = new Promise<ArrayBuffer>((_resolve, reject) => { rejectRead = reject; });
    const file = csvFile();
    Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: () => pending });
    await user.upload(screen.getByLabelText('Question bank file'), file);
    expect(screen.getByRole('status')).toHaveTextContent('Reading');
    expect(screen.getByLabelText('Question bank file')).toBeDisabled();
    rejectRead(new Error('Unreadable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be read');
    await waitFor(() => expect(screen.getByLabelText('Question bank file')).not.toBeDisabled());
    expect(onApply).not.toHaveBeenCalled();
  });
});

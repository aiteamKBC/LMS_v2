import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { feedbackApi, type FeedbackForm } from '@/api/feedback';
import { FormBuilder } from './FormBuilder';

vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));
Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live requests are forbidden in import tests'); })));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function bankFile() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Category', 'Question', 'Answer type', 'Questions per lecture', 'Yes score', 'No score', 'Include in overall score', 'Required', 'Help text'],
    ['Teaching', 'Clear explanation?', '5 Stars', 1, '', '', 'Yes', 'Yes', 'Rate the explanation.'],
    ['Teaching', 'Useful examples?', '5 Stars', 1],
    ['Teaching', 'Enough support?', 'Yes / No', 1, 75, 0, 'No', 'No'],
    ['Comments', 'What could improve?', 'Written answer', 1],
  ]), 'Questions');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const file = new File([bytes], 'bank.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes });
  return file;
}

describe('fixed spreadsheet questions for other feedback types', () => {
  it.each(['general', 'post_event', 'event_rsvp', 'post_mcm_review', 'post_progress_review', 'mid_module', 'end_module'] as const)(
    'imports all questions for %s while preserving its saved timing, scope and settings', async formType => {
      const user = userEvent.setup();
      const moduleForm = ['mid_module', 'end_module'].includes(formType);
      const form: FeedbackForm = {
        id: 7, title: 'Synthetic feedback', formType, deliveryScope: moduleForm ? 'all_modules' : 'manual',
        templateKey: 'synthetic-template', version: 2, isCurrent: true, previousVersionId: 6,
        curriculumScope: { programmeId: 'P1', programmeName: 'Programme', cohortId: 'C1', cohortName: 'Cohort', groupId: 'G1', groupName: 'Group', moduleCatalogueId: '', moduleName: '' },
        description: 'Keep description', instructions: 'Keep instructions', status: 'draft',
        startDate: moduleForm ? null : '2026-11-01T09:00:00Z', dueDate: moduleForm ? null : '2026-12-01T09:00:00Z',
        anonymousResponses: true, allowSaveContinue: false, allowEditAfterSubmission: true,
        createdBy: 'Staff', createdAt: '2026-10-26T09:00:00Z', updatedAt: '2026-10-26T09:00:00Z', publishedAt: null,
        assignedCount: 0, responseCount: 0, startedCount: 0, structureLocked: false, willCreateVersion: true,
        sections: [{ title: 'Existing section', description: '', questionsPerDelivery: null, questions: [{ id: 101, type: 'long_text', text: 'Existing question?', required: false, helpText: '', config: {} }] }],
      };
      vi.spyOn(feedbackApi, 'getForm').mockResolvedValue({ form });
      const update = vi.spyOn(feedbackApi, 'updateForm').mockResolvedValue({ form });
      render(<MemoryRouter initialEntries={['/engagement/reports/feedback/forms/7/edit']}><Routes><Route path="/engagement/reports/feedback/forms/:formId/edit" element={<FormBuilder />} /></Routes></MemoryRouter>);
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('Existing question?'));
      await user.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      const before = update.mock.calls[0][1];

      await user.upload(screen.getByLabelText('Question bank file'), bankFile());
      expect(await screen.findByText('This form: 4 questions (all fixed)')).toBeVisible();
      expect(screen.queryByRole('combobox', { name: /questions per lecture/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Fixed closing question' })).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('Existing question?');
      await user.click(screen.getByRole('button', { name: 'Replace draft questions with this bank' }));
      expect(screen.getByText('All questions (fixed): 4 questions in this form.')).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('Clear explanation?');
      await user.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
      const after = update.mock.calls[1][1];
      expect(after).toEqual({ ...before, sections: expect.any(Array) });
      expect(after.sections).toMatchObject([
        { title: 'Teaching', questionsPerDelivery: null, questions: [
          { text: 'Clear explanation?', type: 'rating', required: true, helpText: 'Rate the explanation.' },
          { text: 'Useful examples?', type: 'rating' },
          { type: 'yes_no', required: false, config: { analytics: { scoring: 'options', optionScores: { yes: 75, no: 0 }, includeInOverall: false } } },
        ] },
        { title: 'Comments', questionsPerDelivery: null, questions: [{ type: 'long_text' }] },
      ]);
    });

  it('discards a lecture import preview when the type changes and creates a fixed form on reimport', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(feedbackApi, 'createForm').mockResolvedValue({ form: { id: 99, version: 1 } as FeedbackForm });
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);
    await user.upload(screen.getByLabelText('Question bank file'), bankFile());
    expect(await screen.findByText('Each lecture: 2 questions')).toBeVisible();
    screen.getByRole('combobox', { name: 'Form Type' }).focus();
    await user.keyboard('{ArrowDown}{End}{Enter}');
    expect(screen.queryByRole('button', { name: 'Replace draft questions with this bank' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /questions per lecture/i })).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText('Question bank file'), bankFile());
    await user.click(await screen.findByRole('button', { name: 'Replace draft questions with this bank' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ formType: 'general', deliveryScope: 'manual', sections: [
      { questionsPerDelivery: null, questions: [{ text: 'Clear explanation?' }, { text: 'Useful examples?' }, { text: 'Enough support?' }] },
      { questionsPerDelivery: null, questions: [{ text: 'What could improve?' }] },
    ] });
  });
});

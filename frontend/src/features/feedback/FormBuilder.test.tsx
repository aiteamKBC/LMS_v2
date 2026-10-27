import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { feedbackApi, type FeedbackForm } from '@/api/feedback';
import { FormBuilder } from './FormBuilder';

vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));
Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });

afterEach(() => vi.restoreAllMocks());

async function chooseGeneralFeedback(user: ReturnType<typeof userEvent.setup>) {
  screen.getByRole('combobox', { name: 'Form Type' }).focus();
  await user.keyboard('{ArrowDown}{End}{Enter}');
}

describe('post-lecture feedback delivery scope', () => {
  it.each(['post_lecture', 'general', 'post_event', 'event_rsvp', 'post_mcm_review', 'post_progress_review', 'mid_module', 'end_module'] as const)('offers staff scoring examples for %s without including them in saved form data or learner preview', async formType => {
    const user = userEvent.setup();
    const form: FeedbackForm = {
      id: 7, title: 'Synthetic feedback', formType, deliveryScope: ['post_lecture', 'mid_module', 'end_module'].includes(formType) ? 'all_modules' : 'manual',
      templateKey: 'synthetic-template', version: 1, isCurrent: true, previousVersionId: null,
      curriculumScope: { programmeId: '', programmeName: '', cohortId: '', cohortName: '', groupId: '', groupName: '', moduleCatalogueId: '', moduleName: '' },
      description: 'Keep description', instructions: 'Keep instructions', status: 'draft', startDate: '2026-11-01T09:00:00Z', dueDate: null,
      anonymousResponses: false, allowSaveContinue: true, allowEditAfterSubmission: false,
      createdBy: 'Staff', createdAt: '2026-10-26T09:00:00Z', updatedAt: '2026-10-26T09:00:00Z', publishedAt: null,
      assignedCount: 0, responseCount: 0, startedCount: 0, structureLocked: false, willCreateVersion: false,
      sections: [{ title: 'Teaching', description: '', questionsPerDelivery: formType === 'post_lecture' ? 1 : null, questions: [{ id: 101, type: 'rating', text: 'Support?', required: true, helpText: '', config: { min: 1, max: 5, display: 'stars' } }] }],
    };
    vi.spyOn(feedbackApi, 'getForm').mockResolvedValue({ form });
    const update = vi.spyOn(feedbackApi, 'updateForm').mockResolvedValue({ form });
    render(<MemoryRouter initialEntries={['/engagement/reports/feedback/forms/7/edit']}><Routes><Route path="/engagement/reports/feedback/forms/:formId/edit" element={<FormBuilder />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('Support?'));
    await user.click(screen.getByRole('button', { name: 'Try scoring' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Example answer 1.1: Support?' }), '5');
    expect(within(screen.getByRole('region', { name: 'Example response result' })).getByText('100%')).toBeVisible();
    expect(update).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.queryByRole('region', { name: 'Form scoring setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Question importance' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toMatchObject({ formType, deliveryScope: form.deliveryScope, startDate: form.startDate, dueDate: null, sections: form.sections });
    expect(JSON.stringify(update.mock.calls[0][1])).not.toContain('answer');
  });

  it.each(['Mid-module Feedback', 'End-module Feedback'])('configures %s using module dates and assignment', async label => {
    const user = userEvent.setup();
    const curriculum = vi.spyOn(feedbackApi, 'curriculumOptions').mockResolvedValue({
      programmes: [{ id: 'P1', name: 'Data' }], cohorts: [], groups: [],
      modules: [{ id: 'M1', name: 'Foundations', programmeId: 'P1', cohortId: 'C1', groupId: 'G1' }],
    });
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);
    screen.getByRole('combobox', { name: 'Form Type' }).focus();
    await user.keyboard('{ArrowDown}');
    await user.click(screen.getByRole('option', { name: new RegExp(label) }));
    expect(screen.getByText('Module delivery')).toBeVisible();
    expect(screen.getByRole('radio', { name: /All modules/ })).toBeChecked();
    expect(screen.getByText(/Responses remain open until the template is closed manually/)).toBeVisible();
    expect(screen.queryByLabelText('Start Date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Due Date')).not.toBeInTheDocument();
    expect(screen.queryByText('Reusable Live Sessions Feedback QR')).not.toBeInTheDocument();
    expect(screen.queryByText('Upload question bank')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /One module only/ }));
    expect(await screen.findByRole('combobox', { name: 'Programme' })).toBeVisible();
    await waitFor(() => expect(curriculum).toHaveBeenCalledTimes(1));
  });

  it('previews an uploaded bank before replacing the draft and shows one learner page', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Category', 'Question', 'Questions per lecture', 'Type'],
      ['Teaching', 'Was the explanation clear?', 1, 'stars'],
      ['Teaching', 'Were the examples helpful?', 1, 'stars'],
      ['Resources', 'Were the materials useful?', 1, 'stars'],
      ['Resources', 'Were the activities useful?', 1, 'stars'],
      ['', 'What could we improve?', '', 'text'],
    ]), 'Questions');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const file = new File([bytes], 'questions.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes });
    await user.upload(screen.getByLabelText('Question bank file'), file);
    expect(await screen.findByText(/5 questions across 2 categories/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Section 1 title' })).toHaveValue('Category 1');
    expect(screen.getByText('Each lecture: 3 questions')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Questions per lecture: Teaching' }), '2');
    expect(screen.getByText('Each lecture: 4 questions')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Replace draft questions with this bank' }));
    expect(screen.getByRole('textbox', { name: 'Section 1 title' })).toHaveValue('Teaching');
    expect(screen.getByRole('combobox', { name: 'Section 1 questions per lecture' })).toHaveValue('2');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('1/1')).toBeVisible();
    expect(screen.getByText('What could we improve?')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('shows the upload and Excel template first while retaining manual five-star editing', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);

    expect(screen.getByText('Reusable Live Sessions Feedback QR')).toBeVisible();
    expect(screen.getByText(`${window.location.origin}/login?lectureFeedback=1`)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Question bank' })).toBeVisible();
    expect(screen.getAllByRole('radio', { name: /star/ })).toHaveLength(5);
    expect(screen.getByRole('combobox', { name: 'Rating style' })).toHaveValue('stars');
    expect(screen.getByLabelText('Question bank file')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Download Excel template' })).toHaveAttribute('href', '/templates/post-lecture-question-bank.xlsx');
    expect(screen.getByRole('heading', { name: 'Form structure' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Question settings' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Form preview' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '+ Add Question to section 1' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Section 1 questions per lecture' }), '1');
    expect(screen.getByRole('combobox', { name: 'Section 1 questions per lecture' })).toHaveValue('1');
    expect(screen.getByRole('status')).toHaveTextContent('Learners will answer 1 question per lecture');
  });

  it('saves imported choice types and category quotas without changing other form details', async () => {
    const user = userEvent.setup();
    const createForm = vi.spyOn(feedbackApi, 'createForm').mockResolvedValue({ form: { id: 999, version: 1 } as FeedbackForm });
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);
    await user.type(screen.getByRole('textbox', { name: 'Form Name' }), 'Mixed question bank');
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Keep this description.');
    const bytes = new TextEncoder().encode([
      ['Category', 'Question', 'Answer type', 'Option 1', 'Option 2', 'Required', 'Yes score', 'No score', 'Option 1 score', 'Option 2 score', 'Include in overall score'],
      ['Teaching', 'Was the explanation clear?', '5 Stars', '', '', 'yes'],
      ['Teaching', 'Were objectives clear?', 'Yes / No', '', '', 'no', 75, 0, '', '', 'No'],
      ['Resources', 'Which resource helped?', 'Choose one', 'Slides', 'Workbook', 'yes', '', '', 100, 0, 'Yes'],
      ['General', 'Any comments?', 'Written answer', '', '', 'no'],
    ].map(row => row.join(',')).join('\r\n'));
    const file = new File([bytes], 'mixed.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    await user.upload(screen.getByLabelText('Question bank file'), file);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Questions per lecture: Teaching' }), '2');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fixed closing question' }), '2:0');
    expect(createForm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Replace draft questions with this bank' }));
    expect(createForm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(createForm).toHaveBeenCalledTimes(1));
    expect(createForm.mock.calls[0][0]).toMatchObject({
      title: 'Mixed question bank', description: 'Keep this description.',
      formType: 'post_lecture', deliveryScope: 'all_modules',
      sections: [
        { title: 'Teaching', questionsPerDelivery: 2, questions: [{ type: 'rating' }, { type: 'yes_no', required: false, config: { analytics: { scoring: 'options', optionScores: { yes: 75, no: 0 }, includeInOverall: false } } }] },
        { title: 'Resources', questionsPerDelivery: 1, questions: [{ type: 'single_choice', config: { options: ['Slides', 'Workbook'], analytics: { optionScores: { Slides: 100, Workbook: 0 }, includeInOverall: true } } }] },
        { title: 'General comments', questionsPerDelivery: null },
      ],
    });
  });

  it('edits uploaded questions in three panels without changing other questions or quotas', async () => {
    const user = userEvent.setup();
    const createForm = vi.spyOn(feedbackApi, 'createForm').mockResolvedValue({ form: { id: 999, version: 1 } as FeedbackForm });
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);
    const bytes = new TextEncoder().encode([
      'Category,Question,Answer type,Option 1,Option 2',
      'Teaching,Clear explanation?,5 Stars,,',
      'Teaching,Useful examples?,5 Stars,,',
      'Resources,Best resource?,Choose one,Slides,Workbook',
      'Resources,Enough resources?,Yes / No,,',
      'General,Any comments?,Written answer,,',
    ].join('\r\n'));
    const file = new File([bytes], 'bank.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    await user.upload(screen.getByLabelText('Question bank file'), file);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Fixed closing question' }), '2:0');
    await user.click(screen.getByRole('button', { name: 'Replace draft questions with this bank' }));

    expect(screen.getByRole('heading', { name: 'Form structure' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Question settings' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('Clear explanation?');
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Teaching' })).toBeVisible();
    expect(screen.getAllByRole('combobox', { name: /Section \d+ questions per lecture/ })).toHaveLength(2);
    expect(screen.queryByRole('combobox', { name: 'Section 3 questions per lecture' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Edit section 2 question 1:/ }));
    expect(screen.getByRole('combobox', { name: 'Question 1 type' })).toHaveValue('single_choice');
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Resources' })).toBeVisible();
    await user.clear(screen.getByRole('textbox', { name: 'Question text' }));
    await user.type(screen.getByRole('textbox', { name: 'Question text' }), 'Most useful resource?');
    await user.clear(screen.getByRole('textbox', { name: 'Answer option 2' }));
    await user.type(screen.getByRole('textbox', { name: 'Answer option 2' }), 'Practice guide');
    await user.type(screen.getByPlaceholderText('Add guidance for learners'), 'Choose one resource.');
    await user.click(screen.getByRole('checkbox', { name: /Required question/ }));
    await user.click(screen.getByRole('button', { name: /Edit section 1 question 2:/ }));
    await user.type(screen.getByRole('textbox', { name: '1 star description' }), 'Not useful');
    await user.click(screen.getByRole('button', { name: /Edit section 1 question 1:/ }));
    expect(screen.getByRole('textbox', { name: '1 star description' })).toHaveValue('');

    // The middle category navigation selects the same question in the settings panel.
    await user.click(within(screen.getByRole('navigation', { name: 'Form progress' })).getByRole('button', { name: /Resources/ }));
    expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('Most useful resource?');
    expect(screen.getByRole('textbox', { name: 'Answer option 2' })).toHaveValue('Practice guide');
    expect(screen.getByRole('button', { name: /Edit section 2 question 1:/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('1/1')).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Form progress' })).not.toBeInTheDocument();
    expect(screen.getByText('Any comments?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Edit form' }));
    expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('Most useful resource?');
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Resources' })).toBeVisible();
    expect(createForm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(createForm).toHaveBeenCalledTimes(1));
    expect(createForm.mock.calls[0][0].sections).toMatchObject([
      { title: 'Teaching', questionsPerDelivery: 1, questions: [
        { text: 'Clear explanation?', type: 'rating', config: { display: 'stars', labels: ['', '', '', '', ''] } },
        { text: 'Useful examples?', type: 'rating', config: { labels: ['Not useful', '', '', '', ''] } },
      ] },
      { title: 'Resources', questionsPerDelivery: 1, questions: [
        { text: 'Most useful resource?', type: 'single_choice', required: false, helpText: 'Choose one resource.', config: { options: ['Slides', 'Practice guide'] } },
        { text: 'Enough resources?', type: 'yes_no' },
      ] },
      { title: 'General comments', questionsPerDelivery: null, questions: [{ text: 'Any comments?', type: 'long_text' }] },
    ]);
  }, 20000);

  it('resets all three panels to the first imported question when replacing a selected draft', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: '+ Add Section' }));
    await user.click(screen.getByRole('button', { name: '+ Add Question to section 2' }));
    const bytes = new TextEncoder().encode('Category,Question,Answer type\r\nNew category,New question?,Yes / No');
    const file = new File([bytes], 'replacement.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    await user.upload(screen.getByLabelText('Question bank file'), file);
    await user.click(await screen.findByRole('button', { name: 'Replace draft questions with this bank' }));
    expect(screen.getByRole('textbox', { name: 'Section 1 title' })).toHaveValue('New category');
    expect(screen.queryByRole('textbox', { name: 'Section 2 title' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('New question?');
    expect(screen.getByRole('combobox', { name: 'Question 1 type' })).toHaveValue('yes_no');
    expect(screen.getByRole('button', { name: /Edit section 1 question 1:/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'New category' })).toBeVisible();
  });

  it('builds categories, mixed questions and a fixed closing answer entirely on screen', async () => {
    const user = userEvent.setup();
    const createForm = vi.spyOn(feedbackApi, 'createForm').mockResolvedValue({ form: { id: 999, version: 1 } as FeedbackForm });
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);
    await user.type(screen.getByRole('textbox', { name: 'Form Name' }), 'Weekly feedback');
    await user.clear(screen.getByRole('textbox', { name: 'Section 1 title' }));
    await user.type(screen.getByRole('textbox', { name: 'Section 1 title' }), 'Teaching');
    await user.type(screen.getByRole('textbox', { name: 'Question text' }), 'Was the explanation clear?');
    await user.click(screen.getByRole('button', { name: '+ Add Question to section 1' }));
    await user.type(screen.getByRole('textbox', { name: 'Question text' }), 'Were the objectives clear?');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question 2 type' }), 'yes_no');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Section 1 questions per lecture' }), '1');
    await user.click(screen.getByRole('button', { name: 'Add closing question' }));
    await user.type(screen.getByRole('textbox', { name: 'Question text' }), 'What could we improve?');
    // A later category is inserted before the closing question, not after it.
    await user.click(screen.getByRole('button', { name: '+ Add Section' }));
    await user.clear(screen.getByRole('textbox', { name: 'Section 2 title' }));
    await user.type(screen.getByRole('textbox', { name: 'Section 2 title' }), 'Activities');
    await user.type(screen.getByRole('textbox', { name: 'Question text' }), 'Which activity helped?');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question 1 type' }), 'single_choice');
    for (const [number, answer] of [[1, 'Discussion'], [2, 'Practice']] as const) {
      const option = screen.getByRole('textbox', { name: `Answer option ${number}` });
      await user.clear(option);
      await user.type(option, answer);
    }
    expect(screen.getByText('Learners will answer 3 questions per lecture.')).toHaveAttribute('role', 'status');
    expect(createForm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('1/1')).toBeVisible();
    expect(screen.getByText('What could we improve?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Edit form' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(createForm).toHaveBeenCalledTimes(1));
    expect(createForm.mock.calls[0][0]).toMatchObject({
      title: 'Weekly feedback', formType: 'post_lecture', deliveryScope: 'all_modules',
      sections: [
        { title: 'Teaching', questionsPerDelivery: 1, questions: [{ text: 'Was the explanation clear?', type: 'rating', config: { display: 'stars', max: 5 } }, { type: 'yes_no' }] },
        { title: 'Activities', questionsPerDelivery: 1, questions: [{ type: 'single_choice', config: { options: ['Discussion', 'Practice'] } }] },
        { title: 'General comments', questionsPerDelivery: null, questions: [{ type: 'long_text', text: 'What could we improve?' }] },
      ],
    });
  }, 15000);

  it('offers every builder type and keeps settings in the selected-question panel', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);
    const type = screen.getByRole('combobox', { name: 'Question 1 type' });
    expect(within(type).getAllByRole('option').map(option => option.textContent)).toEqual([
      'Short Text', 'Long Text', 'Yes / No', 'Single Choice', 'Multiple Choice', 'Dropdown',
      'Rating Scale', 'Likert Scale', 'Number', 'Date', 'Name', 'Email', 'Photo Upload',
    ]);
    expect(screen.getByRole('combobox', { name: 'Rating style' })).toHaveValue('stars');
    expect(screen.queryByRole('textbox', { name: 'Answer option 1' })).not.toBeInTheDocument();
    await user.selectOptions(type, 'multiple_choice');
    expect(screen.getByRole('textbox', { name: 'Answer option 1' })).toBeVisible();
    await user.selectOptions(type, 'long_text');
    expect(screen.queryByRole('textbox', { name: 'Answer option 1' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Question text' }), 'Any suggestions?');
    await user.click(screen.getByRole('button', { name: '+ Add Question to section 1' }));
    expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('');
    await user.click(screen.getByRole('button', { name: /Edit section 1 question 1:/ }));
    expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('Any suggestions?');
    expect(screen.getByRole('combobox', { name: 'Question 1 type' })).toHaveValue('long_text');
  });

  it('clamps a category quota after deletion and preserves question order and values', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);
    await user.type(screen.getByRole('textbox', { name: 'Question text' }), 'First?');
    await user.click(screen.getByRole('button', { name: '+ Add Question to section 1' }));
    await user.type(screen.getByRole('textbox', { name: 'Question text' }), 'Second?');
    await user.click(screen.getByRole('button', { name: '+ Add Question to section 1' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Section 1 questions per lecture' }), '3');
    await user.click(screen.getByRole('button', { name: 'Remove question' }));
    expect(screen.getByRole('combobox', { name: 'Section 1 questions per lecture' })).toHaveValue('2');
    await user.click(screen.getByRole('button', { name: 'Move section 1 question 2 up' }));
    expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('Second?');
    await user.click(screen.getByRole('button', { name: /Edit section 1 question 2:/ }));
    expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('First?');
    expect(screen.getByRole('button', { name: 'Delete section 1' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '+ Add Section' }));
    await user.type(screen.getByRole('textbox', { name: 'Question text' }), 'Other category?');
    await user.click(screen.getByRole('button', { name: 'Move section 2 up' }));
    expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('Other category?');
    await user.click(screen.getByRole('button', { name: 'Delete section 2' }));
    expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('Other category?');
  });

  it.each([false, true])('preserves an existing version and its question metadata when structureLocked=%s', async structureLocked => {
    const user = userEvent.setup();
    const sections = [{
      id: 21, title: 'Teaching', description: 'Keep category details', icon: 'ri-star-line', questionsPerDelivery: 1,
      questions: [{ id: 101, type: 'rating' as const, text: 'Existing question?', required: true, helpText: 'Keep guidance', sortOrder: 3, config: { display: 'stars' as const, min: 1, max: 5, labels: ['Low', 'Basic', 'Moderate', 'Good', 'Great'] } }],
    }];
    const form = {
      id: 7, title: 'Existing feedback', formType: 'post_lecture', deliveryScope: 'all_modules',
      description: 'Existing description', instructions: 'Keep instructions', startDate: null, dueDate: null,
      anonymousResponses: false, allowSaveContinue: true, allowEditAfterSubmission: false,
      version: 3, willCreateVersion: !structureLocked, structureLocked, sections,
    } as FeedbackForm;
    vi.spyOn(feedbackApi, 'getForm').mockResolvedValue({ form });
    const updateForm = vi.spyOn(feedbackApi, 'updateForm').mockResolvedValue({ form });
    render(<MemoryRouter initialEntries={['/engagement/reports/feedback/forms/7/edit']}><Routes><Route path="/engagement/reports/feedback/forms/:formId/edit" element={<FormBuilder />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Section 1 title' })).toHaveValue('Teaching'));
    const category = screen.getByRole('textbox', { name: 'Section 1 title' });
    if (structureLocked) {
      expect(category).toBeDisabled();
      expect(screen.getByRole('textbox', { name: 'Question text' })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: 'Question 1 type' })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: 'Section 1 questions per lecture' })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: 'Rating style' })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: 'Question importance' })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: 'Question scoring' })).toBeDisabled();
      expect(screen.getByRole('textbox', { name: '1 star description' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Remove question' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '+ Add Section' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Add closing question' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '+ Add Question to section 1' })).toBeDisabled();
      expect(screen.getByLabelText('Question bank file')).toBeDisabled();
    } else {
      expect(screen.getByText(/Saving creates a new version for future deliveries/)).toBeVisible();
      expect(screen.getByPlaceholderText('Add guidance for learners')).toHaveValue('Keep guidance');
    }
    expect(updateForm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(updateForm).toHaveBeenCalledTimes(1));
    expect(updateForm.mock.calls[0][0]).toBe(7);
    expect(updateForm.mock.calls[0][1].sections).toEqual(structureLocked ? undefined : sections);
    expect(updateForm.mock.calls[0][1]).toMatchObject({ title: 'Existing feedback', description: 'Existing description', instructions: 'Keep instructions' });
  });

  it('saves reporting settings without changing availability, delivery scope or category draw count', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(feedbackApi, 'createForm').mockResolvedValue({ form: { id: 999, version: 1 } as FeedbackForm });
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);
    await user.type(screen.getByRole('textbox', { name: 'Form Name' }), 'Reporting test');
    await user.type(screen.getByRole('textbox', { name: 'Question text' }), 'Clear?');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question importance' }), 'critical');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({
      formType: 'post_lecture', deliveryScope: 'all_modules', startDate: null, dueDate: null,
      allowSaveContinue: true, allowEditAfterSubmission: false,
      sections: [{ questionsPerDelivery: 1, questions: [{ type: 'rating', config: { min: 1, max: 5, display: 'stars', analytics: { importance: 'critical' } } }] }],
    });
  });

  it('lets the creator choose section icons and previews sections as steps', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);

    await chooseGeneralFeedback(user);
    await user.click(screen.getByRole('button', { name: '+ Add Section' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Section 2 icon' }), 'ri-chat-3-line');
    await user.clear(screen.getByRole('textbox', { name: 'Section 2 title' }));
    await user.type(screen.getByRole('textbox', { name: 'Section 2 title' }), 'Your thoughts');
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByRole('navigation', { name: 'Form progress' })).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('defaults to the fixed all-modules form and loads curriculum only for a module override', async () => {
    const curriculum = vi.spyOn(feedbackApi, 'curriculumOptions').mockResolvedValue({
      programmes: [{ id: 'PROG-1', name: 'Data' }],
      cohorts: [], groups: [], modules: [{ id: 'MOD-1', name: 'Foundations', programmeId: 'PROG-1', cohortId: 'C-1', groupId: 'G-1' }],
    });
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);

    expect(screen.getByRole('radio', { name: /all modules/i })).toBeChecked();
    expect(screen.queryByRole('combobox', { name: 'Programme' })).not.toBeInTheDocument();
    expect(curriculum).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('radio', { name: /one module only/i }));

    expect(await screen.findByRole('combobox', { name: 'Programme' })).toBeInTheDocument();
    await waitFor(() => expect(curriculum).toHaveBeenCalledTimes(1));
  });

  it('shows descriptive form types in the custom dropdown', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);

    const formType = screen.getByRole('combobox', { name: 'Form Type' });
    formType.focus();
    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('option', { name: /general feedback/i })).toHaveTextContent('A flexible form for manual feedback collection');
    await user.keyboard('{End}{Enter}');

    expect(screen.getByRole('combobox', { name: 'Form Type' })).toHaveTextContent('General feedback');
    expect(screen.queryByText('Live Sessions Feedback delivery')).not.toBeInTheDocument();
  });

  it('edits the selected question from the settings panel', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);

    await chooseGeneralFeedback(user);
    await user.click(screen.getByRole('button', { name: '+ Add Question to section 1' }));

    const questionText = screen.getByRole('textbox', { name: 'Question text' });
    await user.type(questionText, 'What helped you learn today?');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question 2 type' }), 'short_text');
    await user.click(screen.getByRole('checkbox', { name: /required question/i }));

    expect(screen.getAllByText('What helped you learn today?').length).toBeGreaterThan(0);
    expect(screen.getByRole('combobox', { name: 'Question 2 type' })).toHaveValue('short_text');
    expect(screen.getByRole('checkbox', { name: /required question/i })).toBeChecked();
  });
});

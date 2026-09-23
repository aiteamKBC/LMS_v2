import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewInstanceModal } from './ReviewInstanceModal';
import { calculateReviewInstanceProgress, completeReviewInstance, downloadReviewInstancePdf, fetchPreviousReviewSession, fetchReviewInstanceForm, generateReviewMeetingSummary, reopenReviewInstance, saveReviewInstanceAnswers, signReviewInstance, type ReviewInstanceFormDefinition, type ReviewProgressSnapshot } from '@/api/reviewInstances';

const account = vi.hoisted(() => ({ name: 'Sam Coach' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { user: { fullName: account.name } } }) }));
vi.mock('@/api/reviewInstances', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/reviewInstances')>(),
  fetchReviewInstanceForm: vi.fn(), saveReviewInstanceAnswers: vi.fn(), completeReviewInstance: vi.fn(), reopenReviewInstance: vi.fn(), signReviewInstance: vi.fn(),
  downloadReviewInstancePdf: vi.fn(), calculateReviewInstanceProgress: vi.fn(), generateReviewMeetingSummary: vi.fn(), fetchPreviousReviewSession: vi.fn(),
}));
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({
  SignaturePad: ({ signatoryName, onCommit }: { signatoryName: string; onCommit: (signature: string) => void }) => <div>
    <p>Signing as {signatoryName}</p><button type="button" onClick={() => onCommit('data:image/png;base64,c2ln')}>Confirm coach signature</button>
  </div>,
}));

function definition(status = 'in-progress'): ReviewInstanceFormDefinition {
  return {
    instance: { id: 'instance-1', reviewTemplateId: 'template-1', learnerId: 12, programmeId: 'programme-1', occurrenceNumber: 1,
      targetDate: '2026-09-14', status, startedAt: '2026-09-14T09:00:00', completedAt: null },
    template: { id: 'template-1', name: 'Monthly coaching', signatures: { advisor: true, participant: true, employer: false, referrer: false },
      visibleTo: { advisor: true, participant: true, employer: false, referrer: false }, recurrence: { interval: 1, unit: 'month' }, notifications: {}, allowEditingPriorDays: 0 },
    sections: [{ id: 'section-1', title: 'Next steps', estimatedMinutes: 5, displayOrder: 1, enabled: true,
      fields: [{ id: 'field-1', title: 'Agreed action', fieldType: 'text', required: true, displayOrder: 1, configuration: {}, answer: 'Review the next module' }] }],
    signatures: { advisor: { required: true, signed: false }, participant: { required: true, signed: false }, employer: { required: false, signed: false }, referrer: { required: false, signed: false } },
    manualOverride: null,
  };
}

/** Same shape, but classified as the canonical Monthly Coaching Meeting
 *  review type via the stable `reviewTypeCode` -- never by name/title. */
function mcmDefinition(status = 'awaiting-signature'): ReviewInstanceFormDefinition {
  const base = definition(status);
  return {
    ...base,
    template: { ...base.template, reviewTypeCode: 'mcm' },
    sections: [...base.sections, { id: 'summary-section', title: 'Meeting Summary', estimatedMinutes: 0, displayOrder: 2, enabled: true,
      fields: [{ id: 'summary-field', title: 'Summary', fieldType: 'text_multiline', required: true, displayOrder: 1,
        configuration: { semanticKey: 'meeting_summary' }, answer: null }] }],
    meetingSummarySource: { fieldId: 'summary-field', status: 'ready', summaryText: 'AI generated coaching summary.' },
    pdf: { available: false, reason: 'The PDF is available after the learner and all required parties have signed.' },
  };
}

function mount() {
  const onStatusChange = vi.fn();
  const onClose = vi.fn();
  render(
    <ReviewInstanceModal
      event={{ learner: 'Ayman Learner', programme: 'Marketing' }}
      instanceId="instance-1"
      onClose={onClose}
      onCompleted={vi.fn()}
      onStatusChanged={onStatusChange}
    />,
  );
  return { onStatusChange, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  account.name = 'Sam Coach';
  vi.mocked(fetchReviewInstanceForm).mockResolvedValue(definition());
  vi.mocked(saveReviewInstanceAnswers).mockResolvedValue(definition());
  vi.mocked(completeReviewInstance).mockResolvedValue(definition('awaiting-signature'));
  vi.mocked(reopenReviewInstance).mockResolvedValue(definition('in-progress'));
  vi.mocked(fetchPreviousReviewSession).mockResolvedValue({
    available: false,
    reason: 'There is no previous occurrence for this Review.',
    instance: null,
    review: null,
    summaryText: '',
    transcriptText: '',
    transcriptAvailable: false,
    transcriptTruncated: false,
  });
});

describe('review reopen flow', () => {
  it('reopens a completed review with a reason and returns it to editing', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(definition('completed'));
    const { onStatusChange } = mount();
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/Everyone must sign this Review again/);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(reopenReviewInstance).toHaveBeenCalledWith('instance-1', {
      reasonCode: 'correction-required',
      note: 'Reopened for correction; all required signatures must be collected again.',
    }));
    expect(onStatusChange).toHaveBeenCalledWith('in-progress');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeVisible();
  });
});
afterEach(cleanup);

describe('coach review page presentation', () => {
  it('loads the immediately previous occurrence for the same review', async () => {
    const current = definition();
    current.instance.occurrenceNumber = 3;
    current.template.reviewTypeCode = 'mcm';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(current);
    vi.mocked(fetchPreviousReviewSession).mockResolvedValue({
      available: true,
      instance: {
        id: 'instance-2',
        occurrenceNumber: 2,
        targetDate: '2026-08-14',
        completedAt: '2026-08-15T10:00:00Z',
        status: 'completed',
      },
      review: { name: 'Monthly coaching', reviewTypeCode: 'mcm', reviewTemplateId: 'template-1' },
      summaryText: 'Prior coaching summary.',
      transcriptText: 'Coach: Let us review the agreed action.\nLearner: It is complete.',
      transcriptAvailable: true,
      transcriptTruncated: false,
    });

    mount();
    expect(await screen.findByRole('button', { name: 'View previous session' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View previous session' }));

    await waitFor(() => expect(fetchPreviousReviewSession).toHaveBeenCalledWith('instance-1'));
    expect(await screen.findByText('Prior coaching summary.')).toBeVisible();
    expect(screen.getByLabelText('Previous session transcript')).toHaveTextContent('Coach: Let us review the agreed action.');
  });

  it('starts Curriculum sections at step 1 without modal chrome', async () => {
    const pageDefinition = definition();
    pageDefinition.template.reviewTypeCode = 'mcm';
    pageDefinition.sections.push({
      id: 'section-2',
      title: 'Final reflection',
      estimatedMinutes: 3,
      displayOrder: 2,
      enabled: true,
      fields: [{ id: 'field-2', title: 'Reflection', fieldType: 'text_multiline', required: false, displayOrder: 1, configuration: {} }],
    });
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(pageDefinition);
    const onClose = vi.fn();
    render(
      <ReviewInstanceModal
        presentation="page"
        event={{ learner: 'Ayman Learner', programme: 'Marketing' }}
        instanceId="instance-1"
        onClose={onClose}
      />,
    );

    expect(await screen.findByRole('navigation', { name: 'Review steps' })).toBeVisible();
    expect(screen.queryByText('Review selected')).not.toBeInTheDocument();
    expect(screen.queryByText('Details confirmed')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Monthly Coaching Meeting #1' })).toBeVisible();
    expect(screen.getByText('Step 1')).toBeVisible();
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Next steps' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Final reflection' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByRole('heading', { name: 'Final reflection' })).toBeVisible();
    expect(screen.getByText('Step 2 of 2')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Close form' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to reviews' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('labels the shared page UI as Progress Review for PR instances', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(progressReviewDefinition());
    render(
      <ReviewInstanceModal
        presentation="page"
        event={{ learner: 'Ayman Learner', programme: 'Marketing' }}
        instanceId="instance-1"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Progress Review #1' })).toBeVisible();
  });
});

describe('coach review signature workflow', () => {
  it('keeps the submitted review open and focuses the coach signature without requiring a second visit', async () => {
    const { onStatusChange, onClose } = mount();
    await screen.findByDisplayValue('Review the next module');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send for signatures' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Send for signatures' }));
    expect(await screen.findByRole('heading', { name: 'Your coach signature is required' })).toBeVisible();
    expect(completeReviewInstance).toHaveBeenCalledWith('instance-1', { 'field-1': 'Review the next module' });
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith('awaiting-signature');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Send for signatures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('saves the final required signature and updates the completed state without closing', async () => {
    const pending = definition('awaiting-signature');
    pending.signatures.participant = { required: true, signed: true, signedName: 'Ayman Learner', signedAt: '2026-09-14T09:30:00Z' };
    const completed = structuredClone(pending);
    completed.instance.status = 'completed';
    completed.signatures.advisor = { required: true, signed: true, signedName: 'Sam Coach', signedAt: '2026-09-14T10:00:00Z' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(pending);
    vi.mocked(signReviewInstance).mockResolvedValue(completed);
    const { onClose, onStatusChange } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm coach signature' }));
    expect(await screen.findByText('Review completed')).toBeVisible();
    expect(signReviewInstance).toHaveBeenCalledWith('instance-1', 'advisor', 'Sam Coach', 'data:image/png;base64,c2ln');
    expect(onStatusChange).toHaveBeenCalledWith('completed');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirm coach signature' })).not.toBeInTheDocument();
    expect(screen.getByText('Your coach signature has been saved.')).toBeVisible();
  });

  it('prevents duplicate signing and leaves a failed signature available for retry', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(definition('awaiting-signature'));
    let rejectSignature!: (reason: Error) => void;
    vi.mocked(signReviewInstance).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSignature = reject; }));
    const { onStatusChange } = mount();
    const sign = await screen.findByRole('button', { name: 'Confirm coach signature' });
    fireEvent.click(sign);
    expect(sign).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close form' })).toBeDisabled();
    fireEvent.click(sign);
    expect(signReviewInstance).toHaveBeenCalledTimes(1);
    await act(async () => rejectSignature(new Error('Connection lost')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    expect(sign).toBeEnabled();
    expect(onStatusChange).not.toHaveBeenCalled();
    const signed = definition('awaiting-signature');
    signed.signatures.advisor = { required: true, signed: true, signedName: 'Sam Coach' };
    vi.mocked(signReviewInstance).mockResolvedValueOnce(signed);
    fireEvent.click(sign);
    expect(await screen.findByText('Your coach signature has been saved.')).toBeVisible();
    expect(onStatusChange).toHaveBeenCalledWith('awaiting-signature');
  });

  it('does not produce a coach signature from the learner name when the account name is missing', async () => {
    account.name = '';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(definition('awaiting-signature'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account has no name on record');
    expect(screen.queryByRole('button', { name: 'Confirm coach signature' })).not.toBeInTheDocument();
    expect(signReviewInstance).not.toHaveBeenCalled();
  });

  it('keeps required field validation before the signature step', async () => {
    const draft = definition();
    draft.sections[0].fields[0].answer = '';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(draft);
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send for signatures' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Send for signatures' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please complete every required field');
    expect(completeReviewInstance).not.toHaveBeenCalled();
    expect(signReviewInstance).not.toHaveBeenCalled();
  });

  it('does not ask a signed coach to sign again while the learner signature is pending', async () => {
    const signed = definition('awaiting-signature');
    signed.signatures.advisor = { required: true, signed: true, signedName: 'Sam Coach' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(signed);
    mount();
    expect(await screen.findByText('Your part is complete. The review is waiting for the remaining required signatures.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirm coach signature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send for signatures' })).not.toBeInTheDocument();
  });

  it('shows direct completion for templates with no required signatures', async () => {
    const draft = definition();
    for (const role of ['advisor', 'participant'] as const) {
      draft.signatures[role].required = false;
      draft.template.signatures[role] = false;
    }
    const completed = structuredClone(draft);
    completed.instance.status = 'completed';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(draft);
    vi.mocked(completeReviewInstance).mockResolvedValue(completed);
    const { onStatusChange, onClose } = mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete review' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Complete review' }));
    expect(await screen.findByText('Review completed')).toBeVisible();
    expect(onStatusChange).toHaveBeenCalledWith('completed');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirm coach signature' })).not.toBeInTheDocument();
  });
});

describe('Review Meeting Summary integration', () => {
  it('exposes the transcript summary controls for a Progress Review', async () => {
    const existing = mcmDefinition('in-progress');
    existing.template.reviewTypeCode = 'progress_review';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    mount();

    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    expect(await screen.findByText('AI Meeting Summary')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
    expect(screen.getByText('Progress Review')).toBeVisible();
  });

  it('uses the semantic marker for the report editor while regular text fields keep the compact control', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('in-progress'));
    mount();

    const regularEditor = await screen.findByDisplayValue('Review the next module');
    expect(regularEditor).toHaveAttribute('rows', '3');
    expect(regularEditor.className).not.toContain('h-[360px]');

    fireEvent.click(screen.getByRole('button', { name: /Meeting Summary/ }));
    const summaryEditor = screen.getByRole('textbox', { name: 'Meeting Summary' });
    expect(summaryEditor.className).toContain('h-[360px]');
    expect(summaryEditor).not.toHaveAttribute('rows');
    expect(screen.getByText('Review and finalise the meeting summary before sending the Review for signatures.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Expand editor' })).toBeVisible();
  });

  it('loads a stored AI suggestion into an empty mapped editor without saving it', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('in-progress'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    expect(await screen.findByDisplayValue('AI generated coaching summary.')).toBeVisible();
    expect(screen.getByText(/not saved automatically/i)).toBeVisible();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
    expect(generateReviewMeetingSummary).not.toHaveBeenCalled();
  });

  it('keeps the existing formal answer authoritative over the AI suggestion', async () => {
    const existing = mcmDefinition('in-progress');
    existing.sections[1].fields[0].answer = 'Coach-approved draft wording.';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    expect(await screen.findByDisplayValue('Coach-approved draft wording.')).toBeVisible();
    expect(screen.queryByDisplayValue('AI generated coaching summary.')).not.toBeInTheDocument();
  });

  it('does not replace a deliberately saved blank formal answer on open', async () => {
    const existing = mcmDefinition('in-progress');
    existing.sections[1].fields[0].answer = '';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    await screen.findByText('AI Meeting Summary');
    expect(screen.getAllByRole('textbox').at(-1)).toHaveValue('');
    expect(screen.queryByDisplayValue('AI generated coaching summary.')).not.toBeInTheDocument();
  });

  it('requires confirmation before generated text replaces editor content', async () => {
    const existing = mcmDefinition('in-progress');
    existing.sections[1].fields[0].answer = 'Keep this coach wording.';
    existing.meetingSummarySource = { fieldId: 'summary-field', status: 'unavailable', summaryText: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(generateReviewMeetingSummary).mockResolvedValue({
      meetingSummarySource: { fieldId: 'summary-field', status: 'ready', summaryText: 'New generated wording.' },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate from Teams' }));
    expect(await screen.findByRole('button', { name: 'Replace with generated summary' })).toBeVisible();
    expect(screen.getByDisplayValue('Keep this coach wording.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Replace with generated summary' }));
    expect(screen.getByDisplayValue('New generated wording.')).toBeVisible();
  });

  it('uploads a .vtt fallback and loads its AI result without saving automatically', async () => {
    const existing = mcmDefinition('in-progress');
    existing.meetingSummarySource = { fieldId: 'summary-field', status: 'unavailable', summaryText: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(generateReviewMeetingSummary).mockResolvedValue({
      meetingSummarySource: { fieldId: 'summary-field', status: 'ready', summaryText: 'Summary from uploaded transcript.' },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    expect(screen.getByRole('button', { name: 'Upload .vtt & Generate' })).toBeVisible();

    const transcript = new File(
      ['WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nUploaded meeting notes.'],
      'meeting.vtt',
      { type: 'text/vtt' },
    );
    fireEvent.change(screen.getByLabelText('Select .vtt transcript'), { target: { files: [transcript] } });

    await waitFor(() => expect(generateReviewMeetingSummary).toHaveBeenCalledWith('instance-1', transcript));
    expect(await screen.findByDisplayValue('Summary from uploaded transcript.')).toBeVisible();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

  it('keeps a truncated-transcript caveat visible after the generated text is applied', async () => {
    const existing = mcmDefinition('in-progress');
    existing.meetingSummarySource = { fieldId: 'summary-field', status: 'unavailable', summaryText: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(generateReviewMeetingSummary).mockResolvedValue({
      meetingSummarySource: {
        fieldId: 'summary-field',
        status: 'ready',
        summaryText: 'Summary from the earlier part.',
        message: 'The uploaded transcript was longer than this summary can cover, so only its earlier part was used.',
      },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));

    const transcript = new File(
      ['WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nA very long meeting.'],
      'meeting.vtt',
      { type: 'text/vtt' },
    );
    fireEvent.change(screen.getByLabelText('Select .vtt transcript'), { target: { files: [transcript] } });

    // The step instruction must not displace the caveat: a recap built from
    // part of the meeting cannot be handed over looking complete.
    expect(await screen.findByText(/only its earlier part was used/)).toBeVisible();
    expect(screen.getByText(/Save the draft when you are satisfied with it/)).toBeVisible();
  });

  it('saves an uploaded AI summary with the other Review answers when Save draft is selected', async () => {
    const existing = mcmDefinition('in-progress');
    existing.meetingSummarySource = { fieldId: 'summary-field', status: 'unavailable', summaryText: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(generateReviewMeetingSummary).mockResolvedValue({
      meetingSummarySource: { fieldId: 'summary-field', status: 'ready', summaryText: 'Summary from uploaded transcript.' },
    });
    vi.mocked(saveReviewInstanceAnswers).mockResolvedValue(existing);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));

    const transcript = new File(
      ['WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nUploaded meeting notes.'],
      'meeting.vtt',
      { type: 'text/vtt' },
    );
    fireEvent.change(screen.getByLabelText('Select .vtt transcript'), { target: { files: [transcript] } });

    expect(await screen.findByDisplayValue('Summary from uploaded transcript.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saveReviewInstanceAnswers).toHaveBeenCalledWith(
      'instance-1',
      expect.objectContaining({
        'field-1': 'Review the next module',
        'summary-field': 'Summary from uploaded transcript.',
      }),
    ));
  });

  it('supports a manually entered summary when no AI artifact is available', async () => {
    const existing = mcmDefinition('in-progress');
    existing.meetingSummarySource = { fieldId: 'summary-field', status: 'unavailable', summaryText: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(saveReviewInstanceAnswers).mockResolvedValue(existing);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    const summaryEditor = screen.getAllByRole('textbox').at(-1)!;
    fireEvent.change(summaryEditor, { target: { value: 'Coach-written summary without AI.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveReviewInstanceAnswers).toHaveBeenCalledWith(
      'instance-1',
      expect.objectContaining({ 'summary-field': 'Coach-written summary without AI.' }),
    ));
    expect(generateReviewMeetingSummary).not.toHaveBeenCalled();
  });

  it('keeps the mapped summary editable beyond the unrelated 4,000 character field limit', async () => {
    const existing = mcmDefinition('in-progress');
    existing.meetingSummarySource = { fieldId: 'summary-field', status: 'ready', summaryText: 'S'.repeat(4500) };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    const editor = await screen.findByDisplayValue('S'.repeat(4500));
    expect(editor).not.toHaveAttribute('maxLength');
  });

  it('preserves long multiline text across inline and expanded editing without saving automatically', async () => {
    const existing = mcmDefinition('in-progress');
    const longSummary = 'Overview\nLearner is progressing well.\n\nKey discussion points\n• Portfolio evidence\n• Functional skills\n\nNext steps\n1. Upload evidence';
    existing.sections[1].fields[0].answer = longSummary;
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    mount();

    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    const inlineEditor = screen.getByRole('textbox', { name: 'Meeting Summary' });
    expect(inlineEditor).toHaveValue(longSummary);
    fireEvent.change(inlineEditor, { target: { value: `${longSummary}\n2. Confirm next meeting` } });
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));

    expect(screen.getByRole('region', { name: 'Edit Meeting Summary' }).className).toContain('h-[90vh]');
    const expandedEditor = screen.getByRole('textbox', { name: 'Expanded Meeting Summary' });
    expect(expandedEditor).toHaveFocus();
    expect(expandedEditor).toHaveValue(`${longSummary}\n2. Confirm next meeting`);
    fireEvent.change(expandedEditor, { target: { value: `${longSummary}\n2. Confirm next meeting\n3. Share resources` } });
    fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));

    expect(screen.getByRole('textbox', { name: 'Meeting Summary' })).toHaveValue(`${longSummary}\n2. Confirm next meeting\n3. Share resources`);
    expect(screen.getByRole('button', { name: 'Expand editor' })).toHaveFocus();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

  it('closes expanded editing with Escape, keeps the typed value, and restores focus', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('in-progress'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
    const expandedEditor = screen.getByRole('textbox', { name: 'Expanded Meeting Summary' });
    const doneEditing = screen.getByRole('button', { name: 'Done editing' });
    expect(expandedEditor).toHaveFocus();
    fireEvent.keyDown(expandedEditor, { key: 'Tab' });
    expect(doneEditing).toHaveFocus();
    fireEvent.keyDown(doneEditing, { key: 'Tab', shiftKey: true });
    expect(expandedEditor).toHaveFocus();
    fireEvent.change(expandedEditor, { target: { value: 'Edited with the expanded surface.' } });
    fireEvent.keyDown(expandedEditor, { key: 'Escape' });

    expect(screen.queryByRole('heading', { name: 'Edit Meeting Summary' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Meeting Summary' })).toHaveValue('Edited with the expanded surface.');
    expect(screen.getByRole('button', { name: 'Expand editor' })).toHaveFocus();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

  it('only reports a saved draft after the existing save request succeeds and clears it on a later edit', async () => {
    const existing = mcmDefinition('in-progress');
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(saveReviewInstanceAnswers).mockResolvedValue(existing);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    const editor = screen.getByRole('textbox', { name: 'Meeting Summary' });
    fireEvent.change(editor, { target: { value: 'Coach-approved meeting report.' } });
    expect(screen.queryByText('Draft saved.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved.')).toBeVisible();
    expect(saveReviewInstanceAnswers).toHaveBeenCalledWith(
      'instance-1',
      expect.objectContaining({ 'summary-field': 'Coach-approved meeting report.' }),
    );

    fireEvent.change(editor, { target: { value: 'Coach-approved meeting report, amended.' } });
    expect(screen.queryByText('Draft saved.')).not.toBeInTheDocument();
  });

  it('keeps the semantic editor read-only at the signature stage, including when expanded', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('awaiting-signature'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    expect(screen.getByRole('textbox', { name: 'Meeting Summary' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Generate from Teams' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
    expect(screen.getByRole('textbox', { name: 'Expanded Meeting Summary' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });
});

describe('Monthly Coaching Meeting signature summary + signed PDF', () => {
  it('shows the full signature summary and a disabled PDF button once at the signature stage, for the mcm review type only', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('awaiting-signature'));
    mount();
    expect(await screen.findByRole('region', { name: 'Review signatures' })).toBeVisible();
    expect(screen.getByText('0 of 2 required signatures saved')).toBeVisible();
    const download = screen.getByRole('button', { name: 'Download signed PDF' });
    expect(download).toBeDisabled();
    expect(screen.getByText('The PDF is available after the learner and all required parties have signed.')).toBeVisible();
  });

  it('does not show the signature summary or PDF button for a non-mcm review type at the same lifecycle stage', async () => {
    const nonMcm = definition('awaiting-signature');
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(nonMcm);
    mount();
    await screen.findByDisplayValue('Review the next module');
    expect(screen.queryByRole('region', { name: 'Review signatures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download signed PDF' })).not.toBeInTheDocument();
  });

  it('does not show the signature summary or PDF button before the review reaches the signature stage', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('in-progress'));
    mount();
    await screen.findByDisplayValue('Review the next module');
    expect(screen.queryByRole('region', { name: 'Review signatures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download signed PDF' })).not.toBeInTheDocument();
  });

  it('downloads the same review instance the coach has open once the PDF is available', async () => {
    const ready = mcmDefinition('completed');
    ready.signatures.advisor = { required: true, signed: true, signedName: 'Sam Coach', signedAt: '2026-09-14T10:00:00Z' };
    ready.signatures.participant = { required: true, signed: true, signedName: 'Ayman Learner', signedAt: '2026-09-14T09:30:00Z' };
    ready.pdf = { available: true, reason: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(ready);
    vi.mocked(downloadReviewInstancePdf).mockResolvedValue(undefined);
    mount();
    const download = await screen.findByRole('button', { name: 'Download signed PDF' });
    expect(download).toBeEnabled();
    fireEvent.click(download);
    await waitFor(() => expect(downloadReviewInstancePdf).toHaveBeenCalledWith('instance-1'));
  });
});

/** Classified as the canonical Progress Review type via the stable
 *  `reviewTypeCode` -- never by name/title. */
function progressReviewDefinition(status = 'in-progress', snapshot: ReviewProgressSnapshot | null = null): ReviewInstanceFormDefinition {
  const base = definition(status);
  return {
    ...base,
    template: { ...base.template, name: 'Progress Review', reviewTypeCode: 'progress_review' },
    progressSnapshot: snapshot,
    ragHistory: [],
  };
}

function snapshotFixture(overrides: Partial<ReviewProgressSnapshot> = {}): ReviewProgressSnapshot {
  return {
    calculationMethod: 'planned_hours',
    calculatedFrom: '2024-10-18',
    calculatedAt: '2026-09-16T14:35:00',
    calculatedBy: 'coach@example.com',
    weeksElapsed: 100,
    ksbProgress: { available: true, title: 'Project controls professional Apprenticeship Standard (v1.0) (Level 6)', actualPercent: 73, expectedPercent: 100, variancePercent: -27, varianceDirection: 'below' },
    programmeProgress: { actual: 28, expected: 30, planned: 100, actualPercent: 28, expectedPercent: 30, variancePercent: -2, varianceDirection: 'below' },
    offTheJobHours: { actual: 64, expected: 52, planned: 100, actualPercent: 64, expectedPercent: 52, variancePercent: 12, varianceDirection: 'above' },
    ...overrides,
  };
}

describe('Progress Review learning progress snapshot', () => {
  it('offers Calculate only on a Progress Review, and never calculates on its own when the form opens', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(progressReviewDefinition());
    mount();
    expect(await screen.findByRole('region', { name: 'Learning progress' })).toBeVisible();
    expect(screen.getByText('No progress snapshot calculated yet.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Calculate' })).toBeEnabled();
    // Opening the review must never trigger a calculation by itself.
    expect(calculateReviewInstanceProgress).not.toHaveBeenCalled();
  });

  it('does not offer the Learning Progress area on another review type', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('in-progress'));
    mount();
    await screen.findByDisplayValue('Review the next module');
    expect(screen.queryByRole('region', { name: 'Learning progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Calculate' })).not.toBeInTheDocument();
  });

  it('renders the saved snapshot returned by the backend and then offers Recalculate', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(progressReviewDefinition());
    vi.mocked(calculateReviewInstanceProgress).mockResolvedValue(
      progressReviewDefinition('in-progress', snapshotFixture()),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Calculate' }));
    expect(await screen.findByRole('button', { name: 'Recalculate' })).toBeEnabled();
    expect(calculateReviewInstanceProgress).toHaveBeenCalledWith('instance-1');
    // The learner's own start date, and the backend's own calculation time.
    expect(screen.getByText(/Calculated from 18 Oct 2024/)).toBeVisible();
    // Month abbreviations vary by ICU version ("Sep" / "Sept"), so match the
    // parts that carry the meaning: the backend's own calculation date.
    expect(screen.getByText(/Calculated at 16 Sept? 2026/)).toBeVisible();
    expect(screen.getByText('64%')).toBeVisible();
    expect(screen.getByText('12% Above')).toBeVisible();
    expect(screen.getByText('2% Below')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Learning Plan Progress: 28%' })).toBeVisible();
    expect(screen.getByText('27% Below')).toBeVisible();
  });

  it('disables repeated clicks while a calculation is in flight', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(progressReviewDefinition());
    let resolveCalculation!: (value: ReviewInstanceFormDefinition) => void;
    vi.mocked(calculateReviewInstanceProgress).mockImplementationOnce(
      () => new Promise((resolve) => { resolveCalculation = resolve; }),
    );
    mount();
    const calculate = await screen.findByRole('button', { name: 'Calculate' });
    fireEvent.click(calculate);
    const calculating = await screen.findByRole('button', { name: 'Calculating...' });
    expect(calculating).toBeDisabled();
    fireEvent.click(calculating);
    expect(calculateReviewInstanceProgress).toHaveBeenCalledTimes(1);
    await act(async () => resolveCalculation(progressReviewDefinition('in-progress', snapshotFixture())));
    expect(await screen.findByRole('button', { name: 'Recalculate' })).toBeEnabled();
  });

  it('locks the saved snapshot once the review reaches the signature step', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(
      progressReviewDefinition('awaiting-signature', snapshotFixture()),
    );
    mount();
    expect(await screen.findByRole('region', { name: 'Learning progress' })).toBeVisible();
    expect(screen.getByText('64%')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Calculate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recalculate' })).not.toBeInTheDocument();
  });

  it('keeps a completed review showing its own saved figures and its own RAG history', async () => {
    const completed = progressReviewDefinition('completed', snapshotFixture());
    completed.ragHistory = [
      { reviewInstanceId: 'instance-1', reviewName: 'Progress Review', occurrenceNumber: 2, targetDate: '2026-01-03', completedAt: '2026-01-14T10:00:00', rag: 'Green' },
      { reviewInstanceId: 'instance-0', reviewName: 'Progress Review', occurrenceNumber: 1, targetDate: '2025-04-16', completedAt: '2025-04-16T10:00:00', rag: '' },
    ];
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(completed);
    mount();
    expect(await screen.findByText('Review completed')).toBeVisible();
    expect(screen.getByText('64%')).toBeVisible();
    expect(screen.getAllByText('28%')).toHaveLength(2);
    expect(screen.getByText('Green')).toBeVisible();
    // A past review that captured no RAG still appears, as "None".
    expect(screen.getByText('None')).toBeVisible();
    expect(calculateReviewInstanceProgress).not.toHaveBeenCalled();
  });

  it('reports a backend refusal instead of showing an invented figure', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(progressReviewDefinition());
    vi.mocked(calculateReviewInstanceProgress).mockRejectedValue(
      new Error('This learner has no individual programme start date, so progress cannot be calculated.'),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Calculate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no individual programme start date');
    expect(screen.getByText('No progress snapshot calculated yet.')).toBeVisible();
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewInstanceModal } from './ReviewInstanceModal';
import { calculateReviewInstanceProgress, completeReviewInstance, downloadReviewInstancePdf, fetchReviewInstanceForm, saveReviewInstanceAnswers, signReviewInstance, type ReviewInstanceFormDefinition, type ReviewProgressSnapshot } from '@/api/reviewInstances';

const account = vi.hoisted(() => ({ name: 'Sam Coach' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { user: { fullName: account.name } } }) }));
vi.mock('@/api/reviewInstances', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/reviewInstances')>(),
  fetchReviewInstanceForm: vi.fn(), saveReviewInstanceAnswers: vi.fn(), completeReviewInstance: vi.fn(), signReviewInstance: vi.fn(),
  downloadReviewInstancePdf: vi.fn(), calculateReviewInstanceProgress: vi.fn(),
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
  return { ...base, template: { ...base.template, reviewTypeCode: 'mcm' }, pdf: { available: false, reason: 'The PDF is available after the learner and all required parties have signed.' } };
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
});
afterEach(cleanup);

describe('coach review signature workflow', () => {
  it('keeps the submitted review open and focuses the coach signature without requiring a second visit', async () => {
    const { onStatusChange, onClose } = mount();
    await screen.findByDisplayValue('Review the next module');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete review' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Complete review' }));
    expect(await screen.findByRole('heading', { name: 'Your coach signature is required' })).toBeVisible();
    expect(onStatusChange).toHaveBeenCalledWith('awaiting-signature');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Complete review' })).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete review' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Complete review' }));
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
    expect(screen.queryByRole('button', { name: 'Complete review' })).not.toBeInTheDocument();
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

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewInstanceModal } from './ReviewInstanceModal';
import { completeReviewInstance, fetchReviewInstanceForm, saveReviewInstanceAnswers, signReviewInstance, type ReviewInstanceFormDefinition } from '@/api/reviewInstances';

const account = vi.hoisted(() => ({ name: 'Sam Coach' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { user: { fullName: account.name } } }) }));
vi.mock('@/api/reviewInstances', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/reviewInstances')>(),
  fetchReviewInstanceForm: vi.fn(), saveReviewInstanceAnswers: vi.fn(), completeReviewInstance: vi.fn(), signReviewInstance: vi.fn(),
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
  };
}

function mount() {
  const onStatusChange = vi.fn();
  const onClose = vi.fn();
  render(<ReviewInstanceModal event={{ learner: 'Ayman Learner', programme: 'Marketing' }} instanceId="instance-1" onClose={onClose} onStatusChange={onStatusChange} />);
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
    expect(screen.getByLabelText('Review signature step')).toHaveFocus();
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

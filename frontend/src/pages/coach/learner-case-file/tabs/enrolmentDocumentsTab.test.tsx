/**
 * Enrolment Documents: the coach views, downloads and signs their learner's
 * enrolment review documents, signing with a signature they create once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewDocument } from '@/api/reviewForm';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  one: vi.fn(),
  sign: vi.fn(),
  saveSignature: vi.fn(),
  downloadReviewPdf: vi.fn(),
}));
vi.mock('@/api/coachEnrolmentDocuments', () => ({
  fetchCoachEnrolmentDocuments: (...a: unknown[]) => api.list(...a),
  fetchCoachEnrolmentDocument: (...a: unknown[]) => api.one(...a),
  signCoachEnrolmentDocument: (...a: unknown[]) => api.sign(...a),
}));
vi.mock('@/api/savedSignature', () => ({ saveSignature: (...a: unknown[]) => api.saveSignature(...a) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { subjectType: 'staff', subjectId: 7 } } }) }));
vi.mock('@/pages/learner/onboarding/reviews/reviewDocument', () => ({
  buildReviewPdf: () => ({ output: () => 'blob:review' }),
  downloadReviewPdf: (...a: unknown[]) => api.downloadReviewPdf(...a),
}));
// The real pad needs a canvas; a button standing in for "draw and sign" is enough here.
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({
  SignaturePad: ({ onCommit }: { onCommit: (url: string) => void }) => (
    <button onClick={() => onCommit('data:image/png;base64,NEW')}>Use this signature</button>
  ),
}));

import { EnrolmentDocumentsTab } from './EnrolmentDocumentsTab';

const unsigned = { signature: '', name: '', signedAt: null, signed: false };
const signed = (name: string) => ({ signature: '', name, signedAt: '2026-09-20T10:00:00Z', signed: true });
const doc = (overrides: Partial<ReviewDocument> = {}): ReviewDocument => ({
  eventKey: 'eligibility-review:31:1:2026-08-03',
  reviewType: 'eligibility-review',
  label: 'Eligibility Review & FS Discussion',
  scheduledDate: '2026-08-03',
  reviewedBy: 'Casey Coach',
  completed: true,
  completedAt: '2026-08-03',
  startedAt: '2026-08-03',
  sectionsDone: 6,
  sectionsTotal: 6,
  signatures: { learner: signed('Test Learner'), admin: unsigned, employer: { ...unsigned, required: true }, signable: true },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({ documents: [doc()], signature: { saved: true, name: 'Casey Coach' } });
  api.one.mockResolvedValue({ eventKey: 'x' });
  api.sign.mockResolvedValue({});
  api.saveSignature.mockResolvedValue({ signature: 'data:image/png;base64,NEW', savedAt: '' });
});

describe('Enrolment Documents tab', () => {
  it('lists each review document with who has signed it', async () => {
    render(<EnrolmentDocumentsTab learnerId="31" />);

    expect(await screen.findByText('Eligibility Review & FS Discussion')).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith('31');
    expect(screen.getByText(/Learner signed — Test Learner/)).toBeInTheDocument();
    expect(screen.getByText('Coach not signed')).toBeInTheDocument();
    expect(screen.getByText('Employer not signed')).toBeInTheDocument();
  });

  it('adds the coach signature only after the coach confirms', async () => {
    render(<EnrolmentDocumentsTab learnerId="31" />);
    await userEvent.click(await screen.findByRole('button', { name: /^Sign Eligibility/ }));

    expect(api.sign).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('as Casey Coach');
    await userEvent.click(screen.getByRole('button', { name: /Sign document/ }));

    await waitFor(() => expect(api.sign).toHaveBeenCalledWith('31', 'eligibility-review:31:1:2026-08-03'));
    expect(api.list).toHaveBeenCalledTimes(2); // refreshed to show the new signature
  });

  it('offers no Sign button once the review has its staff signature, and none before the review is complete', async () => {
    api.list.mockResolvedValue({
      documents: [
        doc({ signatures: { ...doc().signatures, admin: signed('Enrolment Officer') } }),
        doc({ eventKey: 'workspace:31:1', label: 'RPL And Experience', completed: false, sectionsDone: 2 }),
      ],
      signature: { saved: true, name: 'Casey Coach' },
    });
    render(<EnrolmentDocumentsTab learnerId="31" />);

    expect(await screen.findByText(/Coach signed — Enrolment Officer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Sign / })).not.toBeInTheDocument();
    expect(screen.getByText('It can be signed once the review is complete.')).toBeInTheDocument();
  });

  it('asks the coach to create a signature first, then saves it to their account', async () => {
    api.list.mockResolvedValueOnce({ documents: [doc()], signature: { saved: false, name: 'Casey Coach' } });
    render(<EnrolmentDocumentsTab learnerId="31" />);

    expect(await screen.findByRole('button', { name: /^Sign Eligibility/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Create your signature/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Use this signature' }));

    await waitFor(() => expect(api.saveSignature).toHaveBeenCalledWith('staff:7', 'data:image/png;base64,NEW'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Sign Eligibility/ })).toBeEnabled());
  });

  it('downloads the full document', async () => {
    render(<EnrolmentDocumentsTab learnerId="31" />);
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }));

    await waitFor(() => expect(api.downloadReviewPdf).toHaveBeenCalledWith({ eventKey: 'x' }, expect.any(Object)));
    expect(api.one).toHaveBeenCalledWith('31', 'eligibility-review:31:1:2026-08-03');
  });

  it('shows why the documents could not be loaded', async () => {
    api.list.mockRejectedValue(new Error('Learner not found.'));
    render(<EnrolmentDocumentsTab learnerId="99" />);

    expect(await screen.findByText('Learner not found.')).toBeInTheDocument();
  });
});

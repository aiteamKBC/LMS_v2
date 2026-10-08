/**
 * Case File only views and downloads enrolment review documents.
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

  it.each([true, false])('has no mutation controls with saved signature=%s', async (saved) => {
    api.list.mockResolvedValue({ documents: [doc(), doc({ eventKey: 'other', label: 'Incomplete review', completed: false })], signature: { saved, name: 'Casey Coach' } });
    render(<EnrolmentDocumentsTab learnerId="31" />);
    await screen.findByText('Eligibility Review & FS Discussion');
    expect(screen.queryByRole('button', { name: /sign|save|edit|update/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(api.sign).not.toHaveBeenCalled();
    expect(api.saveSignature).not.toHaveBeenCalled();
  });

  it('preserves historical staff signatures without editing actions', async () => {
    api.list.mockResolvedValue({ documents: [doc({ signatures: { ...doc().signatures, admin: signed('Enrolment Officer') } })] });
    render(<EnrolmentDocumentsTab learnerId="31" />);
    expect(await screen.findByText(/Coach signed.*Enrolment Officer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign/i })).not.toBeInTheDocument();
  });

  it('opens the full document without saving or signing', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    render(<EnrolmentDocumentsTab learnerId="31" />);
    await userEvent.click(await screen.findByRole('button', { name: /^View/ }));
    await waitFor(() => expect(tab.location.href).toBe('blob:review'));
    expect(api.one).toHaveBeenCalledWith('31', doc().eventKey);
    expect(api.sign).not.toHaveBeenCalled();
    expect(api.saveSignature).not.toHaveBeenCalled();
    open.mockRestore();
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

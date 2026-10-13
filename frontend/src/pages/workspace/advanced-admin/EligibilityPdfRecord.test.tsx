import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { advancedAdminEligibilityForm } from '@/api/advancedAdmin';
import { buildReviewPdf } from '@/pages/learner/onboarding/reviews/reviewDocument';
import EligibilityPdfRecord from './EligibilityPdfRecord';

vi.mock('@/api/advancedAdmin', () => ({
  advancedAdminEligibilityForm: vi.fn(),
  advancedAdminOriginalReviewPdf: (id: number, reviewId: string) =>
    `/login_api/advanced-admin/learners/${id}/reviews/${reviewId}/original-pdf/`,
}));
vi.mock('@/pages/learner/onboarding/reviews/reviewDocument', () => ({
  buildReviewPdf: vi.fn(),
  reviewDocumentFilename: () => 'eligibility-sample-learner.pdf',
}));

const createObjectURL = vi.fn(() => 'blob:review-pdf');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('opens the original Aptem PDF for the selected learner without showing imported text', async () => {
  const fetch = vi.fn(async () => new Response(new Blob(['%PDF-1.7 original'], { type: 'application/pdf' }), {
    status: 200, headers: { 'Content-Type': 'application/pdf' },
  }));
  vi.stubGlobal('fetch', fetch);
  render(<EligibilityPdfRecord learnerId={42} recordKey="row-11" label="Eligibility Review" status="completed"
    date="2026-09-12" source="imported" aptemReviewId="aptem-11" />);

  fireEvent.click(screen.getByText(/Eligibility Review · completed/));
  expect(await screen.findByTitle('Eligibility Review PDF')).toHaveAttribute('src', 'blob:review-pdf');
  expect(fetch).toHaveBeenCalledWith('/login_api/advanced-admin/learners/42/reviews/aptem-11/original-pdf/',
    expect.objectContaining({ credentials: 'include' }));
  expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('download', 'eligibility-review.pdf');
  expect(advancedAdminEligibilityForm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText(/Eligibility Review · completed/));
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:review-pdf'));
});

it('builds the saved native review as a PDF for that learner and event', async () => {
  const form = { reviewLabel: 'Eligibility Review', learnerInformation: { name: 'Sample Learner' } };
  vi.mocked(advancedAdminEligibilityForm).mockResolvedValue(form as never);
  vi.mocked(buildReviewPdf).mockReturnValue({ output: () => new Blob(['%PDF-1.7 generated'], { type: 'application/pdf' }) } as never);
  render(<EligibilityPdfRecord learnerId={57} recordKey="eligibility-review:57:1" label="Eligibility Review"
    status="completed" date="2026-09-12" source="native" />);

  fireEvent.click(screen.getByText(/Eligibility Review · completed/));
  expect(await screen.findByTitle('Eligibility Review PDF')).toHaveAttribute('src', 'blob:review-pdf');
  expect(advancedAdminEligibilityForm).toHaveBeenCalledWith(57, 'eligibility-review:57:1', expect.any(AbortSignal));
  expect(buildReviewPdf).toHaveBeenCalledWith(form, expect.any(Object));
  expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('download', 'eligibility-sample-learner.pdf');
});

it('reports an imported review without an original PDF id instead of loading another review', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<EligibilityPdfRecord learnerId={42} recordKey="row-12" label="Eligibility Review"
    status="completed" date="2026-09-12" source="imported" />);

  fireEvent.click(screen.getByText(/Eligibility Review · completed/));
  expect(await screen.findByRole('alert')).toHaveTextContent('The original PDF is unavailable for this review.');
  expect(fetch).not.toHaveBeenCalled();
  expect(advancedAdminEligibilityForm).not.toHaveBeenCalled();
});

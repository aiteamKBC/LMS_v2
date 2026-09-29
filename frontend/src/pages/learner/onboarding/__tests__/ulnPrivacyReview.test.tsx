/**
 * The fourth enrolment review — ULN Privacy Notice & Learner Acknowledgement:
 * listed and booked like the other three, and filled in by reading the notice
 * and confirming the acknowledgement.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { OnboardingReview } from '@/api/learnerCalendar';
import type { ReviewFormResponse } from '@/api/reviewForm';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/hooks/useMyLearner', () => ({ useMyLearner: () => ({ kind: 'apprenticeship', id: '670' }) }));
vi.mock('@/hooks/useLearnerNavGate', () => ({ useEnrolmentSubmitted: () => true }));
const calendar = vi.hoisted(() => ({ fetchOnboardingReviews: vi.fn() }));
vi.mock('@/api/learnerCalendar', () => ({
  ...calendar,
  bookLearnerCalendarSession: vi.fn(),
  cancelLearnerCalendarSession: vi.fn(),
  fetchFirstSessionSlots: vi.fn(async () => ({ slots: [] })),
  ukOffsetForDate: () => '+01:00',
}));
const form = vi.hoisted(() => ({ fetchReviewForm: vi.fn(), saveReviewForm: vi.fn(), signReviewForm: vi.fn() }));
vi.mock('@/api/reviewForm', () => form);
vi.mock('../reviews/reviewDocument', () => ({ downloadReviewPdf: vi.fn() }));

import OnboardingReviewsPage from '../reviews/page';
import ReviewFormPage from '../reviews/form';

const LABEL = 'ULN Privacy Notice & Learner Acknowledgement';
const unsigned = { signature: '', name: '', signedAt: null, signed: false };
const ulnForm = (overrides: Partial<ReviewFormResponse> = {}): ReviewFormResponse => ({
  eventKey: 'uln-privacy:670:1:2026-10-02',
  reviewType: 'uln-privacy',
  reviewLabel: LABEL,
  scheduledDate: '2026-10-02',
  scheduledTime: '10:00',
  reviewedBy: 'Case Owner',
  learnerInformation: { name: 'Test Learner', programmeName: '', programmeStartDate: '', plannedEndDate: '', programmeStatus: '', employer: '', manager: '', mentor: '' },
  answers: {},
  sectionStatus: { ulnPrivacyNotice: false, learnerAcknowledgement: false },
  sections: ['ulnPrivacyNotice', 'learnerAcknowledgement'],
  programmeStatusOptions: [],
  signatures: { learner: unsigned, admin: unsigned, employer: { ...unsigned, required: true }, signable: false },
  completed: false,
  completedAt: null,
  startedAt: '2026-10-02',
  meetingLink: '',
  status: 'booked',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  form.fetchReviewForm.mockResolvedValue(ulnForm());
  form.saveReviewForm.mockImplementation(async (_k, _i, _e, body: { answers: Record<string, unknown> }) =>
    ulnForm({ sectionStatus: { ulnPrivacyNotice: 'ulnPrivacyNotice' in body.answers, learnerAcknowledgement: 'learnerAcknowledgement' in body.answers } }));
});

describe('ULN Privacy Notice & Learner Acknowledgement review', () => {
  it('is listed as the fourth review to book', async () => {
    const review = (type: OnboardingReview['type'], label: string) =>
      ({ type, label, booked: false, hasForm: true, event: null }) as OnboardingReview;
    calendar.fetchOnboardingReviews.mockResolvedValue({
      caseOwner: { name: 'Case Owner', email: '' },
      allBooked: false,
      reviews: [
        review('eligibility-review', 'Eligibility Review & FS Discussion'),
        review('workspace', 'RPL And Experience'),
        review('training-plan', 'Workplace Health & Safety Declaration'),
        review('uln-privacy', LABEL),
      ],
    });
    render(<MemoryRouter><OnboardingReviewsPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: LABEL })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Book ${LABEL}` })).toBeInTheDocument();
    expect(screen.getByText(/please book all four reviews/)).toBeInTheDocument();
  });

  it('shows the notice and records that the learner read it and confirms the acknowledgement', async () => {
    render(
      <MemoryRouter initialEntries={['/learner/onboarding/reviews/uln-privacy:670:1:2026-10-02']}>
        <Routes><Route path="/learner/onboarding/reviews/:eventKey" element={<ReviewFormPage />} /></Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Unique Learner Number (ULN) Privacy Notice' })).toBeInTheDocument();
    expect(screen.getByText(/submitting and maintaining your Individualised Learner Record \(ILR\)/)).toBeInTheDocument();
    expect(screen.getByText(/I understand what a ULN is/)).toBeInTheDocument();

    const [noticeSave, acknowledgementSave] = screen.getAllByRole('button', { name: /^Save$/ });
    await userEvent.click(noticeSave);
    await waitFor(() => expect(form.saveReviewForm).toHaveBeenCalledWith('apprenticeship', '670', 'uln-privacy:670:1:2026-10-02',
      { answers: { ulnPrivacyNotice: { noticeRead: 'Yes' } } }));

    await userEvent.click(acknowledgementSave);
    await waitFor(() => expect(form.saveReviewForm).toHaveBeenLastCalledWith('apprenticeship', '670', 'uln-privacy:670:1:2026-10-02',
      { answers: { learnerAcknowledgement: { acknowledged: 'Yes' } } }));
  });
});

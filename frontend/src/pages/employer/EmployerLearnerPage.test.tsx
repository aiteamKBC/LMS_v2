import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SidebarNavItem } from '@/components/feature/Sidebar';
import { AppIcon } from '@/components/feature/AppIcon';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  fetchEmployerLearner: vi.fn((): Promise<unknown> => new Promise(() => undefined)),
  fetchEmployerReviewInstance: vi.fn(() => Promise.resolve(null)),
  signReviewAsEmployer: vi.fn(() => Promise.resolve({})),
  signEnrolmentReviewAsEmployer: vi.fn(() => Promise.resolve({})),
  fetchEmployerEnrolmentReview: vi.fn(() => Promise.resolve({ eventKey: 'enrol-eligibility-1' })),
  fetchReviewForm: vi.fn(() => Promise.resolve({})),
  downloadReviewPdf: vi.fn(),
  fetchMigratedReviewForParty: vi.fn(() => Promise.resolve(null)),
  signMigratedReviewAsParty: vi.fn(() => Promise.resolve({ signed: true, role: 'employer' })),
  downloadMigratedReviewForParty: vi.fn(() => Promise.resolve()),
  toastError: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: mocks.toastError }),
}));
vi.mock('@/api/employerPortal', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/employerPortal')>(),
  // The Overview tab's learner-dashboard reads; never settling keeps them out of the way.
  fetchEmployerLearnerWeek: vi.fn(() => new Promise(() => undefined)),
  fetchEmployerLearnerSchedule: vi.fn(() => new Promise(() => undefined)),
  fetchEmployerLearnerHours: vi.fn(() => new Promise(() => undefined)),
  fetchEmployerLearnerPhoto: vi.fn(() => new Promise(() => undefined)),
  fetchEmployerLearner: mocks.fetchEmployerLearner,
  fetchEmployerLearnerPlan: vi.fn(),
  fetchEmployerReviewInstance: mocks.fetchEmployerReviewInstance,
  signDocumentAsEmployer: vi.fn(),
  signAgreementAsEmployer: vi.fn(),
  signTrainingPlanAsEmployer: vi.fn(),
  signWrittenAgreementAsEmployer: vi.fn(),
  signReviewAsEmployer: mocks.signReviewAsEmployer,
  signEnrolmentReviewAsEmployer: mocks.signEnrolmentReviewAsEmployer,
  fetchEmployerEnrolmentReview: mocks.fetchEmployerEnrolmentReview,
}));
vi.mock('@/api/reviewForm', () => ({ fetchReviewForm: mocks.fetchReviewForm }));
vi.mock('@/api/learnerCalendar', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/learnerCalendar')>(),
  fetchMigratedReviewForParty: mocks.fetchMigratedReviewForParty,
  signMigratedReviewAsParty: mocks.signMigratedReviewAsParty,
  downloadMigratedReviewForParty: mocks.downloadMigratedReviewForParty,
}));
vi.mock('@/pages/learner/onboarding/reviews/reviewDocument', () => ({ downloadReviewPdf: mocks.downloadReviewPdf }));
// The pad's own behaviour is covered by savedSignaturePad.test.tsx; here it
// only needs to hand a signature to the page.
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({
  SignaturePad: ({ onCommit }: { onCommit: (url: string) => void }) => (
    <button onClick={() => onCommit('data:image/png;base64,SIG')}>Pad sign</button>
  ),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({
    role,
    roleLabel,
    navItems,
    userName,
    children,
  }: {
    role: string;
    roleLabel: string;
    navItems: SidebarNavItem[];
    userName: string;
    children: ReactNode;
  }) => {
    const learners = navItems.find((item) => item.id === 'employer-portal-learners');
    return (
      <div
        data-testid="workspace-shell"
        data-role={role}
        data-role-label={roleLabel}
        data-user-name={userName}
        data-learners-href={learners?.href ?? ''}
      >
        {children}
      </div>
    );
  },
}));

import EmployerLearnerPage from './EmployerLearnerPage';

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/employers/7/learner/commercial/499']}>
      <Routes>
        <Route path="/employers/:employerId/learner/:kind/:learnerId" element={<EmployerLearnerPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId('workspace-shell');
}

describe('EmployerLearnerPage workspace identity', () => {
  beforeEach(() => {
    mocks.fetchEmployerLearner.mockClear();
  });

  it('keeps an employer in the employer workspace', () => {
    mocks.useAuth.mockReturnValue({
      auth: { account: { role: 'employer', displayName: 'Test Employer' } },
    });

    const shell = renderPage();

    expect(shell).toHaveAttribute('data-role', 'employer');
    expect(shell).toHaveAttribute('data-role-label', 'Employer');
    expect(shell).toHaveAttribute('data-user-name', 'Test Employer');
    expect(shell).toHaveAttribute('data-learners-href', '/employers/7');
  });

  it('gives staff the same employer menu under their own name', () => {
    mocks.useAuth.mockReturnValue({
      auth: { account: { role: 'staff', accessNavRole: 'compliance' } },
    });

    const shell = renderPage();

    expect(shell).toHaveAttribute('data-role', 'compliance');
    expect(shell).toHaveAttribute('data-role-label', 'Employer');
    expect(shell).toHaveAttribute('data-user-name', 'Enrolment Officer');
    expect(shell).toHaveAttribute('data-learners-href', '/employers/7');
  });
});

describe('EmployerLearnerPage review signing', () => {
  const review = {
    kind: 'review',
    eventKey: 'enrol-eligibility-1',
    reviewType: 'eligibility',
    label: 'Eligibility Review & FS Discussion',
    scheduledDate: '',
    signable: true,
    completed: true,
    sectionsTotal: 1,
    employerSignatureRequired: true,
    signed: false,
    signedName: '',
    signedAt: null,
    learnerSigned: false,
    adminSigned: false,
  };

  function detail(reviews: object[]) {
    return {
      employer: { id: '7', name: 'Test Employer' },
      learner: {
        id: '499', kind: 'commercial', name: 'Lee Learner', email: '', phone: '', programme: '',
        cohort: '', programmeStatus: 'Onboarding', onboardingStatus: '', startDate: '', endDate: '', isActive: false,
      },
      performance: {
        quizzesTaken: 0, quizzesPassed: 0, averageScore: null, componentsCompleted: 0,
        ksbsEvidenced: 0, completedHours: null, lastActivityAt: null,
      },
      reviews,
      documents: [],
      outstandingCount: 1,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // The app gets AppIcon from unplugin-auto-import, which vitest.config.ts
    // does not load; provide it the same way for the page's Hero.
    vi.stubGlobal('AppIcon', AppIcon);
    mocks.useAuth.mockReturnValue({ auth: { account: { role: 'employer', displayName: 'Test Employer' } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The signing queue has its own tab.
  async function openDocuments() {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Documents/ }));
  }

  async function signFirstReview() {
    await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: /^Sign$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Pad sign' }));
  }

  it('signs a legacy enrolment review through the enrolment-review endpoint', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([review]));
    await signFirstReview();

    await waitFor(() => expect(mocks.signEnrolmentReviewAsEmployer).toHaveBeenCalledWith(
      'commercial', '499', 'enrol-eligibility-1', { name: 'Test Employer', signature: 'data:image/png;base64,SIG' },
    ));
    expect(mocks.signReviewAsEmployer).not.toHaveBeenCalled();
  });

  it('signs a Curriculum review instance through the review-instance endpoint', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([{ ...review, eventKey: 'cal-1', reviewInstanceId: 'ri-1' }]));
    await signFirstReview();

    await waitFor(() => expect(mocks.signReviewAsEmployer).toHaveBeenCalledWith(
      '7', 'commercial', '499', 'cal-1', { name: 'Test Employer', signature: 'data:image/png;base64,SIG' },
    ));
    expect(mocks.signEnrolmentReviewAsEmployer).not.toHaveBeenCalled();
  });

  it('signs a migrated PR through the dedicated employer endpoint', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([{ ...review, eventKey: 'imported-review:C5-TEST-PR', reviewInstanceId: 'imported-review:C5-TEST-PR', migratedForm: true }]));
    await signFirstReview();
    await waitFor(() => expect(mocks.signMigratedReviewAsParty).toHaveBeenCalledWith('imported-review:C5-TEST-PR', 'data:image/png;base64,SIG'));
    expect(mocks.signReviewAsEmployer).not.toHaveBeenCalled();
    expect(mocks.signEnrolmentReviewAsEmployer).not.toHaveBeenCalled();
  });

  it('opens a signed legacy enrolment review through the employer portal read', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([{ ...review, signed: true, signedName: 'Test Employer' }]));
    await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: /Show document/ }));

    await waitFor(() => expect(mocks.downloadReviewPdf).toHaveBeenCalledWith({ eventKey: 'enrol-eligibility-1' }, expect.anything()));
    expect(mocks.fetchEmployerEnrolmentReview).toHaveBeenCalledWith('7', 'commercial', '499', 'enrol-eligibility-1');
    expect(mocks.fetchReviewForm).not.toHaveBeenCalled();
  });

  it('keeps a signed migrated review unavailable until final completion', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([{ ...review,
      eventKey: 'imported-review:synthetic', migratedForm: true, signed: true, completed: false,
    }]));
    await openDocuments();
    expect(await screen.findByText('Signed · awaiting final completion')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Show document/ })).not.toBeInTheDocument();
    expect(mocks.downloadMigratedReviewForParty).not.toHaveBeenCalled();
  });

  it('downloads a completed migrated review through the authorized party endpoint', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([{ ...review,
      eventKey: 'imported-review:synthetic', migratedForm: true, signed: true, completed: true,
    }]));
    await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: /Show document/ }));
    await waitFor(() => expect(mocks.downloadMigratedReviewForParty).toHaveBeenCalledWith('imported-review:synthetic'));
    expect(mocks.downloadReviewPdf).not.toHaveBeenCalled();
  });

  it('shows the missing migrated PDF error without falling back to a draft or legacy PDF', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([{ ...review,
      eventKey: 'imported-review:synthetic', migratedForm: true, signed: true, completed: true,
    }]));
    mocks.downloadMigratedReviewForParty.mockRejectedValueOnce(new Error('The LMS PDF has not been generated yet.'));
    await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: /Show document/ }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Could not open the document', 'The LMS PDF has not been generated yet.'));
    expect(mocks.downloadReviewPdf).not.toHaveBeenCalled();
  });
});

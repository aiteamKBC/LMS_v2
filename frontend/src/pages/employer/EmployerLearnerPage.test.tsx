import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SidebarNavItem } from '@/components/feature/Sidebar';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchEmployerLearnerPlan, fetchEmployerLearnerWeek, fetchEmployerLearnerSchedule, fetchEmployerLearnerHours } from '@/api/employerPortal';
import type { LearnerDetail } from '@/api/learnerDetail';

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
  fetchEmployerMonthlyLogSummary: vi.fn(() => Promise.resolve({ months: [], total_months: 0, completed_months: 0, read_only: true, csrf_token: '' })),
  fetchEmployerProgressReviews: vi.fn(() => Promise.resolve({ events: [], definitions: {} })),
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/employers/7/learner/commercial/499']}>
      <Routes>
        <Route path="/employers/:employerId/learner/:kind/:learnerId" element={<EmployerLearnerPage />} />
      </Routes>
    </MemoryRouter>
    </QueryClientProvider>,
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
    expect(screen.getByRole('status', { name: 'Loading learner' })).toBeVisible();
    expect(screen.getByTestId('learner-loading-spinner')).toHaveClass('animate-spin');
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

describe('EmployerLearnerPage content and review signing', () => {
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
        cohort: '', employer: 'Test Employer', organization: 'Test Organization', programmeStatus: 'Onboarding', onboardingStatus: '', startDate: '', endDate: '', isActive: false,
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

  it('places Progress reviews after Documents and opens the employer review workspace', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([]));
    renderPage();
    const tab = await screen.findByRole('button', { name: 'Progress reviews' });
    const documents = screen.getByRole('button', { name: /Documents/ });
    expect(documents.compareDocumentPosition(tab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(tab);
    expect(await screen.findByRole('region', { name: 'Reviews sessions' })).toBeVisible();
    expect(tab).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Open calendar' })).not.toBeInTheDocument();
  });

  it('adds the timeline above the existing learning plan while keeping progress in Overview', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([]));
    vi.mocked(fetchEmployerLearnerWeek).mockResolvedValueOnce({
      weekStart: '2026-10-05', weekEnd: '2026-10-11', timezone: 'Europe/London', modules: [], deadlines: [],
      undatedActivities: 0, expectedHours: 0, missingExpectedHours: 0,
      otjh: { actual: 0, historical: 0, new: 0, undatedHistoricalRows: 0 },
      planSubjects: [],
      metrics: {
        migrated: false,
        programme: { completed: 4, total: 8, percent: 50, status: 'ready' },
        ksb: { completed: 2, total: 4, percent: 50, status: 'ready' },
        otjh: { historical: 0, new: 11, actual: 11, completed_actual: 11, planned: 74 },
      },
    });
    vi.mocked(fetchEmployerLearnerSchedule).mockResolvedValueOnce({
      months: {}, actual: [], actualAvailable: true, modules: [], moduleLinks: {}, sessions: [], reviews: [],
      coach: { name: 'Coach', bookingUrl: null }, contractStatus: 'ready', generatedAt: '',
    });
    vi.mocked(fetchEmployerLearnerHours).mockResolvedValueOnce({ months: [] } as Awaited<ReturnType<typeof fetchEmployerLearnerHours>>);
    vi.mocked(fetchEmployerLearnerPlan).mockResolvedValueOnce({
      name: 'Lee Learner', modules: ['Existing module'], ksbs: [],
      week: [{ module: 'Existing module', week: 'Existing week' }],
      components: [{ module: 'Existing module', week: 'Existing week', component: 'Existing reading',
        componentId: 'reading-1', type: 'reading', expectedOtjh: 2, contentHtml: '<p>Saved lesson</p>' }],
    } as unknown as LearnerDetail);

    renderPage();
    const learnerBanner = within(await screen.findByRole('banner', { name: 'Learner programme' }));
    expect(learnerBanner.getByRole('heading', { level: 1, name: 'Lee Learner' })).toBeVisible();
    expect(learnerBanner.getByRole('button', { name: 'All learners' })).toBeVisible();
    const employment = learnerBanner.getByRole('region', { name: 'Employer and Organization' });
    expect(employment).toHaveTextContent('Test Employer');
    expect(employment).toHaveTextContent('Test Organization');
    expect(learnerBanner.queryByRole('button', { name: 'Continue learning' })).not.toBeInTheDocument();
    expect(learnerBanner.queryByRole('button', { name: "Learner's Map" })).not.toBeInTheDocument();
    const programmeProgress = await screen.findByRole('region', { name: 'Programme module progress' });
    expect(programmeProgress).toBeVisible();
    expect(programmeProgress.closest('.learner-dashboard')).not.toBeNull();
    expect(programmeProgress.closest('.employer-learner-dashboard')).not.toBeNull();
    const wholeProgramme = screen.getByRole('region', { name: 'Whole programme progress' });
    expect(wholeProgramme).toBeVisible();
    expect(within(wholeProgramme).getAllByRole('img')).toHaveLength(4);
    expect(within(wholeProgramme).getByRole('img', { name: /^Attendance:/ })).toBeVisible();
    expect(within(wholeProgramme).getByRole('img', { name: 'Activities: 50%' })).toBeVisible();
    expect(within(wholeProgramme).getByRole('img', { name: /^Hours:/ })).toBeVisible();
    expect(within(wholeProgramme).getByRole('img', { name: 'KSBs: 50%' })).toBeVisible();
    expect(within(wholeProgramme).getByText('4 / 8')).toBeVisible();
    expect(wholeProgramme.parentElement).toBe(programmeProgress.parentElement);
    expect(wholeProgramme.compareDocumentPosition(programmeProgress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const otjChart = screen.getByRole('region', { name: 'Off-the-job hours by month' });
    expect(otjChart).toBeVisible();
    expect(otjChart.parentElement).toBe(programmeProgress.parentElement);
    expect(programmeProgress.compareDocumentPosition(otjChart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Module timeline' })).not.toBeInTheDocument();
    expect(fetchEmployerLearnerPlan).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Learning plan' }));
    expect(screen.getByRole('banner', { name: 'Learner programme' })).toBeVisible();
    const timeline = await screen.findByRole('region', { name: 'Module timeline' });
    const overview = screen.getByRole('region', { name: 'Module overview' });
    expect(overview).toBeVisible();
    expect(timeline.parentElement?.parentElement).toHaveClass(/trainingCards/);
    expect(timeline.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const module = await screen.findByRole('button', { name: /Existing module/ });
    expect(module).toBeVisible();
    expect(timeline.compareDocumentPosition(module) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Existing week/ }));
    expect(screen.getByText('Existing reading', { selector: 'p' })).toBeVisible();
    expect(fetchEmployerLearnerPlan).toHaveBeenCalledWith('7', 'commercial', '499');
    expect(screen.queryByRole('region', { name: 'Programme module progress' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(await screen.findByRole('region', { name: 'Programme module progress' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Off-the-job hours by month' })).toBeVisible();
    expect(screen.queryByText('Existing reading')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Module timeline' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Monthly logs' }));
    expect(await screen.findByText('No monthly logs yet')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Off-the-job hours by month' })).not.toBeInTheDocument();
  });

  it('shows the All documents columns and filters for the current learner', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([
      review,
      { ...review, eventKey: 'waiting-review', label: 'Waiting review', signable: false },
      { ...review, eventKey: 'signed-review', label: 'Signed review', signed: true },
    ]));
    await openDocuments();
    const documents = screen.getByRole('region', { name: 'Documents' });
    for (const column of ['Document', 'Date', 'Status', 'Parties', 'Action']) {
      expect(within(documents).getByText(column)).toBeVisible();
    }
    expect(within(documents).getByText('Awaiting your signature')).toBeVisible();
    expect(within(documents).getByText('Waiting on learner')).toBeVisible();
    const filters = within(documents).getByRole('navigation', { name: 'Filter documents' });
    await userEvent.click(within(filters).getByRole('button', { name: /To sign/ }));
    expect(within(documents).getByText(review.label)).toBeVisible();
    expect(within(documents).queryByText('Waiting review')).not.toBeInTheDocument();
    expect(within(documents).queryByText('Signed review')).not.toBeInTheDocument();
    await userEvent.click(within(filters).getByRole('button', { name: /Signed/ }));
    expect(within(documents).getByText('Signed review')).toBeVisible();
    expect(within(documents).getByRole('button', { name: 'Show document' })).toBeVisible();
    expect(within(documents).queryByText(review.label)).not.toBeInTheDocument();
  });

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

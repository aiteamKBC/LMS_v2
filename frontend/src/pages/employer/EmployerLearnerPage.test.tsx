import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SidebarNavItem } from '@/components/feature/Sidebar';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchEmployerLearnerPlan, fetchEmployerLearningOverview, fetchEmployerTraining } from '@/api/employerPortal';
import { dashboardOverviewFixture } from '@/test/dashboardOverviewFixture';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  fetchEmployerLearner: vi.fn((): Promise<unknown> => new Promise(() => undefined)),
  fetchEmployerReviewInstance: vi.fn(() => Promise.resolve(null)),
  signReviewAsEmployer: vi.fn(() => Promise.resolve({})),
  signEnrolmentReviewAsEmployer: vi.fn(() => Promise.resolve({})),
  fetchEmployerEnrolmentReview: vi.fn(() => Promise.resolve({ eventKey: 'enrol-eligibility-1' })),
  fetchReviewForm: vi.fn(() => Promise.resolve({})),
  downloadReviewPdf: vi.fn(),
  buildReviewPdf: vi.fn(() => ({ output: () => new Blob(['%PDF-1.7 example'], { type: 'application/pdf' }) })),
  fetch: vi.fn(),
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
  fetchEmployerLearningOverview: vi.fn(() => new Promise(() => undefined)),
  fetchEmployerTraining: vi.fn(() => new Promise(() => undefined)),
  fetchEmployerLearnerWeek: vi.fn(() => new Promise(() => undefined)),
  fetchEmployerLearnerSchedule: vi.fn(() => new Promise(() => undefined)),
  fetchEmployerLearnerHours: vi.fn(() => new Promise(() => undefined)),
  fetchEmployerLearnerAttendance: vi.fn(() => new Promise(() => undefined)),
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
vi.mock('@/pages/learner/monthly-submission/AssignmentPdfPreview', () => ({ AssignmentPdfPreview: ({ url, label }: { url: string; label: string }) =>
  <section aria-label={label} data-url={url} /> }));
vi.mock('@/api/learnerCalendar', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/learnerCalendar')>(),
  fetchMigratedReviewForParty: mocks.fetchMigratedReviewForParty,
  signMigratedReviewAsParty: mocks.signMigratedReviewAsParty,
  downloadMigratedReviewForParty: mocks.downloadMigratedReviewForParty,
}));
vi.mock('@/pages/learner/onboarding/reviews/reviewDocument', () => ({ downloadReviewPdf: mocks.downloadReviewPdf,
  buildReviewPdf: mocks.buildReviewPdf, reviewDocumentFilename: () => 'Review.pdf' }));
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

function renderPage(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[`/employers/7/learner/commercial/499${search}`]}>
      <Routes>
        <Route path="/employers/:employerId/learner/:kind/:learnerId" element={<EmployerLearnerPage />} />
        <Route path="/employers/:employerId/learners" element={<h1>All employer learners</h1>} />
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
    expect(shell).toHaveAttribute('data-learners-href', '/employers/7/learners');
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
    expect(shell).toHaveAttribute('data-learners-href', '/employers/7/learners');
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
    // jsdom has no native dialog implementation; browser checks exercise real focus/Escape behavior.
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
    vi.stubGlobal('fetch', mocks.fetch);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    mocks.fetch.mockResolvedValue(new Response('%PDF-1.7 saved', { headers: { 'Content-Type': 'application/pdf' } }));
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

  it.each(['reviews', 'documents'])('opens the %s tab directly from the employer home link', async tabName => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([]));
    renderPage(`?tab=${tabName}`);
    const label = tabName === 'reviews' ? /^Progress reviews$/ : /^Documents/;
    expect(await screen.findByRole('button', { name: label })).toHaveAttribute('aria-current', 'page');
  });

  it('returns from a learner review to My learners using All learners', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([]));
    renderPage('?tab=reviews');
    await userEvent.click(await screen.findByRole('button', { name: 'All learners' }));
    expect(screen.getByRole('heading', { name: 'All employer learners' })).toBeVisible();
  });

  it('uses the learner projections for Overview and Learning plan without the legacy full-plan read', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([]));
    vi.mocked(fetchEmployerLearningOverview).mockResolvedValueOnce(dashboardOverviewFixture());
    vi.mocked(fetchEmployerTraining).mockResolvedValueOnce({
      timeline: { start: '2026-09', end: '2026-11', modules: [], reviews: [], coachName: 'Coach' },
      selectedModule: null, selectedModuleId: null,
    });
    renderPage();
    const learnerBanner = within(await screen.findByRole('banner', { name: 'Learner programme' }));
    expect(learnerBanner.getByRole('heading', { level: 1, name: 'Lee Learner' })).toBeVisible();
    expect(learnerBanner.getByRole('region', { name: 'Employer and Organization' })).toHaveTextContent('Test Organization');
    expect(await screen.findByRole('region', { name: 'Programme module progress' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Whole programme progress' })).not.toBeInTheDocument();
    expect(screen.getByText('40.00 h')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Module (Current plan): 50% overall progress' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Learning plan' }));
    expect(await screen.findByRole('region', { name: 'Module timeline' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Module overview' })).toBeVisible();
    expect(fetchEmployerTraining).toHaveBeenCalledWith('7', 'commercial', '499', '', '', expect.any(AbortSignal));
    expect(fetchEmployerLearnerPlan).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Programme module progress' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(await screen.findByRole('region', { name: 'Programme module progress' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Module timeline' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Monthly logs' }));
    expect(await screen.findByText('No monthly logs yet')).toBeVisible();
  });

  it('marks the Documents tab with a red dot while anything is unsigned', async () => {
    // Not signable yet (the review form is unfinished) still counts as unsigned.
    mocks.fetchEmployerLearner.mockResolvedValue({
      ...detail([{ ...review, signable: false }, { ...review, eventKey: 'signed-review', signed: true }]),
      outstandingCount: 0,
    });
    renderPage();
    const documentsTab = await screen.findByRole('button', { name: /Documents/ });
    const dot = within(documentsTab).getByTestId('documents-unsigned-dot');
    expect(dot).toHaveClass('bg-red-500');
    expect(dot).toHaveAttribute('title', '1 not signed yet');
    expect(documentsTab).toHaveAccessibleName(/1 not signed yet/);
  });

  it('shows no dot once everything is signed', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue({ ...detail([{ ...review, signed: true }]), outstandingCount: 0 });
    renderPage();
    const documentsTab = await screen.findByRole('button', { name: /Documents/ });
    expect(within(documentsTab).queryByTestId('documents-unsigned-dot')).not.toBeInTheDocument();
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
    expect(within(documents).getByText('Awaiting completion')).toBeVisible();
    const filters = within(documents).getByRole('navigation', { name: 'Filter documents' });
    await userEvent.click(within(filters).getByRole('button', { name: /To sign/ }));
    expect(within(documents).getByText(review.label)).toBeVisible();
    expect(within(documents).queryByText('Waiting review')).not.toBeInTheDocument();
    expect(within(documents).queryByText('Signed review')).not.toBeInTheDocument();
    await userEvent.click(within(filters).getByRole('button', { name: /Signed/ }));
    expect(within(documents).getByText('Signed review')).toBeVisible();
    expect(within(documents).getByRole('button', { name: 'Preview' })).toBeVisible();
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
    mocks.fetchMigratedReviewForParty.mockResolvedValueOnce({ reviewRevision: 2 } as never);
    mocks.fetchEmployerLearner.mockResolvedValue(detail([{ ...review, eventKey: 'imported-review:C5-TEST-PR', reviewInstanceId: 'imported-review:C5-TEST-PR', migratedForm: true }]));
    await signFirstReview();
    await waitFor(() => expect(mocks.signMigratedReviewAsParty).toHaveBeenCalledWith('imported-review:C5-TEST-PR', 'data:image/png;base64,SIG', { reviewRevision: 2 }));
    expect(mocks.signReviewAsEmployer).not.toHaveBeenCalled();
    expect(mocks.signEnrolmentReviewAsEmployer).not.toHaveBeenCalled();
  });

  it('opens a signed legacy enrolment review through the employer portal read', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([{ ...review, signed: true, signedName: 'Test Employer' }]));
    await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: /^Preview$/ }));

    expect(await screen.findByRole('region', { name: review.label + ' preview' })).toHaveAttribute('data-url', 'blob:preview');
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'Review.pdf');
    expect(mocks.downloadReviewPdf).not.toHaveBeenCalled();
    expect(mocks.fetchEmployerEnrolmentReview).toHaveBeenCalledWith('7', 'commercial', '499', 'enrol-eligibility-1');
    expect(mocks.fetchReviewForm).not.toHaveBeenCalled();
  });

  it('offers preview while keeping final download unavailable before completion', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([{ ...review,
      eventKey: 'imported-review:synthetic', migratedForm: true, signed: true, completed: false,
    }]));
    await openDocuments();
    expect(await screen.findByText('Awaiting final completion')).toBeVisible();
    expect(screen.getByRole('button', { name: /^Preview$/ })).toBeVisible();
    expect(mocks.downloadMigratedReviewForParty).not.toHaveBeenCalled();
  });

  it('previews the stored migrated PDF before offering a download', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([{ ...review,
      eventKey: 'imported-review:synthetic', migratedForm: true, signed: true, completed: true,
    }]));
    await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: /^Preview$/ }));
    expect(await screen.findByRole('link', { name: 'Download' })).toHaveAttribute('href', 'blob:preview');
    expect(mocks.fetch).toHaveBeenCalledWith('/learner_api/migrated-reviews/imported-review%3Asynthetic/party-pdf', expect.objectContaining({ credentials: 'include' }));
    expect(mocks.downloadMigratedReviewForParty).not.toHaveBeenCalled();
    expect(mocks.downloadReviewPdf).not.toHaveBeenCalled();
  });

  it('shows the missing migrated PDF error without falling back to a draft or legacy PDF', async () => {
    mocks.fetchEmployerLearner.mockResolvedValue(detail([{ ...review,
      eventKey: 'imported-review:synthetic', migratedForm: true, signed: true, completed: true,
    }]));
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'The LMS PDF has not been generated yet.' }), { status: 409 }));
    await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: /^Preview$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The LMS PDF has not been generated yet.');
    expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
    expect(mocks.downloadReviewPdf).not.toHaveBeenCalled();
  });
});

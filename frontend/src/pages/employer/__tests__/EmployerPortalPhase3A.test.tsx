import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import EmployerPortalPage from '../EmployerPortalPage';
import EmployerLearnerPage from '../EmployerLearnerPage';
import { fetchEmployerLearner, fetchEmployerLearnerPlan, fetchEmployerLearnerSummary, fetchEmployerPortal, fetchEmployerReviewInstance, signReviewAsEmployer, type EmployerLearnerDetail, type EmployerLearnerSummary, type EmployerPortal } from '@/api/employerPortal';
import type { LearnerReviewDefinition } from '@/api/learnerCalendar';

vi.mock('@/api/employerPortal', () => ({ fetchEmployerPortal: vi.fn(), fetchEmployerLearner: vi.fn(), fetchEmployerLearnerPlan: vi.fn(), fetchEmployerLearnerSummary: vi.fn(), fetchEmployerReviewInstance: vi.fn(), signReviewAsEmployer: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { role: 'employer', displayName: 'Test Employer' } } }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({ SignaturePad: ({ onCommit, onCancel }: { onCommit: (value: string) => void; onCancel: () => void }) => <div><button onClick={() => onCommit('data:image/png;base64,c2ln')}>Commit signature</button><button onClick={onCancel}>Cancel signature</button></div> }));

function summary(): EmployerLearnerSummary {
  return {
    learner: { id: '125', kind: 'commercial', name: 'API Learner', email: '' },
    programme: { name: 'API Programme', status: 'Active', cohort: 'API Cohort', group: 'API Group', startDate: '2026-01-01', plannedEndDate: '2027-01-01' },
    coach: { id: null, name: 'API Coach', email: null }, trainingPlan: { available: true, plannedOtjTotalHours: 278 },
    currentLearning: { selectionState: 'current', modules: [{ moduleId: 'm-1', moduleName: 'API Module', progressPercent: 37.5, completedActivities: 1, totalActivities: 10, currentWeek: null, totalWeeks: 8, available: true, source: 'learner_learning_plan' }] },
    attendance: { available: true, ratePercent: 86, sessionsHeld: 7, sessionsAttended: 6, absences: 1, classification: 'amber', lastSessionDate: '2026-09-17', lastAttendanceStatus: 'late' },
    otj: { actualHours: 61, submittedPendingHours: 6, plannedTotalHours: 278, plannedToDateHours: null, varianceToDateHours: null, plannedToDateAvailable: false },
    ksb: { available: true, metric: 'activity_ksb_points', achieved: 18, total: 24, percentage: 75 },
    activity: { lastLmsActivityAt: '2026-09-17T10:00:00Z', lastSubmissionAt: null, lastLiveSessionAt: null },
    reviews: { lastReviewDate: '2026-08-01', nextReviewDate: '2026-10-01', pendingEmployerSignatureCount: 1, available: true },
  };
}
function detail(): EmployerLearnerDetail {
  return {
    employer: { id: '7', name: 'Test Employer' },
    learner: { id: '125', kind: 'commercial', name: 'API Learner', email: '', phone: '', programme: 'API Programme', cohort: 'API Cohort', programmeStatus: 'Active', onboardingStatus: '', startDate: '2026-01-01', endDate: '2027-01-01', isActive: true },
    performance: { quizzesTaken: 0, quizzesPassed: 0, averageScore: null, componentsCompleted: 0, ksbsEvidenced: 0, completedHours: null, lastActivityAt: null },
    reviews: [{ kind: 'review', eventKey: 'review:45', reviewInstanceId: '45', reviewType: 'progress_review', label: 'Canonical Progress Review', scheduledDate: '2026-10-01', signable: true, completed: false, sectionsTotal: 1, employerSignatureRequired: true, signed: false, signedName: '', signedAt: null, learnerSigned: false, adminSigned: false }], documents: [], outstandingCount: 1,
  };
}
function portal(): EmployerPortal {
  return { employer: { id: '7', name: 'Test Employer', email: '', employerGroupNames: ['API Organisation'] }, learners: [{ ...detail().learner, outstandingCount: 1, documentsTotal: 0 }], outstandingTotal: 1 };
}
function Navigation() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/employers/7/learner/apprenticeship/999')}>Change learner</button>;
}
function open(path = '/employers/7/learner/commercial/125') {
  return render(<MemoryRouter initialEntries={[path]}><Navigation /><Routes><Route path="/employers/:employerId" element={<EmployerPortalPage />} /><Route path="/employers/:employerId/learner/:kind/:learnerId" element={<EmployerLearnerPage />} /></Routes></MemoryRouter>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('AppIcon', AppIcon);
  vi.mocked(fetchEmployerPortal).mockResolvedValue(portal());
  vi.mocked(fetchEmployerLearner).mockResolvedValue(detail());
  vi.mocked(fetchEmployerLearnerPlan).mockRejectedValue(new Error('Learning plan unavailable'));
  vi.mocked(fetchEmployerLearnerSummary).mockResolvedValue(summary());
  vi.mocked(signReviewAsEmployer).mockResolvedValue({});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Employer Phase 3A', () => {
  it('renders only learners returned by the employer API and navigates using source ID and kind', async () => {
    open('/employers/7');
    const card = await screen.findByRole('link', { name: 'API Learner' });
    expect(fetchEmployerPortal).toHaveBeenCalledWith('7');
    expect(await screen.findByText('API Module')).toBeInTheDocument();
    expect(screen.queryByText(/Zoe Moore Williams|emp-001|Sophie Williams/)).not.toBeInTheDocument();
    fireEvent.click(card);
    await waitFor(() => expect(fetchEmployerLearner).toHaveBeenCalledWith('7', 'commercial', '125'));
    expect(await screen.findByRole('region', { name: 'Programme Details' })).toBeInTheDocument();
  });
  it('loads Overview from backend fields and preserves the domain percentage without recomputing it', async () => {
    open();
    const current = await screen.findByRole('region', { name: 'Current Module Progress' });
    await waitFor(() => expect(within(current).getByText('37.5%')).toBeInTheDocument());
    expect(screen.queryByText('10%')).not.toBeInTheDocument();
    expect(screen.getByText('API Module')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Attendance' })).getByText('86%')).toBeInTheDocument();
    expect(screen.getByText('API Group')).toBeInTheDocument();
    expect(screen.getByText('61h')).toBeInTheDocument();
    expect(screen.getByText('18 / 24')).toBeInTheDocument();
  });
  it('renders multiple current modules without averaging percentages', async () => {
    const data = summary(); data.currentLearning.selectionState = 'multiple';
    data.currentLearning.modules.push({ ...data.currentLearning.modules[0], moduleId: 'm-2', moduleName: 'Second API Module', progressPercent: 82.5 });
    vi.mocked(fetchEmployerLearnerSummary).mockResolvedValue(data);
    open();
    expect(await screen.findByText('Second API Module')).toBeInTheDocument();
    expect(screen.getAllByText('Multiple active modules').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Multiple active modules')[0]).toHaveClass('text-base');
    expect(screen.getByText('37.5%')).toBeInTheDocument();
    expect(screen.getByText('82.5%')).toBeInTheDocument();
    expect(screen.queryByText('60%')).not.toBeInTheDocument();
  });
  it.each(['next', 'last', 'unavailable'] as const)('supports the %s module state', async state => {
    const data = summary(); data.currentLearning.selectionState = state;
    vi.mocked(fetchEmployerLearnerSummary).mockResolvedValue(data);
    open();
    const learning = await screen.findByRole('region', { name: 'Current Learning' });
    expect(within(learning).getByText(state === 'next' ? 'Next module' : state === 'last' ? 'Last module' : 'Current learning unavailable')).toBeInTheDocument();
  });
  it('keeps missing attendance, absence and KSB values unavailable', async () => {
    const data = summary();
    data.attendance = { available: false, ratePercent: null, sessionsHeld: null, sessionsAttended: null, absences: null, classification: 'unavailable', lastSessionDate: null, lastAttendanceStatus: null };
    data.ksb = { available: false, metric: 'activity_ksb_points', achieved: null, total: null, percentage: null };
    vi.mocked(fetchEmployerLearnerSummary).mockResolvedValue(data);
    open();
    expect(await screen.findByText('Attendance unavailable')).toBeInTheDocument();
    expect(screen.getByText('KSB data unavailable')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Absences' })).getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText(/On track|No absences/)).not.toBeInTheDocument();
  });
  it('shows only actual, pending and programme total OTJ hours', async () => {
    open();
    const otj = await screen.findByRole('region', { name: 'Off-the-job Hours' });
    expect(within(otj).getByText('61h')).toBeInTheDocument();
    expect(within(otj).getByText('6h')).toBeInTheDocument();
    expect(within(otj).getByText('278h')).toBeInTheDocument();
    expect(screen.queryByText(/planned.to.date|behind|ahead|variance/i)).not.toBeInTheDocument();
  });
  it('excludes MCM and legacy reviews from canonical Progress Review actions', async () => {
    const data = detail(); data.reviews = [{ ...data.reviews[0], reviewType: 'mcm', label: 'Monthly Coaching Meeting' }, { ...data.reviews[0], reviewInstanceId: undefined, label: 'Legacy review' }];
    const metrics = summary(); metrics.reviews.pendingEmployerSignatureCount = 0;
    vi.mocked(fetchEmployerLearner).mockResolvedValue(data); vi.mocked(fetchEmployerLearnerSummary).mockResolvedValue(metrics);
    open();
    const reviews = await screen.findByRole('region', { name: 'Reviews' });
    expect(within(reviews).getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('Monthly Coaching Meeting')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign/i })).not.toBeInTheDocument();
  });
  it('opens a canonical review through the ownership-scoped GET and exposes no signing action', async () => {
    vi.mocked(fetchEmployerReviewInstance).mockResolvedValue({ instance: { id: '45' }, template: { name: 'Read-only canonical review', reviewTypeCode: 'progress_review', visibleTo: { employer: true } }, sections: [], signatures: {} } as unknown as LearnerReviewDefinition);
    open(); fireEvent.click(await screen.findByRole('button', { name: 'View Review' }));
    expect(await screen.findByText('Read-only canonical review')).toBeInTheDocument();
    expect(fetchEmployerReviewInstance).toHaveBeenCalledWith('7', 'commercial', '125', 'review:45');
    expect(screen.queryByRole('button', { name: /sign/i })).not.toBeInTheDocument();
  });
  it('submits the employer signature only through the ownership-scoped Progress Review endpoint', async () => {
    vi.mocked(fetchEmployerReviewInstance).mockResolvedValue({
      instance: { id: '45', status: 'awaiting-signature' },
      template: { name: 'Signable Progress Review', reviewTypeCode: 'progress_review', visibleTo: { employer: true } },
      sections: [],
      signatures: { employer: { required: true, signed: false, signedName: '', signedAt: null, signature: null } },
    } as unknown as LearnerReviewDefinition);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'View Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign as Employer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Commit signature' }));
    await waitFor(() => expect(signReviewAsEmployer).toHaveBeenCalledWith(
      '7', 'commercial', '125', 'review:45', { name: 'Test Employer', signature: 'data:image/png;base64,c2ln' },
    ));
  });
  it('does not show an employer signing control when the review state cannot be signed', async () => {
    vi.mocked(fetchEmployerReviewInstance).mockResolvedValue({
      instance: { id: '45', status: 'in-progress' },
      template: { name: 'Unfinished Progress Review', reviewTypeCode: 'progress_review', visibleTo: { employer: true } },
      sections: [],
      signatures: { employer: { required: true, signed: false, signedName: '', signedAt: null, signature: null } },
    } as unknown as LearnerReviewDefinition);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'View Review' }));
    expect(await screen.findByText('Unfinished Progress Review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign as Employer' })).not.toBeInTheDocument();
    expect(signReviewAsEmployer).not.toHaveBeenCalled();
  });
  it('shows API errors without mock fallback and supports retry', async () => {
    vi.mocked(fetchEmployerPortal).mockRejectedValueOnce(new Error('Access denied'));
    open('/employers/7');
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText(/API Learner|Zoe Moore Williams|Sophie Williams/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'API Learner' })).toBeInTheDocument();
  });
  it('does not convert failed dashboard summaries into zero pending reviews', async () => {
    vi.mocked(fetchEmployerLearnerSummary).mockRejectedValue(new Error('Summary denied'));
    open('/employers/7');
    expect(await screen.findByText('Summary unavailable')).toBeInTheDocument();
    expect(screen.getByText('Review actions unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No review action')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry unavailable summaries' })).toBeInTheDocument();
  });
  it('honours backend ownership rejection even if the summary request succeeds', async () => {
    vi.mocked(fetchEmployerLearner).mockRejectedValue(new Error('That learner does not belong to this employer.'));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('That learner does not belong');
    expect(screen.queryByText('API Module')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Programme Details' })).not.toBeInTheDocument();
  });
  it('clears the previous learner immediately and ignores late responses after navigation', async () => {
    let resolveOld!: (data: EmployerLearnerSummary) => void;
    vi.mocked(fetchEmployerLearnerSummary).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockRejectedValue(new Error('Summary denied'));
    open(); await screen.findByRole('region', { name: 'Programme Details' });
    vi.mocked(fetchEmployerLearner).mockRejectedValue(new Error('Learner access denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Change learner' }));
    expect(screen.queryByText('API Programme')).not.toBeInTheDocument();
    await act(async () => { resolveOld(summary()); });
    expect(await screen.findByText('Learner access denied')).toBeInTheDocument();
    expect(fetchEmployerLearner).toHaveBeenLastCalledWith('7', 'apprenticeship', '999');
    expect(screen.queryByText('API Module')).not.toBeInTheDocument();
  });
  it('builds Actions from real reviews, documents and attendance — no fake write controls', async () => {
    vi.mocked(fetchEmployerReviewInstance).mockResolvedValue({ instance: { id: '45' }, template: { name: 'Read-only canonical review', reviewTypeCode: 'progress_review', visibleTo: { employer: true } }, sections: [], signatures: {} } as unknown as LearnerReviewDefinition);
    open(); await screen.findByRole('region', { name: 'Programme Details' });
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    // One pending Progress Review signature (from the mocked review) and one
    // attendance concern (the mocked summary is 86% / amber) — both derived
    // from data already fetched for other tabs, not invented for this one.
    expect(await screen.findByText('Canonical Progress Review')).toBeInTheDocument();
    expect(screen.getByText('Attendance concern')).toBeInTheDocument();
    // The action navigates to the canonical review. Its backend-derived
    // definition decides whether an employer signature is available.
    expect(screen.queryByRole('button', { name: /^sign$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View Review' }));
    expect(await screen.findByText('Read-only canonical review')).toBeInTheDocument();
  });
  it('shows an up-to-date Actions tab when nothing needs employer attention', async () => {
    const data = detail(); data.reviews = [];
    const metrics = summary(); metrics.attendance.classification = 'green';
    vi.mocked(fetchEmployerLearner).mockResolvedValue(data);
    vi.mocked(fetchEmployerLearnerSummary).mockResolvedValue(metrics);
    vi.mocked(fetchEmployerReviewInstance).mockResolvedValue({ instance: { id: '45' }, template: { name: 'Read-only canonical review', reviewTypeCode: 'progress_review', visibleTo: { employer: true } }, sections: [], signatures: {} } as unknown as LearnerReviewDefinition);
    open(); await screen.findByRole('region', { name: 'Programme Details' });
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(await screen.findByText("You're up to date")).toBeInTheDocument();
  });
  it('keeps deferred tabs empty of mock data or write controls', async () => {
    open(); await screen.findByRole('region', { name: 'Programme Details' });
    fireEvent.click(screen.getByRole('button', { name: 'Progress Reviews' }));
    expect(screen.getByText('Canonical Progress Review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Learning Plan' }));
    expect(screen.getByRole('region', { name: 'Learning Plan' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Attendance & OTJ' }));
    expect(screen.getByRole('region', { name: 'Attendance' })).toBeInTheDocument();
  });
  it('retains the existing real document panel separately from Progress Reviews', async () => {
    const data = detail();
    data.documents = [{ kind: 'document', id: 'doc-5', docType: 'agreement', label: 'Existing compliance document', generatedAt: '2026-01-01', signable: false, signed: true, signedName: 'Test Employer', signedAt: '2026-01-02' }];
    vi.mocked(fetchEmployerLearner).mockResolvedValue(data);
    open(); await screen.findByRole('region', { name: 'Programme Details' });
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }));
    expect(screen.getByText('Existing compliance document')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.queryByText('Canonical Progress Review')).not.toBeInTheDocument();
  });
  it('shows an empty learner list without issuing summary requests', async () => {
    vi.mocked(fetchEmployerPortal).mockResolvedValue({ ...portal(), learners: [], outstandingTotal: 0 });
    open('/employers/7');
    expect(await screen.findByText('No learners are linked to this employer yet.')).toBeInTheDocument();
    expect(fetchEmployerLearnerSummary).not.toHaveBeenCalled();
  });
});

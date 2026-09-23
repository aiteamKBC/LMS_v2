import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import EmployerPortalPage from '../EmployerPortalPage';
import EmployerLearnerPage from '../EmployerLearnerPage';
import { downloadEmployerReviewPdf, fetchEmployerLearner, fetchEmployerLearnerPlan, fetchEmployerLearnerSummary, fetchEmployerPortal, fetchEmployerReviewInstance, signReviewAsEmployer, type EmployerLearnerDetail, type EmployerLearnerSummary, type EmployerPortal } from '@/api/employerPortal';
import type { LearnerReviewDefinition } from '@/api/learnerCalendar';

vi.mock('@/api/employerPortal', () => ({ downloadEmployerReviewPdf: vi.fn(), fetchEmployerPortal: vi.fn(), fetchEmployerLearner: vi.fn(), fetchEmployerLearnerPlan: vi.fn(), fetchEmployerLearnerSummary: vi.fn(), fetchEmployerReviewInstance: vi.fn(), signReviewAsEmployer: vi.fn() }));
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
    expect(screen.queryByText(/behind plan|ahead of plan/i)).not.toBeInTheDocument();
  });
  it('shows planned-to-date hours and a behind-plan variance once they are known', async () => {
    const data = summary();
    data.otj = { ...data.otj, actualHours: 61, plannedToDateHours: 90, varianceToDateHours: -29, plannedToDateAvailable: true, behindPlan: true };
    vi.mocked(fetchEmployerLearnerSummary).mockResolvedValue(data);
    // The OTJ detail section is gated on the learner-plan request, so resolve it
    // before opening rather than leaving the section on its loading state.
    vi.mocked(fetchEmployerLearnerPlan).mockResolvedValue({ activityFeed: [] } as unknown as Awaited<ReturnType<typeof fetchEmployerLearnerPlan>>);
    open();
    // Let the learner load before switching tabs — the OTJ section's own fetch
    // is gated on it, and clicking earlier leaves the section on its spinner.
    await screen.findByRole('region', { name: 'Programme Details' });
    fireEvent.click(screen.getByRole('button', { name: 'Attendance & OTJ' }));
    // Re-query each poll: React swaps the section's subtree when the gating
    // learner-plan request settles, so a reference taken earlier goes stale.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const otj = screen.getByRole('region', { name: 'Off-the-job Hours' });
    expect(within(otj).getAllByText('90h').length).toBeGreaterThan(0);
    expect(within(otj).getByText('29h behind plan')).toBeInTheDocument();
  });
  it('reports being ahead of plan without flagging it as a concern', async () => {
    const data = summary();
    data.otj = { ...data.otj, actualHours: 120, plannedToDateHours: 90, varianceToDateHours: 30, plannedToDateAvailable: true, behindPlan: false };
    vi.mocked(fetchEmployerLearnerSummary).mockResolvedValue(data);
    // The OTJ detail section is gated on the learner-plan request, so resolve it
    // before opening rather than leaving the section on its loading state.
    vi.mocked(fetchEmployerLearnerPlan).mockResolvedValue({ activityFeed: [] } as unknown as Awaited<ReturnType<typeof fetchEmployerLearnerPlan>>);
    open();
    // Let the learner load before switching tabs — the OTJ section's own fetch
    // is gated on it, and clicking earlier leaves the section on its spinner.
    await screen.findByRole('region', { name: 'Programme Details' });
    fireEvent.click(screen.getByRole('button', { name: 'Attendance & OTJ' }));
    // Flush the gating learner-plan promise, then re-query: React swaps the
    // section's subtree once it settles.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const otj = screen.getByRole('region', { name: 'Off-the-job Hours' });
    expect(within(otj).getByText('30h ahead of plan')).toBeInTheDocument();
    expect(within(otj).queryByText(/behind plan/i)).not.toBeInTheDocument();
  });
  it('keeps planned-to-date unavailable when the programme dates are missing', async () => {
    const data = summary();
    data.otj = { ...data.otj, plannedToDateHours: null, varianceToDateHours: null, plannedToDateAvailable: false, behindPlan: null };
    vi.mocked(fetchEmployerLearnerSummary).mockResolvedValue(data);
    // The OTJ detail section is gated on the learner-plan request, so resolve it
    // before opening rather than leaving the section on its loading state.
    vi.mocked(fetchEmployerLearnerPlan).mockResolvedValue({ activityFeed: [] } as unknown as Awaited<ReturnType<typeof fetchEmployerLearnerPlan>>);
    open();
    // Let the learner load before switching tabs — the OTJ section's own fetch
    // is gated on it, and clicking earlier leaves the section on its spinner.
    await screen.findByRole('region', { name: 'Programme Details' });
    fireEvent.click(screen.getByRole('button', { name: 'Attendance & OTJ' }));
    // Flush the gating learner-plan promise, then re-query: React swaps the
    // section's subtree once it settles.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const otj = screen.getByRole('region', { name: 'Off-the-job Hours' });
    expect(within(otj).getByText(/needs the programme start and end dates/)).toBeInTheDocument();
    expect(within(otj).queryByText(/behind plan|ahead of plan/i)).not.toBeInTheDocument();
  });
  it('rounds stored four-decimal hours for display without inventing precision', async () => {
    const data = summary();
    data.otj = { ...data.otj, actualHours: 18.5114 };
    vi.mocked(fetchEmployerLearnerSummary).mockResolvedValue(data);
    // The OTJ detail section is gated on the learner-plan request, so resolve it
    // before opening rather than leaving the section on its loading state.
    vi.mocked(fetchEmployerLearnerPlan).mockResolvedValue({ activityFeed: [] } as unknown as Awaited<ReturnType<typeof fetchEmployerLearnerPlan>>);
    open();
    // Let the learner load before switching tabs — the OTJ section's own fetch
    // is gated on it, and clicking earlier leaves the section on its spinner.
    await screen.findByRole('region', { name: 'Programme Details' });
    fireEvent.click(screen.getByRole('button', { name: 'Attendance & OTJ' }));
    // Flush the gating learner-plan promise, then re-query: React swaps the
    // section's subtree once it settles.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const otj = screen.getByRole('region', { name: 'Off-the-job Hours' });
    expect(within(otj).getAllByText('18.5h').length).toBeGreaterThan(0);
    expect(within(otj).queryByText('18.5114h')).not.toBeInTheDocument();
  });
  it('shows the module week and percentage the learning plan reports', async () => {
    const data = summary();
    // 60% rather than 75%, which the fixture's KSB coverage also reports.
    data.currentLearning.modules = [{ ...data.currentLearning.modules[0], progressPercent: 60, completedActivities: 3, totalActivities: 5, currentWeek: 2, totalWeeks: 8 }];
    vi.mocked(fetchEmployerLearnerSummary).mockResolvedValue(data);
    open('/employers/7');
    // Every learner card reads the same mocked summary, so assert within one.
    const card = (await screen.findAllByRole('article'))[0];
    expect(within(card).getByText('60%')).toBeInTheDocument();
    expect(within(card).getByText(/Week 2 of 8/)).toBeInTheDocument();
    expect(within(card).getByText(/3 of 5 activities completed/)).toBeInTheDocument();
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
  it('has no Actions tab, and an old ?tab=actions link lands on Overview', async () => {
    open('/employers/7/learner/commercial/125?tab=actions');
    expect(await screen.findByRole('region', { name: 'Programme Details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByText('Attendance concern')).not.toBeInTheDocument();
  });
  it('downloads the signed Progress Review PDF through the ownership-scoped endpoint', async () => {
    vi.mocked(downloadEmployerReviewPdf).mockResolvedValue();
    vi.mocked(fetchEmployerReviewInstance).mockResolvedValue({ instance: { id: '45', status: 'completed' }, template: { name: 'Signed Progress Review', reviewTypeCode: 'progress_review', visibleTo: { employer: true } }, sections: [], signatures: {}, pdf: { available: true, reason: '' } } as unknown as LearnerReviewDefinition);
    open('/employers/7/learner/commercial/125?tab=reviews');
    fireEvent.click(await screen.findByRole('button', { name: 'View Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download signed PDF' }));
    await waitFor(() => expect(downloadEmployerReviewPdf).toHaveBeenCalledWith('7', 'commercial', '125', 'review:45'));
  });
  it('opens the Progress Review details directly under the review that was clicked', async () => {
    const data = detail();
    data.reviews = [data.reviews[0], { ...data.reviews[0], eventKey: 'review:46', reviewInstanceId: '46', label: 'Second Progress Review' }];
    vi.mocked(fetchEmployerLearner).mockResolvedValue(data);
    vi.mocked(fetchEmployerReviewInstance).mockResolvedValue({ instance: { id: '45' }, template: { name: 'First review details', reviewTypeCode: 'progress_review', visibleTo: { employer: true } }, sections: [], signatures: {} } as unknown as LearnerReviewDefinition);
    open('/employers/7/learner/commercial/125?tab=reviews');
    fireEvent.click((await screen.findAllByRole('button', { name: 'View Review' }))[0]);
    const details = await screen.findByRole('region', { name: 'Progress Review details' });
    expect(fetchEmployerReviewInstance).toHaveBeenCalledWith('7', 'commercial', '125', 'review:45');
    // DOM order: the first review's details sit before the second review, not after the list.
    expect(details.compareDocumentPosition(screen.getByText('Second Progress Review')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('keeps the PDF download disabled with the server reason until every party has signed', async () => {
    vi.mocked(fetchEmployerReviewInstance).mockResolvedValue({ instance: { id: '45', status: 'in-progress' }, template: { name: 'Unsigned Progress Review', reviewTypeCode: 'progress_review', visibleTo: { employer: true } }, sections: [], signatures: {}, pdf: { available: false, reason: 'The PDF is available after the learner and all required parties have signed.' } } as unknown as LearnerReviewDefinition);
    open('/employers/7/learner/commercial/125?tab=reviews');
    fireEvent.click(await screen.findByRole('button', { name: 'View Review' }));
    expect(await screen.findByRole('button', { name: 'Download signed PDF' })).toBeDisabled();
    expect(screen.getByText(/available after the learner and all required parties have signed/)).toBeInTheDocument();
    expect(downloadEmployerReviewPdf).not.toHaveBeenCalled();
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

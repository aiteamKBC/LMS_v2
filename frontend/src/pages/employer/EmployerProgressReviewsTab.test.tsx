import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import type { LearnerCalendarEvent, LearnerReviewDefinition } from '@/api/learnerCalendar';
import { fetchEmployerMeetingArtifacts, fetchEmployerProgressReview, fetchEmployerProgressReviews, saveEmployerReviewAnswers, signReviewAsEmployer } from '@/api/employerPortal';
import { fetchMigratedReviewForParty, signMigratedReviewAsParty, saveMigratedReviewPartyAnswers } from '@/api/learnerCalendar';
import { EmployerProgressReviewsTab } from './EmployerProgressReviewsTab';

vi.mock('@/api/employerPortal', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/employerPortal')>(),
  fetchEmployerProgressReview: vi.fn(), fetchEmployerProgressReviews: vi.fn(),
  saveEmployerReviewAnswers: vi.fn(), signReviewAsEmployer: vi.fn(), fetchEmployerMeetingArtifacts: vi.fn(),
}));
vi.mock('@/api/learnerCalendar', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/learnerCalendar')>(),
  fetchMigratedReviewForParty: vi.fn(), signMigratedReviewAsParty: vi.fn(), saveMigratedReviewPartyAnswers: vi.fn(),
}));
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({
  SignaturePad: ({ onCommit }: { onCommit: (signature: string) => void }) => <button type="button" onClick={() => onCommit('data:image/png;base64,SIG')}>Confirm employer signature</button>,
}));

let event: LearnerCalendarEvent;
let definition: LearnerReviewDefinition;
const onChanged = vi.fn();
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/employers/7/learner/commercial/499']}>
    <EmployerProgressReviewsTab employerId="7" kind="commercial" learnerId="499" employerName="Employer Jane" onReviewChanged={onChanged} />
  </MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('AppIcon', AppIcon);
  event = { id: 'review-1', eventKey: 'review-1', title: 'Progress review', source: 'progress-review', type: 'review', sequence: 1,
    status: 'awaiting-signature', date: '2026-09-14', targetDate: '2026-09-14', scheduledDate: '2026-09-14', scheduledTime: '09:00',
    durationMinutes: 60, coachName: 'Coach Sam', coachEmail: '', meetingProvider: '', meetingLink: '', notes: '',
    reviewTemplateId: 'template-1', reviewInstanceId: 'instance-1', learnerSigned: true };
  definition = {
    manualOverride: null,
    instance: { id: 'instance-1', reviewTemplateId: 'template-1', learnerId: 55, programmeId: 'programme-1', occurrenceNumber: 1,
      targetDate: '2026-09-14', status: 'awaiting-signature', startedAt: null, completedAt: null },
    template: { id: 'template-1', name: 'Progress review', signatures: { advisor: true, participant: true, employer: true, referrer: false },
      visibleTo: { advisor: true, participant: true, employer: true, referrer: false }, recurrence: { interval: 12, unit: 'weeks' }, notifications: {}, allowEditingPriorDays: 0 },
    sections: [], signatures: { advisor: { required: true, signed: true }, participant: { required: true, signed: true },
      employer: { required: true, signed: false }, referrer: { required: false, signed: false } },
  };
  vi.mocked(fetchEmployerProgressReviews).mockImplementation(async () => structuredClone({ events: [event], definitions: { [event.eventKey]: definition } }));
  vi.mocked(fetchEmployerProgressReview).mockImplementation(async () => structuredClone({ event, definition }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('employer progress reviews', () => {
  it('reads saved APTEM recordings without a Teams refresh action', async () => {
    event = { ...event, reviewSource: 'aptem', eventKey: 'imported-review:901', calendarEventKey: 'cal:901', invited: true };
    vi.mocked(fetchEmployerMeetingArtifacts).mockResolvedValue({ resourceMode: 'stored', artifacts: [],
      storage: { stored: true, syncedAt: '2026-09-14T10:00:00Z' } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'View all reviews (1)' }));
    fireEvent.click(screen.getByRole('button', { name: /View review|Read & sign/ }));
    expect(await screen.findByText(/No saved meeting recording is available/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check Teams' })).not.toBeInTheDocument();
    expect(fetchEmployerMeetingArtifacts).toHaveBeenCalledExactlyOnceWith('7', 'commercial', '499', 'imported-review:901', expect.any(AbortSignal));
  });

  it('shows the saved review status in the current card and past list without offering signatures or booking', async () => {
    event = { ...event, reviewTemplateId: null, reviewInstanceId: null, importedReview: {
      id: '88', aptemReviewId: 'A-88', name: 'Progress review', type: 'Progress Review', reviewerName: 'Coach',
      plannedDate: event.targetDate, plannedTime: null, completedDate: null, status: 'awaiting-signature',
      extractionStatus: 'complete', detailsAvailable: false, sections: [],
    } };
    vi.mocked(fetchEmployerProgressReviews).mockImplementation(async () => ({ events: [event], definitions: {} }));
    vi.mocked(fetchEmployerProgressReview).mockImplementation(async () => ({ event, definition: null }));
    mount();
    const current = within(await screen.findByRole('article', { name: 'Current review' }));
    expect(current.getByText('Awaiting signatures')).toBeVisible();
    expect(current.getByRole('button', { name: 'View review' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View all reviews (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Past (1)' }));
    expect(within(screen.getByRole('region', { name: 'All reviews' })).getByText('Awaiting signatures')).toBeVisible();
    expect(screen.queryByText('Archived review')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Read & sign|Book a time|Reschedule meeting|Record attendance/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View review' }));
    expect(await screen.findByRole('heading', { name: event.title })).toBeVisible();
    expect(saveEmployerReviewAnswers).not.toHaveBeenCalled();
    expect(signReviewAsEmployer).not.toHaveBeenCalled();
    expect(saveMigratedReviewPartyAnswers).not.toHaveBeenCalled();
    expect(signMigratedReviewAsParty).not.toHaveBeenCalled();
  });

  it.each(['native', 'Progress Review', 'Progress Review (+ Skills Radar)'])('joins a scheduled %s from the list and details while keeping form access', async type => {
    const day = '2099-10-26';
    event = { ...event, status: 'scheduled', scheduledDate: day, targetDate: day, date: day,
      meetingLink: 'https://teams.microsoft.com/meet/synthetic', calendarEventKey: 'booked-pr' };
    definition = { ...definition, instance: { ...definition.instance!, status: 'scheduled' } };
    if (type !== 'native') {
      event = { ...event, reviewTemplateId: null, reviewInstanceId: null, importedReview: {
        id: '88', aptemReviewId: 'A-88', name: type, type, reviewerName: 'Coach', plannedDate: day, plannedTime: null,
        completedDate: null, status: 'Not Scheduled', extractionStatus: 'complete', detailsAvailable: false, sections: [],
      } };
      vi.mocked(fetchEmployerProgressReviews).mockImplementation(async () => ({ events: [event], definitions: {} }));
      vi.mocked(fetchEmployerProgressReview).mockImplementation(async () => ({ event, definition: null }));
    }
    mount();
    const join = await screen.findByRole('link', { name: 'Join meeting' });
    expect(join).toHaveAttribute('href', event.meetingLink);
    expect(join).toHaveAttribute('target', '_blank');
    expect(join).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByText('Archived review')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Book a time|Reschedule meeting|Record attendance/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View all reviews (1)' }));
    expect(screen.getByRole('link', { name: 'Join meeting' })).toHaveAttribute('href', event.meetingLink);
    fireEvent.click(screen.getByRole('button', { name: 'View review' }));
    expect(await screen.findByRole('link', { name: 'Join meeting' })).toHaveAttribute('href', event.meetingLink);
    expect(saveEmployerReviewAnswers).not.toHaveBeenCalled();
    expect(signReviewAsEmployer).not.toHaveBeenCalled();
    expect(saveMigratedReviewPartyAnswers).not.toHaveBeenCalled();
  });

  it('offers the meeting recording once the booked meeting has passed, and nothing else from Teams', async () => {
    event = { ...event, invited: true, calendarEventKey: 'cal:1' };
    vi.mocked(fetchEmployerMeetingArtifacts).mockResolvedValue({ artifacts: [
      { id: 'rec-1', artifact_type: 'recording', graph_artifact_id: 'rec-1', end_datetime: '2026-09-14T10:00:00Z' },
    ] });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'View all reviews (1)' }));
    fireEvent.click(screen.getByRole('button', { name: /View review|Read & sign/ }));
    expect(await screen.findByRole('button', { name: /Play/ })).toBeVisible();
    expect(fetchEmployerMeetingArtifacts).toHaveBeenCalledWith('7', 'commercial', '499', 'cal:1', expect.anything());
    expect(screen.getByRole('link', { name: /Download/ })).toHaveAttribute('href',
      '/learner_api/employer-portal/7/learner/commercial/499/progress-reviews/cal%3A1/artifacts/recording/rec-1/content/');
    // The transcript, the attendance tracker and the meeting summary stay staff-side.
    expect(screen.queryByText(/Transcript|Attendance|Meeting summary/)).not.toBeInTheDocument();
  });

  it('does not reach for a recording before the meeting has happened', async () => {
    const day = '2099-10-26';
    event = { ...event, invited: true, status: 'scheduled', scheduledDate: day, targetDate: day, date: day,
      meetingLink: 'https://teams.microsoft.com/meet/synthetic', calendarEventKey: 'cal:1' };
    definition = { ...definition, instance: { ...definition.instance!, status: 'scheduled' } };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'View all reviews (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'View review' }));
    expect(await screen.findByRole('link', { name: 'Join meeting' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Play/ })).not.toBeInTheDocument();
    expect(fetchEmployerMeetingArtifacts).not.toHaveBeenCalled();
  });

  it('keeps View review beside Join meeting on the meeting day', async () => {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    event = { ...event, status: 'scheduled', scheduledDate: day, targetDate: day, date: day,
      meetingLink: 'https://teams.microsoft.com/meet/synthetic' };
    definition = { ...definition, instance: { ...definition.instance!, status: 'scheduled' } };
    mount();
    expect(await screen.findByRole('link', { name: 'Join meeting' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View review' }));
    expect(await screen.findByRole('link', { name: 'Join meeting' })).toBeVisible();
  });

  it.each(['not-scheduled', 'cancelled', 'completed', 'unsafe-link', 'no-link'])('does not offer joining for %s in either view', async scenario => {
    const status = ['unsafe-link', 'no-link'].includes(scenario) ? 'scheduled' : scenario;
    event = { ...event, status, scheduledDate: '2099-10-26', targetDate: '2099-10-26', date: '2099-10-26',
      meetingLink: scenario === 'unsafe-link' ? 'javascript:alert(1)' : scenario === 'no-link' ? '' : 'https://teams.microsoft.com/meet/synthetic' };
    definition = { ...definition, instance: { ...definition.instance!, status },
      signatures: { ...definition.signatures, employer: { required: false, signed: false } } };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'View all reviews (1)' }));
    expect(screen.queryByRole('link', { name: 'Join meeting' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View review' }));
    await screen.findByRole('heading', { name: 'Progress review #1' });
    expect(screen.queryByRole('link', { name: 'Join meeting' })).not.toBeInTheDocument();
  });

  it('saves an Aptem employer answer through the party endpoint and refreshes its version', async () => {
    event = { ...event, migratedForm: true, eventKey: 'imported-review:88', id: 'imported-review:88', status: 'scheduled' };
    definition = { ...definition, migratedForm: true, readOnly: false, answerVersion: 'v1', instance: { ...definition.instance!, status: 'scheduled' },
      sections: [{ id: 'discussion', title: 'Discussion', enabled: true, displayOrder: 0, estimatedMinutes: 0, fields: [
        { id: 'employer', title: 'Employer feedback', fieldType: 'text', required: false, displayOrder: 0, configuration: { respondentRoles: ['employer'] } },
      ] }] };
    vi.mocked(fetchMigratedReviewForParty).mockResolvedValue(definition);
    vi.mocked(saveMigratedReviewPartyAnswers).mockResolvedValue({ ...definition, answerVersion: 'v2' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'View review' }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Employer draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my answers' }));
    await waitFor(() => expect(saveMigratedReviewPartyAnswers).toHaveBeenCalledWith('imported-review:88', { employer: 'Employer draft' }, 'v1'));
    expect(saveEmployerReviewAnswers).not.toHaveBeenCalled();
  });

  it('uses the learner timeline and archive with employer signature status and no learner actions', async () => {
    mount();
    expect(await screen.findByText('Your signature is needed')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Progress review programme timeline' })).toBeVisible();
    expect(screen.queryByText('Open calendar')).not.toBeInTheDocument();
    expect(screen.queryByText('Book a time')).not.toBeInTheDocument();
    expect(screen.queryByText('Record attendance')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View all reviews (1)' }));
    expect(screen.getByRole('region', { name: 'All reviews' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Past (1)' }));
    expect(screen.getByRole('button', { name: 'Read & sign' })).toBeVisible();
  });

  it('signs only the employer role even when the learner has already signed, then updates both list and document counts', async () => {
    vi.mocked(signReviewAsEmployer).mockImplementation(async () => {
      definition.signatures.employer = { required: true, signed: true, signedName: 'Employer Jane' };
      return definition;
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Read & sign' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm employer signature' }));
    await waitFor(() => expect(signReviewAsEmployer).toHaveBeenCalledWith('7', 'commercial', '499', 'instance-1', { name: 'Employer Jane', signature: 'data:image/png;base64,SIG' }));
    expect(await screen.findByText('All signatures saved')).toBeVisible();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Confirm employer signature' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to reviews' }));
    expect(await screen.findByText('Your signature is saved')).toBeVisible();
  });

  it('saves employer questions while keeping coach fields read-only and unfinished forms unsigned', async () => {
    definition.instance!.status = 'in-progress';
    event.status = 'in-progress';
    definition.sections = [{ id: 'discussion', title: 'Discussion', enabled: true, displayOrder: 0, estimatedMinutes: 5, fields: [
      { id: 'employer-comment', title: 'Employer comment', fieldType: 'text_multiline', required: false, displayOrder: 0, configuration: { respondentRoles: ['employer'] } },
      { id: 'coach-comment', title: 'Coach comment', fieldType: 'text_multiline', required: false, displayOrder: 1, configuration: {}, answer: 'Coach notes' },
    ] }];
    vi.mocked(saveEmployerReviewAnswers).mockImplementation(async () => {
      definition.sections[0].fields[0].answer = 'Good progress at work'; return definition;
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'View review' }));
    const [field, coachField] = await screen.findAllByRole('textbox');
    expect(field).toBeEnabled();
    expect(coachField).toBeDisabled();
    expect(coachField).toHaveValue('Coach notes');
    expect(screen.queryByRole('button', { name: 'Confirm employer signature' })).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'Good progress at work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my answers' }));
    await waitFor(() => expect(saveEmployerReviewAnswers).toHaveBeenCalledWith('7', 'commercial', '499', 'instance-1', { 'employer-comment': 'Good progress at work' }));
  });

  it.each(['MCM', 'PR', 'PR_SKILLS_RADAR', 'PSP'] as const)('uses the employer party flow when the migrated %s template requires it', async family => {
    event = { ...event, migratedForm: true, eventKey: 'imported-review:88', id: 'imported-review:88', reviewInstanceId: null, reviewTemplateId: null,
      source: family === 'MCM' ? 'mcr' : 'progress-review', reviewTypeCode: family === 'MCM' ? 'mcm' : 'progress_review',
      title: family === 'PSP' ? 'Personal Support Plan' : family === 'MCM' ? 'Monthly Coaching Meeting' : 'Progress review',
      employerSigned: false, employerSignatureRequired: true };
    definition = { ...definition, migratedForm: true, source: 'aptem', reviewRevision: 2,
      template: { ...definition.template, reviewTypeCode: family === 'PSP' ? 'aptem_psp' : family === 'MCM' ? 'aptem_mcm' : 'aptem_progress_review' } };
    vi.mocked(fetchMigratedReviewForParty).mockResolvedValue(definition);
    vi.mocked(signMigratedReviewAsParty).mockResolvedValue({ signed: true, role: 'employer' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Read & sign' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm employer signature' }));
    await waitFor(() => expect(signMigratedReviewAsParty).toHaveBeenCalledWith('imported-review:88', 'data:image/png;base64,SIG', { reviewRevision: 2 }));
    expect(signReviewAsEmployer).not.toHaveBeenCalled();
  });

  it('does not offer the learner signature when the review needs no employer signature', async () => {
    definition.signatures.employer = { required: false, signed: false };
    definition.signatures.participant = { required: true, signed: false };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'View review' }));
    expect(await screen.findByRole('region', { name: 'Review signatures' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirm employer signature' })).not.toBeInTheDocument();
    expect(signReviewAsEmployer).not.toHaveBeenCalled();
  });

  it('allows retry when review loading fails', async () => {
    vi.mocked(fetchEmployerProgressReviews).mockRejectedValueOnce(new Error('Review service unavailable'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Review service unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Read & sign' })).toBeVisible();
  });
});

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
  async function openImportedRecordingReview(overrides: Partial<LearnerCalendarEvent> = {}) {
    event = { ...event, reviewSource: 'aptem', eventKey: 'imported-review:archive', id: 'imported-review:archive',
      calendarEventKey: 'learner-book:verified-legacy', invited: false, migratedForm: true,
      scheduledDate: '2020-01-01', ...overrides };
    definition = { ...definition, migratedForm: true, readOnly: true,
      instance: { ...definition.instance!, status: event.status },
      signatures: { ...definition.signatures, employer: { required: true, signed: true } } };
    vi.mocked(fetchMigratedReviewForParty).mockResolvedValue(definition);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'View all reviews (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'View review' }));
    await screen.findByRole('heading', { name: 'Progress review #1' });
  }

  it.each([
    { status: 'completed', invited: false, scheduledDate: '2020-01-01' },
    { status: 'awaiting-signature', invited: false, scheduledDate: '2020-01-01' },
    { status: 'completed', invited: true, scheduledDate: null },
    { status: 'completed', invited: true, scheduledDate: '2099-10-26' },
  ])('keeps linked APTEM archive access independent of current invitation/date: %j', async overrides => {
    vi.mocked(fetchEmployerMeetingArtifacts).mockResolvedValue({ resourceMode: 'stored', artifacts: [
      { id: 'saved-video', graph_artifact_id: 'saved-video', artifact_type: 'recording', content_available: true },
    ] });
    await openImportedRecordingReview(overrides);
    expect(await screen.findByText('Meeting Recording')).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    expect(document.querySelector('video')).toHaveAttribute('src',
      '/learner_api/employer-portal/7/learner/commercial/499/progress-reviews/imported-review%3Aarchive/artifacts/recording/saved-video/content/?preview=1');
    expect(fetchEmployerMeetingArtifacts).toHaveBeenCalledExactlyOnceWith('7', 'commercial', '499', 'imported-review:archive', expect.any(AbortSignal));
    expect(screen.queryByRole('button', { name: 'Check Teams' })).not.toBeInTheDocument();
    expect(saveMigratedReviewPartyAnswers).not.toHaveBeenCalled();
    expect(signMigratedReviewAsParty).not.toHaveBeenCalled();
  });

  it('shows linked APTEM recording metadata as unavailable when there is no saved archive', async () => {
    vi.mocked(fetchEmployerMeetingArtifacts).mockResolvedValue({ resourceMode: 'stored', artifacts: [
      { id: 'metadata-only', graph_artifact_id: 'metadata-only', artifact_type: 'recording', content_available: false },
    ] });
    await openImportedRecordingReview({ status: 'completed' });
    expect(await screen.findByText('A saved copy of this recording is not available yet.')).toBeVisible();
    expect(screen.getByText('Meeting Recording')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(document.querySelector('video')).not.toBeInTheDocument();
  });

  it('keeps the linked APTEM recording section visible when the saved collection is empty', async () => {
    vi.mocked(fetchEmployerMeetingArtifacts).mockResolvedValue({ resourceMode: 'stored', artifacts: [] });
    await openImportedRecordingReview({ status: 'completed' });
    expect(await screen.findByText(/No saved meeting recording is available/)).toBeVisible();
    expect(screen.getByText('Meeting Recording')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
  });

  it.each(['Recording access denied.', 'This review has no meeting of its own.', 'Stored resources could not be loaded.'])(
    'shows a linked APTEM resource error without hiding the signed form: %s', async message => {
      vi.mocked(fetchEmployerMeetingArtifacts).mockRejectedValue(new Error(message));
      await openImportedRecordingReview({ status: 'completed' });
      expect(await screen.findByText(message)).toBeVisible();
      expect(screen.getByText('Meeting Recording')).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Progress review #1' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
      expect(document.querySelector('video')).not.toBeInTheDocument();
    });

  it('does not request APTEM recordings without a linked calendar even if an invitation flag remains', async () => {
    await openImportedRecordingReview({ status: 'completed', calendarEventKey: null, invited: true });
    expect(fetchEmployerMeetingArtifacts).not.toHaveBeenCalled();
    expect(screen.queryByText('Meeting Recording')).not.toBeInTheDocument();
  });

  it('shows the linked recording section while its stored resource request is pending', async () => {
    let finish!: (value: Awaited<ReturnType<typeof fetchEmployerMeetingArtifacts>>) => void;
    vi.mocked(fetchEmployerMeetingArtifacts).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await openImportedRecordingReview({ status: 'completed' });
    expect(screen.getByText('Meeting Recording')).toBeVisible();
    expect(screen.queryByText(/No saved meeting recording is available/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    finish({ resourceMode: 'stored', artifacts: [] });
    expect(await screen.findByText(/No saved meeting recording is available/)).toBeVisible();
  });

  it('keeps source-completed APTEM history and its recording readable without a migrated form', async () => {
    event = { ...event, reviewSource: 'aptem', id: 'imported-review:historical', eventKey: 'imported-review:historical',
      calendarEventKey: 'calendar:historical', invited: false, scheduledDate: null, status: 'completed',
      sourceStatus: 'completed', migratedForm: false, reviewInstanceId: null, reviewTemplateId: null,
      importedReview: { id: '901', aptemReviewId: 'historical', name: 'Progress review', type: 'Progress Review',
        reviewerName: 'Historical Coach', plannedDate: '2020-01-01', plannedTime: null, completedDate: '2020-01-01',
        status: 'completed', extractionStatus: 'complete', detailsAvailable: true, sections: [] } };
    vi.mocked(fetchEmployerProgressReviews).mockResolvedValue({ events: [event], definitions: {} });
    vi.mocked(fetchEmployerProgressReview).mockResolvedValue({ event, definition: null });
    vi.mocked(fetchEmployerMeetingArtifacts).mockResolvedValue({ resourceMode: 'stored', artifacts: [
      { id: 'historical-video', graph_artifact_id: 'historical-video', artifact_type: 'recording', content_available: true },
    ] });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'View all reviews (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'View review' }));
    expect(await screen.findByRole('button', { name: 'Play' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Progress review' })).toBeVisible();
    expect(fetchEmployerMeetingArtifacts).toHaveBeenCalledExactlyOnceWith('7', 'commercial', '499', 'imported-review:historical', expect.any(AbortSignal));
    expect(fetchMigratedReviewForParty).not.toHaveBeenCalled();
  });

  it('defaults to the earliest pending APTEM review and keeps manual selection separate', async () => {
    const dates = ['2026-10-26', '2027-03-30', '2027-06-29', '2027-09-29'];
    const events = dates.map((date, index): LearnerCalendarEvent => ({
      ...event, id: `aptem:${index + 1}`, eventKey: `aptem:${index + 1}`, title: `Progress Review ${index + 1}`, sequence: index + 1,
      reviewTemplateId: null, reviewInstanceId: null, reviewSource: 'aptem', migratedForm: false,
      status: index === 0 ? 'completed' : 'not-scheduled', effectiveLmsStatus: index === 0 ? 'completed' : 'not-scheduled',
      sourceStatus: index === 0 ? 'completed' : 'not-scheduled', scheduledDate: null, scheduledTime: null, targetDate: date, date,
      importedReview: { id: String(index + 1), aptemReviewId: `A-${index + 1}`, name: `Progress Review ${index + 1}`, type: 'Progress Review',
        reviewerName: 'Synthetic Coach', plannedDate: date, plannedTime: null, completedDate: index === 0 ? date : null,
        status: index === 0 ? 'completed' : 'not-scheduled', extractionStatus: 'complete', detailsAvailable: false, sections: [] },
    }));
    vi.mocked(fetchEmployerProgressReviews).mockResolvedValue({ events: [events[3], events[0], events[2], events[1]], definitions: {} });
    mount();
    const card = within(await screen.findByRole('article', { name: 'Current review' }));
    expect(await card.findByRole('heading', { name: 'Progress Review 2' })).toBeVisible();
    expect(card.getByText('Your next review')).toBeVisible();
    const timeline = within(screen.getByRole('region', { name: 'Progress review programme timeline' }));
    expect(timeline.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      'Progress Review 1, 26 Oct 2026, Attended', 'Progress Review 2, 30 Mar 2027, Planned',
      'Progress Review 3, 29 Jun 2027, Planned', 'Progress Review 4, 29 Sept 2027, Planned',
    ]);
    fireEvent.click(timeline.getByRole('button', { name: /Progress Review 4,/ }));
    const selected = within(screen.getByRole('article', { name: 'Selected review' }));
    expect(selected.getByRole('heading', { name: 'Progress Review 4' })).toBeVisible();
    expect(selected.queryByText(/Your next (step|review)/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View all reviews (4)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to current review' }));
    expect(within(screen.getByRole('article', { name: 'Current review' })).getByRole('heading', { name: 'Progress Review 2' })).toBeVisible();
    expect(fetchEmployerProgressReview).not.toHaveBeenCalled();
    expect(saveEmployerReviewAnswers).not.toHaveBeenCalled();
    expect(signReviewAsEmployer).not.toHaveBeenCalled();
  });

  it('labels stored unfinished APTEM ownership as responsible Coach', async () => {
    event = { ...event, reviewSource: 'aptem', coachName: 'New responsible Coach' };
    mount();
    const card = within(await screen.findByRole('article', { name: 'Current review' }));
    expect(card.getByText('Responsible Coach')).toBeVisible();
    expect(card.getByText('New responsible Coach')).toBeVisible();
  });

  it('keeps completed APTEM reviewer identity in the historical list', async () => {
    event = { ...event, reviewSource: 'aptem', status: 'completed', coachName: 'Historical Coach' };
    definition = { ...definition, instance: { ...definition.instance!, status: 'completed' } };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'View all reviews (1)' }));
    expect(await screen.findByText('Historical Coach')).toBeVisible();
    expect(screen.getByText('Historical Reviewer / Coach:')).toBeVisible();
    expect(screen.queryByText('New responsible Coach')).not.toBeInTheDocument();
  });

  it('plays the retained archive when an authorized transferred party form loads', async () => {
    event = { ...event, reviewSource: 'aptem', eventKey: 'imported-review:handover', migratedForm: true,
      coachName: 'New responsible Coach', invited: true, calendarEventKey: 'calendar:original', scheduledDate: '2020-01-01' };
    vi.mocked(fetchMigratedReviewForParty).mockResolvedValue(definition);
    vi.mocked(fetchEmployerMeetingArtifacts).mockResolvedValue({ artifacts: [{ id: 'saved-video', graph_artifact_id: 'saved-video',
      artifact_type: 'recording', content_available: true, created_datetime: '', end_datetime: '' }], meetingSummary: null, errors: [], partial: false });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Read & sign' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    const video = document.querySelector('video');
    expect(video?.getAttribute('src')).toContain('imported-review%3Ahandover/artifacts/recording/saved-video/content/');
    expect(fetchMigratedReviewForParty).toHaveBeenCalledWith('imported-review:handover', expect.any(AbortSignal));
  });

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

  it('shows the saved review status in a selected card and past list without inventing an employer action', async () => {
    event = { ...event, reviewTemplateId: null, reviewInstanceId: null, importedReview: {
      id: '88', aptemReviewId: 'A-88', name: 'Progress review', type: 'Progress Review', reviewerName: 'Coach',
      plannedDate: event.targetDate, plannedTime: null, completedDate: null, status: 'awaiting-signature',
      extractionStatus: 'complete', detailsAvailable: false, sections: [],
    } };
    vi.mocked(fetchEmployerProgressReviews).mockImplementation(async () => ({ events: [event], definitions: {} }));
    vi.mocked(fetchEmployerProgressReview).mockImplementation(async () => ({ event, definition: null }));
    mount();
    // No employer signature is required: history remains readable by selection,
    // but must not become "Your next step" through the former last-row fallback.
    const marker = await screen.findByRole('button', { name: /Progress review,.*Awaiting signatures/ });
    expect(screen.getByRole('heading', { name: 'No current review' })).toBeVisible();
    fireEvent.click(marker);
    const current = within(screen.getByRole('article', { name: 'Selected review' }));
    expect(current.queryByText('Your next step')).not.toBeInTheDocument();
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

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewInstanceModal } from './ReviewInstanceModal';
import { MigratedMeetingIntelligence } from './MigratedMeetingIntelligence';
import * as api from '@/api/reviewInstances';
import type { CoachMeetingArtifactsResponse, MigratedSummaryBinding } from './calendarEvents';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { user: { fullName: 'Synthetic coach' } } }) }));
const identity = vi.hoisted(() => ({ viewAs: false }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: 'coach@example.invalid', isInitialized: true, isViewingAsCoach: identity.viewAs }) }));
vi.mock('@/api/reviewInstances', async original => ({
  ...await original<typeof import('@/api/reviewInstances')>(),
  fetchReviewInstanceForm: vi.fn(), fetchMigratedReviewIntelligence: vi.fn(), saveReviewInstanceAnswers: vi.fn(),
  generateReviewMeetingSummary: vi.fn(), submitMigratedReview: vi.fn(),
  uploadMigratedSummaryTranscript: vi.fn(),
}));
afterEach(cleanup);
const id = 'imported-review:binding-ui';
function definition(status = 'in-progress'): api.ReviewInstanceFormDefinition {
  return {
    instance: { id, reviewTemplateId: '', learnerId: 42, programmeId: 'P1', occurrenceNumber: null,
      targetDate: '2026-10-01', status, startedAt: null, completedAt: null },
    source: 'aptem', migratedForm: true, formAvailable: true, readOnly: status !== 'in-progress', localStatus: status,
    answerVersion: 'v1', summaryBinding: { fieldKey: 'recap', state: 'NEVER_POPULATED' },
    template: { id: '', name: 'Migrated Review', reviewTypeCode: 'aptem_mcm',
      signatures: { advisor: false, participant: false, employer: false, referrer: false },
      visibleTo: { advisor: true, participant: true, employer: true, referrer: false },
      recurrence: { interval: 0, unit: 'none' }, notifications: {}, allowEditingPriorDays: 0 },
    sections: [{ id: 'discussion', title: 'Discussion', enabled: true, displayOrder: 0, estimatedMinutes: 0, fields: [
      { id: 'recap', title: 'Discussion record', fieldType: 'text_multiline', required: false, displayOrder: 0, configuration: { migrated: true, semanticKey: 'meeting_summary' } },
      { id: 'other', title: 'Other answer', fieldType: 'text', required: false, displayOrder: 1, configuration: {}, answer: 'Existing other answer' },
    ] }], signatures: { advisor: { required: false, signed: false }, participant: { required: false, signed: false }, employer: { required: false, signed: false }, referrer: { required: false, signed: false } },
    manualOverride: null,
    booking: { booked: true, canBook: false, canAttach: false, conflict: false, eventKey: id, scheduledDate: '2026-10-01', scheduledTime: '10:00', durationMinutes: 30, meetingLink: 'https://example.invalid/meeting', syncState: 'synced' },
  };
}
function result(binding: MigratedSummaryBinding = { fieldKey: 'recap', state: 'NEVER_POPULATED' }): CoachMeetingArtifactsResponse {
  return { artifacts: [], summaryBinding: binding, intelligence: { attendanceStatus: 'available', recordingStatus: 'unknown', transcriptStatus: 'available', summaryStatus: 'ready', errorCodes: [] },
    meetingSummary: { status: 'ready', summary: { title: 'AI recap', overview: 'Original provenance', keyPoints: [], actions: [], nextSteps: [], support: [] } } };
}
function mount() { return render(<ReviewInstanceModal instanceId={id} onClose={vi.fn()} />); }
beforeEach(() => {
  vi.clearAllMocks();
  identity.viewAs = false;
  vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(definition());
  vi.mocked(api.fetchMigratedReviewIntelligence).mockResolvedValue(result());
  vi.mocked(api.saveReviewInstanceAnswers).mockResolvedValue({ ...definition(), answerVersion: 'v3' });
});

describe('bound migrated review answers', () => {
  it('keeps the explicitly bound field visible alongside a Learning Progress snapshot', async () => {
    const saved = definition();
    saved.sections[0].title = 'Learning Progress';
    saved.template.reviewTypeCode = 'aptem_progress_review';
    const metric = { actual: null, expected: null, planned: null, actualPercent: null, expectedPercent: null, variancePercent: null, varianceDirection: '' as const };
    saved.progressSnapshot = { calculationMethod: 'historical', calculatedFrom: '2026-01-01', calculatedAt: '2026-10-01', calculatedBy: 'Synthetic', weeksElapsed: null, programmeProgress: metric, offTheJobHours: metric };
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    mount();
    expect(await screen.findByRole('textbox', { name: 'Discussion record' })).toBeEnabled();
  });

  it('loads a normal editable field, then shows the single saved AI answer after Check Session', async () => {
    vi.mocked(api.fetchMigratedReviewIntelligence).mockImplementation(async (_id, _signal, options) => options?.refresh
      ? { ...result({ fieldKey: 'recap', state: 'AI_POPULATED_UNEDITED', status: 'populated' }), answerVersion: 'v2', reviewAnswers: { recap: 'AI form answer', other: 'Existing other answer' } }
      : result());
    mount();
    const field = await screen.findByRole('textbox', { name: 'Discussion record' });
    expect(field).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Generate from Teams' })).toBeEnabled();
    fireEvent.click(await screen.findByRole('button', { name: 'Check Session' }));
    await waitFor(() => expect(field).toHaveValue('AI form answer'));
    expect(screen.getAllByDisplayValue('AI form answer')).toHaveLength(1);
    expect(screen.queryByText('Original provenance')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(api.submitMigratedReview).not.toHaveBeenCalled();
    expect(api.generateReviewMeetingSummary).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '' } });
    expect(screen.queryByRole('button', { name: 'Check Session' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate from Teams' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Upload Transcript' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.saveReviewInstanceAnswers).toHaveBeenCalledWith(id,
      { recap: '', other: 'Existing other answer' }, { answerVersion: 'v2', editedFields: ['recap'] }));
  });

  it('keeps unsaved text on a conflict and requires saving before Check Session', async () => {
    vi.mocked(api.saveReviewInstanceAnswers).mockRejectedValue(new Error('This review changed. Reopen it before saving.'));
    mount();
    const field = await screen.findByRole('textbox', { name: 'Discussion record' });
    fireEvent.change(field, { target: { value: 'Unsaved coach text' } });
    expect(screen.queryByRole('button', { name: 'Check Session' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/This review changed/)).toBeVisible();
    expect(field).toHaveValue('Unsaved coach text');
    expect(api.fetchMigratedReviewIntelligence).toHaveBeenCalledTimes(1);
  });

  it('freezes editing while checking and preserves server answers for unrelated fields', async () => {
    let release!: (value: CoachMeetingArtifactsResponse) => void;
    vi.mocked(api.fetchMigratedReviewIntelligence).mockImplementation(async (_id, _signal, options) => options?.refresh
      ? new Promise(resolve => { release = resolve; }) : result());
    mount();
    const field = await screen.findByRole('textbox', { name: 'Discussion record' });
    fireEvent.click(await screen.findByRole('button', { name: 'Check Session' }));
    expect(field).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    await act(async () => release({ ...result(), answerVersion: 'v2', reviewAnswers: { recap: 'Generated', other: 'Newer saved elsewhere' } }));
    expect(field).toHaveValue('Generated');
    expect(screen.getByDisplayValue('Newer saved elsewhere')).toBeEnabled();
  });

  it.each(['awaiting-signature', 'completed'])('shows the authoritative answer read-only at %s', async status => {
    const saved = definition(status);
    saved.sections[0].fields[0].answer = 'Final coach wording';
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    mount();
    expect(await screen.findByDisplayValue('Final coach wording')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Check Session' })).not.toBeInTheDocument();
    expect(screen.queryByText('Original provenance')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate from Teams' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload Transcript' })).not.toBeInTheDocument();
  });

  it.each([
    ['COACH_EDITED', 'Your Meeting Summary answer has been kept.'],
    ['COACH_CLEARED', 'Your cleared Meeting Summary answer has been kept.'],
  ] as const)('explains preserved %s state', async (state, text) => {
    vi.mocked(api.fetchMigratedReviewIntelligence).mockResolvedValue(result({ fieldKey: 'recap', state, status: 'answer-preserved' }));
    render(<MigratedMeetingIntelligence instanceId={id} family="aptem_mcm" status="in-progress" viewAs={false} />);
    expect(await screen.findByText(text)).toBeVisible();
  });

  it('keeps the complete oversized suggestion available for manual shortening', async () => {
    const fullText = 'X'.repeat(4001);
    const saved = definition();
    saved.summaryBinding = { fieldKey: 'recap', state: 'NEVER_POPULATED', status: 'summary-too-long', suggestionText: fullText };
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    vi.mocked(api.fetchMigratedReviewIntelligence).mockResolvedValue(result(saved.summaryBinding));
    mount();
    expect((await screen.findAllByText(/AI summary is longer than this field allows/))[0]).toBeVisible();
    fireEvent.click(screen.getByText('View latest AI suggestion'));
    expect(screen.getByRole('textbox', { name: 'Latest AI suggestion' })).toHaveValue(fullText);
    expect(screen.getAllByDisplayValue(fullText)).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Discussion record' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Discussion record' })).toBeEnabled();
  });

  it('keeps manual entry available after AI failure', async () => {
    const failed = result();
    failed.intelligence!.summaryStatus = 'failed';
    failed.intelligence!.errorCodes = ['AI_SUMMARY_FAILED'];
    vi.mocked(api.fetchMigratedReviewIntelligence).mockResolvedValue(failed);
    mount();
    expect(await screen.findByText('Generation failed')).toBeVisible();
    const field = screen.getByRole('textbox', { name: 'Discussion record' });
    fireEvent.change(field, { target: { value: 'Manual answer' } });
    expect(field).toHaveValue('Manual answer');
  });

  it('generates beside the field through the migrated Check Session path and stays editable', async () => {
    let release!: (value: CoachMeetingArtifactsResponse) => void;
    vi.mocked(api.fetchMigratedReviewIntelligence).mockImplementation(async (_id, _signal, options) => options?.refresh
      ? new Promise(resolve => { release = resolve; }) : result());
    mount();
    const field = await screen.findByRole('textbox', { name: 'Discussion record' });
    fireEvent.click(screen.getByRole('button', { name: 'Generate from Teams' }));
    expect(screen.getByRole('button', { name: 'Generating summary...' })).toBeDisabled();
    expect(field).toBeDisabled();
    expect(api.fetchMigratedReviewIntelligence).toHaveBeenLastCalledWith(id, undefined, { refresh: true });
    await act(async () => release({ ...result({ fieldKey: 'recap', state: 'AI_POPULATED_UNEDITED', status: 'populated', suggestionSource: 'teams' }),
      answerVersion: 'v2', reviewAnswers: { recap: 'Teams summary', other: 'Existing other answer' } }));
    expect(field).toHaveValue('Teams summary');
    expect(field).toBeEnabled();
    expect(screen.getByText('Latest AI summary generated from Teams transcript.')).toBeVisible();
    await waitFor(() => expect(api.fetchMigratedReviewIntelligence).toHaveBeenCalledTimes(3));
    expect(api.fetchMigratedReviewIntelligence).toHaveBeenLastCalledWith(id, expect.any(AbortSignal), { refresh: false });
    expect(api.generateReviewMeetingSummary).not.toHaveBeenCalled();
    expect(api.submitMigratedReview).not.toHaveBeenCalled();
  });

  it('uploads without a Teams booking, shows loading and uses the returned answer version', async () => {
    const saved = definition();
    delete saved.booking;
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    let release!: (value: CoachMeetingArtifactsResponse) => void;
    vi.mocked(api.uploadMigratedSummaryTranscript).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    mount();
    const field = await screen.findByRole('textbox', { name: 'Discussion record' });
    expect(screen.getByRole('button', { name: 'Generate from Teams' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Upload Transcript' })).toBeEnabled();
    const file = new File(['Coach: Synthetic transcript'], 'meeting.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Select migrated review transcript'), { target: { files: [file] } });
    expect(screen.getByRole('button', { name: 'Uploading transcript and generating summary...' })).toBeDisabled();
    expect(field).toBeDisabled();
    expect(api.uploadMigratedSummaryTranscript).toHaveBeenCalledWith(id, file);
    await act(async () => release({ artifacts: [], summaryBinding: { fieldKey: 'recap', state: 'AI_POPULATED_UNEDITED', status: 'populated', suggestionSource: 'uploaded_transcript' },
      answerVersion: 'upload-version', reviewAnswers: { recap: 'Uploaded summary', other: 'Existing other answer' } }));
    expect(field).toHaveValue('Uploaded summary');
    expect(field).toBeEnabled();
    expect(screen.getByText('Latest AI summary generated from uploaded transcript.')).toBeVisible();
    expect(api.fetchMigratedReviewIntelligence).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'Coach final wording' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.saveReviewInstanceAnswers).toHaveBeenCalledWith(id, { recap: 'Coach final wording', other: 'Existing other answer' },
      { answerVersion: 'upload-version', editedFields: ['recap'] }));
  });

  it('shows neither field action for an ordinary unbound question', async () => {
    const saved = definition();
    saved.sections[0].fields[0].configuration = { migrated: true };
    saved.summaryBinding = { status: 'no-binding' };
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    mount();
    await screen.findByText('Discussion record');
    expect(screen.queryByRole('button', { name: 'Upload Transcript' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate from Teams' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Check Session' })).toBeEnabled();
  });

  it.each(['Final coach answer', ''])('preserves saved coach content %j while showing a new upload suggestion', async answer => {
    const saved = definition();
    saved.sections[0].fields[0].answer = answer;
    const binding: MigratedSummaryBinding = { fieldKey: 'recap', state: answer ? 'COACH_EDITED' : 'COACH_CLEARED', status: 'answer-preserved',
      generationStatus: 'ready', replacementAvailable: true, suggestionSource: 'uploaded_transcript', suggestionText: 'New suggestion' };
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    vi.mocked(api.uploadMigratedSummaryTranscript).mockResolvedValue({ artifacts: [], summaryBinding: binding, answerVersion: 'v2', reviewAnswers: { recap: answer, other: 'Existing other answer' } });
    mount();
    const field = await screen.findByRole('textbox', { name: 'Discussion record' });
    fireEvent.change(screen.getByLabelText('Select migrated review transcript'), { target: { files: [new File(['Transcript'], 'meeting.txt')] } });
    expect(await screen.findByText('AI summary generated. Your existing answer was preserved.')).toBeVisible();
    expect(field).toHaveValue(answer);
    fireEvent.click(screen.getByText('View latest AI suggestion'));
    expect(screen.getByRole('textbox', { name: 'Latest AI suggestion' })).toHaveValue('New suggestion');
    expect(api.saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

  it('reports upload validation and AI failures while leaving manual entry available', async () => {
    vi.mocked(api.uploadMigratedSummaryTranscript).mockRejectedValueOnce(new Error('The uploaded file is not a valid WebVTT transcript.'))
      .mockResolvedValueOnce({ artifacts: [], summaryBinding: { fieldKey: 'recap', state: 'NEVER_POPULATED', generationStatus: 'failed' },
        answerVersion: 'v2', reviewAnswers: { other: 'Existing other answer' }, partial: true });
    mount();
    const field = await screen.findByRole('textbox', { name: 'Discussion record' });
    const file = new File(['malformed'], 'meeting.vtt', { type: 'text/vtt' });
    const upload = screen.getByLabelText('Select migrated review transcript');
    fireEvent.change(upload, { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('not a valid WebVTT');
    expect(field).toBeEnabled();
    fireEvent.change(upload, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The transcript was processed, but the AI summary could not be generated.'));
    expect(field).toBeEnabled();
    fireEvent.change(field, { target: { value: 'Manual fallback' } });
    expect(field).toHaveValue('Manual fallback');
  });

  it('warns about a long suggestion even when a protected answer takes precedence', async () => {
    const saved = definition();
    saved.sections[0].fields[0].answer = 'Coach final wording';
    saved.summaryBinding = { fieldKey: 'recap', state: 'COACH_EDITED', status: 'answer-preserved',
      replacementAvailable: true, summaryTooLong: true, suggestionText: 'X'.repeat(4001) };
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    mount();
    expect(await screen.findByText('AI summary is longer than this field allows. Review and shorten it before saving.')).toBeVisible();
    expect(screen.getByText('AI summary generated. Your existing answer was preserved.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Discussion record' })).toHaveValue('Coach final wording');
  });

  it('explains a missing Teams transcript without blocking manual entry', async () => {
    vi.mocked(api.fetchMigratedReviewIntelligence).mockImplementation(async (_id, _signal, options) => options?.refresh
      ? { ...result({ fieldKey: 'recap', state: 'NEVER_POPULATED', status: 'summary-unavailable', generationStatus: 'unavailable' }),
        answerVersion: 'v2', reviewAnswers: { other: 'Existing other answer' } } : result());
    mount();
    const field = await screen.findByRole('textbox', { name: 'Discussion record' });
    fireEvent.click(screen.getByRole('button', { name: 'Generate from Teams' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No transcript was found for this meeting.');
    expect(field).toBeEnabled();
  });

  it('keeps admin view-as read-only without generation or upload actions', async () => {
    identity.viewAs = true;
    mount();
    expect(await screen.findByRole('textbox', { name: 'Discussion record' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Upload Transcript' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate from Teams' })).not.toBeInTheDocument();
    expect(api.uploadMigratedSummaryTranscript).not.toHaveBeenCalled();
  });
});

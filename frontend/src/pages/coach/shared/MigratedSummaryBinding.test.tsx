import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ReviewInstanceModal } from './ReviewInstanceModal';
import { MigratedMeetingIntelligence } from './MigratedMeetingIntelligence';
import * as api from '@/api/reviewInstances';
import type { CoachMeetingArtifactsResponse, MigratedSummaryBinding } from './calendarEvents';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { user: { fullName: 'Synthetic coach' } } }) }));
const identity = vi.hoisted(() => ({ viewAs: false, email: 'coach@example.invalid' }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: identity.email, isInitialized: true, isViewingAsCoach: identity.viewAs }) }));
vi.mock('@/api/reviewInstances', async original => ({
  ...await original<typeof import('@/api/reviewInstances')>(),
  fetchReviewInstanceForm: vi.fn(), fetchMigratedReviewIntelligence: vi.fn(), saveReviewInstanceAnswers: vi.fn(),
  generateReviewMeetingSummary: vi.fn(), submitMigratedReview: vi.fn(),
  uploadMigratedSummaryTranscript: vi.fn(), initializeMigratedReview: vi.fn(),
  startMigratedReview: vi.fn(),
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
  identity.email = 'coach@example.invalid';
  vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(definition());
  vi.mocked(api.fetchMigratedReviewIntelligence).mockResolvedValue(result());
  vi.mocked(api.saveReviewInstanceAnswers).mockResolvedValue({ ...definition(), answerVersion: 'v3' });
});

describe('bound migrated review answers', () => {
  it('starts from the form Join Teams link and preserves typed answers and their save version', async () => {
    const saved = { ...definition('scheduled'), readOnly: false, bookingAdoptionVersion: 'same-saved-work' };
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    vi.mocked(api.startMigratedReview).mockResolvedValue({ ...saved, localStatus: 'in-progress', answerVersion: 'v2' });
    mount();
    const input = await screen.findByRole('textbox', { name: 'Discussion record' });
    fireEvent.change(input, { target: { value: 'Keep my unsaved text' } });
    const link = screen.getByRole('link', { name: 'Join Teams' });
    expect(api.startMigratedReview).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(link).toHaveAttribute('href', 'https://example.invalid/meeting');
    await waitFor(() => expect(api.startMigratedReview).toHaveBeenCalledWith(id, expect.objectContaining({ calendarEventKey: id })));
    expect(input).toHaveValue('Keep my unsaved text');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.saveReviewInstanceAnswers).toHaveBeenCalledWith(id,
      expect.objectContaining({ recap: 'Keep my unsaved text' }), expect.objectContaining({ answerVersion: 'v2' })));
  });
  it.each(['aptem_mcm', 'aptem_progress_review'])('expands %s summary editing and saves the same answer explicitly', async reviewTypeCode => {
    const saved = definition();
    saved.template.reviewTypeCode = reviewTypeCode;
    saved.sections[0].fields[0].answer = 'Existing summary\nKeep this line';
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    mount();
    const inline = await screen.findByRole('textbox', { name: 'Discussion record' });
    expect(inline).toHaveAttribute('maxlength', '4000');
    fireEvent.change(inline, { target: { value: 'Existing summary\nCoach addition' } });
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
    const expanded = screen.getByRole('textbox', { name: 'Expanded Meeting Summary' });
    expect(expanded).toHaveFocus();
    expect(expanded).toHaveAttribute('maxlength', '4000');
    expect(expanded).toHaveValue('Existing summary\nCoach addition');
    fireEvent.change(expanded, { target: { value: 'Existing summary\nCoach addition\nFinal action' } });
    fireEvent.keyDown(expanded, { key: 'Escape' });
    expect(screen.getByRole('textbox', { name: 'Discussion record' })).toHaveValue('Existing summary\nCoach addition\nFinal action');
    expect(screen.getByRole('button', { name: 'Expand editor' })).toHaveFocus();
    expect(api.saveReviewInstanceAnswers).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.saveReviewInstanceAnswers).toHaveBeenCalledWith(id,
      { recap: 'Existing summary\nCoach addition\nFinal action', other: 'Existing other answer' },
      { answerVersion: 'v1', editedFields: ['recap'] }));
    expect(await screen.findByText('Draft saved.')).toBeVisible();
  });

  it.each(['awaiting-signature', 'completed'])('keeps expanded Aptem summaries read-only in %s', async status => {
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(definition(status));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Expand editor' }));
    expect(screen.getByRole('textbox', { name: 'Expanded Meeting Summary' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
    expect(api.saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

  it.each([
    ['GLOBAL', false, true], ['GLOBAL', true, true],
    ['PROGRAMME', false, true], ['PROGRAMME', true, true],
    ['PROGRAMME', false, false], ['PROGRAMME', true, false],
  ] as const)('renders initialized %s summary actions with admin=%s and binding=%s', async (scope, viewAs, bound) => {
    identity.viewAs = viewAs;
    const saved = { ...definition(), migratedTemplateResolution: {
      resolved_template_id: 20, resolved_scope: scope, review_family: 'MCM', uses_snapshot: true,
    } };
    saved.template.name = `${scope} MCM`;
    saved.readOnly = viewAs;
    if (!bound) {
      saved.sections[0].fields[0].configuration = { migrated: true };
      saved.summaryBinding = { status: 'no-binding' };
    }
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    mount();
    await screen.findByText('Discussion record');
    for (const name of ['Generate from Teams', 'Upload Transcript']) {
      const button = screen.queryByRole('button', { name });
      if (!bound) expect(button).not.toBeInTheDocument();
      else if (viewAs) expect(button).toBeDisabled();
      else expect(button).toBeEnabled();
    }
    expect(api.initializeMigratedReview).not.toHaveBeenCalled();
    expect(api.uploadMigratedSummaryTranscript).not.toHaveBeenCalled();
  });

  it.each(['missing', 'duplicate', 'wrong-type', 'conditional'] as const)('hides preview actions for a %s binding', async kind => {
    identity.viewAs = true;
    const preview = definition('scheduled');
    preview.migratedForm = false;
    preview.previewOnly = true;
    delete preview.summaryBinding;
    delete preview.booking;
    const field = preview.sections[0].fields[0];
    if (kind === 'missing') field.configuration = { migrated: true };
    if (kind === 'duplicate') preview.sections[0].fields.push({ ...field, id: 'second-summary', title: 'Another summary' });
    if (kind === 'wrong-type') field.fieldType = 'boolean';
    if (kind === 'conditional') preview.sections[0].fields[0] = {
      ...field, id: 'condition', title: 'Conditional summary', fieldType: 'boolean_case_block',
      configuration: { migrated: true }, yesFields: [{ ...field, parentFieldId: 'condition' }], answer: true,
    };
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(preview);
    mount();
    await screen.findByText('Other answer');
    expect(screen.queryByRole('button', { name: 'Generate from Teams' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload Transcript' })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(api.initializeMigratedReview).not.toHaveBeenCalled();
  });

  it.each(['GLOBAL', 'PROGRAMME'] as const)('shows inert summary actions in an uninitialized %s admin preview', async scope => {
    const user = userEvent.setup();
    identity.viewAs = true;
    const preview = { ...definition('scheduled'), migratedTemplateResolution: {
      resolved_template_id: 20, resolved_scope: scope, review_family: 'MCM',
    } };
    preview.migratedForm = false;
    preview.previewOnly = true;
    preview.canInitialize = false;
    preview.template.name = `${scope} MCM preview`;
    delete preview.summaryBinding;
    delete preview.answerVersion;
    delete preview.booking;
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(preview);
    mount();
    await screen.findByText('Discussion record');
    for (const name of ['Generate from Teams', 'Upload Transcript']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription('Available to the assigned Coach only.');
      await user.click(button);
      button.focus();
      expect(button).not.toHaveFocus();
      await user.keyboard('{Enter} ');
      fireEvent.drop(button, { dataTransfer: { files: [new File(['Transcript'], 'meeting.txt')] } });
    }
    expect(screen.getByRole('textbox', { name: 'Discussion record' })).toBeDisabled();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(api.initializeMigratedReview).not.toHaveBeenCalled();
    expect(api.uploadMigratedSummaryTranscript).not.toHaveBeenCalled();
    expect(api.fetchMigratedReviewIntelligence).not.toHaveBeenCalled();
    expect(api.generateReviewMeetingSummary).not.toHaveBeenCalled();
    expect(api.saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

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
    expect(screen.getByRole('button', { name: 'Upload Transcript' })).toBeEnabled();
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
    expect(api.fetchMigratedReviewIntelligence).toHaveBeenLastCalledWith(id, undefined, { refresh: true, generateSummary: true });
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
        intelligence: { ...result().intelligence!, transcriptStatus: 'unavailable', summaryStatus: 'unavailable', errorCodes: ['TRANSCRIPT_PENDING'] },
        answerVersion: 'v2', reviewAnswers: { other: 'Existing other answer' } } : result());
    mount();
    const field = await screen.findByRole('textbox', { name: 'Discussion record' });
    fireEvent.click(screen.getByRole('button', { name: 'Generate from Teams' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No transcript was found for this meeting.');
    expect(field).toBeEnabled();
  });

  it('reports a saved transcript without mislabeling it missing when generation is pending', async () => {
    vi.mocked(api.fetchMigratedReviewIntelligence).mockImplementation(async (_id, _signal, options) => options?.refresh
      ? { ...result({ fieldKey: 'recap', state: 'NEVER_POPULATED', status: 'summary-unavailable', generationStatus: 'unavailable' }),
        intelligence: { ...result().intelligence!, transcriptStatus: 'available', summaryStatus: 'pending',
          meetingEndStatus: 'pending', errorCodes: ['MEETING_END_PENDING'] },
        answerVersion: 'pending-version', reviewAnswers: { other: 'Existing other answer' } }
      : result());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Generate from Teams' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The saved Teams transcript is available');
    expect(screen.queryByText(/No transcript was found/)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Discussion record' })).toBeEnabled();
  });

  it.each(['aptem_mcm', 'aptem_progress_review'])('shows disabled admin summary controls for %s without a file picker or mutation', async reviewTypeCode => {
    const user = userEvent.setup();
    identity.viewAs = true;
    const saved = definition();
    saved.readOnly = true;
    saved.template.reviewTypeCode = reviewTypeCode;
    saved.sections[0].fields[0].answer = 'Saved coach summary';
    saved.summaryBinding = { ...saved.summaryBinding, suggestionSource: 'uploaded_transcript' };
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    mount();
    const field = await screen.findByRole('textbox', { name: 'Discussion record' });
    expect(field).toBeDisabled();
    expect(field).toHaveValue('Saved coach summary');
    expect(screen.getByText('Latest AI summary generated from uploaded transcript.')).toBeVisible();
    for (const name of ['Generate from Teams', 'Upload Transcript']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription('Available to the assigned Coach only.');
      await user.click(button);
      button.focus();
      expect(button).not.toHaveFocus();
      await user.keyboard('{Enter} ');
      fireEvent.drop(button, { dataTransfer: { files: [new File(['Transcript'], 'meeting.txt')] } });
    }
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(api.fetchMigratedReviewIntelligence).toHaveBeenCalledTimes(1);
    expect(api.fetchMigratedReviewIntelligence).toHaveBeenCalledWith(id, expect.any(AbortSignal), { refresh: false });
    expect(api.uploadMigratedSummaryTranscript).not.toHaveBeenCalled();
    expect(api.generateReviewMeetingSummary).not.toHaveBeenCalled();
    expect(api.saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

  it.each(['awaiting-signature', 'completed'])('keeps admin %s summary actions hidden', async status => {
    identity.viewAs = true;
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(definition(status));
    mount();
    expect(await screen.findByRole('textbox', { name: 'Discussion record' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Generate from Teams' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload Transcript' })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });
});


describe('summary request ownership', () => {
  it('finishes a pending generation while navigating steps within the same review', async () => {
    const saved = definition();
    saved.sections.push({ id: 'next', title: 'Next discussion', enabled: true, displayOrder: 1, estimatedMinutes: 0,
      fields: [{ id: 'next-note', title: 'Next note', fieldType: 'text', required: false, displayOrder: 0, configuration: {} }] });
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    let resolveGeneration!: (value: CoachMeetingArtifactsResponse) => void;
    const pending = new Promise<CoachMeetingArtifactsResponse>(resolve => { resolveGeneration = resolve; });
    vi.mocked(api.fetchMigratedReviewIntelligence).mockImplementation(async (_key, _signal, options) => options?.refresh ? pending : result());
    render(<ReviewInstanceModal instanceId={id} onClose={vi.fn()} presentation="page" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate from Teams' }));
    await waitFor(() => expect(api.fetchMigratedReviewIntelligence).toHaveBeenCalledWith(id, undefined, { refresh: true, generateSummary: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.queryByRole('button', { name: 'Generate from Teams' })).not.toBeInTheDocument();
    await act(async () => { resolveGeneration({ ...result({ fieldKey: 'recap', state: 'AI_POPULATED_UNEDITED', generationStatus: 'ready' }),
      answerVersion: 'generated-version', reviewAnswers: { recap: 'Current review summary', other: 'Existing other answer' } }); });
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('textbox', { name: 'Discussion record' })).toHaveValue('Current review summary');
  });

  it.each(['aptem_mcm', 'aptem_progress_review'])('allows Generate for a verified legacy %s booking with a different calendar key', async family => {
    const saved = definition();
    saved.template.reviewTypeCode = family;
    saved.booking = { ...saved.booking!, eventKey: 'legacy-calendar:42' };
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(saved);
    mount();
    const generate = await screen.findByRole('button', { name: 'Generate from Teams' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check Session' })).toBeEnabled());
    expect(generate).toBeEnabled();
  });

  it.each(['teams', 'upload', 'check'].flatMap(source => ['review', 'coach', 'view-as'].flatMap(target =>
    ['success', 'failure'].map(outcome => ({ source, target, outcome })),
  )))('ignores a late $source $outcome after switching $target', async ({ source, target, outcome }) => {
    let resolveGeneration!: (value: CoachMeetingArtifactsResponse) => void;
    let rejectGeneration!: (reason: Error) => void;
    const pending = new Promise<CoachMeetingArtifactsResponse>((resolve, reject) => {
      resolveGeneration = resolve;
      rejectGeneration = reject;
    });
    vi.mocked(api.fetchMigratedReviewIntelligence).mockImplementation(async (_key, _signal, options) => options?.refresh ? pending : result());
    vi.mocked(api.uploadMigratedSummaryTranscript).mockReturnValue(pending);
    const view = mount();
    await screen.findByRole('textbox', { name: 'Discussion record' });
    if (source !== 'upload') {
      const action = await screen.findByRole('button', { name: source === 'check' ? 'Check Session' : 'Generate from Teams' });
      await waitFor(() => expect(action).toBeEnabled());
      fireEvent.click(action);
      await waitFor(() => expect(api.fetchMigratedReviewIntelligence).toHaveBeenCalledWith(id, undefined,
        source === 'check' ? { refresh: true } : { refresh: true, generateSummary: true }));
    } else {
      fireEvent.change(screen.getByLabelText('Select migrated review transcript'), {
        target: { files: [new File(['Synthetic transcript'], 'meeting.txt', { type: 'text/plain' })] },
      });
      await waitFor(() => expect(api.uploadMigratedSummaryTranscript).toHaveBeenCalledOnce());
    }
    const next = definition();
    if (target === 'review') next.instance = { ...next.instance, id: 'imported-review:another' };
    if (target === 'coach') identity.email = 'another-coach@example.invalid';
    if (target === 'view-as') {
      identity.viewAs = true;
      next.readOnly = true;
    }
    next.answerVersion = 'another-version';
    next.sections[0].fields[0].answer = 'Second review summary';
    next.sections[0].fields[1].answer = 'Second review other answer';
    vi.mocked(api.fetchReviewInstanceForm).mockResolvedValue(next);
    view.rerender(<ReviewInstanceModal instanceId={next.instance.id} onClose={vi.fn()} />);
    await screen.findByDisplayValue('Second review summary');
    await act(async () => {
      if (outcome === 'failure') rejectGeneration(new Error('Old request failed'));
      else resolveGeneration({ ...result({ fieldKey: 'recap', state: 'AI_POPULATED_UNEDITED', generationStatus: 'ready' }),
        answerVersion: 'first-review-generated-version', reviewAnswers: { recap: 'First review generated summary', other: 'First review other answer' } });
    });
    expect(screen.getByRole('textbox', { name: 'Discussion record' })).toHaveValue('Second review summary');
    expect(screen.queryByText(/Old request failed/)).not.toBeInTheDocument();
    if (target === 'view-as') {
      expect(screen.getByRole('textbox', { name: 'Discussion record' })).toBeDisabled();
      expect(api.saveReviewInstanceAnswers).not.toHaveBeenCalled();
      return;
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.saveReviewInstanceAnswers).toHaveBeenCalled());
    expect(api.saveReviewInstanceAnswers).toHaveBeenCalledWith(next.instance.id,
      expect.objectContaining({ recap: 'Second review summary', other: 'Second review other answer' }),
      expect.objectContaining({ answerVersion: 'another-version' }));
  });

  it('distinguishes a transcript fetch failure from a missing transcript', async () => {
    vi.mocked(api.fetchMigratedReviewIntelligence).mockImplementation(async (_key, _signal, options) => options?.refresh
      ? { ...result({ fieldKey: 'recap', state: 'NEVER_POPULATED', generationStatus: 'unavailable' }),
        answerVersion: 'fetch-failed-version', reviewAnswers: { other: 'Existing other answer' },
        intelligence: { ...result().intelligence!, transcriptStatus: 'fetch-failed', errorCodes: ['TRANSCRIPT_FETCH_FAILED'] } }
      : result());
    mount();
    const action = await screen.findByRole('button', { name: 'Generate from Teams' });
    await act(async () => { fireEvent.click(action); });
    expect(await screen.findByRole('alert')).toHaveTextContent('The Teams transcript could not be fetched.');
    expect(screen.queryByText(/No transcript was found/)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Discussion record' })).toBeEnabled();
  });

  it('distinguishes an incomplete transcript from a missing transcript', async () => {
    vi.mocked(api.fetchMigratedReviewIntelligence).mockImplementation(async (_key, _signal, options) => options?.refresh
      ? { ...result({ fieldKey: 'recap', state: 'NEVER_POPULATED', generationStatus: 'unavailable' }),
        intelligence: { ...result().intelligence!, transcriptStatus: 'incomplete', summaryStatus: 'unavailable',
          errorCodes: ['TRANSCRIPT_INCOMPLETE'] } }
      : result());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Generate from Teams' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The complete Teams transcript is not available yet.');
    expect(screen.queryByText(/No transcript was found/)).not.toBeInTheDocument();
  });
});

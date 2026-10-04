import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewInstanceModal } from './ReviewInstanceModal';
import { MigratedMeetingIntelligence } from './MigratedMeetingIntelligence';
import * as api from '@/api/reviewInstances';
import type { CoachMeetingArtifactsResponse, MigratedSummaryBinding } from './calendarEvents';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { user: { fullName: 'Synthetic coach' } } }) }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: 'coach@example.invalid', isInitialized: true, isViewingAsCoach: false }) }));
vi.mock('@/api/reviewInstances', async original => ({
  ...await original<typeof import('@/api/reviewInstances')>(),
  fetchReviewInstanceForm: vi.fn(), fetchMigratedReviewIntelligence: vi.fn(), saveReviewInstanceAnswers: vi.fn(),
  generateReviewMeetingSummary: vi.fn(), submitMigratedReview: vi.fn(),
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
    expect(screen.queryByRole('button', { name: 'Generate from Teams' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Check Session' }));
    await waitFor(() => expect(field).toHaveValue('AI form answer'));
    expect(screen.getAllByDisplayValue('AI form answer')).toHaveLength(1);
    expect(screen.queryByText('Original provenance')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(api.submitMigratedReview).not.toHaveBeenCalled();
    expect(api.generateReviewMeetingSummary).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '' } });
    expect(screen.queryByRole('button', { name: 'Check Session' })).not.toBeInTheDocument();
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
    vi.mocked(api.fetchMigratedReviewIntelligence).mockResolvedValue(result({ fieldKey: 'recap', state: 'NEVER_POPULATED', status: 'summary-too-long', suggestionText: fullText }));
    mount();
    expect(await screen.findByText(/AI summary is longer than this field allows/)).toBeVisible();
    fireEvent.click(screen.getByText('View full AI suggestion to shorten'));
    expect(screen.getByRole('textbox', { name: 'Full AI suggestion' })).toHaveValue(fullText);
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
});

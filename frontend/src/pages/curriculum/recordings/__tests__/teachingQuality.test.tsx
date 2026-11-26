import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QualityReviewDialog from '@/pages/coaching-recordings/QualityReviewDialog';
import { teachingQualityContext, saveTeachingQualityReview } from '../teachingQuality';
import { qualityContext, qualityForms, saveQualityReview, QualityReviewError, type QualityContext, type QualityForm, type QualityReview } from '@/api/coachingQualityReviews';

vi.mock('../teachingQuality', () => ({ teachingQualityContext: vi.fn(), saveTeachingQualityReview: vi.fn() }));
vi.mock('@/api/coachingQualityReviews', async () => ({ ...await vi.importActual<typeof import('@/api/coachingQualityReviews')>('@/api/coachingQualityReviews'), qualityContext: vi.fn(), qualityForms: vi.fn(), saveQualityReview: vi.fn() }));
const scope = { moduleId: 'module-one', seriesId: 'series-one', occurrenceId: 'occurrence-one' };
const context = (): QualityContext => ({
  template: { id: 'feedback-form_teaching', reviewType: 'FORM_TEACHING', title: 'Teaching Session Feedback Form', version: 1,
    ratings: { gold: 'Excellent', green: 'Effective', amber: 'Developing', red: 'Weak', na: 'Not applicable' },
    sections: [{ id: 'observation', title: 'Teaching observation', screenshots: false,
      criteria: [{ id: 'teaching-1', text: 'Subject expertise and vocational relevance', type: 'rating', required: true }] }] },
  learners: [], review: null, observer: { id: 'staff:1', name: 'Reviewer', email: 'reviewer@example.invalid' },
  snapshot: { scope: 'teaching', reviewType: 'FORM_TEACHING', coach: { name: 'Synthetic Tutor', email: 'tutor@example.invalid' }, learner: null,
    lecture: { ...scope, tutorKey: 'tutor@example.invalid', programme: 'Synthetic Programme', cohort: 'Cohort A', group: 'Group A' },
    meeting: { eventId: 'event-one', title: 'Synthetic lecture', startsAt: '2026-11-02T10:00:00Z', endsAt: '2026-11-02T11:00:00Z' } },
});
const saved = (form: QualityForm): QualityReview => ({ ...context().snapshot, id: 'saved-teaching-review', version: 1,
  templateId: 'teaching-session-v1', identity: 'synthetic', status: 'draft', form, reviewer: context().observer, updatedBy: 'staff:1', updatedAt: '2026-11-02T12:00:00Z' });
const mount = (onClose = vi.fn()) => render(<MemoryRouter><QualityReviewDialog teachingLecture={scope} onClose={onClose} /></MemoryRouter>);

describe('Whole lecture teaching review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(teachingQualityContext).mockResolvedValue(context());
    vi.mocked(saveTeachingQualityReview).mockImplementation(async (_, payload) => ({ ...saved(payload.form), status: payload.status }));
  });
  it('opens only the teaching form and saves without a learner or coach API request', async () => {
    mount();
    await screen.findByText('Tutor observed');
    expect(screen.getByText('Synthetic Tutor')).toBeVisible();
    expect(screen.getByText('Cohort A / Group A')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Review learner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose another form' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/Version 1 saved/);
    expect(saveTeachingQualityReview).toHaveBeenCalledWith(scope, expect.objectContaining({ expectedVersion: 0, status: 'draft', form: expect.objectContaining({ header: expect.objectContaining({ programme: 'Synthetic Programme' }) }) }));
    expect(vi.mocked(saveTeachingQualityReview).mock.calls[0][1]).not.toHaveProperty('learnerId');
    expect(qualityContext).not.toHaveBeenCalled(); expect(qualityForms).not.toHaveBeenCalled(); expect(saveQualityReview).not.toHaveBeenCalled();
  });
  it('requires teaching evidence before completion and preserves edits after a save conflict', async () => {
    mount(); await screen.findByText('Tutor observed');
    fireEvent.click(screen.getByRole('button', { name: 'Complete review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a rating');
    expect(saveTeachingQualityReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Evidence observed and impact on the learner' }), { target: { value: 'Observed subject examples at 12:30.' } });
    vi.mocked(saveTeachingQualityReview).mockRejectedValueOnce(new QualityReviewError('Reload the saved version.', 409));
    fireEvent.click(screen.getByRole('button', { name: 'Complete review' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Reload the saved version.'));
    expect(screen.getByRole('textbox', { name: 'Evidence observed and impact on the learner' })).toHaveValue('Observed subject examples at 12:30.');
    expect(screen.getByRole('button', { name: 'Reload saved version' })).toBeEnabled();
  });
  it('reopens the saved whole-class answers and protects unsaved changes on Escape', async () => {
    const base: QualityForm = { header: { employer: '', programme: 'Synthetic Programme', activityDate: '2026-11-02', startDate: '', endDate: '' },
      criteria: { 'teaching-1': { rating: 'green', evidence: 'Saved tutor observation' } }, images: {}, sources: [], actions: [] };
    vi.mocked(teachingQualityContext).mockResolvedValue({ ...context(), review: saved(base) });
    const onClose = vi.fn(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount(onClose);
    const evidence = await screen.findByRole('textbox', { name: 'Evidence observed and impact on the learner' });
    expect(evidence).toHaveValue('Saved tutor observation');
    fireEvent.change(evidence, { target: { value: 'Unsaved new observation' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirm).toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});

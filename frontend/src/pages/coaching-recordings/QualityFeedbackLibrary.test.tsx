import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { qualityForms, qualityContext, qualityDefinition, createQualityForm, saveQualityDefinition, saveQualityReview, uploadQualityEvidence, type QualityReview, type QualityTemplate } from '@/api/coachingQualityReviews';
import QualityFormCards from './QualityFormCards';
import QualityReviewDialog from './QualityReviewDialog';
import QualityFormsPage from './QualityFormsPage';
import { blankQualityForm, qualityCompletionIssue } from './qualityFormModel';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/api/coachingQualityReviews', async () => ({ ...await vi.importActual<typeof import('@/api/coachingQualityReviews')>('@/api/coachingQualityReviews'),
  qualityForms: vi.fn(), qualityContext: vi.fn(), qualityDefinition: vi.fn(), createQualityForm: vi.fn(), saveQualityDefinition: vi.fn(), saveQualityReview: vi.fn(), uploadQualityEvidence: vi.fn() }));
const kinds = ['PROGRESS_REVIEW','COMMITMENT','FIRST_SESSION','GATEWAY','INFORMATION','MONTHLY_COACHING','TEACHING','BARRIERS','BRITISH_VALUES','CIAG','EPA','MARKING_FEEDBACK','SAFEGUARDING','TARGET_SETTING'];
const cards = kinds.map((kind, index) => ({ reviewType: 'FORM_' + kind, title: kind.replaceAll('_', ' ') + ' Feedback Form', group: index < 7 ? 'Session forms' : 'Themed observations', published: true, revision: 0, legacy: false }));
const definition = (kind: string): QualityTemplate => ({ id: 'feedback-' + kind.toLowerCase(), reviewType: kind, title: cards.find(row => row.reviewType === kind)?.title || 'Custom form', version: 1,
  ratings: { gold: 'Gold guidance', green: 'Green guidance', amber: 'Amber guidance', red: 'Red guidance', na: 'Not applicable' },
  sections: [{ id: 'observation', title: 'Session observation', screenshots: false, criteria: [{ id: 'criterion-1', text: 'Specific observation', type: 'rating', allowNa: false, descriptors: { green: 'Complete original criterion guidance.' } }] }] });
const templateState = (kind: string) => ({ id: definition(kind).id, reviewType: kind, revision: 0, draft: definition(kind), published: definition(kind), publishedAt: null, updatedAt: null });
const coach = { email: 'coach@example.invalid', name: 'Synthetic coach' }, learner = { id: '1', name: 'Synthetic learner' }, reviewer = { id: 'staff:1', name: 'Synthetic reviewer', email: 'reviewer@example.invalid' };
const meeting = { eventId: 'verified-event', title: 'Monthly coaching meeting', startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z' };

describe('Feedback forms and original evidence', () => {
  beforeEach(() => {
    vi.mocked(qualityForms).mockReset().mockResolvedValue({ forms: cards });
    vi.mocked(qualityContext).mockReset().mockImplementation(async (_event, _reference, _learner, _signal, kind = '') => ({ template: definition(kind), learners: [learner], review: null, observer: reviewer, snapshot: { coach, learner, meeting, reviewType: kind } }));
    vi.mocked(qualityDefinition).mockReset().mockImplementation(async (_signal, kind = '') => ({ template: templateState(kind), fieldTypes: ['rating','file'] }));
    vi.mocked(saveQualityReview).mockReset().mockImplementation(async payload => ({ id: 'saved-' + payload.reviewType, version: payload.expectedVersion + 1, templateId: 'portfolio-sampling-v1', identity: 'identity', reviewType: payload.reviewType,
      status: payload.status, form: payload.form, coach, learner, meeting, reviewer, updatedAt: '2026-10-26T12:00:00Z', updatedBy: reviewer.id }) as QualityReview);
    vi.mocked(uploadQualityEvidence).mockReset().mockImplementation(async (_id, section, file) => ({ id: file.name, section, filename: file.name, size: file.size, contentType: 'application/octet-stream', hasPreview: false }));
    vi.mocked(createQualityForm).mockReset().mockResolvedValue(templateState('FORM_CUSTOM_TEST'));
    vi.mocked(saveQualityDefinition).mockReset().mockImplementation(async payload => ({ ...templateState(payload.definition.reviewType!), revision: 1, draft: payload.definition, published: { ...payload.definition, version: 2 } }));
  });

  it('lists all fourteen cards, groups and searches them locally without auto-selection or typing requests', async () => {
    const select = vi.fn(); render(<QualityFormCards value="" onChange={select} />);
    expect(await screen.findAllByRole('radio')).toHaveLength(14);
    expect(screen.getAllByRole('radio').every(row => !(row as HTMLInputElement).checked)).toBe(true);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'SAFEGUARDING' } });
    expect(screen.getAllByRole('radio')).toHaveLength(1); expect(qualityForms).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('radio', { name: 'SAFEGUARDING Feedback Form' }));
    expect(select).toHaveBeenCalledWith('FORM_SAFEGUARDING');
  });

  it('reports a library failure and retries instead of presenting an empty success', async () => {
    vi.mocked(qualityForms).mockRejectedValueOnce(new Error('Library temporarily unavailable'));
    render(<QualityFormCards value="" onChange={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Library temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry form library' }));
    expect(await screen.findAllByRole('radio')).toHaveLength(14);
  });

  it('opens the chosen form, saves a draft once, and uploads multiple original file formats sequentially', async () => {
    render(<MemoryRouter><QualityReviewDialog initialLearnerId="1" initialReviewType="MCM" onClose={vi.fn()} /></MemoryRouter>);
    expect(await screen.findAllByRole('radio')).toHaveLength(14);
    expect(screen.queryByRole('radio', { name: 'Green' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'SAFEGUARDING Feedback Form' }));
    await screen.findByRole('radio', { name: 'Green' });
    expect(screen.queryByRole('radio', { name: 'N/A' })).not.toBeInTheDocument();
    const files = [new File(['spreadsheet'], 'evidence.xlsx'), new File(['video'], 'evidence.mp4')];
    fireEvent.change(screen.getByLabelText('Attach evidence files: evidence'), { target: { files } });
    await screen.findByText('evidence.mp4');
    expect(saveQualityReview).toHaveBeenCalledOnce(); expect(uploadQualityEvidence).toHaveBeenCalledTimes(2);
    expect(vi.mocked(uploadQualityEvidence).mock.calls.map(call => call[0])).toEqual(['saved-FORM_SAFEGUARDING','saved-FORM_SAFEGUARDING']);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveQualityReview).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveQualityReview).mock.calls[1][0].form.attachments?.evidence).toEqual(['evidence.xlsx','evidence.mp4']);
    expect(vi.mocked(saveQualityReview).mock.calls[1][0].reviewType).toBe('FORM_SAFEGUARDING');
    expect(qualityContext).toHaveBeenCalledTimes(2);
  });

  it('keeps entered observations when an evidence upload fails or exceeds its bound', async () => {
    vi.mocked(uploadQualityEvidence).mockRejectedValue(new Error('Evidence upload failed'));
    render(<MemoryRouter><QualityReviewDialog initialLearnerId="1" onClose={vi.fn()} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('radio', { name: 'GATEWAY Feedback Form' }));
    const note = await screen.findByRole('textbox', { name: 'Evidence observed and impact on the learner' });
    fireEvent.change(note, { target: { value: 'Preserve this observation' } });
    const huge = new File(['x'], 'large.zip'); Object.defineProperty(huge, 'size', { value: 26 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Attach evidence files: evidence'), { target: { files: [huge] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 25 MB'); expect(uploadQualityEvidence).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Attach evidence files: evidence'), { target: { files: [new File(['evidence'], 'file.pdf'), new File(['later evidence'], 'later.pdf')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence upload failed');
    expect(uploadQualityEvidence).toHaveBeenCalledOnce();
    expect(note).toHaveValue('Preserve this observation');
  });

  it('creates a custom draft form then edits question types and full rating descriptions without typing requests', async () => {
    render(<MemoryRouter><QualityFormsPage /></MemoryRouter>);
    await screen.findByRole('radio', { name: 'GATEWAY Feedback Form' });
    expect(qualityDefinition).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'New form name' }), { target: { value: 'Custom evidence review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create form type' }));
    await screen.findByRole('textbox', { name: 'Question text' });
    expect(createQualityForm).toHaveBeenCalledWith('Custom evidence review', expect.any(String));
    const guidance = screen.getByRole('textbox', { name: 'Green reference criteria', hidden: true });
    fireEvent.change(guidance, { target: { value: 'Edited complete grading guidance.' } });
    expect(saveQualityDefinition).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'Upload evidence file' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish form' }));
    await waitFor(() => expect(saveQualityDefinition).toHaveBeenCalledOnce());
    expect(vi.mocked(saveQualityDefinition).mock.calls[0][0]).toMatchObject({ publish: true, definition: { reviewType: 'FORM_CUSTOM_TEST', sections: [{ criteria: [{ descriptors: { green: 'Edited complete grading guidance.' } }] }] } });
  });

  it('validates required file questions without treating false or zero as empty answers', () => {
    const template = definition('FORM_EPA'); template.sections[0].criteria = [{ id: 'file', text: 'Original evidence', type: 'file', required: true }, { id: 'confirmed', text: 'Confirmed', type: 'boolean', required: true }, { id: 'count', text: 'Count', type: 'number', required: true }];
    const form = blankQualityForm(template, '2026-10-26');
    form.answers = { confirmed: false, count: 0 };
    expect(qualityCompletionIssue(template, form)).toBe('Attach evidence: Original evidence');
    form.attachments = { file: ['saved-file'] };
    expect(qualityCompletionIssue(template, form)).toBe('');
  });
});

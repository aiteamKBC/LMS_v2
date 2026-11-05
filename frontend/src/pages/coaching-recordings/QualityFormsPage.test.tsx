import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QualityFormsPage from './QualityFormsPage';
import { qualityDefinition, qualityForms, saveQualityDefinition, QualityReviewError, type QualityTemplateState } from '@/api/coachingQualityReviews';
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/api/coachingQualityReviews', async () => ({ ...await vi.importActual<typeof import('@/api/coachingQualityReviews')>('@/api/coachingQualityReviews'), qualityDefinition: vi.fn(), qualityForms: vi.fn(), saveQualityDefinition: vi.fn() }));
const state = (): QualityTemplateState => {
  const definition = { id: 'portfolio-sampling-v1', version: 1, title: 'Portfolio Sampling Feedback Form', ratings: { gold: 'High quality', green: 'Effective', amber: 'Weak', red: 'Absent', na: 'Not applicable' }, sections: [{ id: 'progress', title: 'Progress reviews', screenshots: true, criteria: [{ id: 'progress-1', text: 'Original question', type: 'rating' as const, required: true }] }] };
  return { id: definition.id, revision: 0, draft: structuredClone(definition), published: definition, publishedAt: null, updatedAt: null };
};
describe('Curriculum quality form authoring', () => {
  beforeEach(() => {
    vi.mocked(qualityForms).mockReset().mockResolvedValue({ forms: ['MCM','PR'].map(reviewType => ({ reviewType, title: reviewType, group: 'Previous forms', published: true, revision: 0, legacy: true })) });
    vi.mocked(qualityDefinition).mockReset().mockResolvedValue({ template: state(), fieldTypes: ['rating', 'text', 'checklist', 'image'] });
    vi.mocked(saveQualityDefinition).mockReset().mockImplementation(async value => ({ ...state(), revision: 1, draft: value.definition, published: value.publish ? { ...value.definition, version: 2 } : state().published }));
  });
  const open = () => render(<MemoryRouter initialEntries={['/?type=MCM']}><QualityFormsPage /></MemoryRouter>);
  it('starts from the default questions, supports all types and sends no typing requests', async () => {
    open(); const question = await screen.findByRole('textbox', { name: 'Question text' });
    expect(question).toHaveValue('Original question');
    fireEvent.change(question, { target: { value: 'Edited question' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Question type' }), { target: { value: 'checklist' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Options/ }), { target: { value: 'Observed\nNot observed' } });
    expect(saveQualityDefinition).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'Upload image' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish form' }));
    await screen.findByText(/Published · Form version 2/);
    expect(vi.mocked(saveQualityDefinition).mock.calls[0][0]).toMatchObject({ expectedRevision: 0, publish: true, definition: { sections: [{ criteria: [{ id: 'progress-1', text: 'Edited question', type: 'checklist', options: ['Observed', 'Not observed'] }] }] } });
  });
  it('loads the PR editor independently and guards a switch with unsaved changes', async () => {
    vi.mocked(qualityDefinition).mockImplementation(async (_signal, kind) => {
      const value = state(); value.draft.reviewType = kind; value.draft.title = `${kind} quality form`;
      value.draft.sections[0].criteria[0].text = `${kind} criterion`; return { template: value, fieldTypes: ['rating'] };
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      render(<MemoryRouter initialEntries={['/?type=PR']}><QualityFormsPage /></MemoryRouter>);
      const question = await screen.findByRole('textbox', { name: 'Question text' }); expect(question).toHaveValue('PR criterion');
      fireEvent.change(question, { target: { value: 'Edited PR criterion' } });
      fireEvent.click(screen.getByText('Choose a form', { exact: true }));
      fireEvent.click(screen.getByRole('radio', { name: 'MCM' })); expect(qualityDefinition).toHaveBeenCalledOnce();
      expect(question).toHaveValue('Edited PR criterion'); confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole('radio', { name: 'MCM' }));
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Question text' })).toHaveValue('MCM criterion'));
      fireEvent.click(screen.getByRole('button', { name: 'Publish form' }));
      await waitFor(() => expect(saveQualityDefinition).toHaveBeenCalledOnce());
      expect(vi.mocked(saveQualityDefinition).mock.calls[0][0].definition.reviewType).toBe('MCM');
    } finally { confirm.mockRestore(); }
  });
  it('saves a draft without claiming that meetings use the new version', async () => {
    open(); await screen.findByRole('textbox', { name: 'Question text' });
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft saved. Meetings continue to use the published form.');
    expect(vi.mocked(saveQualityDefinition).mock.calls[0][0].publish).toBe(false);
  });
  it('previews the UI with logo and no save or image requests', async () => {
    open(); await screen.findByRole('textbox', { name: 'Question text' });
    fireEvent.click(screen.getByRole('button', { name: 'Preview form' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Kent Business College' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }));
    expect(saveQualityDefinition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close Quality form preview' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('retains edits on conflict and reuses the unchanged save identifier', async () => {
    vi.mocked(saveQualityDefinition).mockRejectedValue(new QualityReviewError('Form changed elsewhere.', 409));
    open(); const question = await screen.findByRole('textbox', { name: 'Question text' });
    fireEvent.change(question, { target: { value: 'Keep these edits' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); await screen.findByRole('alert');
    expect(question).toHaveValue('Keep these edits');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveQualityDefinition).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveQualityDefinition).mock.calls[0][0].requestId).toEqual(vi.mocked(saveQualityDefinition).mock.calls[1][0].requestId);
  });
  it('keeps an unsaved definition when browser Back is declined', async () => {
    const old = window.history.state;
    window.history.replaceState({ idx: 4 }, '');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false), go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    try {
      open(); const question = await screen.findByRole('textbox', { name: 'Question text' });
      fireEvent.change(question, { target: { value: 'Unsaved definition' } });
      window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 3 } }));
      expect(confirm).toHaveBeenCalled(); expect(go).toHaveBeenCalledWith(1);
      expect(question).toHaveValue('Unsaved definition'); expect(saveQualityDefinition).not.toHaveBeenCalled();
    } finally { confirm.mockRestore(); go.mockRestore(); window.history.replaceState(old, ''); }
  });
});

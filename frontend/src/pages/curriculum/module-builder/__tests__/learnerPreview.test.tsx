import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearnerPreview } from '../LearnerPreview';
import { previewComponent } from '../learnerPreviewData';
import type { ModuleCatalogueItem, ModuleComponent } from '../moduleAuthoringData';

vi.mock('@/pages/learner/video-watch/page', () => ({ ComponentBody: ({ component, preview }: { component: { title: string }; preview: boolean }) => <div data-testid="learner-body">{component.title} {preview ? 'preview enabled' : 'interactive'}</div> }));
vi.mock('@/pages/learner/quiz-take/page', () => ({ QuestionInput: () => <input aria-label="Preview answer" /> }));
const component = (settings: Record<string, unknown> = {}): ModuleComponent => ({
  id: 'C1', title: 'Reading one', type: 'reading', settings, description: '', expectedOtjh: 1,
} as ModuleComponent);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Learner preview', () => {
  it('uses the selected source and never treats an uploaded PDF as podcast audio', () => {
    const settings = { resourceUrl: 'https://example.invalid/old.pptx', uploadedFileUrl: 'https://example.invalid/new.pdf', powerpointSource: 'Device upload' };
    expect(previewComponent(component(settings)).resourceUrl).toBe(settings.uploadedFileUrl);
    expect(previewComponent(component(settings)).audioUrl).toBe('');
    expect(previewComponent(component({ ...settings, powerpointSource: 'URL' })).resourceUrl).toBe(settings.resourceUrl);
  });

  it('maps the uploaded materials and authored brief used by the learner', () => {
    const resource = previewComponent(component({ presentationUrl: 'https://example.invalid/deck.pptx', downloadAllowed: true,
      assignmentBrief: 'Write an answer', assignmentFileName: 'brief.pdf' }));
    expect(resource.resourceUrl).toBe('https://example.invalid/deck.pptx');
    expect(resource.downloadAllowed).toBe(true);
    expect(resource.assignmentBrief).toBe('Write an answer');
    expect(resource.fileName).toBe('brief.pdf');
  });

  it('switches components using the learner renderer without progress or attendance requests', async () => {
    const fetchMock = vi.fn(() => { throw new Error('Unexpected request'); }); vi.stubGlobal('fetch', fetchMock);
    const close = vi.fn();
    const module = { title: 'Example module', weekStructure: [{ id: 'W1', weekNumber: 1, title: 'Week',
      components: [component(), { ...component(), id: 'C2', title: 'Video two', type: 'video' }] }] } as ModuleCatalogueItem;
    render(<LearnerPreview module={module} onClose={close} />);
    expect(await screen.findByTestId('learner-body')).toHaveTextContent('Reading one preview enabled');
    fireEvent.click(screen.getByRole('button', { name: 'Video two' }));
    expect(screen.getByTestId('learner-body')).toHaveTextContent('Video two preview enabled');
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});

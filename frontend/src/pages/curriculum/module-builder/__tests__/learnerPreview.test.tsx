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

  it('loads the exact live session recording in preview without learner writes', async () => {
    const live = { ...component({ teamsLiveSessionId: 'S1', teamsSessionNumber: '2' }), type: 'live-session', title: 'Live lesson' } as ModuleComponent;
    expect(previewComponent(live)).toMatchObject({ teamsLiveSessionId: 'S1', teamsSessionNumber: 2 });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [{
      id: 'O2', seriesId: 'S1', sessionNumber: 2, reportReady: true, attendance: [],
      artifacts: [{ id: 'A2', type: 'recording', state: 'ready' }],
    }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const module = { title: 'Example module', weekStructure: [{ id: 'W2', weekNumber: 2, title: 'Week', components: [live] }] } as ModuleCatalogueItem;
    render(<LearnerPreview module={module} onClose={vi.fn()} />);
    expect(await screen.findByLabelText('Session recording 1')).toHaveAttribute('src', '/curriculum_api/curriculum/session-results/S1/artifacts/A2/');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/curriculum_api/curriculum/session-results/S1/sessions/2/');
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Sync attendance & files' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'attendance' })).not.toBeInTheDocument();
  });
});

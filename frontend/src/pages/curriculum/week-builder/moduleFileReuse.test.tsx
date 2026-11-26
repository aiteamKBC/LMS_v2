import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ComponentEditor } from './page';
import { moduleUploadedFiles } from './moduleUploadedFiles';

const fetchStored = vi.hoisted(() => vi.fn());
vi.mock('./weekTemplateData', async importOriginal => ({ ...(await importOriginal<typeof import('./weekTemplateData')>()), fetchModuleStoredUploads: fetchStored }));
vi.mock('../module-builder/RichTextEditor', () => ({ RichTextDraft: () => <div>Editor</div> }));
// Previews fetch and render the file; not what these tests are about.
vi.mock('@/components/feature/SlideDeckViewer', () => ({ SlideDeckViewer: () => <div>Deck preview</div> }));

afterEach(cleanup);

type Component = ComponentProps<typeof ComponentEditor>['component'];
type Links = NonNullable<ComponentProps<typeof ComponentEditor>['recordingLinks']>;
const UP = '/curriculum_api/curriculum/uploads/';
const pdf = { fileName: 'handbook.pdf', url: `${UP}a/handbook.pdf`, size: 2048, contentType: 'application/pdf' };
const deck = { fileName: 'intro.pptx', url: `${UP}b/intro.pptx`, size: 4096, contentType: 'application/vnd.ms-powerpoint' };
const audio = { fileName: 'episode.mp3', url: `${UP}c/episode.mp3`, size: 1024, contentType: 'audio/mpeg' };
const brief = { fileName: 'brief.docx', url: `${UP}d/brief.docx`, size: 512, contentType: 'application/msword' };

function component(id: string, type: string, title: string, settings: Record<string, unknown>): Component {
  return { id, type, title, description: '', settings, expectedOtjh: 1, points: 10, groupIds: [] } as unknown as Component;
}

const reading = component('R1', 'reading', 'Reading Material 1', { readingSource: 'File', componentFiles: JSON.stringify([pdf]) });
const slides = component('P1', 'powerpoint', 'Slides', { uploadedFileUrl: deck.url, fileName: deck.fileName, uploadedFileSize: deck.size, uploadedFileContentType: deck.contentType });
const podcast = component('C1', 'podcast', 'Podcast', { componentFiles: JSON.stringify([audio]), podcastUrl: audio.url });
const assignment = component('A1', 'assignment', 'Assignment', {
  assignmentTopics: JSON.stringify([{ id: '1', resources: [brief, { fileName: 'Site', url: 'https://example.com', size: 0, contentType: '', link: true }] }]),
});
const webLink = component('R3', 'reading', 'Web reading', { readingSource: 'File', resourceUrl: 'https://example.com/page' });
const weeks = [
  { id: 'W1', label: 'Week 1', components: [reading, slides] },
  { id: 'W2', label: 'Week 2', components: [podcast, assignment, webLink, component('R4', 'reading', 'Same file again', { componentFiles: JSON.stringify([pdf]) })] },
];

function links(): Links {
  return { moduleId: 'MOD-1', weeks, setLink: vi.fn() } as unknown as Links;
}

it('lists every uploaded file in the module once, with where it is used, and skips web links', () => {
  const files = moduleUploadedFiles(weeks);
  expect(files.map(item => item.file.url)).toEqual([pdf.url, deck.url, audio.url, brief.url]);
  expect(files[0].source).toBe('Week 1 · Reading Material 1');
  expect(files[1].file).toEqual(deck);
});

it('attaches a file from another component to a reading without uploading it', () => {
  const onChange = vi.fn();
  const uploadResource = vi.fn();
  const target = component('R2', 'reading', 'Reading Material 2', { readingSource: 'File', componentFiles: JSON.stringify([brief]) });
  render(<ComponentEditor component={target} onChange={onChange} onBack={vi.fn()} groupOptions={[]} weekScope={{} as ComponentProps<typeof ComponentEditor>['weekScope']} uploadResource={uploadResource} recordingLinks={links()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Use a file already uploaded in this module' }));
  const list = screen.getByRole('list', { name: 'Files already uploaded in this module' });
  // The file already attached here is not offered again.
  expect(list).not.toHaveTextContent('brief.docx');
  expect(list).toHaveTextContent('episode.mp3');
  expect(list).toHaveTextContent('Used in Week 1 · Slides');

  fireEvent.click(screen.getAllByRole('button', { name: 'Use this file' })[0]);
  const settings = onChange.mock.calls.at(-1)![0].settings;
  expect(JSON.parse(settings.componentFiles)).toEqual([brief, pdf]);
  // The first file and legacy keys are unchanged; nothing was uploaded.
  expect(settings.resourceUrl).toBe(brief.url);
  expect(settings.readingSource).toBe('File');
  expect(uploadResource).not.toHaveBeenCalled();
});

it('offers module files on a slide deck too', () => {
  const onChange = vi.fn();
  const target = component('P2', 'powerpoint', 'Deck 2', {});
  render(<ComponentEditor component={target} onChange={onChange} onBack={vi.fn()} groupOptions={[]} weekScope={{} as ComponentProps<typeof ComponentEditor>['weekScope']} recordingLinks={links()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use a file already uploaded in this module' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Use this file' })[1]);
  const settings = onChange.mock.calls.at(-1)![0].settings;
  expect(JSON.parse(settings.componentFiles)).toEqual([deck]);
  expect(settings.fileName).toBe('intro.pptx');
});

it('does not add the button to podcasts or assignments', () => {
  render(<ComponentEditor component={component('C2', 'podcast', 'Podcast 2', { podcastSource: 'Audio File' })} onChange={vi.fn()} onBack={vi.fn()} groupOptions={[]} weekScope={{} as ComponentProps<typeof ComponentEditor>['weekScope']} recordingLinks={links()} />);
  expect(screen.queryByRole('button', { name: /Use a file already uploaded/ })).toBeNull();
});

it('also offers files stored for the module that no component uses any more', async () => {
  const removed = { fileName: 'old-handbook.pdf', url: `${UP}MOD-1/R2/old-handbook-20261108085803428328.pdf`, size: 300, contentType: 'application/pdf', componentId: 'R2', uploadedAt: null };
  const orphan = { fileName: 'notes.pdf', url: `${UP}MOD-1/GONE/notes-20261108085803428329.pdf`, size: 100, contentType: 'application/pdf', componentId: 'GONE', uploadedAt: null };
  // A stored copy of an attached file is listed once, as attached.
  const attachedCopy = { ...removed, url: pdf.url, componentId: 'R1' };
  fetchStored.mockResolvedValue({ files: [removed, orphan, attachedCopy], truncated: false });
  const onChange = vi.fn();
  const target = component('R2', 'reading', 'Reading Material 2', { readingSource: 'File' });
  const moduleLinks = { ...links(), weeks: [...weeks, { id: 'W3', label: 'Week 3', components: [target] }] } as Links;
  render(<ComponentEditor component={target} onChange={onChange} onBack={vi.fn()} groupOptions={[]} weekScope={{} as ComponentProps<typeof ComponentEditor>['weekScope']} moduleId="MOD-1" recordingLinks={moduleLinks} />);

  fireEvent.click(screen.getByRole('button', { name: 'Use a file already uploaded in this module' }));
  const list = await screen.findByRole('list', { name: 'Files already uploaded in this module' });
  expect(fetchStored).toHaveBeenCalledWith('MOD-1', expect.any(AbortSignal));
  await waitFor(() => expect(list).toHaveTextContent('old-handbook.pdf'));
  expect(list).toHaveTextContent('Not attached · uploaded for Week 3 · Reading Material 2');
  expect(list).toHaveTextContent('Not attached to any component');
  expect(list.querySelectorAll('li')).toHaveLength(6);

  fireEvent.click(screen.getAllByRole('button', { name: 'Use this file' })[4]);
  expect(JSON.parse(onChange.mock.calls.at(-1)![0].settings.componentFiles)).toEqual([
    { fileName: 'old-handbook.pdf', url: removed.url, size: 300, contentType: 'application/pdf' },
  ]);
});

it('still lists attached files when the stored list cannot be loaded', async () => {
  fetchStored.mockRejectedValue(new Error('503'));
  const target = component('R2', 'reading', 'Reading Material 2', { readingSource: 'File' });
  render(<ComponentEditor component={target} onChange={vi.fn()} onBack={vi.fn()} groupOptions={[]} weekScope={{} as ComponentProps<typeof ComponentEditor>['weekScope']} moduleId="MOD-1" recordingLinks={links()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use a file already uploaded in this module' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.getByRole('list', { name: 'Files already uploaded in this module' })).toHaveTextContent('handbook.pdf');
});

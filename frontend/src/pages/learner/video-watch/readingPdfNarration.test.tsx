import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { JourneyComponent } from '@/utils/learnerJourney';
import { ComponentBody } from './page';

const pdfText = vi.hoisted(() => vi.fn());
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: ({ data }: { data: Uint8Array }) => ({ promise: Promise.resolve({
    numPages: 3,
    cleanup: vi.fn(),
    getPage: async (page: number) => ({
      getViewport: () => ({ width: 600, height: 800 }),
      render: () => ({ cancel: vi.fn(), promise: Promise.resolve() }),
      getTextContent: () => pdfText(data[0], page),
    }),
  }) }),
}));

const speak = vi.fn<(utterance: SpeechSynthesisUtterance) => void>();
const cancel = vi.fn();
const textContent = (text: string) => ({
  items: [{ str: text, transform: [12, 0, 0, 12, 0, 700], height: 12, hasEOL: true }],
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
    new Response(new Uint8Array([String(input).includes('guide') ? 2 : 1]), { status: 200 })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  pdfText.mockImplementation(async (file: number, page: number) => textContent(`Document ${file} page ${page}.`));
  vi.stubGlobal('speechSynthesis', { speak, cancel });
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    text: string;
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) { this.text = text; }
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function reading(overrides: Partial<JourneyComponent> = {}) {
  return <ComponentBody component={{ componentId: 'PDF-READING', type: 'reading',
    contentHtml: '<p>Activity introduction.</p>', resourceUrl: '/book.pdf', ...overrides,
  } as JourneyComponent} contentKind="reading" parsed={null} title="Reading" onDuration={vi.fn()}
    onProgress={vi.fn()} onPlayingChange={vi.fn()} onEnded={vi.fn()} onUnsupported={vi.fn()} />;
}

async function startReading() {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Read aloud' })));
}

async function finishSpeech() {
  for (let index = 0; index < speak.mock.calls.length; index += 1) {
    expect(index).toBeLessThan(20);
    await act(async () => {
      speak.mock.calls[index][0].onend?.({} as SpeechSynthesisEvent);
      await vi.runAllTimersAsync();
    });
  }
}

it('reads the activity text then only the currently open PDF page, without toolbar labels', async () => {
  render(reading());
  fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));
  expect(screen.getByText('Page 2 of 3')).toBeVisible();
  vi.useFakeTimers();
  await startReading();
  expect(speak.mock.calls[0][0].text).toBe('Activity introduction.');
  await finishSpeech();
  expect(speak.mock.calls.map(([utterance]) => utterance.text)).toEqual(['Activity introduction.', 'Document 1 page 2.']);
  expect(pdfText.mock.calls).toEqual([[1, 2]]);
  expect(screen.getByRole('button', { name: 'Read aloud' })).toHaveAttribute('aria-pressed', 'false');
});

it('reads a PDF-only activity served from a protected URL identified by filename', async () => {
  render(reading({ contentHtml: '', resourceUrl: '/materials/123/', fileName: 'Reading.pdf' }));
  await screen.findByText('Page 1 of 3');
  await startReading();
  expect(speak.mock.calls.map(([utterance]) => utterance.text)).toEqual(['Document 1 page 1.']);
  expect(fetch).toHaveBeenCalledWith('/materials/123/', expect.objectContaining({ credentials: 'same-origin' }));
});

it('keeps the current pages of multiple attachments in order after a page change and reads the primary once', async () => {
  // Separate network arrivals, as in the existing attachment viewer tests,
  // keep concurrent dynamic imports from bypassing Vitest's PDF module mock.
  let resolveGuide!: (response: Response) => void;
  const guideResponse = new Promise<Response>(resolve => { resolveGuide = resolve; });
  vi.mocked(fetch).mockImplementation(async input => String(input).includes('guide')
    ? guideResponse : new Response(new Uint8Array([1]), { status: 200 }));
  render(reading({ files: [
    { url: '/book.pdf', fileName: 'Book.pdf', size: 1, contentType: 'application/pdf' },
    { url: '/guide.pdf', fileName: 'Guide.pdf', size: 1, contentType: 'application/pdf' },
  ] }));
  await screen.findByText('Page 1 of 3');
  await act(async () => resolveGuide(new Response(new Uint8Array([2]), { status: 200 })));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Next page' })).toHaveLength(2));
  fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
  vi.useFakeTimers();
  await startReading();
  await finishSpeech();
  expect(speak.mock.calls.map(([utterance]) => utterance.text)).toEqual([
    'Activity introduction.', 'Document 1 page 2.', 'Document 2 page 1.',
  ]);
  expect(pdfText.mock.calls).toEqual([[1, 2], [2, 1]]);
});

it('does not load or narrate PDF previews that are still collapsed', async () => {
  render(reading({ resourceUrl: null, contentHtml: '<p>Activity introduction.</p><a href="/book.pdf">Reference book</a>' }));
  vi.useFakeTimers();
  await startReading();
  await finishSpeech();
  expect(fetch).not.toHaveBeenCalled();
  expect(pdfText).not.toHaveBeenCalled();
  expect(speak.mock.calls.map(([utterance]) => utterance.text)).toEqual(['Activity introduction.', 'Reference book']);
});

it('includes an opened linked PDF and removes it from narration when its preview closes', async () => {
  render(reading({ resourceUrl: null, contentHtml: '<a href="/book.pdf">Reference book</a>' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview file: Reference book' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));
  vi.useFakeTimers();
  await startReading();
  await finishSpeech();
  expect(speak.mock.calls.map(([utterance]) => utterance.text)).toEqual(['Reference book', 'Document 1 page 2.']);
  fireEvent.click(screen.getByRole('button', { name: 'Hide preview: Reference book' }));
  speak.mockClear();
  pdfText.mockClear();
  await startReading();
  await finishSpeech();
  expect(speak.mock.calls.map(([utterance]) => utterance.text)).toEqual(['Reference book']);
  expect(pdfText).not.toHaveBeenCalled();
});

it.each(['stop', 'page change', 'close preview', 'unmount'])('discards pending PDF text after %s', async action => {
  let resolveText!: (value: ReturnType<typeof textContent>) => void;
  pdfText.mockReturnValue(new Promise(resolve => { resolveText = resolve; }));
  const view = render(reading({ resourceUrl: null, contentHtml: '<a href="/book.pdf">Reference book</a>' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview file: Reference book' }));
  await screen.findByText('Page 1 of 3');
  await startReading();
  expect(pdfText).toHaveBeenCalledOnce();
  if (action === 'unmount') view.unmount();
  else fireEvent.click(screen.getByRole('button', { name: action === 'stop' ? 'Stop reading'
    : action === 'page change' ? 'Next page' : 'Hide preview: Reference book' }));
  await act(async () => resolveText(textContent('Stale PDF text.')));
  expect(speak).not.toHaveBeenCalled();
  if (action !== 'unmount') expect(screen.getByRole('button', { name: 'Read aloud' })).toHaveAttribute('aria-pressed', 'false');
});

it('stops already queued PDF speech when the learner changes the open page', async () => {
  render(reading());
  await screen.findByText('Page 1 of 3');
  vi.useFakeTimers();
  await startReading();
  act(() => speak.mock.calls[0][0].onend?.({} as SpeechSynthesisEvent));
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await act(async () => vi.runAllTimersAsync());
  expect(speak).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Read aloud' })).toHaveAttribute('aria-pressed', 'false');
});

it('keeps the PDF-only button independent and prevents overlap with activity narration', async () => {
  render(reading());
  fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));
  await startReading();
  expect(speak.mock.calls[0][0].text).toBe('Activity introduction.');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Read page aloud' })));
  expect(screen.getByRole('button', { name: 'Read aloud' })).toHaveAttribute('aria-pressed', 'false');
  expect(speak.mock.calls[1][0].text).toBe('Document 1 page 2.');
  await startReading();
  expect(screen.getByRole('button', { name: 'Read page aloud' })).toHaveAttribute('aria-pressed', 'false');
  expect(speak.mock.calls[2][0].text).toBe('Activity introduction.');
  expect(cancel).toHaveBeenCalledTimes(2);
});

it('explains when the open PDF page has no extractable text', async () => {
  pdfText.mockResolvedValue({ items: [] });
  render(reading());
  await screen.findByText('Page 1 of 3');
  await startReading();
  expect(screen.getByRole('alert')).toHaveTextContent('No readable text was found on the open PDF page');
  expect(speak).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Read aloud' })).toHaveAttribute('aria-pressed', 'false');
});

it('reports a PDF that is still loading instead of silently skipping it', async () => {
  let resolveFile!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise(resolve => { resolveFile = resolve; }));
  render(reading());
  await startReading();
  expect(screen.getByRole('alert')).toHaveTextContent('The PDF is still loading');
  expect(speak).not.toHaveBeenCalled();
  await act(async () => resolveFile(new Response(new Uint8Array([1]), { status: 200 })));
  await screen.findByText('Page 1 of 3');
  await startReading();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(speak).toHaveBeenCalledOnce();
});

it('reports PDF text extraction errors and allows a retry', async () => {
  pdfText.mockRejectedValueOnce(new Error('Synthetic extraction failure'));
  render(reading());
  await screen.findByText('Page 1 of 3');
  await startReading();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not read this content aloud');
  expect(speak).not.toHaveBeenCalled();
  await startReading();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(speak).toHaveBeenCalledOnce();
});

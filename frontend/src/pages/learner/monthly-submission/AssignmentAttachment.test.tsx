import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssignmentAttachment } from './AssignmentAttachment';
// Preload the lazy viewer so module transformation is outside the UI timeout.
import { ComponentBody, InlineAttachmentPreview } from '../video-watch/page';

const pdf = vi.hoisted(() => ({ getPage: vi.fn(), cleanup: vi.fn() }));
const exportedPdf = vi.hoisted(() => ({ addPage: vi.fn(), addImage: vi.fn(), save: vi.fn() }));
vi.mock('jspdf', () => ({ jsPDF: class {
  addPage = exportedPdf.addPage;
  addImage = exportedPdf.addImage;
  save = exportedPdf.save;
} }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: 3, ...pdf }) }),
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  pdf.getPage.mockResolvedValue({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ cancel: vi.fn(), promise: Promise.resolve() }),
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('opens two instruction PDFs automatically with independent pages, zoom, and collapse', async () => {
  let finishSecond!: (response: Response) => void;
  const secondResponse = new Promise<Response>(resolve => { finishSecond = resolve; });
  // Separate response arrivals also verify that one pending PDF does not block the other.
  vi.mocked(fetch).mockImplementation(async input => String(input).includes('guide')
    ? secondResponse : new Response(new Uint8Array([1]), { status: 200 }));
  render(<>
    <AssignmentAttachment url="/brief.pdf" title="Brief" defaultExpanded pdfTools />
    <AssignmentAttachment url="/guide.pdf" title="Guide" defaultExpanded pdfTools />
  </>);
  await screen.findAllByRole('button', { name: 'Zoom in' });
  const [first, second] = screen.getAllByRole('region', { name: 'Assignment attachment' });
  expect(within(first).getByText('Page 1 of 3')).toBeVisible();
  expect(within(second).getByText('Loading PDF preview...')).toBeVisible();
  finishSecond(new Response(new Uint8Array([1]), { status: 200 }));
  expect(await within(second).findByText('Page 1 of 3')).toBeVisible();
  await waitFor(() => expect(first.querySelector('canvas')?.width).toBe(1500));
  fireEvent.click(within(first).getByRole('button', { name: 'Next page' }));
  expect(within(first).getByText('Page 2 of 3')).toBeVisible();
  expect(within(second).getByText('Page 1 of 3')).toBeVisible();
  fireEvent.click(within(first).getByRole('button', { name: 'Zoom in' }));
  expect(within(first).getByLabelText('PDF zoom level')).toHaveTextContent('120%');
  expect(within(second).getByLabelText('PDF zoom level')).toHaveTextContent('100%');
  await waitFor(() => expect(first.querySelector('canvas')?.width).toBe(1800));
  fireEvent.click(within(first).getByRole('button', { name: 'Fit width' }));
  expect(within(first).getByLabelText('PDF zoom level')).toHaveTextContent('100%');
  fireEvent.click(within(first).getByRole('button', { name: 'Hide preview' }));
  expect(first.querySelector('canvas')).toBeNull();
  expect(second.querySelector('canvas')).toBeVisible();
  expect(within(first).getByRole('link', { name: 'Download file' })).toHaveAttribute('href', '/brief.pdf');
  fireEvent.click(within(first).getByRole('button', { name: 'View file' }));
  expect(await within(first).findByText('Page 1 of 3')).toBeVisible();
});

it('keeps the other PDF available when one instruction file fails', async () => {
  vi.mocked(fetch).mockImplementation(async input => new Response(new Uint8Array([1]), { status: String(input).includes('missing') ? 404 : 200 }));
  render(<>
    <AssignmentAttachment url="/missing.pdf" title="Missing" defaultExpanded pdfTools />
    <AssignmentAttachment url="/guide.pdf" title="Guide" defaultExpanded pdfTools />
  </>);
  expect(await screen.findByText('File request failed (404)')).toBeVisible();
  expect(await screen.findByText('Page 1 of 3')).toBeVisible();
  expect(screen.getAllByRole('link', { name: 'Download file' })).toHaveLength(2);
});

it('keeps existing callers collapsed until they request a preview', () => {
  render(<AssignmentAttachment url="/brief.pdf" title="Brief" />);
  expect(screen.getByRole('button', { name: 'View file' })).toHaveAttribute('aria-expanded', 'false');
  expect(fetch).not.toHaveBeenCalled();
});

it('signals reading readiness only after the PDF canvas finishes rendering', async () => {
  let finishRender!: () => void;
  const rendering = new Promise<void>(resolve => { finishRender = resolve; });
  const renderPage = vi.fn(() => ({ cancel: vi.fn(), promise: rendering }));
  pdf.getPage.mockResolvedValue({
    getViewport: () => ({ width: 600, height: 800 }), render: renderPage,
  });
  const onReady = vi.fn();
  render(<InlineAttachmentPreview url="/reading.pdf" title="Reading" onReady={onReady} />);
  await waitFor(() => expect(renderPage).toHaveBeenCalled());
  expect(onReady).not.toHaveBeenCalled();
  await act(async () => finishRender());
  expect(onReady).toHaveBeenCalledOnce();
});

it.each(['reading', 'assignment', 'linked file'])('provides PDF reading tools by default for %s', async context => {
  const url = '/curriculum_api/curriculum/uploads/reading.pdf';
  if (context === 'assignment') {
    render(<AssignmentAttachment url={url} title="Reading" />);
    fireEvent.click(screen.getByRole('button', { name: 'View file' }));
  } else {
    render(<ComponentBody component={{ componentId: 'READ', type: 'reading',
      contentHtml: context === 'linked file' ? `<p>Reading guidance</p><a href="${url}">Reference PDF</a>` : '<p>Reading guidance</p>',
      resourceUrl: context === 'reading' ? url : undefined,
    } as never} contentKind="reading" parsed={null} title="Reading" onDuration={vi.fn()} onProgress={vi.fn()}
      onPlayingChange={vi.fn()} onEnded={vi.fn()} onUnsupported={vi.fn()} />);
    expect(screen.getByText('Reading guidance')).toBeVisible();
    if (context === 'linked file') fireEvent.click(screen.getByRole('button', { name: 'Preview file: Reference PDF' }));
  }
  fireEvent.click(await screen.findByRole('button', { name: 'Zoom in' }));
  expect(screen.getByRole('button', { name: 'Download highlighted PDF' })).toBeEnabled();
  expect(screen.getByLabelText('PDF zoom level')).toHaveTextContent('120%');
  fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
  expect(screen.getByLabelText('PDF zoom level')).toHaveTextContent('100%');
  expect(screen.getByRole('button', { name: 'Read page aloud' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Marker' }));
  expect(screen.getByRole('button', { name: 'Marker' })).toHaveAttribute('aria-pressed', 'true');
  const layer = screen.getByLabelText('PDF highlight layer');
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 } as DOMRect);
  Object.defineProperty(layer, 'setPointerCapture', { configurable: true, value: vi.fn() });
  vi.stubGlobal('PointerEvent', MouseEvent);
  fireEvent.pointerDown(layer, { clientX: 100, clientY: 100 });
  fireEvent.pointerUp(layer, { clientX: 300, clientY: 200 });
  expect(layer.querySelectorAll('rect')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Save marks' }));
  const storageKey = `kbc-reading:${context === 'reading' ? 'READ' : url}:pdf-highlights`;
  expect(JSON.parse(localStorage.getItem(storageKey)!)['1']).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(layer.querySelectorAll('rect')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(layer.querySelectorAll('rect')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Clear marks on this page' }));
  expect(layer.querySelectorAll('rect')).toHaveLength(0);
});

it('downloads every PDF page with its own highlights', async () => {
  localStorage.setItem('kbc-reading:/marked.pdf:pdf-highlights', JSON.stringify({
    1: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }],
    3: [{ x: 0.2, y: 0.3, width: 0.4, height: 0.2 }],
  }));
  const fillRect = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), fillRect } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,synthetic');
  render(<AssignmentAttachment url="/marked.pdf" title="Reading" defaultExpanded />);
  fireEvent.click(await screen.findByRole('button', { name: 'Download highlighted PDF' }));
  await waitFor(() => expect(exportedPdf.save).toHaveBeenCalledWith('marked-highlighted.pdf'));
  expect(exportedPdf.addPage).toHaveBeenCalledTimes(2);
  expect(exportedPdf.addImage).toHaveBeenCalledTimes(3);
  expect(fillRect.mock.calls).toEqual([[96, 256, 288, 128], [192, 384, 384, 256]]);
});

it('shows an export failure and allows retry without downloading a partial PDF', async () => {
  render(<AssignmentAttachment url="/marked.pdf" title="Reading" defaultExpanded />);
  const download = await screen.findByRole('button', { name: 'Download highlighted PDF' });
  await waitFor(() => expect(pdf.getPage).toHaveBeenCalled());
  pdf.getPage.mockRejectedValueOnce(new Error('Could not render export page'));
  fireEvent.click(download);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not render export page');
  expect(exportedPdf.save).not.toHaveBeenCalled();
  expect(download).toBeEnabled();
});

it('keeps highlighted downloads unavailable for a slide deck with downloads disabled', async () => {
  render(<ComponentBody component={{ componentId: 'SLIDES', type: 'slides', resourceUrl: '/slides.pdf', downloadAllowed: false } as never}
    contentKind="slides" parsed={null} title="Slides" onDuration={vi.fn()} onProgress={vi.fn()}
    onPlayingChange={vi.fn()} onEnded={vi.fn()} onUnsupported={vi.fn()} />);
  await screen.findByRole('button', { name: 'Zoom in' });
  expect(screen.queryByRole('button', { name: 'Download highlighted PDF' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Download deck' })).not.toBeInTheDocument();
});

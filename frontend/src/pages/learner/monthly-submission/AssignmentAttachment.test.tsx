import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssignmentAttachment } from './AssignmentAttachment';
// Preload the lazy viewer so module transformation is outside the UI timeout.
import '../video-watch/page';

const pdf = vi.hoisted(() => ({ getPage: vi.fn(), cleanup: vi.fn() }));
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

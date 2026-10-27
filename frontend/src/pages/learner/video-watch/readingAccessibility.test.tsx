import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { JourneyComponent } from '@/utils/learnerJourney';
import type { ModuleCatalogueItem } from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { LearnerPreview } from '@/pages/curriculum/module-builder/LearnerPreview';
import { ComponentBody } from './page';

const pdfText = vi.hoisted(() => vi.fn());
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({
    numPages: 2, cleanup: vi.fn(),
    getPage: async (page: number) => ({
      getViewport: () => ({ width: 600, height: 800 }),
      render: () => ({ cancel: vi.fn(), promise: Promise.resolve() }),
      getTextContent: () => pdfText(page),
    }),
  }) }),
}));
vi.mock('mammoth/mammoth.browser', () => ({ convertToHtml: async () => ({ value: '<p>Uploaded reading text.</p>' }) }));

const textContent = (text: string) => ({ items: [{ str: text, transform: [12, 0, 0, 12, 0, 700], height: 12, hasEOL: true }] });
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  pdfText.mockImplementation(async (page: number) => textContent(`Page ${page} reading text.`));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function reading(overrides: Partial<JourneyComponent> = {}) {
  return <ComponentBody component={{ componentId: 'TOOLS', type: 'reading', contentHtml: '<p>First <strong>important</strong> paragraph.</p><p>Second paragraph.</p>', ...overrides } as JourneyComponent}
    contentKind="reading" parsed={null} title="Reading" onDuration={vi.fn()} onProgress={vi.fn()}
    onPlayingChange={vi.fn()} onEnded={vi.fn()} onUnsupported={vi.fn()} />;
}
function selectText(root: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(root);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Highlight selection' }));
  fireEvent.click(screen.getByRole('button', { name: 'Highlight selection' }));
}
function changePreferences() {
  fireEvent.click(screen.getByRole('button', { name: 'Increase text size' }));
  fireEvent.change(screen.getByLabelText('Reading font'), { target: { value: 'sans' } });
  fireEvent.change(screen.getByLabelText('Reading colour mode'), { target: { value: 'cream' } });
  fireEvent.click(screen.getByRole('button', { name: 'Spacing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Letter gap' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reading ruler' }));
}
function expectPreferences(surface: HTMLElement) {
  expect(surface).toHaveStyle({ fontSize: '18px', fontFamily: 'Arial, Helvetica, sans-serif', backgroundColor: '#fff7dc', lineHeight: '1.9', letterSpacing: '0.05em' });
  expect(surface.querySelector('[data-reading-ruler]')).not.toBeNull();
}

it('updates, saves and restores every display preference for authored reading text', () => {
  const view = render(reading());
  changePreferences();
  expectPreferences(screen.getByRole('region', { name: 'Reading text' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  view.unmount();
  render(reading());
  expectPreferences(screen.getByRole('region', { name: 'Reading text' }));
  fireEvent.click(screen.getByRole('button', { name: 'Decrease text size' }));
  expect(screen.getByRole('region', { name: 'Reading text' })).toHaveStyle({ fontSize: '16px' });
  for (const colour of ['dark', 'monochrome', 'paper']) fireEvent.change(screen.getByLabelText('Reading colour mode'), { target: { value: colour } });
  expect(screen.getByRole('region', { name: 'Reading text' })).toHaveStyle({ backgroundColor: '#fff', color: '#1f2937' });
});

it('keeps the ruler relative to the reading area when the pointer moves over nested content', () => {
  render(reading());
  fireEvent.click(screen.getByRole('button', { name: 'Reading ruler' }));
  const surface = screen.getByRole('region', { name: 'Reading text' });
  const ruler = surface.querySelector('[data-reading-ruler]')!;
  expect(ruler).toBeVisible();
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
  fireEvent.mouseMove(screen.getByText('important'), { clientY: 200 });
  expect(ruler).toHaveStyle({ top: '82px' });
  Object.defineProperty(surface, 'scrollHeight', { configurable: true, value: 1000 });
  fireEvent.keyDown(surface, { key: 'ArrowDown' });
  expect(ruler).toHaveStyle({ top: '106px' });
  fireEvent.click(screen.getByRole('button', { name: 'Reading ruler' }));
  expect(surface.querySelector('[data-reading-ruler]')).toBeNull();
});

it('highlights across paragraphs without breaking their structure, and persists and clears the marks', () => {
  const view = render(reading());
  const content = screen.getByRole('region', { name: 'Reading text' }).querySelector('[data-reading-text]') as HTMLElement;
  selectText(content);
  expect(content.querySelectorAll('p')).toHaveLength(2);
  expect(content.querySelector('strong mark')).toHaveTextContent('important');
  expect(content.querySelector('mark p')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  view.unmount();
  render(reading());
  expect(screen.getByRole('region', { name: 'Reading text' }).querySelectorAll('mark')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Clear highlights' }));
  expect(screen.getByRole('region', { name: 'Reading text' }).querySelector('mark')).toBeNull();
});

it('does not carry text or preferences into a different activity in the same mounted viewer', () => {
  const view = render(reading());
  changePreferences();
  view.rerender(reading({ componentId: 'OTHER', contentHtml: '<p>Other activity.</p>' }));
  expect(screen.queryByText('important')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Reading text' })).toHaveStyle({ fontSize: '16px' });
});

it('applies all preferences to PDF text and retains independent page highlights across view changes and reload', async () => {
  const view = render(reading({ contentHtml: '', resourceUrl: '/book.pdf' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Text reading view' }));
  const surface = await screen.findByRole('region', { name: 'PDF text, page 1' });
  changePreferences();
  expectPreferences(surface);
  selectText(surface.querySelector('[data-reading-text]') as HTMLElement);
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  const next = await screen.findByRole('region', { name: 'PDF text, page 2' });
  expect(next.querySelector('mark')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Original PDF' }));
  expect(screen.getByRole('region', { name: 'Original PDF page' }).querySelector('canvas')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Text reading view' }));
  expect((await screen.findByRole('region', { name: 'PDF text, page 1' })).querySelector('mark')).toHaveTextContent('Page 1 reading text.');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  view.unmount();
  render(reading({ contentHtml: '', resourceUrl: '/book.pdf' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Text reading view' }));
  const restored = await screen.findByRole('region', { name: 'PDF text, page 1' });
  expectPreferences(restored);
  expect(restored.querySelector('mark')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Clear highlights' }));
  expect(restored.querySelector('mark')).toBeNull();
});

it.each(['extra', 'linked'])('passes preferences to %s PDF attachments', async kind => {
  render(reading({ contentHtml: kind === 'linked' ? '<a href="/extra.pdf">Extra PDF</a>' : '<p>Reading</p>',
    files: kind === 'extra' ? [{ url: '/extra.pdf', fileName: 'Extra.pdf', contentType: 'application/pdf', size: 1 }] : undefined,
  }));
  changePreferences();
  if (kind === 'linked') fireEvent.click(screen.getByRole('button', { name: 'Preview file: Extra PDF' }));
  expectPreferences(await screen.findByRole('region', { name: 'Original PDF page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Text reading view' }));
  expectPreferences(await screen.findByRole('region', { name: 'PDF text, page 1' }));
});

it.each(['txt', 'docx'])('applies and saves reading tools on uploaded %s text too', async extension => {
  vi.mocked(fetch).mockResolvedValue(new Response('Uploaded reading text.'));
  const view = render(reading({ contentHtml: '', resourceUrl: `/notes.${extension}` }));
  const surface = await screen.findByRole('region', { name: 'Reading attachment text' });
  changePreferences();
  expectPreferences(surface);
  selectText(surface.querySelector('[data-reading-text]') as HTMLElement);
  expect(surface.querySelector('mark')).toHaveTextContent('Uploaded reading text.');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  view.unmount();
  vi.mocked(fetch).mockResolvedValue(new Response('Uploaded reading text.'));
  render(reading({ contentHtml: '', resourceUrl: `/notes.${extension}` }));
  const restored = await screen.findByRole('region', { name: 'Reading attachment text' });
  expectPreferences(restored);
  expect(restored.querySelector('mark')).toHaveTextContent('Uploaded reading text.');
  fireEvent.click(screen.getByRole('button', { name: 'Clear highlights' }));
  expect(restored.querySelector('mark')).toBeNull();
});

it('reads a PDF page once when its extracted text is also visible', async () => {
  const speak = vi.fn();
  vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text; } });
  render(reading({ contentHtml: '', resourceUrl: '/spoken.pdf' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Text reading view' }));
  await screen.findByRole('region', { name: 'PDF text, page 1' });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Read aloud' })));
  expect(speak).toHaveBeenCalledOnce();
  expect(speak.mock.calls[0][0].text).toBe('Page 1 reading text.');
  await act(async () => speak.mock.calls[0][0].onend());
  expect(screen.getByRole('button', { name: 'Read aloud' })).toHaveAttribute('aria-pressed', 'false');
});

it('keeps two documents on the same page number isolated when saving PDF text highlights', async () => {
  let finishSecond!: (response: Response) => void;
  const second = new Promise<Response>(resolve => { finishSecond = resolve; });
  vi.mocked(fetch).mockImplementation(async input => String(input).includes('second') ? second : new Response(new Uint8Array([1])));
  const activity = reading({ contentHtml: '', resourceUrl: '/first.pdf', files: [
    { url: '/first.pdf', fileName: 'First.pdf', contentType: 'application/pdf', size: 1 },
    { url: '/second.pdf', fileName: 'Second.pdf', contentType: 'application/pdf', size: 1 },
  ] });
  render(activity);
  fireEvent.click(await screen.findByRole('button', { name: 'Text reading view' }));
  const first = await screen.findByRole('region', { name: 'PDF text, page 1' });
  selectText(first.querySelector('[data-reading-text]') as HTMLElement);
  await act(async () => finishSecond(new Response(new Uint8Array([1]))));
  const views = await screen.findAllByRole('button', { name: 'Text reading view' });
  fireEvent.click(views[1]);
  await waitFor(() => expect(screen.getAllByRole('region', { name: 'PDF text, page 1' })).toHaveLength(2));
  expect(screen.getAllByRole('region', { name: 'PDF text, page 1' })[1].querySelector('mark')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(localStorage.getItem('kbc-reading:TOOLS:/first.pdf:pdf-text-highlights')).toContain('data-learner-highlight');
  expect(localStorage.getItem('kbc-reading:/second.pdf:/second.pdf:pdf-text-highlights')).not.toContain('data-learner-highlight');
});

it('explains a scanned page and allows the learner to return to the original PDF', async () => {
  pdfText.mockResolvedValue({ items: [] });
  render(reading({ contentHtml: '', resourceUrl: '/scan.pdf' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Text reading view' }));
  expect(await screen.findByText(/Scanned pages need a text version/)).toHaveAttribute('role', 'status');
  fireEvent.click(screen.getByRole('button', { name: 'Original PDF' }));
  expect(screen.getByRole('region', { name: 'Original PDF page' }).querySelector('canvas')).toBeVisible();
});

it('shows extraction errors, allows retry and renders PDF markup as harmless text', async () => {
  pdfText.mockRejectedValueOnce(new Error('Synthetic extraction failure')).mockResolvedValue(textContent('<img src=x onerror=alert(1)>'));
  render(reading({ contentHtml: '', resourceUrl: '/retry.pdf' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Text reading view' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not extract text');
  fireEvent.click(screen.getByRole('button', { name: 'Retry text view' }));
  const surface = await screen.findByRole('region', { name: 'PDF text, page 1' });
  expect(surface).toHaveTextContent('<img src=x onerror=alert(1)>');
  expect(surface.querySelector('img')).toBeNull();
});

it('discards an old page extraction response after navigating to another PDF page', async () => {
  let finish!: (value: ReturnType<typeof textContent>) => void;
  pdfText.mockImplementation(page => page === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(textContent('Current page.')));
  render(reading({ contentHtml: '', resourceUrl: '/slow.pdf' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Text reading view' }));
  await waitFor(() => expect(pdfText).toHaveBeenCalledWith(1));
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('Current page.');
  await act(async () => finish(textContent('Stale page.')));
  expect(screen.queryByText('Stale page.')).not.toBeInTheDocument();
});

it('reports failed PDF annotation storage instead of displaying Saved', async () => {
  render(reading({ contentHtml: '', resourceUrl: '/full.pdf' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Text reading view' }));
  selectText((await screen.findByRole('region', { name: 'PDF text, page 1' })).querySelector('[data-reading-text]') as HTMLElement);
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key.endsWith('pdf-text-highlights')) throw new DOMException('Full', 'QuotaExceededError');
    original.call(this, key, value);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByRole('alert')).toHaveTextContent('some highlights could not be saved');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible();
});

it('uses the same working tools for staff Preview as learner without writing progress', async () => {
  const module = { title: 'Synthetic module', weekStructure: [{ id: 'W1', weekNumber: 1, title: 'Week', components: [{
    id: 'STAFF-READ', type: 'reading', title: 'Staff reading', settings: { readingContent: '<p>Preview reading.</p>', resourceUrl: '/preview.pdf' },
  }] }] } as unknown as ModuleCatalogueItem;
  render(<LearnerPreview module={module} onClose={vi.fn()} />);
  await screen.findByText('Preview reading.');
  changePreferences();
  expectPreferences(screen.getByRole('region', { name: 'Reading text' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Text reading view' }));
  expectPreferences(await screen.findByRole('region', { name: 'PDF text, page 1' }));
  expect(within(screen.getByRole('dialog')).getByText('Preview only. Progress, attendance and assessment results are not saved.')).toBeVisible();
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

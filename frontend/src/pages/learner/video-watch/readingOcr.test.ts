import { afterEach, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { extractScannedPage } from './readingOcr';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function pdfPage() {
  const render = { promise: Promise.resolve(), cancel: vi.fn() };
  const page = { getViewport: vi.fn(() => ({ width: 600, height: 800 })), render: vi.fn(() => render) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['pixels'], { type: 'image/jpeg' })));
  return { pdf: { getPage: vi.fn(async () => page) } as unknown as PDFDocumentProxy, page, render };
}

it('posts only the rendered page with authenticated CSRF protection', async () => {
  const { pdf, page } = pdfPage();
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'test-token' }))
    .mockResolvedValueOnce(Response.json({ text: 'Recognised text.' }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await extractScannedPage(pdf, 2, new AbortController().signal)).toBe('Recognised text.');
  expect(pdf.getPage).toHaveBeenCalledWith(2);
  expect(page.render).toHaveBeenCalledWith(expect.objectContaining({ background: '#ffffff' }));
  const [url, options] = fetchMock.mock.calls[1];
  expect(url).toBe('/learner_api/reading/ocr/');
  expect(options).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': 'test-token' } });
  expect([...options.body.keys()]).toEqual(['page']);
});

it('does not submit a page when CSRF authentication fails', async () => {
  const { pdf } = pdfPage();
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: 'Unauthenticated' }, { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(extractScannedPage(pdf, 1, new AbortController().signal)).rejects.toThrow('sign in');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('keeps the provider failure visible and prevents sending an aborted page', async () => {
  const { pdf } = pdfPage();
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'test-token' }))
    .mockResolvedValueOnce(Response.json({ error: 'Please retry later.' }, { status: 502 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(extractScannedPage(pdf, 1, new AbortController().signal)).rejects.toThrow('Please retry later.');
  fetchMock.mockClear();
  const controller = new AbortController();
  controller.abort();
  await expect(extractScannedPage(pdf, 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchMock).not.toHaveBeenCalled();
});

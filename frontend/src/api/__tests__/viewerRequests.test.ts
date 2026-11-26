import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '../cachedRequest';
import { fetchSlideDeck } from '../slideDeck';
import { fetchAttachmentResource, fetchPdfResource } from '../pdfResource';

beforeEach(() => clearAllCachedResources());
afterEach(() => { vi.unstubAllGlobals(); clearAllCachedResources(); });

it('shares slide mounts, survives caller cleanup, caches revisits and separates sources', async () => {
  const fetcher = vi.fn(async () => Response.json({ slides: [], slideCount: 0 }));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const first = fetchSlideDeck('/a.pptx', controller.signal);
  controller.abort();
  const next = fetchSlideDeck('/a.pptx');
  await expect(first).rejects.toHaveProperty('name', 'AbortError');
  await next;
  await fetchSlideDeck('/a.pptx');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await fetchSlideDeck('/b.pptx');
  expect(fetcher).toHaveBeenCalledTimes(2);
  clearAllCachedResources();
  await fetchSlideDeck('/a.pptx');
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('shares identical PDF mounts with independent bytes and respects no-store on revisit', async () => {
  const fetcher = vi.fn(async () => new Response('%PDF-example'));
  vi.stubGlobal('fetch', fetcher);
  const [a, b] = await Promise.all([fetchPdfResource('/learner/1/a.pdf'), fetchPdfResource('/learner/1/a.pdf')]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await a.text()).toBe('%PDF-example');
  expect(await b.text()).toBe('%PDF-example');
  await fetchPdfResource('/learner/2/a.pdf');
  await fetchPdfResource('/learner/1/a.pdf');
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('preserves empty PDF responses and retries failed slide reads', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  const response = await fetchPdfResource('/empty.pdf');
  expect(response.status).toBe(204);
  expect((await response.arrayBuffer()).byteLength).toBe(0);
  const fetcher = vi.fn(async () => Response.json({ error: 'Unavailable' }, { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(fetchSlideDeck('/bad')).rejects.toThrow('Unavailable');
  await expect(fetchSlideDeck('/bad')).rejects.toThrow('Unavailable');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('shares an authorized file error without sharing a consumable response stream', async () => {
  const fetcher = vi.fn(async () => Response.json({ error: 'This file is unavailable.' }, { status: 404 }));
  vi.stubGlobal('fetch', fetcher);
  const [first, second] = await Promise.all([fetchPdfResource('/missing.pdf'), fetchPdfResource('/missing.pdf')]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(first.status).toBe(404);
  expect(second.status).toBe(404);
  expect(await first.json()).toEqual({ error: 'This file is unavailable.' });
  expect(await second.json()).toEqual({ error: 'This file is unavailable.' });
});

it.each([204, 205, 304])('retains a bodyless file response (%s)', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
  const response = await fetchPdfResource('/bodyless.pdf');
  expect(response.status).toBe(status);
  expect((await response.arrayBuffer()).byteLength).toBe(0);
});

it('shares document preview mounts without merging different request headers', async () => {
  const fetcher = vi.fn(async () => new Response('document'));
  vi.stubGlobal('fetch', fetcher);
  const [a, b] = await Promise.all([fetchAttachmentResource('/a.docx'), fetchAttachmentResource('/a.docx')]);
  expect(await a.text()).toBe('document');
  expect(await b.text()).toBe('document');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await fetchPdfResource('/a.docx');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

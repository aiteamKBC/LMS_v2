import { afterEach, expect, it, vi } from 'vitest';
import { fetchAssignedLearners } from '../assignedLearners';
const target = { scope: 'module' as const, id: 'MOD-A', name: 'Module A' };
const page = { scope: 'module', id: 'MOD-A', status: 'active', total: 0, filteredTotal: 0, page: 1, pageSize: 25, learners: [] };
afterEach(() => vi.unstubAllGlobals());

it('uses one cookie-authenticated uncached GET per explicit call and no CSRF or count request', async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify(page), { status: 200 }));
  vi.stubGlobal('fetch', transport);
  expect(transport).not.toHaveBeenCalled();
  const controller = new AbortController();
  await fetchAssignedLearners(target, 'active', '', 1, controller.signal);
  expect(transport).toHaveBeenCalledTimes(1);
  const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain('/curriculum/learner-directory/learners/?scope=module&id=MOD-A');
  expect(init).toMatchObject({ credentials: 'include', cache: 'no-store', signal: controller.signal });
  await fetchAssignedLearners(target, 'active', '', 1, controller.signal);
  expect(transport).toHaveBeenCalledTimes(2);
});

it('passes cancellation to the real transport instead of only ignoring its response', async () => {
  const transport = vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  vi.stubGlobal('fetch', transport);
  const controller = new AbortController();
  const pending = fetchAssignedLearners(target, 'active', '', 1, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(transport).toHaveBeenCalledTimes(1);
});

it('keeps failures visible, makes no automatic retries and does not expose an HTML error response', async () => {
  const transport = vi.fn(async () => new Response('<html>Private proxy details</html>', { status: 503 }));
  vi.stubGlobal('fetch', transport);
  await expect(fetchAssignedLearners(target, 'active', '', 1, new AbortController().signal)).rejects.toThrow('Could not load assigned learners. Please retry.');
  expect(transport).toHaveBeenCalledTimes(1);
});

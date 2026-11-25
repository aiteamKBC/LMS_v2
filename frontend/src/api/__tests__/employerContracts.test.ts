import { afterEach, expect, it, vi } from 'vitest';
import { fetchEmployerContracts } from '../employerContracts';

afterEach(() => vi.unstubAllGlobals());

it('sends session credentials and cancellation to the owned contract endpoint', async () => {
  const body = { contracts: [], sources: { lms: 'ready' } };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  expect(await fetchEmployerContracts('8', 'commercial', '12', signal)).toEqual(body);
  expect(fetch).toHaveBeenCalledWith('/learner_api/employer-portal/8/learner/commercial/12/contracts/', { credentials: 'include', signal });
});

it('reports access and server errors instead of returning an empty contract list', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
  await expect(fetchEmployerContracts('8', 'apprenticeship', '11', new AbortController().signal)).rejects.toThrow('Could not load contracts');
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLearnerEntry } from './entry';
afterEach(() => vi.unstubAllGlobals());
describe('entry status response validation', () => {
  it.each([{}, null, { classification: 'new' }, { classification: 'existing', canAccess: true, required: true }])('rejects incomplete or inconsistent status: %j', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(fetchLearnerEntry()).rejects.toThrow('verify your learner profile');
  });
  it('does not classify a failed lookup as new', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Retry profile lookup' }), { status: 503 })));
    await expect(fetchLearnerEntry()).rejects.toThrow('Retry profile lookup');
  });
});

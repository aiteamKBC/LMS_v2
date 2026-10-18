import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCurriculumGetCache, fetchCurriculumJson } from '@/lib/curriculumApi';
import { getMigratedTemplate, listMigratedTemplates, previewMigratedDefinition } from './migratedReviewTemplates';

describe('managed template read transport', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { clearCurriculumGetCache(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { clearCurriculumGetCache(); vi.unstubAllGlobals(); });

  it('shares a StrictMode read without aborting transport when one subscriber leaves', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const first = listMigratedTemplates('', controller.signal).catch(error => error);
    controller.abort();
    const second = listMigratedTemplates();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal?.aborted).not.toBe(true);
    finish(Response.json({ templates: [], resolutions: [], can_manage: true }));
    expect((await first).name).toBe('AbortError');
    await expect(second).resolves.toMatchObject({ can_manage: true });
  });

  it('revalidates later opens and separates template ids', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 1, updated_at: 'before' }));
    await getMigratedTemplate(1);
    fetchMock.mockResolvedValueOnce(Response.json({ id: 1, updated_at: 'after' }));
    await expect(getMigratedTemplate(1)).resolves.toMatchObject({ updated_at: 'after' });
    fetchMock.mockResolvedValueOnce(Response.json({ id: 2 }));
    await expect(getMigratedTemplate(2)).resolves.toMatchObject({ id: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps access failures visible', async () => {
    fetchMock.mockResolvedValue(Response.json({ detail: 'Denied' }, { status: 403 }));
    await expect(listMigratedTemplates()).rejects.toThrow('Curriculum or administrator access is required');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('previews a definition without invalidating unrelated curriculum reads', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ csrf_token: 'synthetic', templates: [] }));
    await listMigratedTemplates();
    fetchMock.mockResolvedValueOnce(Response.json({ programme: { id: 'P1' } }));
    await fetchCurriculumJson('/curriculum/programmes/P1/detail/shell/');
    fetchMock.mockResolvedValue(Response.json({ sections: [], readOnly: true }));
    await previewMigratedDefinition({ sections: [] });
    await previewMigratedDefinition({ sections: [] });
    await expect(fetchCurriculumJson('/curriculum/programmes/P1/detail/shell/')).resolves.toMatchObject({ programme: { id: 'P1' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

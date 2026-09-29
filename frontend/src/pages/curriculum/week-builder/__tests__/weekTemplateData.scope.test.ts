import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCurriculumOverview } from '@/lib/curriculumApi';
import { loadCurriculumScope } from '../weekTemplateData';

vi.mock('@/lib/curriculumApi', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/curriculumApi')>();
  return {
    ...original,
    fetchCurriculumOverview: vi.fn(),
  };
});

describe('loadCurriculumScope freshness', () => {
  beforeEach(() => {
    vi.mocked(fetchCurriculumOverview).mockResolvedValue({
      programmes: [], cohorts: [], groups: [], modules: [],
    } as never);
  });

  it('passes force through to the API cache bypass', async () => {
    await loadCurriculumScope({ force: true });
    expect(fetchCurriculumOverview).toHaveBeenCalledWith(undefined, {
      compact: true,
      skipCache: true,
    });
  });
});

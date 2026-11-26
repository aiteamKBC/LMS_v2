import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchCurriculumModules, fetchCurriculumProgrammes } = vi.hoisted(() => ({
  fetchCurriculumModules: vi.fn(),
  fetchCurriculumProgrammes: vi.fn(),
}));

vi.mock('@/lib/curriculumApi', () => ({
  fetchCurriculumModules,
  fetchCurriculumProgrammes,
}));

vi.mock('@/hooks/useRefreshOnReturn', () => ({
  useLiveRefresh: vi.fn(),
}));

import { useCurriculumModules } from '../useCurriculumModules';
import { useCurriculumProgrammes } from '../useCurriculumProgrammes';

describe('curriculum list cache on mount', () => {
  beforeEach(() => {
    fetchCurriculumModules.mockResolvedValue([]);
    fetchCurriculumProgrammes.mockResolvedValue([]);
  });

  it('does not force a network revalidation on the initial module read', async () => {
    renderHook(() => useCurriculumModules({ compact: true, revalidate: true }));

    await waitFor(() => expect(fetchCurriculumModules).toHaveBeenCalled());
    expect(fetchCurriculumModules).toHaveBeenCalledWith(
      expect.any(AbortSignal),
      expect.objectContaining({ compact: true, revalidate: false }),
    );
  });

  it('does not force a network revalidation on the initial programme read', async () => {
    renderHook(() => useCurriculumProgrammes({ visibility: 'all', revalidate: true }));

    await waitFor(() => expect(fetchCurriculumProgrammes).toHaveBeenCalled());
    expect(fetchCurriculumProgrammes).toHaveBeenCalledWith(
      expect.any(AbortSignal),
      expect.objectContaining({ visibility: 'all', revalidate: false }),
    );
  });
});

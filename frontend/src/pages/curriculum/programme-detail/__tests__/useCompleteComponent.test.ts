import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumComponent } from '@/lib/curriculumApi';

/**
 * The programme page reads its components without their authored long text,
 * and the KSB placement preview is the one place that text is shown. These
 * pin the rule that a trimmed row is never shown as if it were complete: it
 * reads as loading until the full row lands, and as an error -- not as an
 * empty component -- when it cannot be loaded.
 */

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumComponents: vi.fn(),
}));

const trimmed = {
  id: 'COMP-1',
  moduleCatalogueId: 'MOD-1',
  title: 'Reading',
  type: 'Reading Material',
  duration: 10,
  status: 'published',
  contentSections: 1,
  settings: { videoUrl: '' },
  settingsOmitted: ['readingContent'],
} as unknown as CurriculumComponent;

const full = {
  ...trimmed,
  settings: { videoUrl: '', readingContent: '<p>The whole reading</p>' },
  settingsOmitted: undefined,
} as unknown as CurriculumComponent;

describe('useCompleteComponent', () => {
  beforeEach(async () => {
    const api = await import('@/lib/curriculumApi');
    vi.mocked(api.fetchCurriculumComponents).mockReset();
  });

  it('hands back a complete row as it is, without a request', async () => {
    const api = await import('@/lib/curriculumApi');
    const { useCompleteComponent } = await import('../useCompleteComponent');
    const complete = { ...full };
    const { result } = renderHook(() => useCompleteComponent(complete));
    expect(result.current.status).toBe('ready');
    expect(result.current.component).toBe(complete);
    expect(api.fetchCurriculumComponents).not.toHaveBeenCalled();
  });

  it('loads the full settings of a trimmed row from its own module only', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.mocked(api.fetchCurriculumComponents).mockResolvedValueOnce([full]);
    const { useCompleteComponent } = await import('../useCompleteComponent');
    const { result } = renderHook(() => useCompleteComponent(trimmed));

    expect(result.current.status).toBe('loading');
    expect(result.current.component).toBeUndefined();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(api.fetchCurriculumComponents).toHaveBeenCalledTimes(1);
    expect(api.fetchCurriculumComponents).toHaveBeenCalledWith(expect.any(AbortSignal), { moduleCatalogueIds: ['MOD-1'] });
    expect(result.current.component?.settings).toEqual({ videoUrl: '', readingContent: '<p>The whole reading</p>' });
    expect(result.current.component?.settingsOmitted).toBeUndefined();
  });

  it('reports a failed load as an error, never as an empty component, and retries on request', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.mocked(api.fetchCurriculumComponents)
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValueOnce([full]);
    const { useCompleteComponent } = await import('../useCompleteComponent');
    const { result } = renderHook(() => useCompleteComponent(trimmed));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Network down');
    expect(result.current.component).toBeUndefined();

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(api.fetchCurriculumComponents).toHaveBeenCalledTimes(2);
    expect(result.current.component?.settings?.readingContent).toBe('<p>The whole reading</p>');
  });

  it('reports a component that is no longer in its module instead of showing the trimmed row', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.mocked(api.fetchCurriculumComponents).mockResolvedValueOnce([{ ...full, id: 'COMP-OTHER' }]);
    const { useCompleteComponent } = await import('../useCompleteComponent');
    const { result } = renderHook(() => useCompleteComponent(trimmed));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.component).toBeUndefined();
  });

  it('does not refetch when the same row arrives as a new object', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.mocked(api.fetchCurriculumComponents).mockResolvedValue([full]);
    const { useCompleteComponent } = await import('../useCompleteComponent');
    const { result, rerender } = renderHook(({ row }) => useCompleteComponent(row), { initialProps: { row: trimmed } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ row: { ...trimmed } });
    rerender({ row: { ...trimmed } });
    expect(result.current.status).toBe('ready');
    expect(api.fetchCurriculumComponents).toHaveBeenCalledTimes(1);
  });
});

import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumModules } from '@/hooks/useCurriculumModules';
import { clearCurriculumGetCache } from '@/lib/curriculumApi';

/**
 * The curriculum wizard used to mount two independent modules loaders
 * (useCurriculumData with refreshModules, plus useCurriculumModules). Both
 * requested the identical full URL `/curriculum/modules/` and each carried its own
 * AbortSignal, so neither could join the in-flight GET map - every open paid for
 * two full-payload module fetches.
 *
 * These tests pin the request counts for both shapes so a second loader cannot be
 * reintroduced silently.
 */

const MODULES_PATH = '/curriculum/modules/';

function countModuleRequests(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls
    .map(call => String(call[0]))
    .filter(url => url.includes(MODULES_PATH) && !url.includes('resolve-structures'));
}

// Mirrors what the wizard mounts now: a single curriculum-data loader.
function SingleLoaderProbe() {
  const { loading } = useCurriculumData({ compact: true, includeHolidays: true, refreshModules: true });
  return <div data-testid="state">{loading ? 'loading' : 'ready'}</div>;
}

// Mirrors the old wizard: the same data loader plus a second modules loader.
function DualLoaderProbe() {
  const { loading } = useCurriculumData({ compact: true, includeHolidays: true, refreshModules: true });
  useCurriculumModules({ autoLoad: true });
  return <div data-testid="state">{loading ? 'loading' : 'ready'}</div>;
}

describe('wizard /modules/ request count', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let completed: string[];

  beforeEach(() => {
    completed = [];
    fetchMock = vi.fn((url: string, init: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        completed.push(String(url));
        resolve({
          ok: true,
          status: 200,
          json: async () => ({
            results: [],
            programmes: [], cohorts: [], groups: [], modules: [],
            components: [], holidays: [], sessions: [], stats: {},
          }),
        } as unknown as Response);
      }, 20);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    clearCurriculumGetCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('completes exactly one /modules/ request for a single loader', async () => {
    const { getByTestId } = render(
      <StrictMode>
        <SingleLoaderProbe />
      </StrictMode>,
    );
    await waitFor(() => expect(getByTestId('state').textContent).toBe('ready'));

    const completedModules = completed.filter(url => url.includes(MODULES_PATH));
    expect(completedModules).toHaveLength(1);
  });

  it('still completes one /modules/ request if a second loader is mounted', async () => {
    const { getByTestId } = render(
      <StrictMode>
        <DualLoaderProbe />
      </StrictMode>,
    );
    await waitFor(() => expect(getByTestId('state').textContent).toBe('ready'));

    const completedModules = completed.filter(url => url.includes(MODULES_PATH));
    expect(completedModules).toHaveLength(1);
  });

  it('requests the full module payload, never the compact one, for authoring', async () => {
    const { getByTestId } = render(
      <StrictMode>
        <SingleLoaderProbe />
      </StrictMode>,
    );
    await waitFor(() => expect(getByTestId('state').textContent).toBe('ready'));

    // The wizard ranks duplicate modules by component count, so it must keep
    // weekStructure: a compact response would silently report zero components.
    countModuleRequests(fetchMock).forEach(url => {
      expect(url).not.toContain('compact=true');
    });
  });
});

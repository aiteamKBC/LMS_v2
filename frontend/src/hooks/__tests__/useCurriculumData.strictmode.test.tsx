import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCurriculumData } from '@/hooks/useCurriculumData';

/**
 * Reproduces the duplicated request chain reported in the curriculum wizard:
 * under StrictMode the loader effect runs twice, and before the fix the caller's
 * AbortSignal never reached fetch(), so BOTH passes completed as full responses.
 */

function countByPath(mock: ReturnType<typeof vi.fn>) {
  const counts = new Map<string, number>();
  for (const call of mock.mock.calls) {
    const url = String(call[0]);
    const path = url.replace(/^.*\/curriculum\//, '').replace(/\?.*$/, '');
    counts.set(path, (counts.get(path) || 0) + 1);
  }
  return counts;
}

function Probe() {
  const { loading } = useCurriculumData({ compact: true, includeHolidays: true, refreshModules: true });
  return <div data-testid="state">{loading ? 'loading' : 'ready'}</div>;
}

describe('useCurriculumData under StrictMode', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let completed: string[];

  beforeEach(() => {
    completed = [];
    fetchMock = vi.fn((url: string, init: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
      // Resolve on a later tick so StrictMode's cleanup lands mid-flight, the way
      // a real network request behaves.
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('completes each endpoint only once even though the effect runs twice', async () => {
    const { getByTestId } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );

    await waitFor(() => expect(getByTestId('state').textContent).toBe('ready'));

    // StrictMode may *start* two passes; the aborted one must not complete.
    const completedCounts = new Map<string, number>();
    for (const url of completed) {
      const path = url.replace(/^.*\/curriculum\//, '').replace(/\?.*$/, '');
      completedCounts.set(path, (completedCounts.get(path) || 0) + 1);
    }

    const overCompleted = [...completedCounts.entries()].filter(([, n]) => n > 1);
    expect(
      overCompleted,
      `endpoints completed more than once: ${JSON.stringify(overCompleted)}`,
    ).toEqual([]);

    // Diagnostic: show what was attempted vs completed.
    console.log('attempted:', Object.fromEntries(countByPath(fetchMock)));
    console.log('completed:', Object.fromEntries(completedCounts));
  });
});

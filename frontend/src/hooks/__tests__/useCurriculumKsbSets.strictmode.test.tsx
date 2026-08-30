import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCurriculumKsbSets } from '@/hooks/useCurriculumKsbSets';
import { clearCurriculumGetCache } from '@/lib/curriculumApi';

function Probe() {
  const { ksbSets, loading, error } = useCurriculumKsbSets({ all: true });
  return <div data-testid="state">{error || (loading ? 'loading' : `ready:${ksbSets.length}`)}</div>;
}

describe('useCurriculumKsbSets under StrictMode', () => {
  beforeEach(() => {
    clearCurriculumGetCache();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => {
      window.setTimeout(() => resolve({
        ok: true,
        status: 200,
        json: async () => ({
          schema: 'curriculum-v1',
          count: 1,
          results: [{
            frameworkId: 'KSBP-1',
            programmeId: '',
            programmeName: 'Project manager',
            standard: 'Project manager',
            ksbs: [],
          }],
        }),
      } as Response), 20);
    })));
  });

  afterEach(() => {
    clearCurriculumGetCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('delivers the shared request to the second StrictMode effect', async () => {
    const { getByTestId } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );

    await waitFor(() => expect(getByTestId('state')).toHaveTextContent('ready:1'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

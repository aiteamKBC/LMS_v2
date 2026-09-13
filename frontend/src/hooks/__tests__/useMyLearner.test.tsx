import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  getRememberedLearner, rememberLearner, rememberSignedInLearner,
  useLinkedLearner, useMyLearner, useResolvedLearner,
} from '../useMyLearner';

const ownLearner = { kind: 'commercial', id: '499' };

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/learner/calendar?kind=apprenticeship&learner=125']}>{children}</MemoryRouter>;
}

beforeEach(() => {
  rememberSignedInLearner(undefined, undefined);
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  rememberSignedInLearner(undefined, undefined);
  localStorage.clear();
});

describe('signed-in learner identity', () => {
  it('keeps dashboard, sidebar and calendar on the account when an old link names another learner', () => {
    rememberSignedInLearner('learner', 499, 'commercial');
    const { result } = renderHook(() => ({
      dashboard: useResolvedLearner('apprenticeship', '125'),
      calendar: useLinkedLearner(),
      sidebar: useMyLearner(),
    }), { wrapper });

    expect(result.current).toEqual({ dashboard: ownLearner, calendar: ownLearner, sidebar: ownLearner });
    expect(getRememberedLearner()).toEqual(ownLearner);
  });

  it('ignores another tab overwriting the remembered learner', () => {
    rememberSignedInLearner('learner', 499, 'commercial');
    const { result, rerender } = renderHook(useMyLearner);
    localStorage.setItem('my_learner', JSON.stringify({ kind: 'commercial', id: '125' }));
    rerender();
    expect(result.current).toEqual(ownLearner);
    expect(getRememberedLearner()).toEqual(ownLearner);
  });

  it('does not let a late learner lookup replace the signed-in identity', () => {
    rememberSignedInLearner('learner', 499, 'commercial');
    rememberLearner('apprenticeship', '125');
    expect(getRememberedLearner()).toEqual(ownLearner);
  });

  it('uses the account even when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    rememberSignedInLearner('learner', 499, 'commercial');
    expect(renderHook(useMyLearner).result.current).toEqual(ownLearner);
  });

  it('updates the identity when a different learner signs in', () => {
    rememberSignedInLearner('learner', 499, 'commercial');
    rememberSignedInLearner('learner', 126, 'apprenticeship');
    expect(getRememberedLearner()).toEqual({ kind: 'apprenticeship', id: '126' });
  });

  it('lets staff follow explicit learner links after switching accounts', () => {
    rememberSignedInLearner('learner', 499, 'commercial');
    rememberSignedInLearner('staff', 13);
    const { result } = renderHook(() => useResolvedLearner('apprenticeship', '125'));
    expect(result.current).toEqual({ kind: 'apprenticeship', id: '125' });
    expect(getRememberedLearner()).toEqual(result.current);
  });

  it('releases the signed-in identity when the session ends', () => {
    rememberSignedInLearner('learner', 499, 'commercial');
    rememberSignedInLearner(undefined, undefined);
    rememberLearner('commercial', '125');
    expect(getRememberedLearner()).toEqual({ kind: 'commercial', id: '125' });
  });
});

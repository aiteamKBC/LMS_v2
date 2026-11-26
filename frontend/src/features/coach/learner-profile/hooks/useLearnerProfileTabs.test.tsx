import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resolveLearnerProfileTab, useLearnerProfileTabs } from './useLearnerProfileTabs';

describe('learner profile tab ownership', () => {
  it('keeps the legacy learning-plan alias and rejects unknown tabs', () => {
    expect(resolveLearnerProfileTab('learning-plan')).toBe('support');
    expect(resolveLearnerProfileTab('reviews')).toBe('reviews');
    expect(resolveLearnerProfileTab('unknown')).toBe('overview');
  });

  it('retains a user-selected tab until navigation requests a valid tab', () => {
    const { result, rerender } = renderHook(({ requested }) => useLearnerProfileTabs(requested), {
      initialProps: { requested: null as string | null },
    });
    act(() => result.current.setActiveTab('evidence'));
    rerender({ requested: 'unknown' });
    expect(result.current.activeTab).toBe('evidence');
    rerender({ requested: 'reviews' });
    expect(result.current.activeTab).toBe('reviews');
  });
});

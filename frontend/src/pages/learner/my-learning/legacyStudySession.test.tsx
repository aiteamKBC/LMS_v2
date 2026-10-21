import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeTrackingSession } from '@/api/timeTracking';
import { useLegacyStudySession } from './useLegacyStudySession';

const session = { trackingToken: 'signed-test-token', startedAt: '2026-10-21T10:00:00Z',
  sessionId: 'test-session', countingMode: 'visible_page' } as TimeTrackingSession;
const tick = (seconds: number) => act(() => { vi.advanceTimersByTime(seconds * 1000); });

describe('legacy study timing', () => {
  beforeEach(() => {
    localStorage.clear(); vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('only counts started, visible and unpaused time; saving and transfer freeze stop it', () => {
    const view = renderHook(({ enabled, saving }) => useLegacyStudySession('owner:course:material', enabled, saving),
      { initialProps: { enabled: true, saving: false } });
    tick(5); expect(view.result.current.draft).toBeNull();
    act(() => view.result.current.begin('attempt', session));
    tick(4); expect(view.result.current.draft?.elapsedSeconds).toBe(4);
    act(() => view.result.current.setPaused(true)); tick(5);
    expect(view.result.current.draft?.elapsedSeconds).toBe(4);
    act(() => view.result.current.setPaused(false));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange'))); tick(10);
    expect(view.result.current.draft?.elapsedSeconds).toBe(4);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange'))); tick(2);
    expect(view.result.current.draft?.elapsedSeconds).toBe(6);
    view.rerender({ enabled: true, saving: true }); tick(4);
    view.rerender({ enabled: false, saving: false }); tick(4);
    expect(view.result.current.draft?.elapsedSeconds).toBe(6);
  });

  it('requires audible playback for media-only activities', () => {
    const { result } = renderHook(() => useLegacyStudySession('media', true, false));
    act(() => result.current.begin('attempt', { ...session, countingMode: 'active_playback' }));
    tick(3); expect(result.current.draft?.elapsedSeconds).toBe(0);
    act(() => result.current.setPlaying(true)); tick(3);
    act(() => result.current.setPlaying(false)); tick(3);
    expect(result.current.draft?.elapsedSeconds).toBe(3);
  });

  it('keeps answers and time through reopening without mixing learner or activity identity', () => {
    const view = renderHook(({ key }) => useLegacyStudySession(key, true, false), { initialProps: { key: 'learner1:material1' } });
    act(() => view.result.current.begin('attempt1', session)); tick(3);
    act(() => { view.result.current.setAnswers(() => ({ q: ['a'] })); view.result.current.setConfirmed(true); });
    view.rerender({ key: 'learner2:material1' });
    expect(view.result.current.draft).toBeNull();
    view.rerender({ key: 'learner1:quiz1' });
    expect(view.result.current.draft).toBeNull();
    view.unmount();
    const reopened = renderHook(() => useLegacyStudySession('learner1:material1', true, false));
    expect(reopened.result.current.draft).toMatchObject({ attemptId: 'attempt1', elapsedSeconds: 3, answers: { q: ['a'] }, confirmed: true });
    act(() => reopened.result.current.clear());
    expect(localStorage.getItem('learner1:material1')).toBeNull();
  });

  it('stops timing when the workspace hides a previously opened activity', () => {
    const parent = document.createElement('div');
    const element = document.createElement('div'); parent.append(element); document.body.append(parent);
    const view = renderHook(() => useLegacyStudySession('hidden-panel', true, false, { current: element }));
    act(() => view.result.current.begin('attempt', session)); tick(2);
    parent.hidden = true; tick(5);
    expect(view.result.current.draft?.elapsedSeconds).toBe(2);
    parent.hidden = false; tick(2);
    expect(view.result.current.draft?.elapsedSeconds).toBe(4);
    view.unmount(); parent.remove();
  });
});

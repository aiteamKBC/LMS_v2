import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeTrackingSession } from '@/api/timeTracking';
import { useLegacyStudySession } from './useLegacyStudySession';

const session = { trackingToken: 'synthetic-audio-token', startedAt: '2026-11-06T10:00:00Z',
  sessionId: 'synthetic-audio-session', countingMode: 'active_playback' } as TimeTrackingSession;
const tick = (seconds: number) => act(() => { vi.advanceTimersByTime(seconds * 1000); });

describe('legacy podcast timing', () => {
  beforeEach(() => {
    localStorage.clear(); vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

  function podcast(playbackOnly = false) {
    const root = document.createElement('div');
    const audio = document.createElement('audio');
    Object.defineProperty(audio, 'paused', { configurable: true, writable: true, value: false });
    root.append(audio); document.body.append(root);
    const view = renderHook(({ key, enabled, suspended }) =>
      useLegacyStudySession(key, enabled, suspended, { current: root }, playbackOnly),
    { initialProps: { key: 'synthetic:podcast', enabled: true, suspended: false } });
    act(() => { view.result.current.begin('attempt', session); view.result.current.setPlaying(true); });
    return { ...view, root, audio };
  }

  function visibility(value: 'visible' | 'hidden') {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  }

  it('counts the audible podcast in another tab without losing its hidden interval', () => {
    const view = podcast();
    tick(2); visibility('hidden'); tick(60); visibility('visible'); tick(3);
    expect(view.result.current.draft?.elapsedSeconds).toBe(65);
    expect(JSON.parse(localStorage.getItem('synthetic:podcast')!).elapsedSeconds).toBe(65);
    view.unmount();
  });

  it('excludes muted, paused, seeking, buffering and ended intervals in the background', () => {
    const view = podcast(); visibility('hidden'); tick(2);
    for (const state of ['muted', 'paused', 'seeking', 'buffering', 'ended']) {
      if (state === 'muted') view.audio.muted = true;
      if (state === 'paused') Object.defineProperty(view.audio, 'paused', { value: true, configurable: true });
      if (state === 'seeking') Object.defineProperty(view.audio, 'seeking', { value: true, configurable: true });
      if (state === 'ended') Object.defineProperty(view.audio, 'ended', { value: true, configurable: true });
      act(() => { view.result.current.setPlaying(false); }); tick(10);
      view.audio.muted = false;
      Object.defineProperty(view.audio, 'paused', { value: false, configurable: true });
      Object.defineProperty(view.audio, 'seeking', { value: false, configurable: true });
      Object.defineProperty(view.audio, 'ended', { value: false, configurable: true });
      act(() => { view.result.current.setPlaying(true); });
    }
    view.audio.currentTime = 1305; view.audio.playbackRate = 2;
    tick(3);
    expect(view.result.current.draft?.elapsedSeconds).toBe(5);
    view.unmount();
  });

  it('stops background audio for a hidden activity, manual pause, saving or another learner', () => {
    const view = podcast(); visibility('hidden'); tick(2);
    view.root.hidden = true; tick(5); view.root.hidden = false;
    act(() => { view.result.current.setPaused(true); }); tick(5);
    act(() => { view.result.current.setPaused(false); });
    view.rerender({ key: 'synthetic:podcast', enabled: true, suspended: true }); tick(5);
    view.rerender({ key: 'synthetic:podcast', enabled: false, suspended: false }); tick(5);
    expect(view.result.current.draft?.elapsedSeconds).toBe(2);
    view.rerender({ key: 'another-learner:podcast', enabled: true, suspended: false }); tick(5);
    expect(view.result.current.draft).toBeNull();
    expect(JSON.parse(localStorage.getItem('synthetic:podcast')!).elapsedSeconds).toBe(2);
    view.unmount();
  });

  it('keeps visible-page and video-only timing restricted to the visible tab', () => {
    const video = podcast(true); tick(2); visibility('hidden'); tick(20);
    expect(video.result.current.draft?.elapsedSeconds).toBe(2);
    video.unmount(); visibility('visible');
    const reading = podcast();
    act(() => { reading.result.current.begin('reading', { ...session, countingMode: 'visible_page' }); });
    tick(2); visibility('hidden'); tick(20);
    expect(reading.result.current.draft?.elapsedSeconds).toBe(2);
    reading.unmount();
  });

  it.each(['visible', 'hidden'] as const)('uses elapsed seconds when a %s playback timer callback is delayed', state => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const view = podcast(); visibility(state);
    clock.mockReturnValue(5000); tick(1);
    expect(view.result.current.draft?.elapsedSeconds).toBe(5);
    view.unmount();
  });

  it('keeps the audible fraction before the tab is hidden', () => {
    const view = podcast(); tick(0.75); visibility('hidden'); tick(1);
    expect(view.result.current.draft?.elapsedSeconds).toBeCloseTo(1.75);
    view.unmount();
  });

  it('settles audible time when playback stops before a delayed callback fires', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const view = podcast(); visibility('hidden');
    clock.mockReturnValue(5000);
    Object.defineProperty(view.audio, 'paused', { value: true, configurable: true });
    act(() => { view.result.current.setPlaying(false); });
    expect(view.result.current.draft?.elapsedSeconds).toBe(5);
    clock.mockReturnValue(15000); tick(1);
    expect(view.result.current.draft?.elapsedSeconds).toBe(5);
    view.unmount();
  });

  it('does not settle a hidden video interval as playback time', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const view = podcast(true); visibility('hidden');
    clock.mockReturnValue(5000);
    act(() => { view.result.current.setPlaying(false); });
    expect(view.result.current.draft?.elapsedSeconds).toBe(0);
    view.unmount();
  });
});

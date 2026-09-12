import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useLearningStatements } from './useLearningStatements';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('only generates on explicit request after reaching the word minimum', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ whatYouLearned: 'Generated knowledge', understood: 'Generated understanding', gainedSkills: 'Generated skills' }) });
  vi.stubGlobal('fetch', fetch);
  const apply = vi.fn();
  const { result } = renderHook(() => useLearningStatements('word '.repeat(120), '1', 'commercial', 'A', true,
    { whatYouLearned: 'My own statement', understood: '', gainedSkills: '' }, apply));
  await act(async () => { await vi.advanceTimersByTimeAsync(1900); });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { await result.current.generate(); });
  expect(apply).toHaveBeenCalledWith({ whatYouLearned: 'Generated knowledge', understood: 'Generated understanding', gainedSkills: 'Generated skills' });
});
it('does not send incomplete or locked answers', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  renderHook(() => useLearningStatements('Short answer', '1', 'commercial', 'A', true,
    { whatYouLearned: '', understood: '', gainedSkills: '' }, vi.fn()));
  renderHook(() => useLearningStatements('word '.repeat(120), '1', 'commercial', 'A', false,
    { whatYouLearned: '', understood: '', gainedSkills: '' }, vi.fn()));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(fetch).not.toHaveBeenCalled();
});

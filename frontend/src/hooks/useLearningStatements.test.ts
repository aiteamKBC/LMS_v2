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

it('keeps written statements when generation returns empty or whitespace-only fields', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ whatYouLearned: '', understood: '  ', gainedSkills: '\n' }) }));
  const apply = vi.fn();
  const { result } = renderHook(() => useLearningStatements('word '.repeat(120), '1', 'commercial', 'A', true,
    { whatYouLearned: 'Written knowledge', understood: 'Written understanding', gainedSkills: 'Written skills' }, apply));
  await act(async () => { await result.current.generate(); });
  expect(apply).not.toHaveBeenCalled();
  expect(result.current.status).toContain('existing answers have been kept');
});

it('applies supported fields while retaining empty results and edits made during the request', async () => {
  let finish!: (value: unknown) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve; })));
  const apply = vi.fn();
  const initial = { whatYouLearned: 'Written knowledge', understood: 'Written understanding', gainedSkills: 'Written skills' };
  const { result, rerender } = renderHook(({ current }) => useLearningStatements('word '.repeat(120), '1', 'apprenticeship', 'A', true, current, apply),
    { initialProps: { current: initial } });
  let pending!: Promise<void>;
  act(() => { pending = result.current.generate(); });
  rerender({ current: { ...initial, whatYouLearned: 'A newer manual edit' } });
  await act(async () => {
    finish({ ok: true, json: async () => ({ whatYouLearned: 'Outdated suggestion', understood: '', gainedSkills: 'Supported skills' }) });
    await pending;
  });
  expect(apply).toHaveBeenCalledWith({ gainedSkills: 'Supported skills' });
});

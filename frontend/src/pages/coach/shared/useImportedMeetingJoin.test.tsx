import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { startMigratedReview, type ReviewInstanceFormDefinition } from '@/api/reviewInstances';
import { useImportedMeetingJoin } from './useImportedMeetingJoin';

vi.mock('@/api/reviewInstances', () => ({ startMigratedReview: vi.fn() }));
const event = { id: '42', eventKey: 'legacy-calendar:71', calendarEventKey: 'legacy-calendar:71',
  reviewSource: 'aptem', status: 'scheduled', meetingLink: 'https://example.invalid/teams' };
const result = { instance: { id: 'imported-review:900', status: 'in-progress' }, localStatus: 'in-progress' } as ReviewInstanceFormDefinition;
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'open').mockReturnValue(null); });

it('uses the exact server calendar association, never the display ID, and coalesces pending starts', async () => {
  let finish!: (value: ReviewInstanceFormDefinition) => void;
  vi.mocked(startMigratedReview).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const onStarted = vi.fn(), onError = vi.fn();
  const { result: hook } = renderHook(() => useImportedMeetingJoin({ contextKey: 'coach', readOnly: false, onStarted, onError }));
  expect(startMigratedReview).not.toHaveBeenCalled();
  act(() => { hook.current(event); hook.current(event); });
  expect(window.open).toHaveBeenCalledTimes(2);
  expect(startMigratedReview).toHaveBeenCalledExactlyOnceWith('legacy-calendar:71', expect.objectContaining({ calendarEventKey: 'legacy-calendar:71' }));
  await act(async () => finish(result));
  expect(onStarted).toHaveBeenCalledWith(event, result);
});

it('keeps navigation and reports a failed start without a success callback', async () => {
  vi.mocked(startMigratedReview).mockRejectedValue(new Error('Booking changed'));
  const onStarted = vi.fn(), onError = vi.fn();
  const { result: hook } = renderHook(() => useImportedMeetingJoin({ contextKey: 'coach', readOnly: false, onStarted, onError }));
  act(() => hook.current(event));
  expect(window.open).toHaveBeenCalledOnce();
  await waitFor(() => expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('Booking changed')));
  expect(onStarted).not.toHaveBeenCalled();
});

it.each(['curriculum', 'lecture'])('does not change %s joins', reviewSource => {
  const { result: hook } = renderHook(() => useImportedMeetingJoin({ contextKey: 'coach', readOnly: false, onStarted: vi.fn(), onError: vi.fn() }));
  act(() => hook.current({ ...event, reviewSource }));
  expect(window.open).toHaveBeenCalledOnce();
  expect(startMigratedReview).not.toHaveBeenCalled();
});

it.each(['completed', 'awaiting-signature', 'submitted', 'not-scheduled'])('does not start %s reviews', status => {
  const { result: hook } = renderHook(() => useImportedMeetingJoin({ contextKey: 'coach', readOnly: false, onStarted: vi.fn(), onError: vi.fn() }));
  act(() => hook.current({ ...event, status }));
  expect(window.open).toHaveBeenCalledOnce();
  expect(startMigratedReview).not.toHaveBeenCalled();
});

it('preserves link navigation and fences a response after Coach/view-as changes', async () => {
  let finish!: (value: ReviewInstanceFormDefinition) => void;
  vi.mocked(startMigratedReview).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const onStarted = vi.fn(), onError = vi.fn();
  const { result: hook, rerender } = renderHook(({ contextKey, readOnly }) => useImportedMeetingJoin({ contextKey, readOnly, onStarted, onError }),
    { initialProps: { contextKey: 'coach-one', readOnly: false } });
  act(() => hook.current(event, false));
  expect(window.open).not.toHaveBeenCalled();
  rerender({ contextKey: 'coach-two', readOnly: true });
  await act(async () => finish(result));
  expect(onStarted).not.toHaveBeenCalled();
  act(() => hook.current(event));
  expect(startMigratedReview).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('viewing as'));
});

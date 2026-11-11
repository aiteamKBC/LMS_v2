import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { subjectRequest, type SubjectMaterial } from '@/api/studentActivity';
import { StudentMaterial } from './StudentMaterial';

vi.mock('@/api/studentActivity', () => ({ subjectRequest: vi.fn() }));
vi.mock('../video-watch/page', () => ({ InlineAttachmentPreview: () => <div>Document preview</div> }));

beforeEach(() => {
  localStorage.clear(); vi.useFakeTimers(); vi.resetAllMocks();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['commercial', 'apprenticeship'])('saves actual %s audio listening across tab changes, excluding pauses and seeks', async kind => {
  const data: SubjectMaterial = {
    title: 'Synthetic podcast', reading_html: '', media: [{ kind: 'audio', title: 'Synthetic audio', url: 'https://example.test/podcast.mp3' }],
    quiz: null, has_reading: false, available: true, source_live: false, persistence_ready: true,
    can_attempt: true, csrf_token: 'synthetic-csrf', completed: false, history: [],
    historical: { score: null, maximum_score: null, passed: null, attempt_number: null, status: null, answers: [] },
  };
  const requests = vi.mocked(subjectRequest);
  requests.mockImplementation(async <T,>(url: string, options?: RequestInit): Promise<T> => {
    if (options?.method !== 'POST') return data as T;
    if (url.endsWith('/attempts/')) return { attempt_id: 'synthetic-attempt', definition: {},
      timing: { trackingToken: 'synthetic-token', startedAt: '2026-11-06T10:00:00Z', countingMode: 'active_playback' } } as T;
    return { completed: true, study_time: { verifiedSeconds: 1305 } } as T;
  });
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<StudentMaterial kind={kind} learnerId="9" groupId={50} activityId={60} />); });
  expect(screen.getByText('Time counts during audible playback, including in another tab.')).toBeVisible();
  const audio = view.container.querySelector('audio')!;
  Object.defineProperty(audio, 'paused', { configurable: true, writable: true, value: false });
  const tick = (seconds: number) => act(() => { vi.advanceTimersByTime(seconds * 1000); });
  fireEvent.playing(audio); tick(774);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange')); tick(200);
  fireEvent.pause(audio); tick(30);
  fireEvent.playing(audio); fireEvent.seeking(audio); tick(30);
  audio.currentTime = 1305;
  fireEvent.seeked(audio); tick(331);
  fireEvent.ended(audio);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  expect(screen.getByRole('timer')).toHaveAccessibleName('Time on this activity: 00 hours, 21 minutes, 45 seconds');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Finish' })); });
  const saves = requests.mock.calls.filter(([url, options]) => url.endsWith('/synthetic-attempt/') && options?.method === 'POST');
  expect(saves).toHaveLength(1);
  expect(JSON.parse(saves[0][1]!.body as string)).toMatchObject({ timeTakenSeconds: 1305, trackingToken: 'synthetic-token' });
});

import { weeklyResourceFixture } from '@/test/weeklyContractFixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '../cachedRequest';
import { primeWeeklyLearningWeek, peekWeeklyLearningWeek, fetchWeeklyLearningWeek } from '../weeklyLearning';
import { weeklyContractFixture } from '@/test/weeklyContractFixture';
import { saveLearningReflectionSubmission } from '../reflectionSubmission';
import { confirmMeetingAttendance } from '../meetingAttendance';
import { confirmAttendance } from '../attendanceLectures';
import { submitAbsenceReport } from '../absenceReports';
import { subjectRequest } from '../studentActivity';
import { submitComponentProgress } from '../components';
import { submitVideoProgress } from '../videos';
import { submitQuizAttempt, completeQuizReading } from '../quizzes';

const payload = () => weeklyContractFixture({ weekId: 'slot:M1:1', moduleId: 'M1', components: [], quizAttempts: [] });
const cached = (id = '201') => peekWeeklyLearningWeek('commercial', id, 'M1', 'slot:M1:1');
beforeEach(() => {
  clearAllCachedResources();
  for (const id of ['201', '202']) primeWeeklyLearningWeek('commercial', id, weeklyResourceFixture(payload(), id));
});
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('successful mutation invalidation', () => {
  const cases = [
    ['component completion', () => submitComponentProgress('C1', 'commercial', '201', {} as Parameters<typeof submitComponentProgress>[3])],
    ['video completion', () => submitVideoProgress('C1', 'commercial', '201', {} as Parameters<typeof submitVideoProgress>[3])],
    ['quiz completion', () => submitQuizAttempt(7, 'commercial', '201', {} as Parameters<typeof submitQuizAttempt>[3])],
    ['quiz reading', () => completeQuizReading(7, 'commercial', '201', 1, 'synthetic', 60, 'timer')],
    ['reflection', () => saveLearningReflectionSubmission({ learnerKind: 'commercial', learnerId: '201' } as Parameters<typeof saveLearningReflectionSubmission>[0])],
    ['meeting attendance', () => confirmMeetingAttendance('commercial', '201', 'O1', 'synthetic')],
    ['lecture attendance', () => confirmAttendance('commercial', '201', 'L1')],
    ['absence', () => submitAbsenceReport('commercial', '201', new FormData())],
    ['imported activity', () => subjectRequest('/learner_api/student-activity/commercial/201/1/2/attempts/', { method: 'POST' })],
  ] as const;
  it.each(cases.slice(0, 3))('%s keeps an unrelated cached week valid', async (_name, mutate) => {
    for (const [number, componentId, quizId] of [[1, 'C1', 7], [2, 'C2', 8]] as const) {
      primeWeeklyLearningWeek('commercial', '201', weeklyResourceFixture(weeklyContractFixture({
        weekId: `slot:M1:${number}`, moduleId: 'M1',
        components: [{ componentId, type: 'quiz', isQuiz: true, quizMeta: { quizId }, contentAvailable: true }], quizAttempts: [],
      }), '201'));
    }
    const independent = peekWeeklyLearningWeek('commercial', '201', 'M1', 'slot:M1:2');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'completed' }))));
    await mutate();
    expect(cached()).toBeUndefined();
    expect(peekWeeklyLearningWeek('commercial', '201', 'M1', 'slot:M1:2')).toBe(independent);
  });
  it.each(cases)('%s clears the affected learner and keeps another learner cached', async (_name, mutate) => {
    vi.stubGlobal('fetch', vi.fn(async (url, options) => new Response(JSON.stringify(
      String(url).includes('/lectures/') ? { lectures: [], csrfToken: 'synthetic' }
        : options?.method === 'POST' ? { id: 'saved', status: 'completed', lectureId: 'L1', creditedMinutes: 30, creditedHours: 0.5 }
          : payload()))));
    const other = cached('202');
    expect(cached()).toBeDefined();
    await mutate();
    expect(cached()).toBeUndefined();
    expect(cached('202')).toBe(other);
    await fetchWeeklyLearningWeek('commercial', '201', 'M1', 'slot:M1:1');
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/weekly/'));
    expect(calls).toHaveLength(1);
    await fetchWeeklyLearningWeek('commercial', '201', 'M1', 'slot:M1:1');
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/weekly/'))).toHaveLength(1);
  });
  it('failed mutations retain valid snapshots', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })));
    const before = cached();
    await expect(confirmMeetingAttendance('commercial', '201', 'O1', 'synthetic')).rejects.toThrow('Forbidden');
    expect(cached()).toBe(before);
  });
});

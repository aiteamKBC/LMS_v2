import { createCachedResource } from '@/api/cachedRequest';
import { fetchCoachAttendanceDetails } from './attendanceApi';
import type { CoachAttendanceDetailsPayload } from '../types/attendance.types';

type Request = { controller: AbortController; users: number };
const requests = new Map<string, Request>();
const keys = new Set<string>();
const resource = createCachedResource<CoachAttendanceDetailsPayload>(
  'coach-attendance-detail',
  key => {
    const [, , learnerId, page, pageSize] = JSON.parse(key) as [string, string, string, number, number];
    const request: Request = { controller: new AbortController(), users: 0 };
    requests.set(key, request);
    return fetchCoachAttendanceDetails(learnerId, request.controller.signal, page, pageSize)
      .then(details => {
        if (!details.learner) throw new Error('Learner attendance record was not found.');
        return details;
      })
      .finally(() => {
        if (requests.get(key) === request) requests.delete(key);
      });
  },
  60_000,
);

export function attendanceDetailKey(scope: string, learnerId: string, page = 1, pageSize = 20): string {
  return JSON.stringify(['attendance-detail', scope, learnerId, page, pageSize]);
}

export function acquireAttendanceDetail(key: string) {
  keys.add(key);
  const promise = resource.read(key);
  const request = requests.get(key);
  if (request) request.users += 1;
  let released = false;
  return {
    promise,
    release() {
      if (released || !request) return;
      released = true;
      request.users -= 1;
      // StrictMode replays effects synchronously. Give the replacement consumer
      // a chance to retain this request before treating cleanup as navigation.
      queueMicrotask(() => {
        if (request.users === 0 && requests.get(key) === request) {
          requests.delete(key);
          resource.invalidate(key);
          request.controller.abort();
        }
      });
    },
  };
}

export function invalidateAttendanceDetail(key: string) {
  const [, scope, learnerId] = JSON.parse(key) as string[];
  // Existing saves affect totals and ordering across every cached page.
  for (const candidate of keys) {
    const [, owner, learner] = JSON.parse(candidate) as string[];
    if (owner === scope && learner === learnerId && !requests.has(candidate)) {
      resource.invalidate(candidate);
      keys.delete(candidate);
    }
  }
}

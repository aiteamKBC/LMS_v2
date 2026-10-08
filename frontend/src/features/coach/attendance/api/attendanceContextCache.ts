import { createCachedResource } from '@/api/cachedRequest';
import { fetchAttendanceContext, type AttendanceContextPayload } from './attendanceApi';

type Request = { controller: AbortController; users: number };
const requests = new Map<string, Request>();
const resource = createCachedResource<AttendanceContextPayload>('coach-attendance-context', key => {
  const [, programmeId, groupId] = JSON.parse(key) as string[];
  const request: Request = { controller: new AbortController(), users: 0 };
  requests.set(key, request);
  return fetchAttendanceContext(programmeId, groupId, request.controller.signal).finally(() => {
    if (requests.get(key) === request) requests.delete(key);
  });
}, 60_000);

export function attendanceContextKey(scope: string, programmeId: string, groupId: string) {
  return JSON.stringify([scope, programmeId, groupId]);
}

export function acquireAttendanceContext(key: string) {
  const promise = resource.read(key);
  const request = requests.get(key);
  if (request) request.users += 1;
  let released = false;
  return { promise, release() {
    if (released || !request) return;
    released = true;
    request.users -= 1;
    queueMicrotask(() => {
      if (request.users === 0 && requests.get(key) === request) {
        requests.delete(key);
        resource.invalidate(key);
        request.controller.abort();
      }
    });
  } };
}

export const invalidateAttendanceContext = (key: string) => resource.invalidate(key);

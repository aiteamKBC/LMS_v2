import { learningFetch } from '@/lib/personalLearning';
import { synchronizeTrackingClock } from '@/lib/trackingClock';
export type TrackingActivityKind = 'quiz' | 'video' | 'component';
export type TrackingCountingMode = 'active_quiz' | 'active_playback' | 'visible_page';

export interface TimeTrackingSession {
  rewardTracking?: boolean;
  trackingToken: string;
  startedAt: string;
  sessionId: string;
  countingMode: TrackingCountingMode;
}

export async function startTimeTracking(
  activityKind: TrackingActivityKind,
  activityId: string | number,
  kind: 'commercial' | 'apprenticeship',
  learnerId: string,
  countingMode: TrackingCountingMode,
): Promise<TimeTrackingSession> {
  const response = await learningFetch(
    `/learner_api/time-tracking/start/?kind=${kind}&learnerId=${encodeURIComponent(learnerId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ activityKind, activityId: String(activityId), countingMode }),
    },
  );
  const text = await response.text();
  let data: (TimeTrackingSession & { error?: string }) | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`The server returned an unexpected response (${response.status}).`);
  }
  if (!response.ok || !data) {
    throw new Error(data?.error || `Could not start activity timing (${response.status}).`);
  }
  if (data.rewardTracking) synchronizeTrackingClock(data);
  return data;
}

/** Re-anchor a restored signed session without recreating it or its observations. */
export async function resumeTimeTracking(session: TimeTrackingSession, activityKind: TrackingActivityKind, activityId: string) {
  if (!session.rewardTracking) return session;
  await synchronizeTimeTrackingClock(session, activityKind, activityId);
  return session;
}

/** Confirm the signed session's current server offset without replacing it. */
export async function synchronizeTimeTrackingClock(session: TimeTrackingSession, activityKind: TrackingActivityKind, activityId: string): Promise<number> {
  const response = await learningFetch('/learner_api/time-tracking/clock/', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ trackingToken: session.trackingToken, activityKind, activityId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Study timing could not synchronize. Your draft is kept.');
  if (data.sessionId !== session.sessionId || !Number.isSafeInteger(data.elapsedMilliseconds)) {
    throw new Error('The LMS did not confirm the timing session. Your draft is kept.');
  }
  synchronizeTrackingClock(session, data.elapsedMilliseconds);
  return data.elapsedMilliseconds;
}

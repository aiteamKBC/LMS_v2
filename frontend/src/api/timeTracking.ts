export type TrackingActivityKind = 'quiz' | 'video' | 'component';
export type TrackingCountingMode = 'active_quiz' | 'active_playback' | 'visible_page';

export interface TimeTrackingSession {
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
  const response = await fetch(
    `/learner_api/time-tracking/start/?kind=${kind}&learnerId=${encodeURIComponent(learnerId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  return data;
}

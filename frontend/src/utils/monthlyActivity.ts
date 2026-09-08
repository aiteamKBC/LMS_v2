import { reportedTimeMinutes } from './reportedTime';

export type ActivityType = 'quiz' | 'video' | 'learning' | 'coaching' | 'review';

export interface MonthActivity {
  id: string;
  activityKey?: string;
  attemptNumber?: number;
  attemptCount?: number;
  at: string;
  type: ActivityType;
  title: string;
  action: string;
  detail?: string;
  module?: string | null;
  week?: string | null;
  duration?: string | null;
  reportedTime?: string | null;
  loggedMinutes?: number;
  ksbs: string[];
  feedback?: string | null;
  status?: string;
  score?: number;
  passed?: boolean;
  coach?: string;
  notes?: string;
  meetingLink?: string;
}

/** Keep one row per activity: its highest logged attempt plus an attempt note. */
export function collapseRepeatedActivities(activities: MonthActivity[]): MonthActivity[] {
  const grouped = new Map<string, MonthActivity[]>();
  const standalone: MonthActivity[] = [];

  for (const activity of activities) {
    if (!activity.activityKey) {
      standalone.push(activity);
      continue;
    }
    grouped.set(activity.activityKey, [...(grouped.get(activity.activityKey) || []), activity]);
  }

  const collapsed = Array.from(grouped.values()).map((attempts) => {
    const best = attempts.reduce((current, candidate) => {
      const currentMinutes = current.loggedMinutes ?? reportedTimeMinutes(current.reportedTime) ?? -1;
      const candidateMinutes = candidate.loggedMinutes ?? reportedTimeMinutes(candidate.reportedTime) ?? -1;
      if (candidateMinutes > currentMinutes) return candidate;
      if (candidateMinutes === currentMinutes && candidate.at > current.at) return candidate;
      return current;
    });
    const attemptCount = Math.max(
      attempts.length,
      ...attempts.map((attempt) => attempt.attemptNumber || 1),
    );
    return {
      ...best,
      action: attemptCount > 1
        ? best.type === 'video' ? 'Watched video'
          : best.type === 'quiz' ? 'Completed quiz'
            : best.action
        : best.action,
      attemptCount,
      ksbs: Array.from(new Set(attempts.flatMap((attempt) => attempt.ksbs))),
      passed: attempts.some((attempt) => attempt.passed === true)
        ? true
        : best.passed,
    };
  });

  return [...collapsed, ...standalone]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

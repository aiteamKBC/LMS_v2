import rules from '../../../../../backend/coach_api/journey_rules.json';
import type { ActivityStatus } from './activityState';
import type { StudentActivityItem } from '@/api/studentActivity';

/** Shared decision table; Python and the legacy Coach adapter use the same rules. */
export function journeyStatus(kind: 'native' | 'module', facts: Record<string, boolean>): ActivityStatus {
  return (rules[kind].find(([fact]) => facts[fact])?.[1] || rules.default) as ActivityStatus;
}

export function historicalJourneyStarted(item?: StudentActivityItem) {
  const status = item?.status?.trim().toLowerCase().replace(/[\s-]+/g, '_') || '';
  return Boolean(item?.video_started || item?.reading_viewed || item?.quiz_attempted
    || (item?.new_attempt_count ?? 0) > 0 || rules.historicalStartedStatuses.includes(status));
}

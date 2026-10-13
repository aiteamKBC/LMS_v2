import type { AdvancedAdminCoachingSession, AdvancedAdminReview } from '@/api/advancedAdmin';

type Family = 'pr' | 'mcm';
type Reviews = Record<Family, AdvancedAdminReview[]>;

function businessDay(value: string | null | undefined) {
  if (!value) return '';
  if (!value.includes('T')) return value.slice(0, 10);
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Match only one review to one session for the same scoped learner, family and day. */
export function matchCoachingSessions(reviews: Reviews, sessions: AdvancedAdminCoachingSession[], requireReport = true) {
  const matched = new Map<string, AdvancedAdminCoachingSession>();
  const matchedSessionIds = new Set<string>();
  const eligible = (session: AdvancedAdminCoachingSession) => session.report ||
    (!requireReport && (Boolean(session.actualStartAt) ||
      ['finished', 'completed', 'waiting_for_transcript'].includes(session.status)));
  for (const family of ['pr', 'mcm'] as const) {
    for (const review of reviews[family]) {
      if (review.componentId == null) continue;
      const onComponent = sessions.filter(session => session.family === family && (!requireReport || eligible(session))
        && session.componentId === review.componentId);
      if (onComponent.length === 1) {
        matched.set(`${family}:${review.id}`, onComponent[0]);
        matchedSessionIds.add(onComponent[0].id);
      }
    }
    const dates = new Set(sessions.filter(session => session.family === family && eligible(session))
      .map(session => businessDay(session.actualStartAt || session.plannedDate)).filter(Boolean));
    for (const date of dates) {
      const onDay = sessions.filter(session => session.family === family && eligible(session)
        && !matchedSessionIds.has(session.id)
        && businessDay(session.actualStartAt || session.plannedDate) === date);
      const candidates = reviews[family].filter(review =>
        review.componentId == null &&
        businessDay(review.completedDate || review.plannedDate) === date);
      if (onDay.length === 1 && candidates.length === 1) {
        matched.set(`${family}:${candidates[0].id}`, onDay[0]);
        matchedSessionIds.add(onDay[0].id);
      }
    }
  }
  return { matched, unmatched: sessions.filter(session => !matchedSessionIds.has(session.id)) };
}

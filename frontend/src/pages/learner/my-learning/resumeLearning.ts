import type { Subject, SubjectEntry } from './learningSummary';
import { subjectWeeks } from './subjectLearning';
import { hasComponentContent } from '@/utils/learnerJourney';
import { activityTimestamp, latestActivityAt } from './learningActivityTime';

/** Resume the most recently studied course before falling back to teaching order.
 * Historical evidence groups and superseded courses remain available manually. */
export function nextIncompleteSubject(subjects: Subject[], starts: Record<string, string | null | undefined>) {
  const ordered = [...subjects].filter(subject => !subject.previousLearningFor && !subject.replacementCourseRef)
    .sort((a, b) => (starts[a.id] || '9999').localeCompare(starts[b.id] || '9999'));
  const remaining = (subject: Subject) => subject.card
      ? subject.card.completedActivityCount < subject.card.activityCount
      : subject.activities.some(activity => !activity.completed);
  const savedAt = (subject: Subject) => activityTimestamp(latestActivityAt([
    subject.card?.lastActivityAt, ...subject.activities.map(activity => activity.lastActivityAt),
  ]));
  const latest = [...ordered].sort((a, b) => savedAt(b) - savedAt(a))[0];
  if (latest && savedAt(latest)) {
    if (remaining(latest)) return latest;
    const next = ordered.slice(ordered.indexOf(latest) + 1).find(remaining);
    if (next) return next;
  }
  return ordered.find(remaining);
}

function available(entry: SubjectEntry) {
  return entry.legacy
    ? entry.legacy.can_open_material !== false || entry.legacy.catalogue_kind === 'quiz' || !!entry.legacy.source_material_activity_id
    : !!entry.native && hasComponentContent(entry.native);
}

/** Continue at the latest saved activity, then move forward in teaching order.
 * Earlier gaps remain available without making every resume start there. */
export function nextIncompleteActivity(subject: Subject) {
  const ordered = subjectWeeks(subject).flatMap(week => week.activities.map(activity => ({ week, activity })));
  const latest = [...ordered].sort((a, b) => activityTimestamp(b.activity.lastActivityAt) - activityTimestamp(a.activity.lastActivityAt))[0];
  const remaining = (entry: typeof latest) => !entry.activity.completed && available(entry.activity);
  if (latest && activityTimestamp(latest.activity.lastActivityAt)) {
    if (remaining(latest)) return latest;
    const next = ordered.slice(ordered.indexOf(latest) + 1).find(remaining);
    if (next) return next;
  }
  return ordered.find(remaining);
}

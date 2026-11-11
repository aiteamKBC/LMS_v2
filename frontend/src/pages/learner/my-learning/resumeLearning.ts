import type { Subject, SubjectEntry } from './learningSummary';
import { subjectWeeks } from './subjectLearning';
import { hasComponentContent } from '@/utils/learnerJourney';

/** Keep the assigned teaching order, including unfinished earlier modules.
 * Historical evidence groups and superseded courses remain available manually. */
export function nextIncompleteSubject(subjects: Subject[], starts: Record<string, string | null | undefined>) {
  return [...subjects].filter(subject => !subject.previousLearningFor && !subject.replacementCourseRef)
    .sort((a, b) => (starts[a.id] || '9999').localeCompare(starts[b.id] || '9999'))
    .find(subject => subject.card
      ? subject.card.completedActivityCount < subject.card.activityCount
      : subject.activities.some(activity => !activity.completed));
}

function available(entry: SubjectEntry) {
  return entry.legacy
    ? entry.legacy.can_open_material !== false || entry.legacy.catalogue_kind === 'quiz' || !!entry.legacy.source_material_activity_id
    : !!entry.native && hasComponentContent(entry.native);
}

/** Completion uses the unified catalogue rules; dates only order the curriculum,
 * and never skip unfinished work in favour of the calendar week. */
export function nextIncompleteActivity(subject: Subject) {
  for (const week of subjectWeeks(subject)) {
    const activity = week.activities.find(entry => !entry.completed && available(entry));
    if (activity) return { week, activity };
  }
}

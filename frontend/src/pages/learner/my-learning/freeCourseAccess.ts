import type { FreeCourseActivity } from '@/api/freeCourses';

// ============================================================================
// What a learner may open in a free course.
//
// Nothing is locked by completion. A learner opens any activity in any order,
// leaves one unfinished, moves to the next and comes back later. Finishing an
// activity records progress; it does not hand out access to the next one.
//
// The quiz prerequisite that used to hold a quiz shut until its section's
// materials were done has been removed. What remains is the only genuine
// reason something cannot be opened: nothing was authored for it.
// ============================================================================

export type LockInfo = { locked: boolean; reason: 'content' | null };

export function isQuiz(activity: FreeCourseActivity): boolean {
  return /quiz/i.test(activity.type);
}

/** Whether an activity has something to show. A quiz is "available" only when a
 *  quiz is linked to it in the curriculum (quizId); otherwise it reads as not
 *  available, exactly like the normal modules. */
export function hasContent(activity: FreeCourseActivity): boolean {
  if (isQuiz(activity)) return Boolean(activity.quizId);
  return Boolean(activity.videoUrl || activity.audioUrl || activity.contentHtml || activity.resourceUrl);
}

/**
 * Availability for every activity in a course.
 *
 * `locked` is never true: it is kept so the callers that read it keep reading
 * the same shape, and so a future authored lock has somewhere to live. An
 * unlinked quiz reports `reason: 'content'` — not available rather than locked.
 */
export function computeLocks(activities: FreeCourseActivity[]): Map<string, LockInfo> {
  const map = new Map<string, LockInfo>();
  for (const activity of activities) {
    map.set(activity.componentId, hasContent(activity)
      ? { locked: false, reason: null }
      : { locked: false, reason: 'content' });
  }
  return map;
}

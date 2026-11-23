import type { FreeCourseActivity, FreeCourseSummary } from '@/api/freeCourses';
import { hasContent, isFreeCourseActivityCompleted } from './freeCourseAccess';

const timestamp = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

/** Same saved-work rule as programme resume; migration times and hours are not activity. */
export function nextFreeCourseActivity(activities: FreeCourseActivity[]) {
  const available = activities.filter(hasContent);
  const remaining = (activity: FreeCourseActivity) => !isFreeCourseActivityCompleted(activity);
  const latest = [...available].sort((a, b) => timestamp(b.lastActivityAt) - timestamp(a.lastActivityAt))[0];
  if (latest && timestamp(latest.lastActivityAt)) {
    if (remaining(latest)) return latest;
    const next = available.slice(available.indexOf(latest) + 1).find(remaining);
    if (next) return next;
  }
  return available.find(activity => activity.activity_state === 'reading_viewed' && remaining(activity))
    ?? available.find(remaining) ?? latest;
}

export function nextFreeCourse(courses: FreeCourseSummary[]) {
  const remaining = (course: FreeCourseSummary) => course.completedActivities < course.activityCount;
  const latest = [...courses].sort((a, b) => timestamp(b.lastActivityAt) - timestamp(a.lastActivityAt))[0];
  if (latest && timestamp(latest.lastActivityAt)) {
    if (remaining(latest)) return latest;
    const next = courses.slice(courses.indexOf(latest) + 1).find(remaining);
    if (next) return next;
  }
  return courses.find(remaining) ?? latest;
}

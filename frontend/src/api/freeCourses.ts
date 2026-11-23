import { learningFetch } from '@/lib/personalLearning';
import { createCachedResource } from './cachedRequest';
import { readLearnerJson } from './learnerRead';
import type { LearnerKind } from './learnerDetail';
import type { Quiz } from './quizzes';

// ============================================================================
// Learner-facing free-courses API client.
//
// Reads canonical assignments and isolated progress through learner-gated APIs.
// The list is a lightweight summary; the canonical week/activity tree loads
// when a course is opened. Completion is independent of programme OTJH/KSBs.
// ============================================================================

export type FreeCourseActivityState = 'not_started' | 'reading_viewed' | 'completed';

/** One openable activity inside a free-course week. */
export interface FreeCourseActivity {
  lastActivityAt?: string | null;
  /** Existing accepted ledger time; never additional awarded hours. */
  acceptedActualSeconds?: number;
  componentId: string;
  title: string;
  type: string;                 // frontend component type, e.g. 'video' | 'reading'
  /** Allocated curriculum time defines Required; it is not awarded OTJ time. */
  expectedOtjh?: number | null;
  description?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  resourceUrl?: string | null;
  contentHtml?: string | null;  // reading rich text (sanitised on render)
  fileName?: string | null;
  /** Every file the author attached, in their order. Entry 0 is the same
   *  file `resourceUrl` points at. */
  files?: import('@/lib/componentFiles').ComponentFile[];
  downloadAllowed?: boolean;
  /** The linked quiz id for a quiz activity (settings.linkedQuizId); null when
   *  no quiz is linked, which reads as "not available". */
  quizId?: string | null;
  /** Author's per-quiz toggle: true = always open (no gating); false = locked
   *  until the section's materials are complete. Only meaningful for quizzes. */
  manualUnlock?: boolean;
  /** This learner's own completion of the activity. Its own store — never part
   *  of programme OTJH/KSBs or the overall progress figure. */
  completed?: boolean; // Compatibility alias supplied by the backend.
  is_completed?: boolean;
  activity_state?: FreeCourseActivityState;
  completed_at?: string | null; // Optional historical timestamp, never a completion flag.
}

export interface FreeCourseWeek {
  weekId: string;
  weekNumber: number;
  weekTitle: string;
  displayOrder: number;
  activities: FreeCourseActivity[];
}

export interface FreeCourse {
  acceptedActualSeconds?: number;
  freeCourseId: string;
  courseName: string;
  description: string;
  coverImageUrl: string;
  weeks: FreeCourseWeek[];
  /** Compatibility metadata; navigation always uses freeCourseId. */
  moduleId?: string;
  weekCount?: number;
  activityCount?: number;
  hours?: number;
}

export interface FreeCourseSummary {
  lastActivityAt?: string | null;
  acceptedActualSeconds?: number;
  freeCourseId: string;
  courseName: string;
  description: string;
  coverImageUrl: string;
  weekCount: number;
  activityCount: number;
  completedActivities: number;
  progressPercentage: number;
  /** Compatibility metadata; navigation always uses freeCourseId. */
  moduleId?: string;
}

const BASE = '/learner_api/free-courses';
const freeCoursesResource = createCachedResource<FreeCourseSummary[]>('learner-free-courses', async (key) => {
  const [kind, id] = key.split(':');
  const payload = await readLearnerJson<{ freeCourses: FreeCourseSummary[] }>(`${BASE}/${kind}/${id}/`);
  return Array.isArray(payload.freeCourses) ? payload.freeCourses : [];
});
const freeCourseDetailResource = createCachedResource<FreeCourse>('learner-free-course-detail', async (key) => {
  const [kind, id, courseId] = JSON.parse(key) as [LearnerKind, string, string];
  const payload = await readLearnerJson<{ freeCourse: FreeCourse }>(
    `${BASE}/${kind}/${id}/courses/${encodeURIComponent(courseId)}/`,
  );
  return payload.freeCourse;
});

/** Lightweight cards for the free courses currently assigned to this learner. */
export function fetchLearnerFreeCourses(kind: LearnerKind, id: string, force = false): Promise<FreeCourseSummary[]> {
  return freeCoursesResource.read(`${kind}:${id}`, { force, revalidate: true });
}

/** Render a revisit immediately, without a loading-frame flash. */
export function peekLearnerFreeCourses(kind: LearnerKind, id: string): FreeCourseSummary[] | undefined {
  return freeCoursesResource.peek(`${kind}:${id}`);
}

/** Assignment changes invalidate both cards and any open course detail. */
export function invalidateLearnerFreeCourses(): void {
  freeCoursesResource.invalidate();
  freeCourseDetailResource.invalidate();
}

/** Load the canonical weeks/components only after an assigned course is opened. */
export function fetchLearnerFreeCourse(
  kind: LearnerKind, id: string, courseId: string, force = false,
): Promise<FreeCourse> {
  return freeCourseDetailResource.read(JSON.stringify([kind, id, courseId]), { force });
}

/** Record that the learner finished one free-course activity. Its completion is
 *  stored in an isolated table and never affects overall progress/OTJH/KSBs. */
export async function markFreeCourseActivityComplete(kind: LearnerKind, id: string, componentId: string): Promise<void> {
  await saveFreeCourseActivityState(kind, id, componentId, 'completed');
}

export async function saveFreeCourseActivityState(
  kind: LearnerKind, id: string, componentId: string, activityState: FreeCourseActivityState,
): Promise<void> {
  let res: Response;
  try {
    res = await learningFetch(`${BASE}/${kind}/${id}/complete/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activityState === 'completed' ? { componentId } : { componentId, activityState }),
    });
  } catch {
    throw new Error('Could not reach the server. Please try again.');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try { const body = await res.json(); if (body?.error) message = body.error; } catch { /* keep default */ }
    throw new Error(message);
  }
  // The cached tree now carries a stale completed flag; drop it so the next read
  // reflects the new completion.
  freeCoursesResource.invalidate(`${kind}:${id}`);
  freeCourseDetailResource.invalidate();
}

/** Load a quiz through its assigned Free Course component. The server derives
 * the quiz id from that component after checking learner ownership, the current
 * Learning Plan assignment and the canonical course/week/component links. */
export function fetchFreeCourseQuiz(kind: LearnerKind, id: string, componentId: string): Promise<FreeCourseQuizData> {
  return readLearnerJson<FreeCourseQuizData>(`${BASE}/${kind}/${id}/quiz/${encodeURIComponent(componentId)}/`);
}

export interface FreeCourseQuizAttempt {
  attemptId: string;
  grade: number | null;
  passed: boolean | null;
  completed: boolean;
  submittedAt: string | null;
}
export type FreeCourseQuizData = Quiz & { attempts?: FreeCourseQuizAttempt[]; historyOnly?: boolean };

export interface FreeCourseQuizResult {
  attemptId?: string;
  componentId: string;
  grade: number;        // percentage, e.g. 80
  passed: boolean;
  passingGrade: number; // percentage threshold
  breakdown: { questionId: number; correct: boolean; earned: number; possible: number; correctAnswer: string | null }[];
}

/** Grade a free-course quiz. On a pass the backend records completion in the
 *  isolated free-course store (never OTJH/KSBs). `answers` is keyed by question
 *  id, in the same shape the shared quiz grader expects. */
export async function submitFreeCourseQuiz(
  kind: LearnerKind, id: string, componentId: string, answers: Record<string, unknown>, submissionId?: string,
): Promise<FreeCourseQuizResult> {
  let res: Response;
  try {
    res = await learningFetch(`${BASE}/${kind}/${id}/quiz/${encodeURIComponent(componentId)}/submit/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers, ...(submissionId ? { submissionId } : {}) }),
    });
  } catch {
    throw new Error('Could not reach the server. Please try again.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
  if (res.ok) {
    freeCoursesResource.invalidate(`${kind}:${id}`);
    freeCourseDetailResource.invalidate();
  }
  return data as FreeCourseQuizResult;
}

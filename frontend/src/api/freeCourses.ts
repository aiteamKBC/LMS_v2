import { learningFetch } from '@/lib/personalLearning';
import { createCachedResource } from './cachedRequest';
import { readLearnerJson } from './learnerRead';
import type { LearnerKind } from './learnerDetail';

// ============================================================================
// Learner-facing free-courses API client.
//
// Reads the free courses assigned to a learner from the learner-gated endpoint
// /learner_api/free-courses/<kind>/<pk>/. Free courses carry no hours, KSBs or
// progress by design, so this shape deliberately has none of those fields — it
// is the authored week/activity tree and nothing more.
// ============================================================================

/** One openable activity inside a free-course week. */
export interface FreeCourseActivity {
  componentId: string;
  title: string;
  type: string;                 // frontend component type, e.g. 'video' | 'reading'
  description?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  resourceUrl?: string | null;
  contentHtml?: string | null;  // reading rich text (sanitised on render)
  fileName?: string | null;
  downloadAllowed?: boolean;
  /** The linked quiz id for a quiz activity (settings.linkedQuizId); null when
   *  no quiz is linked, which reads as "not available". */
  quizId?: string | null;
  /** Author's per-quiz toggle: true = always open (no gating); false = locked
   *  until the section's materials are complete. Only meaningful for quizzes. */
  manualUnlock?: boolean;
  /** This learner's own completion of the activity. Its own store — never part
   *  of programme OTJH/KSBs or the overall progress figure. */
  completed?: boolean;
}

export interface FreeCourseWeek {
  weekId: string;
  weekNumber: number;
  weekTitle: string;
  displayOrder: number;
  activities: FreeCourseActivity[];
}

export interface FreeCourse {
  freeCourseId: string;
  courseName: string;
  description: string;
  coverImageUrl: string;
  weeks: FreeCourseWeek[];
}

const BASE = '/learner_api/free-courses';
const freeCoursesResource = createCachedResource<FreeCourse[]>('learner-free-courses', async (key) => {
  const [kind, id] = key.split(':');
  const payload = await readLearnerJson<{ freeCourses: FreeCourse[] }>(`${BASE}/${kind}/${id}/`);
  return Array.isArray(payload.freeCourses) ? payload.freeCourses : [];
});

/** The free courses assigned to this learner, each with its week/activity tree. */
export function fetchLearnerFreeCourses(kind: LearnerKind, id: string, force = false): Promise<FreeCourse[]> {
  return freeCoursesResource.read(`${kind}:${id}`, { force });
}

/** Render a revisit immediately, without a loading-frame flash. */
export function peekLearnerFreeCourses(kind: LearnerKind, id: string): FreeCourse[] | undefined {
  return freeCoursesResource.peek(`${kind}:${id}`);
}

/** Record that the learner finished one free-course activity. Its completion is
 *  stored in an isolated table and never affects overall progress/OTJH/KSBs. */
export async function markFreeCourseActivityComplete(kind: LearnerKind, id: string, componentId: string): Promise<void> {
  let res: Response;
  try {
    res = await learningFetch(`${BASE}/${kind}/${id}/complete/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentId }),
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
}

export interface FreeCourseQuizResult {
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
  kind: LearnerKind, id: string, componentId: string, answers: Record<string, unknown>,
): Promise<FreeCourseQuizResult> {
  let res: Response;
  try {
    res = await learningFetch(`${BASE}/${kind}/${id}/quiz/${encodeURIComponent(componentId)}/submit/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
  } catch {
    throw new Error('Could not reach the server. Please try again.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
  if (data?.passed) freeCoursesResource.invalidate(`${kind}:${id}`);
  return data as FreeCourseQuizResult;
}

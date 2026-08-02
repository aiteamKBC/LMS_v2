// ============================================================================
// Learner-detail API client.
// Talks to the Django backend at /learner_api (proxied to :8000 by Vite in dev).
// Combines a CommercialUser/EnrolmentUser row with its "Learner"."Active_users"
// mirror (present only while the learner is Active) into one read-only shape.
// ============================================================================

const BASE = '/learner_api/learner-detail';
const CACHE_TTL_MS = 30_000;

const detailCache = new Map<string, { data: LearnerDetail; expiresAt: number }>();
const detailRequests = new Map<string, Promise<LearnerDetail>>();

export type LearnerKind = 'commercial' | 'apprenticeship';

export interface LearnerWeekEntry {
  module: string | null;
  week: string;
}
/** A KSB authored against a component, with the weight it contributes. */
export interface ComponentKsbMapping {
  code: string;
  description: string | null;
  classification: string | null;   // main | secondary | possible
  weight: number;
}

export interface LearnerComponentEntry {
  module: string | null;
  week: string | null;
  component: string;
  expectedOtjh: number | null;
  moduleId?: string | null;             // curriculum.modules.module_catalogue_id (null for legacy id-less modules)
  weekId?: string | null;               // curriculum.weeks.id
  ksbWeightTotal?: number | null;       // summed weight of this component's KSB mappings
  ksbMappingCount?: number | null;      // 0 => component is not gated by the completion criteria
  ksbMappings?: ComponentKsbMapping[];  // the KSBs auto-credited when this component is completed
  componentId?: string | null;
  type?: string | null;                 // master component type, e.g. 'video', 'live_session'
  description?: string | null;
  videoUrl?: string | null;             // present on video components authored with a URL
  audioUrl?: string | null;             // podcast / reading voice-over
  contentHtml?: string | null;          // reading rich-text content
  fileName?: string | null;             // powerpoint / document file name
  downloadAllowed?: boolean;            // powerpoint download flag
  reflectionPrompt?: string | null;     // authored reflection prompt / learner guidance
  resourceUrl?: string | null;          // generic external/download URL
  liveSessionUrl?: string | null;       // Microsoft Teams join URL for live sessions
  teamsLiveSessionId?: string | null;   // curriculum.live_sessions.id for attendance/artifact sync
  sessionDate?: string | null;
  sessionTime?: string | null;
  sessionDateTimeUtc?: string | null;
  durationMinutes?: number | null;
  isQuiz?: boolean;
  quizMeta?: { quizId: number; questions: number | null; duration: number | null; timeUnit: string | null };
}
export interface LearnerKsbItem {
  code: string;
  type: string;
  number: string;
  description: string;
}

// Slim stored per-question result — references answers by id (resolved to text
// on display via the fetched quiz). Free-text types (fill_gap/keywords/matching)
// have no answer id, so they carry chosenText instead.
export interface LearnerQuizQuestionResult {
  questionId: number;
  earned: number;
  correct: boolean;
  chosenAnswerId?: number | number[] | null;
  correctAnswerId?: number[] | null;
  chosenText?: string | null;   // free-text answer types only
}

export interface LearnerQuizAttempt {
  kind?: 'quiz';
  moduleId?: string | null;
  moduleTitle?: string | null;
  weekId?: string | null;
  weekTitle?: string | null;
  componentId?: string | null;
  componentTitle?: string | null;
  componentType?: string | null;
  attempt?: number;           // 1-based attempt number for this quiz
  grade: number;              // 0-1 decimal, e.g. 0.9
  achievedScore?: number;     // questions correct
  totalScore?: number;        // questions total
  passed: boolean;
  quizId: number;
  ksbs?: string[];            // KSB codes the learner marked fulfilled
  feedback?: string;
  reportedTime?: string;      // learner's chosen time (planned label or free text)
  questions?: LearnerQuizQuestionResult[];
  startedAt: string;
  submittedAt: string;
  timeTaken?: string;         // "MM:SS", e.g. "00:26" (auto-tracked)
}

export interface LearnerDetail {
  id: string;
  name: string;
  email: string;
  phone: string;
  programme: string;
  programmeStatus: string;
  cohort: string;
  group: string;
  employer: string;
  lineManager: string;
  isActive: boolean;
  modules: string[];
  week: LearnerWeekEntry[];
  components: LearnerComponentEntry[];
  ksbs: LearnerKsbItem[];
  progressKsbCodes?: string[];
  quizAttempts: LearnerQuizAttempt[];
  videoProgress?: LearnerVideoProgress[];
  componentProgress?: LearnerComponentProgress[];  // non-quiz, non-video completions
  activityFeed?: LearnerActivityEntry[];   // newest first
  totalExpectedOtjh: number;
  plannedHours?: string;      // planned OTJ hours (also stored in Active_users.planned_hours)
  completedHours?: string;    // completed OTJ hours, all activities (Active_users.Completed_hours)
  targetHours?: string;       // cumulative planned hours up to the current week (Target_hours)
  progressHours?: string;     // completed - target (Progress_Hours)
  progressVariance?: string;  // (completed - target) / target, decimal (Progress_variance); '' if target=0
  otjhStatus?: string;        // "On track" | "Need attention" | "At risk" (OTJHoursStatus)
}

/** A completed non-quiz, non-video component (podcast/reading/slides/reflection/…). */
export interface LearnerComponentProgress {
  kind: 'component';
  componentType: string;      // 'podcast' | 'reading' | 'powerpoint' | 'reflection' | …
  componentId: string;
  attempt?: number;
  ksbs?: string[];
  feedback?: string;
  reportedTime?: string;
  startedAt: string | null;
  submittedAt: string;
  timeTaken: string | null;
}

export interface LearnerActivityEntry {
  kind: 'quiz' | 'video' | 'component';
  componentType?: string;
  action: string;             // e.g. "Completed quiz", "Watched video"
  title: string;
  detail?: string;            // e.g. "Scored 90% · 18/20"
  passed?: boolean;
  quizId?: number;
  componentId?: string;
  week?: string | null;
  module?: string | null;
  at: string;                 // ISO timestamp
}

export interface LearnerVideoProgress {
  kind: 'video';
  componentId: string;
  attempt?: number;
  ksbs?: string[];
  feedback?: string;
  reportedTime?: string;
  startedAt: string | null;
  submittedAt: string;
  timeTaken: string | null;
}

async function request<T>(url: string): Promise<T> {
  const existingRequest = pendingRequests.get(url) as Promise<T> | undefined;
  if (existingRequest) {
    return existingRequest;
  }

  const pendingRequest = requestUncached<T>(url);
  pendingRequests.set(url, pendingRequest);
  try {
    return await pendingRequest;
  } finally {
    pendingRequests.delete(url);
  }
}

const pendingRequests = new Map<string, Promise<unknown>>();

async function requestUncached<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) {
        throw new Error(`Backend returned HTML instead of JSON (${res.status}). Check the Django server error output.`);
      }
      throw new Error('Received an invalid JSON response from the backend.');
    }
  }
  if (!res.ok) {
    const message = typeof data === 'object' && data && 'error' in data
      ? String((data as { error?: string }).error)
      : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

/** Remove cached learner data after a progress-changing action. */
export function invalidateLearnerDetailCache(kind?: LearnerKind, id?: string): void {
  if (kind && id) {
    detailCache.delete(`${kind}:${id}`);
    return;
  }
  detailCache.clear();
}

/**
 * Fetch a learner once and share the result between pages. Monthly Cycle,
 * Coaching and Reviews frequently mount back-to-back and need the same heavy
 * payload; this prevents duplicate requests and keeps it briefly in memory.
 */
export function fetchLearnerDetail(kind: LearnerKind, id: string, options: { force?: boolean } = {}): Promise<LearnerDetail> {
  const key = `${kind}:${id}`;
  const cached = detailCache.get(key);
  if (!options.force && cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);

  const pending = detailRequests.get(key);
  if (pending) return pending;

  const promise = request<LearnerDetail>(`${BASE}/${kind}/${id}/`)
    .then((data) => {
      detailCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    })
    .finally(() => detailRequests.delete(key));
  detailRequests.set(key, promise);
  return promise;
}

// ============================================================================
// Quiz-taking API client.
// Talks to the Django backend at /learner_api/quizzes (proxied to :8000 by Vite in dev).
// ============================================================================

import { invalidateLearnerDetailCache } from '@/api/learnerDetail';

const BASE = '/learner_api/quizzes';

export type QuestionType =
  | 'single_choice' | 'multiple_choice' | 'true_false' | 'fill_gap'
  | 'matching' | 'image_matching' | 'ordering' | 'keywords';

export interface QuizAnswerOption {
  id: number;
  text?: string;
  left?: string;
  leftKey?: string;
  label?: string;
  imageUrl?: string;
}

export interface QuizQuestion {
  id: number;
  text: string;
  type: QuestionType;
  points: number;
  sortOrder: number;
  explanation: string | null;
  answers: QuizAnswerOption[];
  rightOptions?: string[];
  answerCount?: number;
}

export interface Quiz {
  id: number;
  title: string;
  module: string | null;
  programme: string | null;
  weekId: string | null;
  duration: number | null;
  timeUnit: string | null;
  passingGrade: number | null;
  randomizeQuestions: boolean;
  randomizeAnswers: boolean;
  questions: QuizQuestion[];
}

/** Answer value shape depends on the question type:
 *  single_choice/true_false -> answer id (number)
 *  multiple_choice          -> answer ids (number[])
 *  fill_gap                 -> free text (string)
 *  matching/image_matching  -> { [leftKey]: rightOptionText }
 *  ordering                 -> answer ids in the learner's chosen order (number[])
 *  keywords                 -> free-text words (string[])
 */
export type QuizAnswerValue = number | number[] | string | string[] | Record<string, string>;

export interface QuizSubmission {
  answers: Record<string, QuizAnswerValue>;
  timeTakenSeconds: number;
  startedAt: string;
  trackingToken: string;
  module?: string | null;
  week?: string | null;
  ksbs?: string[];           // KSB codes the learner marked as fulfilled
  feedback?: string;         // general feedback about the quiz
  reportedTime?: string;     // self-reported time-to-complete (planned time or free text)
}

export interface QuizQuestionResult {
  questionId: number;
  questionText: string;
  type: QuestionType;
  points: number;
  earned: number;
  possible: number;
  correct: boolean;
  chosenAnswer: string | null;
  correctAnswer: string | null;
}

// The slim stored attempt (also echoed in the submit response's `attempt`).
export interface QuizAttempt {
  kind: 'quiz';
  attempt: number;            // 1-based attempt number for this quiz
  grade: number;              // 0-1 decimal, e.g. 0.9
  achievedScore: number;      // questions correct
  totalScore: number;         // questions total
  passed: boolean;
  quizId: number;
  ksbs?: string[];
  feedback?: string;
  reportedTime?: string;
  questions: unknown[];       // slim id-referenced questions (not read by the results screen)
  startedAt: string;
  submittedAt: string;
  timeTaken: string;          // "MM:SS", e.g. "00:26"
  timeTrackingSource: string;
  claimedSeconds: number;
  serverSessionSeconds: number;
  verifiedSeconds: number;
}

export interface QuizAttemptResult {
  attempt: QuizAttempt;
  breakdown: QuizQuestionResult[];   // full-text, for the results screen
  earned: number;
  possible: number;
  grade: number;              // 0-1 decimal
  achievedScore: number;
  totalScore: number;
  passed: boolean;
  timeTaken: string;
  quizName: string;
}

async function request<T>(url: string, init?: globalThis.RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data as T;
}

export function fetchQuiz(quizId: number): Promise<Quiz> {
  return request<Quiz>(`${BASE}/${quizId}/`);
}

export function submitQuizAttempt(
  quizId: number,
  kind: 'commercial' | 'apprenticeship',
  learnerId: string,
  submission: QuizSubmission,
): Promise<QuizAttemptResult> {
  return request<QuizAttemptResult>(`${BASE}/${quizId}/submit/?kind=${kind}&learnerId=${learnerId}`, {
    method: 'POST',
    body: JSON.stringify(submission),
  }).then((result) => {
    invalidateLearnerDetailCache(kind, learnerId);
    return result;
  });
}

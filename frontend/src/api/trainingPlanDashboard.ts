import type { LearnerKind } from './learnerDetail';
import type { LearnerCalendarEvent } from './learnerCalendar';
import { subjectRequest } from './studentActivity';
import { readLearnerJson } from './learnerRead';

export type PlanMonth = { label: string; topics: string[]; planned: number | null; source: string;
  activities?: { date: string; title: string; method: string; hours: number }[]; weeklyTarget?: number | null };
export type PlanSession = { id: string; moduleId: string; title: string; start: string; end: string | null;
  minutes: number; joinUrl: string | null; status: string; attended: boolean | null };
export type PlanModule = { id: string; title: string; description: string; start_date: string | null; end_date: string | null; tutor_name: string; coach_name: string };
export type PlanReview = Pick<LearnerCalendarEvent, 'id' | 'eventKey' | 'title' | 'source' | 'sequence' | 'status' | 'date' | 'targetDate' | 'scheduledDate' | 'scheduledTime' | 'durationMinutes' | 'coachName' | 'invited'>;
export type TrainingPlanDashboard = {
  months: Record<string, PlanMonth>;
  actual: { month: string; groupId: string | null; hours: number; count: number }[];
  actualAvailable: boolean;
  modules: PlanModule[];
  moduleLinks: Record<string, { id: string; title: string }>;
  sessions: PlanSession[];
  reviews: PlanReview[];
  coach: { name: string; bookingUrl: string | null };
  contractStatus: string;
  generatedAt: string;
};

export function fetchTrainingPlanDashboard(kind: LearnerKind, id: string, signal?: AbortSignal) {
  // Share the same in-flight schedule read as This week / Upcoming on Dashboard.
  return readLearnerJson<TrainingPlanDashboard>(`/learner_api/training-plan-dashboard/${kind}/${encodeURIComponent(id)}/?section=overview`, { signal, ttlMs: 30_000, revalidate: true });
}

export type TrainingPlanContract = Pick<TrainingPlanDashboard, 'months' | 'contractStatus'>;
export function fetchTrainingPlanContract(kind: LearnerKind, id: string, signal?: AbortSignal) {
  return subjectRequest<TrainingPlanContract>(`/learner_api/training-plan-dashboard/${kind}/${encodeURIComponent(id)}/?section=contract`, { signal });
}

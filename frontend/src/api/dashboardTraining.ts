import type { LearnerKind } from './learnerDetail';
import type { PlanMonth, PlanReview, PlanModule } from './trainingPlanDashboard';
import type { DisplayTimelineModule } from '@/pages/learner/training-plan-timeline/model';
import { createCachedResource } from './cachedRequest';
import { readLearnerJson, subscribeLearnerReadInvalidation, withCallerSignal } from './learnerRead';

export type TrainingModule = DisplayTimelineModule;
export type TrainingTimelineModule = Pick<TrainingModule, 'id' | 'title' | 'moduleId' | 'start' | 'end' | 'done' | 'activityCount' | 'progress'> & {
  detail?: Partial<PlanModule>; weekAnchor?: string;
};
export function timelineModuleForDisplay(module: TrainingTimelineModule): TrainingModule {
  return { ...module, detail: module.detail ? { id: module.moduleId || module.id, title: module.title, description: '', start_date: module.start || null,
    end_date: module.end || null, coach_name: '', tutor_name: '', ...module.detail } : undefined,
    activityCounts: {}, ksbCodes: [], achievedKsbCodes: null, ksbMappingMissing: false, weeks: 0, actual: null, sessions: [], activities: [] };
}
export type DashboardTrainingPayload = {
  timeline: {
    start: string; end: string; programmeStartDate?: string | null;
    modules: TrainingTimelineModule[]; reviews: PlanReview[];
    months?: Record<string, Pick<PlanMonth, 'topics'>>; coachName?: string;
  };
  selectedModuleId: string | null;
  selectedModule: TrainingModule | null;
};
const root = (kind: LearnerKind, id: string) => `/learner_api/dashboard/${kind}/${encodeURIComponent(id)}/training/`;
const key = (kind: LearnerKind, id: string, moduleId: string) => `${root(kind, id)}modules/${encodeURIComponent(moduleId)}/`;
const details = createCachedResource<TrainingModule>('dashboard-training-modules', async url => {
  const module = await readLearnerJson<TrainingModule>(url);
  if (!module || typeof module.id !== 'string' || !Array.isArray(module.activities) || !module.detail) {
    throw new Error('Could not load module details. Please try again.');
  }
  return module;
});
subscribeLearnerReadInvalidation(() => details.invalidate());

export const dashboardTraining = {
  read: async (kind: LearnerKind, id: string, signal?: AbortSignal, fresh = false, subject = '', month = '', programmeStartDate = '', programmeEndDate = '') => {
    const query = new URLSearchParams();
    if (subject) query.set('subject', subject);
    if (month) query.set('month', month);
    if (programmeStartDate) query.set('programmeStartDate', programmeStartDate);
    if (programmeEndDate) query.set('programmeEndDate', programmeEndDate);
    const url = root(kind, id) + (query.size ? `?${query}` : '');
    const data = await readLearnerJson<DashboardTrainingPayload>(url, { signal, revalidate: fresh, ttlMs: 30_000 });
    if (!data?.timeline || !Array.isArray(data.timeline.modules) || !Array.isArray(data.timeline.reviews)
      || (data.selectedModuleId && data.selectedModule?.id !== data.selectedModuleId)) {
      throw new Error('Could not load your training dashboard. Please try again.');
    }
    if (data.selectedModule) details.prime(key(kind, id, data.selectedModule.id), data.selectedModule);
    return data;
  },
  peek: () => undefined,
};
export function readTrainingModule(kind: LearnerKind, id: string, moduleId: string, signal?: AbortSignal, fresh = false) {
  return withCallerSignal(details.read(key(kind, id, moduleId), { revalidate: fresh }).then(module => {
    if (module.id !== moduleId) throw new Error('Module details did not match the requested module.');
    return module;
  }), signal);
}
export function peekTrainingModule(kind: LearnerKind, id: string, moduleId: string) {
  return details.peek(key(kind, id, moduleId));
}

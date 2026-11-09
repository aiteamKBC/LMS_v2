import { readLearnerJson } from './learnerRead';

export interface WebPoint { id: string; title: string; componentIds: string[] }
export interface WebPointPlan { weeks: Record<string, { moduleId: string; points: WebPoint[] }> }
export interface AuthoredWeekPoints { moduleId: string; weekId: string; editorId: string; revision: number; csrfToken: string; points: WebPoint[]; activities: { id: string; title: string; type: string }[] }

const authorUrl = (moduleId: string, weekId: string) => `${import.meta.env.VITE_API_BASE_URL || '/curriculum_api'}/curriculum/modules/${encodeURIComponent(moduleId)}/weeks/${encodeURIComponent(weekId)}/web-points/`;
export async function authoredWeekPoints(moduleId: string, weekId: string, saved?: Pick<AuthoredWeekPoints, 'points' | 'revision' | 'csrfToken'>): Promise<AuthoredWeekPoints> {
  const result = await fetch(authorUrl(moduleId, weekId), {
    credentials: 'include', cache: 'no-store', method: saved ? 'PUT' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(saved ? { 'X-CSRFToken': saved.csrfToken } : {}) },
    ...(saved ? { body: JSON.stringify({ points: saved.points, expectedRevision: saved.revision }) } : {}),
  });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error || 'Could not load week Points.');
  return data;
}
export const readWebPointPlan = (kind: string, id: string, signal?: AbortSignal) => readLearnerJson<WebPointPlan>(
  `/learner_api/web-points/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/`, { ttlMs: 0, signal });

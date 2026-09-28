import { coachFetch } from '@/lib/coachFetch';
import type { MarkingQueueRequest, MarkingQueueResponse, MarkingScope } from '../types/marking.types';

export function markingEndpoint(scope: MarkingScope) {
  return scope === 'personal' ? '/coach_api/coach/personal-marking' : '/coach_api/coach/marking-queue';
}

export async function fetchMarkingQueue(request: MarkingQueueRequest): Promise<MarkingQueueResponse> {
  const query = new URLSearchParams({
    status: request.status,
    kind: request.kind,
    page: String(request.page),
    page_size: String(request.pageSize ?? 25),
  });
  const response = await coachFetch(`${markingEndpoint(request.scope)}?${query}`);
  const text = await response.text();
  const data = text ? JSON.parse(text) as MarkingQueueResponse : {};
  if (!response.ok) throw new Error(data.detail || 'Unable to load the marking queue.');
  return data;
}

export async function fetchMarkingDetail<T>(scope: MarkingScope, submissionId: string): Promise<T | null> {
  const response = await coachFetch(`${markingEndpoint(scope)}/${submissionId}`);
  const text = await response.text();
  const data = text ? JSON.parse(text) as { item?: T; detail?: string } : {};
  if (!response.ok) throw new Error(data.detail || 'Unable to load this submission.');
  return data.item || null;
}

export async function fetchMarkingSidebarQueue<T>(scope: MarkingScope) {
  const response = await coachFetch(`${markingEndpoint(scope)}?status=all&page=1&page_size=25`);
  const text = await response.text();
  const data = text ? JSON.parse(text) as { items?: T[]; summary?: Record<string, number> } : {};
  if (!response.ok) throw new Error('Unable to load the marking queue.');
  return data;
}


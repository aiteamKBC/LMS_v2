import { coachFetch } from '@/lib/coachFetch';
import type { MarkingPart, MarkingQueueRequest, MarkingQueueResponse, MarkingScope } from '../types/marking.types';

/** The official queue lists a monthly report as two items: assignment (steps 2-4) and reflection (steps 5-8). */
const SPLIT_QUERY = 'split=1';

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
  if (request.scope === 'official') query.set('split', '1');
  const response = await coachFetch(`${markingEndpoint(request.scope)}?${query}`);
  const text = await response.text();
  const data = text ? JSON.parse(text) as MarkingQueueResponse : {};
  if (!response.ok) throw new Error(data.detail || 'Unable to load the marking queue.');
  return data;
}

export function markingPartQuery(part?: MarkingPart | null) {
  return part ? `?part=${part}` : '';
}

export async function fetchMarkingDetail<T>(scope: MarkingScope, submissionId: string, part?: MarkingPart | null): Promise<T | null> {
  const response = await coachFetch(`${markingEndpoint(scope)}/${submissionId}${markingPartQuery(part)}`);
  const text = await response.text();
  const data = text ? JSON.parse(text) as { item?: T; detail?: string } : {};
  if (!response.ok) throw new Error(data.detail || 'Unable to load this submission.');
  return data.item || null;
}

export async function fetchMarkingSidebarQueue<T>(scope: MarkingScope) {
  const response = await coachFetch(`${markingEndpoint(scope)}?status=all&page=1&page_size=25${scope === 'official' ? `&${SPLIT_QUERY}` : ''}`);
  const text = await response.text();
  const data = text ? JSON.parse(text) as { items?: T[]; summary?: Record<string, number> } : {};
  if (!response.ok) throw new Error('Unable to load the marking queue.');
  return data;
}


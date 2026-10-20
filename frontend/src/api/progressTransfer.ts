import { learningFetch } from '@/lib/personalLearning';
import { invalidateLearnerReads } from './learnerRead';
import type { LearnerKind } from './learnerDetail';

export type TransferModule = { courseRef: string; moduleId: string; oldTitle: string; newTitle: string; percent: number; hours: number; demoProgress?: boolean };
export type ProgressTransferRequest = {
  requestId: string; status: 'pending' | 'approved'; requestedAt: string; approvedAt: string | null; modules: TransferModule[];
};
export type TransferPreview = { eligible: Omit<TransferModule, 'percent' | 'hours'>[]; requests: ProgressTransferRequest[]; csrfToken: string };
export type AdminTransfer = ProgressTransferRequest & { learnerId: string; learnerKind: LearnerKind; learnerName: string; programme: string };
export type AdminTransfers = { requests: AdminTransfer[]; nextOffset: number | null; csrfToken: string };
const base = '/learner_api/progress-transfer/';
const learnerPath = (kind: LearnerKind, id: string) => `${base}${kind}/${encodeURIComponent(id)}/`;

async function request<T>(url: string, csrfToken?: string, signal?: AbortSignal): Promise<T> {
  const response = await learningFetch(url, {
    credentials: 'include', cache: 'no-store', signal,
    ...(csrfToken === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ confirm: true }),
    }),
  });
  let data: T & { error?: string };
  try { data = await response.json(); }
  catch { throw new Error('Progress transfer could not be completed. Please try again.'); }
  if (!response.ok) throw new Error(data.error || 'Progress transfer is unavailable. Please try again.');
  return data;
}

export const getTransferPreview = (kind: LearnerKind, id: string, signal?: AbortSignal) => request<TransferPreview>(learnerPath(kind, id), undefined, signal);
export const getTransferRequests = (offset = 0, signal?: AbortSignal) => request<AdminTransfers>(`${base}requests/?offset=${offset}`, undefined, signal);

export async function submitTransferRequest(kind: LearnerKind, id: string, csrfToken: string) {
  if (!csrfToken) throw new Error('Reload the transfer instructions before confirming.');
  const result = await request<{ request: ProgressTransferRequest }>(learnerPath(kind, id), csrfToken);
  invalidateLearnerReads();
  return result.request;
}

export async function approveTransferRequest(id: string, csrfToken: string) {
  if (!csrfToken) throw new Error('Reload the transfer requests before confirming.');
  const result = await request<{ request: ProgressTransferRequest }>(`${base}requests/${encodeURIComponent(id)}/`, csrfToken);
  invalidateLearnerReads();
  return result.request;
}

import { ModuleHoursError } from './moduleHours';

export type HoursOperation = 'set_targets' | 'save_defaults' | 'apply_defaults';
export interface HoursValue { targetMinutes: number | null; revision: number }
export interface HoursState {
  moduleId: string;
  target: HoursValue;
  default: (HoursValue & { id: string }) | null;
}
export interface DefaultItem {
  moduleId: string; state: HoursState | null; reason: string | null;
  revisions: { revision: number; before: HoursValue | null; after: HoursValue }[];
  nextBeforeRevision?: number | null;
}
export interface HoursPreview {
  operation: HoursOperation; canConfirm: boolean; previewToken: string | null; fingerprint: string;
  items: { moduleId: string; state: HoursState | null; targetMinutes: number | null; action: string; reason: string | null }[];
}
export interface HoursOutcome {
  operationId: string; operation: HoursOperation; appliedAt: string; replayed: boolean;
  items: { moduleId: string; action: string; before: HoursValue | null; after: HoursValue | null }[];
}
const base = `${import.meta.env.VITE_API_BASE_URL || '/curriculum_api'}/curriculum/module-hours/v2`;
async function request<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${base}/${path}`, {
    credentials: 'include', cache: 'no-store', signal,
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const payload = await response.json();
  if (!response.ok) throw new ModuleHoursError(payload.error || 'Module hours are unavailable.', response.status);
  return payload as T;
}
export const readHoursDefaults = (ids: string[], signal?: AbortSignal, beforeRevision?: number) => request<{ items: DefaultItem[]; canMatch: boolean }>(
  `defaults/?${new URLSearchParams([...ids.map(id => ['moduleId', id]), ...(beforeRevision ? [['beforeRevision', String(beforeRevision)]] : [])])}`, undefined, signal);
export const previewHours = (operation: HoursOperation, items: Record<string, unknown>[]) =>
  request<HoursPreview>('preview/', { operation, items });
export const readHoursHistory = (before?: string) => request<{ operations: HoursOutcome[]; nextCursor?: string | null }>(
  `operations/${before ? `?before=${encodeURIComponent(before)}` : ''}`);
export async function confirmHours(preview: HoursPreview, idempotencyKey: string) {
  const result = await request<HoursOutcome>('confirm/', {
    previewToken: preview.previewToken, fingerprint: preview.fingerprint, confirmed: true, idempotencyKey,
  });
  if (result.operation !== 'save_defaults') result.items.forEach(item =>
    window.dispatchEvent(new CustomEvent('module-hours-updated', { detail: { moduleId: item.moduleId, canonicalId: item.moduleId } })));
  return result;
}

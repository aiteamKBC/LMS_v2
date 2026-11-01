export interface ModuleHoursAccess {
  canMatch: boolean;
  canManage: boolean;
  revision: number;
}

export interface ModuleHoursTarget {
  moduleId: string;
  targetMinutes: number | null;
  revision: number;
  canMatch: boolean;
}

export class ModuleHoursError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include', cache: 'no-store', ...init,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  });
  const payload = await response.json();
  if (!response.ok) throw new ModuleHoursError(payload.error || 'Module hours could not be loaded.', response.status);
  return payload as T;
}

const curriculumBase = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';
const targetUrl = (moduleId: string) => `${curriculumBase}/curriculum/modules/${encodeURIComponent(moduleId)}/hours-target/`;
const accessUrl = (accountId: number) => `/login_api/admin/accounts/${accountId}/module-hours-access/`;

export const fetchModuleHoursTarget = (moduleId: string, signal?: AbortSignal) =>
  request<ModuleHoursTarget>(targetUrl(moduleId), { signal });

export async function saveModuleHoursTarget(moduleId: string, targetMinutes: number | null, expectedRevision: number) {
  const saved = await request<ModuleHoursTarget>(targetUrl(moduleId), {
    method: 'PATCH', body: JSON.stringify({ targetMinutes, expectedRevision }),
  });
  window.dispatchEvent(new CustomEvent('module-hours-updated', { detail: { moduleId, canonicalId: saved.moduleId } }));
  return saved;
}

export const fetchOwnModuleHoursAccess = () => request<ModuleHoursAccess>('/login_api/module-hours/access/');
export const fetchAccountModuleHoursAccess = (accountId: number) => request<ModuleHoursAccess>(accessUrl(accountId));
export const saveAccountModuleHoursAccess = (accountId: number, access: ModuleHoursAccess) =>
  request<ModuleHoursAccess>(accessUrl(accountId), {
    method: 'PATCH', body: JSON.stringify({ canMatch: access.canMatch, canManage: access.canManage, expectedRevision: access.revision }),
  });

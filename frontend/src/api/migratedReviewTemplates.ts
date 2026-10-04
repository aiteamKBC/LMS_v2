import type { ReviewSectionDefinition } from './reviewInstances';

export const MIGRATED_FAMILIES = ['MCM', 'PR', 'PR_SKILLS_RADAR'] as const;
export type MigratedFamily = typeof MIGRATED_FAMILIES[number];
export const FAMILY_LABELS: Record<MigratedFamily, string> = { MCM: 'MCM', PR: 'PR', PR_SKILLS_RADAR: 'PR + Skills Radar' };
export interface MigratedField {
  key: string; name?: string; title: string; aptemType: number; order: number;
  mandatory?: boolean; description?: string; options?: string[];
  ifTrue?: MigratedField[]; ifFalse?: MigratedField[];
  semanticKey?: 'meeting_summary';
}
export interface MigratedDefinition {
  sections: { key: string; title: string; order: number; fields: MigratedField[] }[];
}
export interface MigratedTemplate {
  id: number; scope: 'GLOBAL' | 'PROGRAMME'; programme_key: string;
  review_family: MigratedFamily; name: string; is_active: boolean; updated_at: string;
  source_metadata: { sourceReviewId?: number; aptemReviewId?: string; programme?: string; copiedFromTemplateId?: number };
  fingerprint: string;
}
export interface TemplateDetail extends MigratedTemplate { definition: MigratedDefinition }
export interface TemplateResolution {
  review_family: MigratedFamily; resolved_template_id: number | null;
  resolved_scope: 'GLOBAL' | 'PROGRAMME' | null; inherited_from_global: boolean; programme_override_exists: boolean;
}
export interface TemplateLibrary {
  templates: MigratedTemplate[]; resolutions: TemplateResolution[]; can_manage: boolean;
}
export interface TemplatePreview { sections: ReviewSectionDefinition[]; readOnly: boolean }

const root = `${import.meta.env.VITE_API_BASE_URL || '/curriculum_api'}/curriculum/migrated-review-templates/`;
let csrfToken = '';

async function request<T>(path = '', method = 'GET', payload?: unknown, signal?: AbortSignal): Promise<T> {
  if (method !== 'GET' && !csrfToken) await listMigratedTemplates();
  const response = await fetch(`${root}${path}`, {
    method, credentials: 'include', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-CSRFToken': csrfToken } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(response.status === 403
      ? 'Curriculum or administrator access is required to manage migrated templates.'
      : data.detail || `Unable to load migrated templates (${response.status}).`);
  }
  if (data.csrf_token) csrfToken = data.csrf_token;
  return data as T;
}

export const listMigratedTemplates = (key = '', signal?: AbortSignal) =>
  request<TemplateLibrary>(`?programme_key=${encodeURIComponent(key)}`, 'GET', undefined, signal);
export const getMigratedTemplate = (id: number) => request<TemplateDetail>(`${id}/`);
export const importMigratedTemplate = (review_family: MigratedFamily, source_review_id: number, name: string) =>
  request<TemplateDetail>('', 'POST', { scope: 'GLOBAL', review_family, source_review_id, name });
export const createMigratedOverride = (programme_key: string, review_family: MigratedFamily, name: string) =>
  request<TemplateDetail>('', 'POST', { scope: 'PROGRAMME', programme_key, review_family, name });
export const updateMigratedTemplate = (template: MigratedTemplate, changes: { name?: string; definition?: MigratedDefinition; is_active?: boolean }) =>
  request<TemplateDetail>(`${template.id}/`, 'PATCH', { ...changes, updated_at: template.updated_at });
export const resetMigratedOverride = (template: MigratedTemplate) =>
  request<TemplateResolution>('reset/', 'POST', { template_id: template.id, programme_key: template.programme_key,
    review_family: template.review_family, updated_at: template.updated_at });
export const previewMigratedTemplate = (id: number) => request<TemplatePreview>(`preview/?template_id=${id}`);
export const previewMigratedDefinition = (definition: MigratedDefinition) => request<TemplatePreview>('preview/', 'POST', { definition });

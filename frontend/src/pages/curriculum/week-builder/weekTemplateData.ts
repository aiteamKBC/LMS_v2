// Data layer for the standalone Week Builder ("week templates").
//
// Reuses the module builder's component model wholesale (ModuleComponent /
// KsbMapping / ComponentSettings and the component-type definitions) so a
// template's components stay identical in shape to module weeks — that keeps
// the Phase 2 "import template into a module" step a straight copy.

import { arrayMove } from '@dnd-kit/sortable';
import {
  componentTypeGroups,
  componentTypes,
  createEmptyComponent,
  makeAuthoringId,
  type KsbMapping,
  type ModuleComponent,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';
import {
  getComponentDefinition,
  validateComponentAuthoring,
  type ModuleComponentType,
  type ModuleStatus,
  type ValidationIssue,
} from '@/pages/curriculum/module-builder/componentAuthoringModel';
import { fetchPointsRules } from '@/api/engagement';
import { fetchCurriculumOverview, type CurriculumGroup, type CurriculumModule, type CurriculumProgramme } from '@/lib/curriculumApi';

export { componentTypeGroups, componentTypes, createEmptyComponent, getComponentDefinition, makeAuthoringId };
export type { KsbMapping, ModuleComponent, ModuleComponentType, ModuleStatus };

// --- Week-builder component palette -----------------------------------------
// The week builder curates its own set of offered component types, independent
// of the module builder's `componentTypes`. Notably it presents ONE "Recorded
// Session" (backed by the rich `video` type) instead of separate Video +
// Recording Placeholder, and it offers Assignment. Labels are overridden only
// for the week builder — the shared model (and module builder) are untouched.
const WEEK_TYPE_LABELS: Partial<Record<string, string>> = {
  video: 'Recorded Session',
};

export function weekTypeLabel(type: string): string {
  return WEEK_TYPE_LABELS[type] || getComponentDefinition(type).label;
}

export const WEEK_BUILDER_TYPES: ModuleComponentType[] = [
  'live-session',
  'video',        // presented as "Recorded Session"
  'reading',
  'podcast',
  'powerpoint',
  'quiz',
  'assignment',
];

export interface WeekPaletteType {
  type: ModuleComponentType;
  label: string;
  icon: string;
  group: string;
  tone: string;
}

export const weekPaletteTypes: WeekPaletteType[] = WEEK_BUILDER_TYPES.map(type => {
  const definition = getComponentDefinition(type);
  return { type, label: weekTypeLabel(type), icon: definition.icon, group: definition.group, tone: definition.tone };
});

export const weekPaletteGroups: string[] = Array.from(new Set(weekPaletteTypes.map(item => item.group)));

// --- Curriculum scope (programmes / groups / modules) -----------------------
// The programme / group / module pickers and the editor's group + module-name
// resolution only need three lists. We request the overview's `compact=true`
// variant — it still returns programmes/groups/modules but drops the heavy
// extras (sessions, holidays, tutors, coaches, KSB frameworks, authoring
// details), which the week builder never uses. The result is cached in one
// in-flight promise and shared across the create modal and every editor open,
// so it's fetched once per session instead of on each open (which was firing
// the request repeatedly and made the pickers pop in late).
export interface CurriculumScope {
  programmes: CurriculumProgramme[];
  groups: CurriculumGroup[];
  modules: CurriculumModule[];
}

let scopeCache: Promise<CurriculumScope> | null = null;

export function loadCurriculumScope(options: { force?: boolean } = {}): Promise<CurriculumScope> {
  if (options.force) scopeCache = null;
  if (!scopeCache) {
    scopeCache = fetchCurriculumOverview(undefined, { compact: true })
      .then(overview => ({
        programmes: overview.programmes || [],
        groups: overview.groups || [],
        modules: overview.modules || [],
      }))
      .catch(error => {
        scopeCache = null; // never cache a failure — let the next caller retry
        throw error;
      });
  }
  return scopeCache;
}

export type WeekTemplateCourseType = 'paid' | 'free';

/** A week authored in the standalone builder, with its full component tree. */
export interface WeekTemplate {
  id: string;
  title: string;
  summary: string;
  learningOutcomes: string[];
  courseType: WeekTemplateCourseType;
  // Paid templates carry a programme + module + group scope; free templates leave these blank.
  programmeId: string;
  programmeName: string;
  moduleCatalogueId: string;
  groupId: string;
  groupName: string;
  status: ModuleStatus;
  ksbMappings: KsbMapping[];
  totalOtjh: number;
  points: number;
  componentCount: number;
  author: string;
  createdAt?: string;
  updatedAt?: string;
  components: ModuleComponent[];
}

/** Body accepted by create/update. Components reuse ModuleComponent verbatim. */
export interface WeekTemplateInput {
  courseType: WeekTemplateCourseType;
  title: string;
  summary?: string;
  learningOutcomes?: string[];
  programmeId?: string;
  programmeName?: string;
  moduleCatalogueId?: string;
  groupId?: string;
  groupName?: string;
  status?: string;
  ksbMappings?: KsbMapping[];
  author?: string;
  components?: ModuleComponent[];
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';

// Local request-init shape (mirrors curriculumApi.ts) so we don't reference the
// DOM `RequestInit` global, which the repo's eslint `no-undef` rule flags.
interface WeekTemplateRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

interface WeekTemplateCollection {
  schema: string;
  count: number;
  results: RawWeekTemplate[];
}

interface WeekTemplateDetailResponse {
  schema: string;
  weekTemplate: RawWeekTemplate;
}

interface RawWeekTemplate {
  id: string;
  title?: string;
  summary?: string;
  learningOutcomes?: string[];
  courseType?: string;
  programmeId?: string;
  programmeName?: string;
  moduleCatalogueId?: string;
  groupId?: string;
  groupName?: string;
  status?: string;
  ksbMappings?: KsbMapping[];
  totalOtjh?: number;
  points?: number;
  componentCount?: number;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  components?: RawWeekTemplateComponent[];
}

interface RawWeekTemplateComponent {
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  expectedOtjh?: number;
  points?: number;
  reflectionRequired?: boolean;
  workplaceEvidenceRequired?: boolean;
  tutorValidationRequired?: boolean;
  ksbMappings?: KsbMapping[];
  settings?: Record<string, unknown>;
}

async function request<T>(path: string, init?: WeekTemplateRequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = payload?.error ? `: ${payload.error}` : '';
    } catch {
      detail = '';
    }
    throw new Error(`Week template API returned ${response.status} for ${path}${detail}`);
  }
  return response.json();
}

function mapComponent(raw: RawWeekTemplateComponent, weekId: string): ModuleComponent {
  const type = (raw.type || 'reading') as ModuleComponentType;
  return {
    id: raw.id || makeAuthoringId('component'),
    weekId,
    type,
    title: raw.title || '',
    description: raw.description || '',
    expectedOtjh: Number(raw.expectedOtjh) || 0,
    points: Number(raw.points) || 0,
    reflectionRequired: Boolean(raw.reflectionRequired),
    workplaceEvidenceRequired: Boolean(raw.workplaceEvidenceRequired),
    tutorValidationRequired: Boolean(raw.tutorValidationRequired),
    ksbMappings: Array.isArray(raw.ksbMappings) ? raw.ksbMappings : [],
    // Fill type defaults, then overlay stored values. Unlike the module builder
    // we do NOT quarantine unknown keys — the week builder adds its own (e.g. a
    // live-session date) that the shared schema doesn't know about.
    settings: { ...getComponentDefinition(type).defaultSettings, ...(raw.settings || {}) } as ModuleComponent['settings'],
  };
}

// Component-type point defaults, sourced from the Engagement points rules the
// team maintains (so a "live session" is worth whatever the rule says). Falls
// back to the frontend definition default when a rule is missing/unreachable.
const TYPE_POINTS_RULE_KEY: Partial<Record<ModuleComponentType, string>> = {
  'live-session': 'live_session_attended',
  'video': 'recorded_session_attended',
  'podcast': 'podcast_attended',
  'powerpoint': 'powerpoint_viewed',
  'reading': 'pdf_viewed',
  'quiz': 'quiz_passed',
  'assignment': 'evidence_submitted',
};

// --- Quiz workspace integration ---------------------------------------------
// The week builder's quiz component talks directly to quiz_api (the same
// backend the standalone Quiz Workspace uses), so a quiz imported or created
// here is one and the same record as in the workspace. quiz_api is open (no
// auth) and lives under its own /quiz_api prefix, so these are plain fetches
// rather than going through the curriculum `request` helper.
const QUIZ_API_BASE = '/quiz_api';

// A quiz as returned by quiz_api's list/create endpoints (camelCase). Only the
// fields the week builder reads are typed here; the payload has many more.
export interface WorkspaceQuizSummary {
  id: number;
  title: string;
  programme?: string | null;
  programmeId?: number | string | null;
  module?: string | null;
  weekId?: string | null;
  questions?: number;
  status?: string;
  assessmentType?: string;
  duration?: number | null;
  passingGrade?: number | null;
}

export async function fetchWorkspaceQuizzes(_signal?: AbortSignal): Promise<WorkspaceQuizSummary[]> {
  const response = await fetch(`${QUIZ_API_BASE}/quizzes/?status=all&assessmentType=quiz`);
  if (!response.ok) throw new Error(`Quiz API returned ${response.status} for quizzes`);
  const data = await response.json();
  return Array.isArray(data?.results) ? data.results : [];
}

/** Moves the component with id `fromId` to the position currently held by `toId`. */
export function reorderComponents(components: ModuleComponent[], fromId: string, toId: string): ModuleComponent[] {
  const from = components.findIndex(c => c.id === fromId);
  const to = components.findIndex(c => c.id === toId);
  if (from < 0 || to < 0) return components;
  return arrayMove(components, from, to);
}

/** The programme/module scope a week (template or module week) is being authored in. */
export interface WeekScope {
  courseType: WeekTemplateCourseType;
  programmeId: string;
  programmeName: string;
  moduleName: string;
}

const normScope = (value?: string | number | null) => String(value ?? '').trim().toLowerCase();

/**
 * Quizzes matching a week's programme + module, or every non-trashed quiz for
 * a free-course week (which has no programme/module to scope by).
 */
export function filterQuizzesForScope(quizzes: WorkspaceQuizSummary[], weekScope: WeekScope): WorkspaceQuizSummary[] {
  return quizzes.filter(quiz => {
    if (normScope(quiz.status) === 'trash') return false;
    const noScope = weekScope.courseType !== 'paid' || (!weekScope.programmeName && !weekScope.programmeId);
    const programmeOk = noScope || normScope(quiz.programmeId) === normScope(weekScope.programmeId) || normScope(quiz.programme) === normScope(weekScope.programmeName);
    const moduleOk = !weekScope.moduleName || normScope(quiz.module) === normScope(weekScope.moduleName);
    return programmeOk && moduleOk;
  });
}

export interface WeekComponentUploadResult {
  uploaded: boolean;
  componentId: string;
  file: { fileName: string; url: string; size: number; contentType: string; componentType: string };
}

// Week template components live in their own backend table (not the module
// builder's `components` table), so uploads go through a dedicated endpoint
// that just stores the file and returns its metadata — the caller writes that
// into the component's own settings and it's persisted on the next Save,
// the same way every other field on a week component is.
export async function uploadWeekComponentResource(componentId: string, file: File, componentType: 'reading' | 'podcast' | 'powerpoint' | 'assignment'): Promise<WeekComponentUploadResult> {
  const form = new FormData();
  form.set('file', file);
  form.set('componentType', componentType);
  const response = await fetch(`${API_BASE_URL}/curriculum/week-components/${encodeURIComponent(componentId)}/upload/`, { method: 'POST', body: form });
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = payload?.error ? `: ${payload.error}` : '';
    } catch {
      detail = '';
    }
    throw new Error(`Week template API returned ${response.status} for upload${detail}`);
  }
  return response.json();
}

export async function fetchComponentPointsDefaults(): Promise<Partial<Record<ModuleComponentType, number>>> {
  try {
    const rules = await fetchPointsRules();
    const byKey = new Map(rules.map(rule => [rule.key || '', rule.points]));
    const out: Partial<Record<ModuleComponentType, number>> = {};
    (Object.entries(TYPE_POINTS_RULE_KEY) as [ModuleComponentType, string][]).forEach(([type, key]) => {
      if (byKey.has(key)) out[type] = byKey.get(key) as number;
    });
    return out;
  } catch {
    return {};
  }
}

// Week-builder validation: reuse the shared per-type checks but drop the
// "unsupported setting" noise, since the week builder intentionally stores keys
// the module builder's schema doesn't declare.
export function validateWeekComponent(component: ModuleComponent): ValidationIssue[] {
  return validateComponentAuthoring(component).filter(issue => !issue.message.startsWith('Unsupported setting'));
}

function mapWeekTemplate(raw: RawWeekTemplate): WeekTemplate {
  const courseType: WeekTemplateCourseType = raw.courseType === 'free' ? 'free' : 'paid';
  return {
    id: raw.id,
    title: raw.title || '',
    summary: raw.summary || '',
    learningOutcomes: Array.isArray(raw.learningOutcomes) ? raw.learningOutcomes : [],
    courseType,
    programmeId: raw.programmeId || '',
    programmeName: raw.programmeName || '',
    moduleCatalogueId: raw.moduleCatalogueId || '',
    groupId: raw.groupId || '',
    groupName: raw.groupName || '',
    status: (raw.status || 'draft') as ModuleStatus,
    ksbMappings: Array.isArray(raw.ksbMappings) ? raw.ksbMappings : [],
    totalOtjh: Number(raw.totalOtjh) || 0,
    points: Number(raw.points) || 0,
    componentCount: Number(raw.componentCount) || 0,
    author: raw.author || '',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    components: (raw.components || []).map(component => mapComponent(component, raw.id)),
  };
}

export interface FetchWeekTemplatesOptions {
  courseType?: WeekTemplateCourseType;
  programmeId?: string;
  moduleCatalogueId?: string;
  groupId?: string;
  status?: string;
  search?: string;
}

export async function fetchWeekTemplates(options: FetchWeekTemplatesOptions = {}, signal?: AbortSignal): Promise<WeekTemplate[]> {
  const query = new URLSearchParams();
  if (options.courseType) query.set('courseType', options.courseType);
  if (options.programmeId) query.set('programmeId', options.programmeId);
  if (options.moduleCatalogueId) query.set('moduleCatalogueId', options.moduleCatalogueId);
  if (options.groupId) query.set('groupId', options.groupId);
  if (options.status) query.set('status', options.status);
  if (options.search) query.set('search', options.search);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const payload = await request<WeekTemplateCollection>(`/curriculum/week-templates/${suffix}`, { signal });
  return (payload.results || []).map(mapWeekTemplate);
}

/**
 * Week templates eligible to be imported into a module: free-course templates
 * always qualify (they aren't tied to any programme); paid templates qualify
 * only when they match the target programme. Non-trashed only. Deliberately
 * has NO "nothing matched, so show everything" fallback — an empty result
 * means there's nothing to import for this programme, not "show other
 * programmes' weeks."
 */
export function filterWeekTemplatesForScope(templates: WeekTemplate[], scope: { programmeId: string; programmeName: string }): WeekTemplate[] {
  const norm = (value?: string) => String(value ?? '').trim().toLowerCase();
  return templates.filter(template => {
    if (norm(template.status) === 'trash') return false;
    if (template.courseType === 'free') return true;
    if (!scope.programmeId && !scope.programmeName) return true;
    return norm(template.programmeId) === norm(scope.programmeId) || norm(template.programmeName) === norm(scope.programmeName);
  });
}

export async function fetchWeekTemplateDetail(id: string, signal?: AbortSignal): Promise<WeekTemplate> {
  const payload = await request<WeekTemplateDetailResponse>(`/curriculum/week-templates/${encodeURIComponent(id)}/`, { signal });
  return mapWeekTemplate(payload.weekTemplate);
}

export async function createWeekTemplate(input: WeekTemplateInput): Promise<WeekTemplate> {
  const payload = await request<WeekTemplateDetailResponse>('/curriculum/week-templates/', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return mapWeekTemplate(payload.weekTemplate);
}

export async function updateWeekTemplate(id: string, input: Partial<WeekTemplateInput>): Promise<WeekTemplate> {
  const payload = await request<WeekTemplateDetailResponse>(`/curriculum/week-templates/${encodeURIComponent(id)}/`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return mapWeekTemplate(payload.weekTemplate);
}

export async function deleteWeekTemplate(id: string): Promise<void> {
  await request<{ deleted: boolean }>(`/curriculum/week-templates/${encodeURIComponent(id)}/`, { method: 'DELETE' });
}

/** A blank in-memory template for the editor before the first save. */
export function createEmptyWeekTemplate(courseType: WeekTemplateCourseType): WeekTemplate {
  return {
    id: makeAuthoringId('WT'),
    title: '',
    summary: '',
    learningOutcomes: [],
    courseType,
    programmeId: '',
    programmeName: '',
    moduleCatalogueId: '',
    groupId: '',
    groupName: '',
    status: 'draft',
    ksbMappings: [],
    totalOtjh: 0,
    points: 0,
    componentCount: 0,
    author: '',
    components: [],
  };
}

/** Recompute the roll-up metrics from the current component list. */
export function recalcWeekTemplate(template: WeekTemplate): WeekTemplate {
  const totalOtjh = template.components.reduce((sum, component) => sum + (Number(component.expectedOtjh) || 0), 0);
  const points = template.components.reduce((sum, component) => sum + (Number(component.points) || 0), 0);
  return {
    ...template,
    totalOtjh: Math.round(totalOtjh * 100) / 100,
    points,
    componentCount: template.components.length,
  };
}

/** Build the create/update body from an editor template. */
export function toWeekTemplateInput(template: WeekTemplate): WeekTemplateInput {
  return {
    courseType: template.courseType,
    title: template.title,
    summary: template.summary,
    learningOutcomes: template.learningOutcomes,
    programmeId: template.programmeId,
    programmeName: template.programmeName,
    moduleCatalogueId: template.moduleCatalogueId,
    groupId: template.groupId,
    groupName: template.groupName,
    status: template.status,
    ksbMappings: template.ksbMappings,
    author: template.author,
    components: template.components,
  };
}

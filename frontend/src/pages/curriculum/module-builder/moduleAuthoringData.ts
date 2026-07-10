import type { CurriculumKsbEntry, CurriculumModule } from '@/lib/curriculumApi';

export type ModuleStatus = 'draft' | 'review' | 'published' | string;
export type KsbMappingType = 'main' | 'secondary' | 'practice';
export type ModuleComponentType =
  | 'live-session'
  | 'recording-placeholder'
  | 'video'
  | 'podcast'
  | 'reading'
  | 'powerpoint'
  | 'quiz'
  | 'monthly-ksb-quiz'
  | 'reflection'
  | 'workplace-evidence'
  | 'assignment'
  | 'checkpoint'
  | 'coaching-preparation';

export interface KsbMapping {
  id: string;
  ksbId: string;
  code: string;
  description: string;
  type: KsbMappingType;
}

export interface CompletionCriteria {
  quizzesCompletedRequired: boolean;
  checkpointsCompletedRequired: boolean;
  averageScoreRequiredEnabled: boolean;
  averageScoreRequired: number;
  totalScoreRequiredEnabled: boolean;
  totalScoreRequired: number;
  additionalNotes: string;
}

export interface AdvancedModuleDetails {
  intent: string;
  learnerBenefit: string;
  employerBenefit: string;
  sequencePurpose: string;
}

export interface ModuleComponent {
  id: string;
  moduleId?: string;
  weekId: string;
  type: ModuleComponentType;
  title: string;
  description: string;
  expectedOtjh: number;
  points: number;
  reflectionRequired: boolean;
  workplaceEvidenceRequired: boolean;
  tutorValidationRequired: boolean;
  ksbMappings: KsbMapping[];
  settings: Record<string, string | number | boolean | string[]>;
}

export interface ModuleWeek {
  id: string;
  moduleId: string;
  weekNumber: number;
  title: string;
  summary: string;
  learningOutcomes: string[];
  components: ModuleComponent[];
  ksbMappings: KsbMapping[];
}

export interface ModuleCatalogueItem {
  id: string;
  catalogueId: string;
  programmeId: string;
  programmeName: string;
  cohortId?: string;
  cohort?: string;
  groupId?: string;
  group?: string;
  title: string;
  description: string;
  status: ModuleStatus;
  authoringStatus?: ModuleStatus;
  sourceType?: string;
  sourceId?: string;
  importedFromTrainingPlanId?: string;
  deliveryStatus?: string;
  deliveryMetadata?: Record<string, string>;
  sessionsNumber?: number;
  startDate?: string;
  endDate?: string;
  weeks: number;
  totalOtjh: number;
  declaredTotalOtjh?: number;
  ksbCount: number;
  lessonCount: number;
  quizCount: number;
  qualityScore: number;
  moduleKsbMappings: KsbMapping[];
  completionCriteria: CompletionCriteria;
  advancedDetails: AdvancedModuleDetails;
  background: string;
  epaRequirements: string[];
  qualificationOutcomes: string[];
  weekStructure: ModuleWeek[];
  sourceModule?: CurriculumModule;
}

export interface KsbOption {
  id: string;
  code: string;
  description: string;
  type?: string;
}

const STRUCTURE_STORE_KEY = 'lms.module-builder.structures.v1';
const LOCAL_MODULE_STORE_KEY = 'lms.module-builder.local-modules.v1';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';
const DEV_FALLBACK = Boolean(import.meta.env.DEV);

export const MODULE_BUILDER_WIZARD_DRAFT_PREFIX = 'lms.module-builder.wizard-draft.';
const MODULE_BUILDER_SYNC_PREFIX = 'lms.module-builder.sync.';

export function wizardDraftLocalIdFromKey(storageKey: string) {
  return String(storageKey || '').startsWith(MODULE_BUILDER_WIZARD_DRAFT_PREFIX)
    ? String(storageKey).slice(MODULE_BUILDER_WIZARD_DRAFT_PREFIX.length)
    : '';
}

export function moduleBuilderSyncKey(identifier: string) {
  return `${MODULE_BUILDER_SYNC_PREFIX}${identifier}`;
}

export function readModuleBuilderSync(identifier: string): ModuleCatalogueItem | null {
  if (typeof window === 'undefined' || !identifier) return null;
  try {
    const raw = window.localStorage.getItem(moduleBuilderSyncKey(identifier));
    if (!raw) return null;
    const payload = JSON.parse(raw) as { module?: ModuleCatalogueItem };
    return payload.module ? recalculateModule(payload.module) : null;
  } catch {
    return null;
  }
}

export function writeModuleBuilderSync(module: ModuleCatalogueItem, wizardDraftLocalId = '') {
  if (typeof window === 'undefined') return;
  const payload = JSON.stringify({
    module: recalculateModule(module),
    catalogueId: module.catalogueId,
    wizardDraftLocalId,
    updatedAt: new Date().toISOString(),
  });
  window.localStorage.setItem(moduleBuilderSyncKey(module.catalogueId), payload);
  if (wizardDraftLocalId) window.localStorage.setItem(moduleBuilderSyncKey(wizardDraftLocalId), payload);
}

export const componentTypes: Array<{ type: ModuleComponentType; label: string; icon: string; group: string; tone: string }> = [
  { type: 'live-session', label: 'Live Teams Session', icon: 'ri-group-line', group: 'Live & recorded', tone: 'violet' },
  { type: 'recording-placeholder', label: 'Recording Placeholder', icon: 'ri-play-circle-line', group: 'Live & recorded', tone: 'slate' },
  { type: 'video', label: 'Video', icon: 'ri-video-line', group: 'Learning materials', tone: 'rose' },
  { type: 'podcast', label: 'Podcast', icon: 'ri-mic-line', group: 'Learning materials', tone: 'amber' },
  { type: 'reading', label: 'Reading Material', icon: 'ri-book-open-line', group: 'Learning materials', tone: 'emerald' },
  { type: 'powerpoint', label: 'PowerPoint', icon: 'ri-file-ppt-2-line', group: 'Learning materials', tone: 'orange' },
  { type: 'quiz', label: 'Quiz', icon: 'ri-questionnaire-line', group: 'Assessment', tone: 'sky' },
  { type: 'assignment', label: 'Assignment', icon: 'ri-file-list-3-line', group: 'Assessment', tone: 'purple' },
  { type: 'reflection', label: 'Reflection', icon: 'ri-chat-quote-line', group: 'Assessment', tone: 'teal' },
  { type: 'workplace-evidence', label: 'Evidence Task', icon: 'ri-upload-cloud-2-line', group: 'Assessment', tone: 'lime' },
  { type: 'checkpoint', label: 'Checkpoint Quiz', icon: 'ri-checkbox-circle-line', group: 'Monthly cycle', tone: 'blue' },
  { type: 'monthly-ksb-quiz', label: 'Monthly KSB Quiz', icon: 'ri-award-line', group: 'Monthly cycle', tone: 'violet' },
  { type: 'coaching-preparation', label: 'Coaching Preparation', icon: 'ri-user-heart-line', group: 'Monthly cycle', tone: 'pink' },
];

export const componentTypeGroups = ['Live & recorded', 'Learning materials', 'Assessment', 'Monthly cycle'];

export const mockKsbOptions: KsbOption[] = [
  { id: 'mock-k1', code: 'K1', description: 'Principles, practices and regulation relevant to the occupational standard.' },
  { id: 'mock-k2', code: 'K2', description: 'Tools, systems and sources of information used to complete role-specific tasks.' },
  { id: 'mock-k3', code: 'K3', description: 'Approaches to communication, collaboration and stakeholder engagement.' },
  { id: 'mock-s1', code: 'S1', description: 'Plan, prioritise and deliver work to agreed quality, time and compliance expectations.' },
  { id: 'mock-s2', code: 'S2', description: 'Analyse information, solve problems and recommend practical improvements.' },
  { id: 'mock-s3', code: 'S3', description: 'Use digital tools and workplace systems to produce reliable outputs.' },
  { id: 'mock-b1', code: 'B1', description: 'Act professionally, ethically and with accountability for own work.' },
  { id: 'mock-b2', code: 'B2', description: 'Commit to continuous development, reflection and inclusive working.' },
];

export const emptyCompletionCriteria = (): CompletionCriteria => ({
  quizzesCompletedRequired: false,
  checkpointsCompletedRequired: false,
  averageScoreRequiredEnabled: false,
  averageScoreRequired: 70,
  totalScoreRequiredEnabled: false,
  totalScoreRequired: 100,
  additionalNotes: '',
});

export const emptyAdvancedDetails = (): AdvancedModuleDetails => ({
  intent: '',
  learnerBenefit: '',
  employerBenefit: '',
  sequencePurpose: '',
});

function authoringIdPrefix(prefix: string) {
  const text = String(prefix || '').toUpperCase();
  if (text.startsWith('MOD')) return 'MOD';
  if (text.startsWith('WEEK')) return 'WEEK';
  if (text.startsWith('COMP')) return 'COMP';
  if (text.startsWith('KSB')) return 'KSBMAP';
  return text.replace(/[^A-Z0-9]+/g, '') || 'ID';
}

export function makeAuthoringId(prefix: string) {
  const timestamp = new Date().toISOString().replace(/\D/g, '');
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${authoringIdPrefix(prefix)}-${timestamp}${suffix}`;
}

const makeId = makeAuthoringId;

export function createEmptyComponent(weekId: string, type: ModuleComponentType, index: number): ModuleComponent {
  const label = componentTypes.find(item => item.type === type)?.label || 'Component';
  return {
    id: makeId('component'),
    weekId,
    type,
    title: `${label} ${index}`,
    description: '',
    expectedOtjh: type === 'live-session' ? 1.5 : ['checkpoint', 'monthly-ksb-quiz', 'coaching-preparation'].includes(type) ? 0.5 : 1,
    points: ['quiz', 'assignment', 'checkpoint', 'monthly-ksb-quiz', 'workplace-evidence'].includes(type) ? 20 : 10,
    reflectionRequired: ['reflection', 'coaching-preparation'].includes(type),
    workplaceEvidenceRequired: type === 'workplace-evidence',
    tutorValidationRequired: ['reflection', 'workplace-evidence', 'assignment', 'coaching-preparation'].includes(type),
    ksbMappings: [],
    settings: getDefaultComponentSettings(type),
  };
}

export function createEmptyWeek(moduleId: string, weekNumber: number): ModuleWeek {
  return {
    id: makeId('week'),
    moduleId,
    weekNumber,
    title: `Week ${weekNumber}`,
    summary: '',
    learningOutcomes: [],
    components: [],
    ksbMappings: [],
  };
}

export function createLocalModuleDraft(input: { programme: string; title: string; description: string; weeks: number; status: ModuleStatus; catalogueId?: string; programmeId?: string; cohortId?: string; cohortName?: string; groupId?: string; groupName?: string; sessionsNumber?: number; startDate?: string; endDate?: string }): ModuleCatalogueItem {
  const catalogueId = input.catalogueId || makeAuthoringId('MOD');
  const id = `local-${catalogueId}`;
  const weekCount = Math.max(0, Math.round(Number(input.weeks) || 0));
  const weekStructure = Array.from({ length: weekCount }, (_, index) => createEmptyWeek(id, index + 1));
  return recalculateModule({
    id,
    catalogueId,
    programmeId: input.programmeId || input.programme || 'programme-local',
    programmeName: input.programme || 'Unassigned programme',
    cohortId: input.cohortId || '',
    cohort: input.cohortName || '',
    groupId: input.groupId || '',
    group: input.groupName || '',
    title: input.title,
    description: input.description,
    status: input.status || 'draft',
    sessionsNumber: Math.max(0, Math.round(Number(input.sessionsNumber ?? input.weeks) || 0)),
    startDate: input.startDate || '',
    endDate: input.endDate || '',
    weeks: weekStructure.length,
    totalOtjh: 0,
    ksbCount: 0,
    lessonCount: 0,
    quizCount: 0,
    qualityScore: 0,
    moduleKsbMappings: [],
    completionCriteria: emptyCompletionCriteria(),
    advancedDetails: emptyAdvancedDetails(),
    background: '',
    epaRequirements: [],
    qualificationOutcomes: [],
    weekStructure,
    deliveryMetadata: {
      cohortId: input.cohortId || '',
      cohort: input.cohortName || '',
      groupId: input.groupId || '',
      group: input.groupName || '',
    },
  });
}

export async function createNewModule(input: { programme: string; title: string; description: string; weeks: number; status: ModuleStatus; programmeId?: string; cohortId?: string; cohortName?: string; groupId?: string; groupName?: string; sessionsNumber?: number; startDate?: string; endDate?: string }) {
  const draft = createLocalModuleDraft(input);
  try {
    const response = await apiJson<{ created: boolean; moduleCatalogueId?: string; module?: ModuleCatalogueItem }>('/curriculum/modules/', {
      method: 'POST',
      body: JSON.stringify({
        title: draft.title,
        moduleType: 'authoring',
        sourceType: 'authoring',
        description: draft.description,
        programmeId: draft.programmeId,
        programme: draft.programmeName,
        programmeName: draft.programmeName,
        cohortId: input.cohortId || '',
        cohortName: input.cohortName || '',
        groupId: input.groupId || '',
        groupName: input.groupName || '',
        status: draft.status || 'draft',
        sessionsNumber: draft.sessionsNumber ?? draft.weeks,
        startDate: draft.startDate || '',
        endDate: draft.endDate || '',
        weekStructure: draft.weekStructure,
        completionCriteria: draft.completionCriteria,
        advancedDetails: draft.advancedDetails,
        moduleKsbMappings: draft.moduleKsbMappings,
        background: draft.background,
        epaRequirements: draft.epaRequirements,
        qualificationOutcomes: draft.qualificationOutcomes,
      }),
    });
    return recalculateModule(response.module || { ...draft, catalogueId: response.moduleCatalogueId || draft.catalogueId });
  } catch (err) {
    if (!DEV_FALLBACK) throw err;
    persistLocalModule(draft);
    return withLocalWarning(draft);
  }
}

export async function duplicateModuleStructure(source: ModuleCatalogueItem) {
  const copyId = `copy-${Date.now().toString(36)}`;
  const cloneMappings = (mappings: KsbMapping[] = [], scope: string) => mappings.map((mapping, index) => ({
    ...mapping,
    id: makeId(`ksb-${scope}-${index + 1}`),
  }));
  const duplicate = recalculateModule({
    ...source,
    id: copyId,
    catalogueId: makeAuthoringId('MOD'),
    title: `${source.title} copy`,
    status: 'draft',
    sourceModule: undefined,
    moduleKsbMappings: cloneMappings(source.moduleKsbMappings, 'module'),
    completionCriteria: { ...source.completionCriteria },
    advancedDetails: { ...source.advancedDetails },
    epaRequirements: [...(source.epaRequirements || [])],
    qualificationOutcomes: [...(source.qualificationOutcomes || [])],
    weekStructure: source.weekStructure.map((week, weekIndex) => {
      const weekId = makeId(`week-copy-${weekIndex + 1}`);
      return {
        ...week,
        id: weekId,
        moduleId: copyId,
        learningOutcomes: [...(week.learningOutcomes || [])],
        ksbMappings: cloneMappings(week.ksbMappings, `week-${weekIndex + 1}`),
        components: week.components.map((component, componentIndex) => ({
          ...component,
          id: makeId(`component-copy-${weekIndex + 1}-${componentIndex + 1}`),
          weekId,
          ksbMappings: cloneMappings(component.ksbMappings, `component-${weekIndex + 1}-${componentIndex + 1}`),
          settings: { ...(component.settings || {}) },
        })),
      };
    }),
  });

  try {
    const created = await createNewModule({
      programme: duplicate.programmeName,
      title: duplicate.title,
      description: duplicate.description,
      weeks: Math.max(1, duplicate.weekStructure.length),
      status: 'draft',
    });
    const payload = recalculateModule({ ...duplicate, catalogueId: created.catalogueId, id: created.id || duplicate.id });
    const saved = await saveModuleStructure(payload.catalogueId, payload);
    return saved;
  } catch (err) {
    if (!DEV_FALLBACK) throw err;
    persistLocalModule(duplicate);
    return withLocalWarning(duplicate);
  }
}

export async function deleteModuleStructure(moduleCatalogueId: string) {
  await apiJson<{ deleted?: boolean; archived?: boolean; deletedAuthoring?: boolean; id?: string }>(`/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/`, {
    method: 'DELETE',
  });
  removeLocalModuleStructure(moduleCatalogueId);
}

export async function loadModuleStructure(catalogueId: string): Promise<ModuleCatalogueItem | null> {
  try {
    return recalculateModule(await apiJson<ModuleCatalogueItem>(`/curriculum/modules/${encodeURIComponent(catalogueId)}/structure/`, {
      timeoutMs: 8000,
    }));
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    if (status === 404) return loadSavedModuleStructure(catalogueId);
    if (!DEV_FALLBACK) throw err;
    const local = loadSavedModuleStructure(catalogueId);
    return local ? withLocalWarning(local) : null;
  }
}

export async function updateModuleSettings(moduleCatalogueId: string, payload: Partial<ModuleCatalogueItem>) {
  try {
    const response = await apiJson<{ updated: boolean; module: ModuleCatalogueItem }>(`/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/settings/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return recalculateModule(response.module);
  } catch (err) {
    if (!DEV_FALLBACK) throw err;
    const local = loadSavedModuleStructure(moduleCatalogueId);
    if (!local) throw err;
    const next = recalculateModule({ ...local, ...payload });
    persistLocalStructure(moduleCatalogueId, next);
    return withLocalWarning(next);
  }
}

export function createLegacyLocalModule(input: { programme: string; title: string; description: string; weeks: number; status: ModuleStatus }): ModuleCatalogueItem {
  const catalogueId = makeAuthoringId('MOD');
  const id = `local-${catalogueId}`;
  const weekStructure = Array.from({ length: Math.max(1, input.weeks || 1) }, (_, index) => createEmptyWeek(id, index + 1));
  return recalculateModule({
    id,
    catalogueId,
    programmeId: input.programme || 'programme-local',
    programmeName: input.programme || 'Unassigned programme',
    title: input.title,
    description: input.description,
    status: input.status || 'draft',
    sessionsNumber: weekStructure.length,
    startDate: '',
    endDate: '',
    weeks: weekStructure.length,
    totalOtjh: 0,
    ksbCount: 0,
    lessonCount: 0,
    quizCount: 0,
    qualityScore: 0,
    moduleKsbMappings: [],
    completionCriteria: emptyCompletionCriteria(),
    advancedDetails: emptyAdvancedDetails(),
    background: '',
    epaRequirements: [],
    qualificationOutcomes: [],
    weekStructure,
  });
}

export function curriculumModuleToCatalogue(module: CurriculumModule): ModuleCatalogueItem {
  const catalogueId = String(module.catalogueId || module.sourceId || module.id);
  const id = `module-${catalogueId}`;
  const title = cleanUserFacingText(module.name) || `Module ${catalogueId}`;
  const description = cleanUserFacingText(module.notes || '');
  return recalculateModule({
    id,
    catalogueId,
    programmeId: module.programme || 'programme',
    programmeName: module.programme || 'Unassigned programme',
    title,
    description,
    status: module.status || 'draft',
    authoringStatus: module.authoringStatus || module.status || 'draft',
    sourceType: module.sourceType,
    sourceId: module.sourceId ? String(module.sourceId) : undefined,
    importedFromTrainingPlanId: module.importedFromTrainingPlanId,
    deliveryStatus: module.deliveryStatus,
    sessionsNumber: module.sessionsNumber || module.weeks || module.sessionNames?.length || 0,
    startDate: module.startDate || '',
    endDate: module.endDate || '',
    weeks: module.weeks || module.sessionNames?.length || 1,
    totalOtjh: 0,
    ksbCount: module.ksbCount || module.ksbCodes?.length || 0,
    lessonCount: module.lessons || module.sessionNames?.length || 0,
    quizCount: module.quizzes || 0,
    qualityScore: 0,
    moduleKsbMappings: (module.ksbCodes || []).map((code, index) => ({
      id: makeAuthoringId('KSBMAP'),
      ksbId: code,
      code,
      description: `Mapped KSB ${code}`,
      type: index < 3 ? 'main' : 'secondary',
    })),
    completionCriteria: emptyCompletionCriteria(),
    advancedDetails: emptyAdvancedDetails(),
    background: '',
    epaRequirements: [],
    qualificationOutcomes: [],
    weekStructure: [],
    sourceModule: module,
  });
}

export function getDefaultStructure(module: ModuleCatalogueItem): ModuleCatalogueItem {
  if (module.weekStructure.length) return recalculateModule(module);

  const source = module.sourceModule;
  const sessionNames = source?.sessionNames || [];
  const weekCount = Math.max(1, source?.weeks || sessionNames.length || module.weeks || 1);
  const weekStructure = Array.from({ length: weekCount }, (_, index) => {
    const week = createEmptyWeek(module.id, index + 1);
    const sessionTitle = sessionNames[index] || (sessionNames.length === 1 ? sessionNames[0] : '');
    if (sessionTitle) {
      week.components = [
        {
          ...createEmptyComponent(week.id, 'live-session', 1),
          title: sessionTitle,
          description: 'Placeholder lesson derived from the existing module catalogue.',
          ksbMappings: module.moduleKsbMappings.slice(0, 2),
        },
      ];
    }
    return week;
  });

  return recalculateModule({ ...module, weekStructure });
}

export function recalculateModule(module: ModuleCatalogueItem): ModuleCatalogueItem {
  const moduleId = String(module.catalogueId || module.id);
  const normalisedWeeks = module.weekStructure.map((week, index) => {
    const weekId = String(week.id || makeAuthoringId('WEEK'));
    return {
      ...week,
      id: weekId,
      moduleId,
      weekNumber: index + 1,
      components: (week.components || []).map(component => ({
        ...component,
        moduleId,
        weekId,
      })),
    };
  });
  const allComponents = normalisedWeeks.flatMap(week => week.components);
  const hasStructure = module.weekStructure.length > 0;
  const componentKsbCodes = new Set(allComponents.flatMap(component => component.ksbMappings.map(mapping => mapping.code)));
  (module.moduleKsbMappings || []).forEach(mapping => componentKsbCodes.add(mapping.code));
  normalisedWeeks.forEach(week => week.ksbMappings.forEach(mapping => componentKsbCodes.add(mapping.code)));
  const totalOtjh = allComponents.reduce((total, component) => total + Number(component.expectedOtjh || 0), 0);
  const totalPoints = allComponents.reduce((total, component) => total + Number(component.points || 0), 0);
  const quality = calculateQualityScore({ ...module, totalOtjh, ksbCount: componentKsbCodes.size });

  return {
    ...module,
    weeks: module.weekStructure.length,
    totalOtjh,
    declaredTotalOtjh: module.declaredTotalOtjh,
    ksbCount: hasStructure ? componentKsbCodes.size : module.ksbCount,
    lessonCount: hasStructure ? allComponents.length : module.lessonCount,
    quizCount: hasStructure ? allComponents.filter(component => ['quiz', 'checkpoint', 'monthly-ksb-quiz'].includes(component.type)).length : module.quizCount,
    qualityScore: quality,
    weekStructure: normalisedWeeks,
    description: cleanUserFacingText(module.description || module.sourceModule?.notes || ''),
    background: module.background || '',
    epaRequirements: module.epaRequirements || [],
    qualificationOutcomes: module.qualificationOutcomes || [],
  };
}

export function calculateQualityChecklist(module: ModuleCatalogueItem) {
  const allComponents = module.weekStructure.flatMap(week => week.components);
  const liveSessions = allComponents.filter(component => component.type === 'live-session');
  const criteriaConfigured =
    module.completionCriteria.quizzesCompletedRequired ||
    module.completionCriteria.checkpointsCompletedRequired ||
    module.completionCriteria.averageScoreRequiredEnabled ||
    module.completionCriteria.totalScoreRequiredEnabled ||
    Boolean(module.completionCriteria.additionalNotes.trim());
  const expectedTotal = module.weekStructure.reduce(
    (total, week) => total + week.components.reduce((weekTotal, component) => weekTotal + Number(component.expectedOtjh || 0), 0),
    0,
  );
  const declaredTotal = typeof module.declaredTotalOtjh === 'number' && module.declaredTotalOtjh > 0 ? module.declaredTotalOtjh : module.totalOtjh;

  return [
    { label: 'Number of weeks defined', passed: module.weekStructure.length > 0 },
    { label: 'Each week has a title', passed: module.weekStructure.every(week => week.title.trim()) },
    { label: 'Each week has at least one component', passed: module.weekStructure.every(week => week.components.length > 0) },
    { label: 'Teams session placeholder where expected', passed: liveSessions.every(component => component.title.trim()) },
    { label: 'Recording placeholder for live sessions', passed: liveSessions.every(component => typeof component.settings.recordingExpected === 'boolean') },
    { label: 'All components have estimated OTJH greater than 0', passed: allComponents.length > 0 && allComponents.every(component => Number(component.expectedOtjh) > 0) },
    { label: 'All components have at least one KSB mapping', passed: allComponents.length > 0 && allComponents.every(component => component.ksbMappings.length > 0) },
    { label: 'Every mapped KSB is classified', passed: allMappedKsbs(module).every(mapping => ['main', 'secondary', 'practice'].includes(mapping.type)) },
    { label: 'Completion criteria configured', passed: criteriaConfigured },
    { label: 'Total module OTJH matches component sum', passed: Math.abs(declaredTotal - expectedTotal) < 0.01 },
  ];
}

export function calculateQualityScore(module: ModuleCatalogueItem) {
  const checklist = calculateQualityChecklist(module);
  const passed = checklist.filter(item => item.passed).length;
  return Math.round((passed / checklist.length) * 100);
}

export function allMappedKsbs(module: ModuleCatalogueItem) {
  return [
    ...module.moduleKsbMappings,
    ...module.weekStructure.flatMap(week => week.ksbMappings),
    ...module.weekStructure.flatMap(week => week.components.flatMap(component => component.ksbMappings)),
  ];
}

export function flattenKsbEntries(entries: CurriculumKsbEntry[] = []): KsbOption[] {
  return entries.map(entry => ({
    id: String(entry.id || entry.code),
    code: entry.code || entry.fullCode || entry.rawCode || String(entry.id),
    description: entry.description || entry.title || '',
    type: entry.type,
  }));
}

export function loadSavedModuleStructure(catalogueId: string): ModuleCatalogueItem | null {
  if (typeof window === 'undefined') return null;
  const store = readStore<Record<string, ModuleCatalogueItem>>(STRUCTURE_STORE_KEY, {});
  return store[catalogueId] || null;
}

export async function saveModuleStructure(moduleCatalogueId: string, payload: ModuleCatalogueItem) {
  const body = recalculateModule(payload);
  try {
    const saved = recalculateModule(await apiJson<ModuleCatalogueItem>(`/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/structure/`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      timeoutMs: 45000,
    }));
    persistLocalStructure(saved.catalogueId || moduleCatalogueId, saved);
    return saved;
  } catch (err) {
    if (!DEV_FALLBACK) throw err;
    return withLocalWarning(persistLocalStructure(moduleCatalogueId, body));
  }
}

export function loadLocalModules(): ModuleCatalogueItem[] {
  if (typeof window === 'undefined') return [];
  return readStore<ModuleCatalogueItem[]>(LOCAL_MODULE_STORE_KEY, []).map(module => recalculateModule(module));
}

export function saveLocalModules(modules: ModuleCatalogueItem[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCAL_MODULE_STORE_KEY, JSON.stringify(modules.map(module => recalculateModule(module))));
}

function persistLocalStructure(moduleCatalogueId: string, payload: ModuleCatalogueItem) {
  const store = readStore<Record<string, ModuleCatalogueItem>>(STRUCTURE_STORE_KEY, {});
  store[moduleCatalogueId] = recalculateModule(payload);
  window.localStorage.setItem(STRUCTURE_STORE_KEY, JSON.stringify(store));
  return store[moduleCatalogueId];
}

function persistLocalModule(module: ModuleCatalogueItem) {
  const modules = loadLocalModules();
  const next = modules.some(item => item.catalogueId === module.catalogueId)
    ? modules.map(item => item.catalogueId === module.catalogueId ? module : item)
    : [...modules, module];
  saveLocalModules(next);
  persistLocalStructure(module.catalogueId, module);
}

function removeLocalModuleStructure(moduleCatalogueId: string) {
  if (typeof window === 'undefined') return;
  const structures = readStore<Record<string, ModuleCatalogueItem>>(STRUCTURE_STORE_KEY, {});
  delete structures[moduleCatalogueId];
  window.localStorage.setItem(STRUCTURE_STORE_KEY, JSON.stringify(structures));
  const modules = loadLocalModules().filter(module => module.catalogueId !== moduleCatalogueId);
  saveLocalModules(modules);
}

function withLocalWarning(module: ModuleCatalogueItem): ModuleCatalogueItem & { localFallback?: boolean } {
  return { ...recalculateModule(module), localFallback: true };
}

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiJson<T>(path: string, init?: { method?: string; body?: string; headers?: Record<string, string>; timeoutMs?: number }): Promise<T> {
  const controller = init?.timeoutMs ? new AbortController() : undefined;
  const timeout = controller && init?.timeoutMs
    ? window.setTimeout(() => controller.abort(), init.timeoutMs)
    : undefined;
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller?.signal,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
    });
    if (!response.ok) {
      let message = `Curriculum API returned ${response.status} for ${path}`;
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch {
        // Ignore body parsing failures so the original status remains visible.
      }
      throw new ApiError(response.status, message);
    }
    return response.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('The curriculum request is taking too long. It was stopped so you can retry without waiting indefinitely.');
    }
    throw err;
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
}

function componentAdvancedDefaults(type: ModuleComponentType): Record<string, string | number | boolean | string[]> {
  const completionRules: Partial<Record<ModuleComponentType, string>> = {
    'live-session': 'Attend or watch recording',
    'recording-placeholder': 'Mark complete after watching',
    video: 'Watch video and mark complete',
    podcast: 'Listen and mark complete',
    reading: 'Read the material and confirm completion',
    powerpoint: 'Review slide deck',
    quiz: 'Submit',
    'monthly-ksb-quiz': 'Submit monthly KSB quiz',
    reflection: 'Submit reflection',
    'workplace-evidence': 'Upload + describe',
    assignment: 'Submit assignment',
    checkpoint: 'Complete checkpoint',
    'coaching-preparation': 'Complete coaching preparation',
  };
  const evidenceRequired: Partial<Record<ModuleComponentType, string>> = {
    'live-session': 'Attendance or recording completion',
    quiz: 'Quiz result',
    'monthly-ksb-quiz': 'Quiz result',
    checkpoint: 'Quiz result',
    reflection: 'Reflection + signature',
    'workplace-evidence': 'File + 100-word description',
    assignment: 'Submission file',
    'coaching-preparation': 'Preparation notes',
  };
  const reflectionPrompt =
    type === 'workplace-evidence'
      ? 'What workplace evidence have you uploaded, and which KSBs does it demonstrate?'
      : ['quiz', 'monthly-ksb-quiz', 'checkpoint'].includes(type)
        ? 'Which questions or topics do you need to revisit after this activity?'
        : 'What did you learn? How will you apply this at work? Which KSBs did this develop?';

  return {
    completionRule: completionRules[type] || 'Mark complete',
    evidenceRequired: evidenceRequired[type] || '-',
    reflectionPrompt,
    contentStatus: 'Draft',
    version: '0.1',
  };
}

function getDefaultComponentSettings(type: ModuleComponentType): Record<string, string | number | boolean | string[]> {
  switch (type) {
    case 'live-session':
      return { ...componentAdvancedDefaults(type), sessionPurpose: '', preparationInstructions: '', reflectionQuestions: '', attendanceRequired: true, recordingExpected: true };
    case 'recording-placeholder':
      return { ...componentAdvancedDefaults(type), recordingPurpose: '', source: 'MIS allocation', expectedAvailability: 'After live session', captionsExpected: false };
    case 'video':
      return { ...componentAdvancedDefaults(type), provider: 'YouTube', videoUrl: '', durationMinutes: 10, captionsAvailable: false, learningBrief: '', postWatchTask: '' };
    case 'podcast':
      return { ...componentAdvancedDefaults(type), podcastSource: 'External URL', podcastUrl: '', durationMinutes: 20, listeningFocus: '', podcastReflectionQuestion: '' };
    case 'reading':
      return {
        ...componentAdvancedDefaults(type),
        difficulty: 'Standard',
        requirement: 'Required',
        readingSource: 'Written in LMS',
        resourceUrl: '',
        readingContent: '',
        mainLearningOutcomes: '',
        ksbEvidenceNotes: '',
        focusSections: '',
        learnerInstruction: '',
        keyPointCount: '0',
        keyPoints: '',
        glossaryTerms: '',
        estimatedReadingTime: 20,
        otjhRationale: '',
        audioEnabled: false,
        audioUrl: '',
        reflectionQuestionCount: '0 qs',
        readingReflectionPrompts: '',
        readingEvidenceRequired: '',
        completionRuleCount: '3 rules',
        completionConfirmationRequired: true,
        linkedActivity: '',
        coachingPrompt: '',
        requiredReading: true,
      };
    case 'powerpoint':
      return { ...componentAdvancedDefaults(type), fileName: '', slideRange: '', speakerNotes: '', downloadAllowed: true };
    case 'quiz':
      return { ...componentAdvancedDefaults(type), buildMode: 'manual', numberOfQuestions: 10, passMarkPercentage: 70, attemptsAllowed: 2, affectsKsbProgression: true, questionsPlaceholder: '', completionFeedback: '' };
    case 'monthly-ksb-quiz':
      return { ...componentAdvancedDefaults(type), buildMode: 'manual', numberOfQuestions: 12, passMarkPercentage: 70, attemptsAllowed: 2, affectsKsbProgression: true, monthFocus: '' };
    case 'reflection':
      return { ...componentAdvancedDefaults(type), minimumWordCount: 250, learnerGuidance: '', tutorReviewGuidance: '' };
    case 'workplace-evidence':
      return { ...componentAdvancedDefaults(type), evidenceInstructions: '', acceptedEvidenceTypes: 'Document, image, video, witness statement', assessmentChecklist: '', minimumDescriptionWords: 100 };
    case 'assignment':
      return { ...componentAdvancedDefaults(type), assignmentBrief: '', submissionInstructions: '', dueTiming: 'End of week', markingRubric: '' };
    case 'checkpoint':
      return { ...componentAdvancedDefaults(type), checkpointTitle: '', checkpointQuestions: '', progressReviewLinked: true, monthlyCoachingReviewLinked: true };
    case 'coaching-preparation':
      return { ...componentAdvancedDefaults(type), preparationPrompt: '', evidenceToBring: '', coachDiscussionPoints: '', coachingReviewLinked: true };
    default:
      return componentAdvancedDefaults(type);
  }
}

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function cleanUserFacingText(value: string) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.replace(/(^|\s)__[a-zA-Z0-9_]+:[\s\S]*?(?=\s__[a-zA-Z0-9_]+:|$)/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

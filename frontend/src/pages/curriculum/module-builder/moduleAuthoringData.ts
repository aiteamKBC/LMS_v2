import type { CurriculumKsbEntry, CurriculumModule } from '@/lib/curriculumApi';
import {
  componentTypeGroups,
  componentTypes,
  getDefaultComponentSettings,
  getComponentDefinition,
  normaliseComponentSettings,
  type ComponentSettings,
  type KsbMappingType,
  type ModuleComponentType,
  type ModuleStatus,
} from './componentAuthoringModel';

export { componentTypeGroups, componentTypes, getDefaultComponentSettings };
export type { ComponentSettings, KsbMappingType, ModuleComponentType, ModuleStatus };

export interface KsbMapping {
  id: string;
  ksbId: string;
  code: string;
  description: string;
  sourceType?: string;
  sourceId?: string;
  type: KsbMappingType;
  classification?: KsbMappingType;
  weight: number;
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
  sourceId?: string;
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
  settings: ComponentSettings;
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
  color?: string;
  status: ModuleStatus;
  authoringStatus?: ModuleStatus;
  sourceType?: string;
  sourceId?: string;
  importedFromTrainingPlanId?: string;
  deliveryStatus?: string;
  deliveryMetadata?: Record<string, string>;
  ksbProfileSourceId?: string;
  tutor?: string;
  coach?: string;
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
  title?: string;
  sourceType?: string;
  sourceId?: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';

export const MODULE_BUILDER_WIZARD_DRAFT_PREFIX = 'lms.module-builder.wizard-draft.';

export function wizardDraftLocalIdFromKey(storageKey: string) {
  const key = String(storageKey || '').trim();
  return key.startsWith(MODULE_BUILDER_WIZARD_DRAFT_PREFIX)
    ? key.slice(MODULE_BUILDER_WIZARD_DRAFT_PREFIX.length)
    : key;
}

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

function isCanonicalModuleCatalogueId(value: unknown) {
  return /^MOD-[A-Z0-9][A-Z0-9_-]*$/i.test(String(value || '').trim());
}

function canonicalModuleCatalogueId(module: CurriculumModule) {
  return [module.moduleCatalogueId, module.catalogueId, module.moduleId, module.structureId]
    .map(value => String(value || '').trim())
    .find(isCanonicalModuleCatalogueId) || '';
}

export function createEmptyComponent(weekId: string, type: ModuleComponentType, index: number): ModuleComponent {
  const definition = getComponentDefinition(type);
  return {
    id: makeId('component'),
    weekId,
    type,
    title: `${definition.label} ${index}`,
    description: '',
    expectedOtjh: definition.defaultOtjh,
    points: definition.defaultPoints,
    reflectionRequired: definition.reflectionDefault,
    workplaceEvidenceRequired: definition.workplaceEvidenceDefault,
    tutorValidationRequired: definition.tutorValidationDefault,
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
        ksbProfileSourceId: draft.ksbProfileSourceId || '',
        background: draft.background,
        epaRequirements: draft.epaRequirements,
        qualificationOutcomes: draft.qualificationOutcomes,
      }),
    });
    return recalculateModule(response.module || { ...draft, catalogueId: response.moduleCatalogueId || draft.catalogueId });
  } catch (err) {
    throw err;
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
    throw err;
  }
}

export async function deleteModuleStructure(moduleCatalogueId: string) {
  await apiJson<{ deleted?: boolean; archived?: boolean; deletedAuthoring?: boolean; id?: string }>(`/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/`, {
    method: 'DELETE',
  });
}

export async function loadModuleStructure(catalogueId: string): Promise<ModuleCatalogueItem | null> {
  try {
    return recalculateModule(await apiJson<ModuleCatalogueItem>(`/curriculum/modules/${encodeURIComponent(catalogueId)}/structure/`));
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    if (status === 404) return null;
    throw err;
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
    throw err;
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
  const canonicalId = canonicalModuleCatalogueId(module);
  // Temporary legacy fallback: unlinked delivery rows still open through their delivery identifier.
  const catalogueId = canonicalId || String(module.deliveryModuleId || module.id || module.sourceId);
  const id = `module-${catalogueId}`;
  const title = cleanUserFacingText(module.name) || `Module ${catalogueId}`;
  const description = cleanUserFacingText(module.notes || '');
  const tutor = String(module.tutor || '').trim();
  const coach = String(module.coach || '').trim();
  const weekStructure = (module.weekStructure || []).map((week, index): ModuleWeek => {
    const weekId = String(week.id || makeAuthoringId('WEEK'));
    return {
      id: weekId,
      moduleId: catalogueId,
      weekNumber: week.weekNumber || index + 1,
      title: week.title || `Week ${index + 1}`,
      summary: '',
      learningOutcomes: [],
      components: (week.components || []).map((component, componentIndex): ModuleComponent => ({
        id: String(component.id || makeAuthoringId('COMP')),
        sourceId: component.id,
        moduleId: catalogueId,
        weekId,
        type: component.type as ModuleComponentType,
        title: component.title || `Component ${componentIndex + 1}`,
        description: '',
        expectedOtjh: Number(component.expectedOtjh ?? component.duration ?? 0) || 0,
        points: 0,
        reflectionRequired: Boolean(component.reflectionRequired),
        workplaceEvidenceRequired: Boolean(component.workplaceEvidenceRequired),
        tutorValidationRequired: Boolean(component.tutorValidationRequired),
        ksbMappings: (component.ksbMappings || []) as KsbMapping[],
        settings: normaliseComponentSettings(component.type as ModuleComponentType, (component.settings || {}) as ComponentSettings),
      })),
      ksbMappings: [],
    };
  });
  return recalculateModule({
    id,
    catalogueId,
    programmeId: module.programmeId || module.programme || 'programme',
    programmeName: module.programme || 'Unassigned programme',
    title,
    description,
    status: module.status || 'draft',
    authoringStatus: module.authoringStatus || module.status || 'draft',
    sourceType: undefined,
    sourceId: undefined,
    importedFromTrainingPlanId: undefined,
    deliveryStatus: module.deliveryStatus,
    ksbProfileSourceId: '',
    tutor,
    coach,
    deliveryMetadata: {
      tutor,
      coach,
      cohortId: module.cohortId || '',
      cohort: module.cohort || '',
      groupId: module.groupId || '',
      group: module.group || '',
    },
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
      weight: index < 3 ? 40 : 20,
    })),
    completionCriteria: emptyCompletionCriteria(),
    advancedDetails: emptyAdvancedDetails(),
    background: '',
    epaRequirements: [],
    qualificationOutcomes: [],
    weekStructure,
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
  const fallbackKsbSource = moduleKsbSourceMetadata(module.ksbProfileSourceId);
  const moduleKsbMappings = normaliseKsbMappings(module.moduleKsbMappings || [], fallbackKsbSource);
  const completionCriteria = {
    ...emptyCompletionCriteria(),
    ...(module.completionCriteria || {}),
  };
  const normalisedWeeks = module.weekStructure.map((week, index) => {
    const weekId = String(week.id || makeAuthoringId('WEEK'));
    return {
      ...week,
      id: weekId,
      moduleId,
      ksbMappings: normaliseKsbMappings(week.ksbMappings || [], fallbackKsbSource),
      weekNumber: index + 1,
      components: (week.components || []).map(component => ({
        ...component,
        moduleId,
        weekId,
        workplaceEvidenceRequired: false,
        ksbMappings: normaliseKsbMappings(component.ksbMappings || [], fallbackKsbSource),
        settings: normaliseComponentSettings(component.type, component.settings || {}),
      })),
    };
  });
  const allComponents = normalisedWeeks.flatMap(week => week.components);
  const hasStructure = module.weekStructure.length > 0;
  const componentKsbCodes = new Set(allComponents.flatMap(component => component.ksbMappings.map(mapping => mapping.code)));
  moduleKsbMappings.forEach(mapping => componentKsbCodes.add(mapping.code));
  normalisedWeeks.forEach(week => week.ksbMappings.forEach(mapping => componentKsbCodes.add(mapping.code)));
  const totalOtjh = allComponents.reduce((total, component) => total + Number(component.expectedOtjh || 0), 0);
  const totalPoints = allComponents.reduce((total, component) => total + Number(component.points || 0), 0);
  const quality = calculateQualityScore({ ...module, completionCriteria, totalOtjh, ksbCount: componentKsbCodes.size, moduleKsbMappings, weekStructure: normalisedWeeks });

  return {
    ...module,
    completionCriteria,
    weeks: module.weekStructure.length,
    totalOtjh,
    declaredTotalOtjh: module.declaredTotalOtjh,
    ksbCount: hasStructure ? componentKsbCodes.size : module.ksbCount,
    lessonCount: hasStructure ? allComponents.length : module.lessonCount,
    quizCount: hasStructure ? allComponents.filter(component => ['quiz', 'checkpoint', 'monthly-ksb-quiz'].includes(component.type)).length : module.quizCount,
    qualityScore: quality,
    moduleKsbMappings,
    weekStructure: normalisedWeeks,
    description: cleanUserFacingText(module.description || module.sourceModule?.notes || ''),
    background: module.background || '',
    epaRequirements: module.epaRequirements || [],
    qualificationOutcomes: module.qualificationOutcomes || [],
  };
}

function normaliseKsbMappings(mappings: KsbMapping[], fallbackSource?: Pick<KsbMapping, 'sourceType' | 'sourceId'>) {
  return mappings.map(mapping => {
    const type = normaliseKsbMappingType(mapping.type || mapping.classification);
    const classification = normaliseKsbMappingType(mapping.classification || mapping.type);
    const weight = clampKsbWeight(mapping.weight);
    return {
      ...mapping,
      sourceType: mapping.sourceType || fallbackSource?.sourceType,
      sourceId: mapping.sourceId || fallbackSource?.sourceId,
      type,
      classification,
      weight: weight > 0 ? weight : defaultKsbWeight(classification),
    };
  });
}

function moduleKsbSourceMetadata(sourceId?: string) {
  const id = String(sourceId || '').trim();
  if (!id) return undefined;
  return {
    sourceType: id.startsWith('standard:') ? 'standard' : 'framework',
    sourceId: id,
  };
}

function defaultKsbWeight(type: KsbMappingType) {
  if (type === 'main') return 40;
  if (type === 'secondary') return 20;
  return 10;
}

function clampKsbWeight(value: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed * 100) / 100);
}

function normaliseKsbMappingType(value?: string): KsbMappingType {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'main' || raw === 'secondary' || raw === 'possible') return raw;
  if (raw === 'practice') return 'possible';
  return 'secondary';
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
    { label: 'All mapped KSBs have a weight', passed: allMappedKsbs(module).every(mapping => Number(mapping.weight || 0) > 0) },
    { label: 'Every mapped KSB is classified', passed: allMappedKsbs(module).every(mapping => ['main', 'secondary', 'possible'].includes(normaliseKsbMappingType(mapping.type))) },
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
    title: entry.title,
  }));
}

export async function saveModuleStructure(moduleCatalogueId: string, payload: ModuleCatalogueItem) {
  const body = recalculateModule(payload);
  return recalculateModule(await apiJson<ModuleCatalogueItem>(`/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/structure/`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    timeoutMs: 90000,
  }));
}

export interface ComponentUploadResult {
  uploaded: boolean;
  savedToComponent: boolean;
  componentId: string;
  moduleCatalogueId: string;
  file: {
    fileName: string;
    storedPath: string;
    url: string;
    size: number;
    contentType: string;
    componentType: string;
  };
}

export async function uploadComponentResource(input: { moduleCatalogueId: string; componentId: string; componentType: 'podcast' | 'powerpoint' | 'assignment'; file: File }) {
  const form = new FormData();
  form.set('file', input.file);
  form.set('moduleCatalogueId', input.moduleCatalogueId);
  form.set('componentType', input.componentType);
  return apiForm<ComponentUploadResult>(`/curriculum/components/${encodeURIComponent(input.componentId)}/upload/`, form, { timeoutMs: 90000 });
}

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiForm<T>(path: string, body: FormData, init?: { timeoutMs?: number }): Promise<T> {
  const controller = init?.timeoutMs ? new AbortController() : undefined;
  const timeout = controller && init?.timeoutMs
    ? window.setTimeout(() => controller.abort(), init.timeoutMs)
    : undefined;
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      body,
      signal: controller?.signal,
    });
    if (!response.ok) {
      let message = `Curriculum API returned ${response.status} for ${path}`;
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch {
        // Keep the original status message when a non-JSON error body is returned.
      }
      throw new ApiError(response.status, message);
    }
    return response.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('The file upload is taking too long. It was stopped so you can retry.');
    }
    throw err;
  } finally {
    if (timeout) window.clearTimeout(timeout);
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
        const validation = Array.isArray(payload?.validationErrors)
          ? payload.validationErrors.map((item: { message?: string }) => item.message).filter(Boolean).join('; ')
          : '';
        if (validation) message = validation;
        else if (payload?.error) message = payload.error;
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

function cleanUserFacingText(value: string) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.replace(/(^|\s)__[a-zA-Z0-9_]+:[\s\S]*?(?=\s__[a-zA-Z0-9_]+:|$)/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

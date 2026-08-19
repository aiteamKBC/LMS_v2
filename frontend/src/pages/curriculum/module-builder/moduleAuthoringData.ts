import type { CurriculumKsbEntry, CurriculumModule } from '@/lib/curriculumApi';
import {
  componentTypeGroups,
  componentTypes,
  getDefaultComponentSettings,
  getComponentDefinition,
  normaliseComponentSettings,
  type ComponentSettings,
  type ComponentSettingValue,
  type KsbMappingType,
  type ModuleComponentType,
  type ModuleStatus,
} from './componentAuthoringModel';

export { componentTypeGroups, componentTypes, getDefaultComponentSettings };
export type { ComponentSettings, KsbMappingType, ModuleComponentType, ModuleStatus };

export type KsbWeightClass = 'hard' | 'soft' | 'possible';

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
  weightClass: KsbWeightClass;
  weight_class?: KsbWeightClass;
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
  programmeStatus?: 'active' | 'draft' | string;
  cohortId?: string;
  cohort?: string;
  groupId?: string;
  group?: string;
  isProgrammeDeleted?: boolean;
  title: string;
  description: string;
  color?: string;
  status: ModuleStatus;
  authoringStatus?: ModuleStatus;
  sourceType?: string;
  sourceId?: string;
  deliveryStatus?: string;
  deliveryMetadata?: Record<string, ComponentSettingValue>;
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

function normalisePlaceholderText(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isGeneratedWeekPlaceholderComponent(component: ModuleComponent, week: Pick<ModuleWeek, 'weekNumber' | 'title'>) {
  const titleKey = normalisePlaceholderText(component.title);
  const weekKeys = [week.title, `Week ${week.weekNumber}`].map(normalisePlaceholderText).filter(Boolean);
  const typeKey = normalisePlaceholderText(component.type);
  const hasKsbMappings = Boolean((component.ksbMappings || []).length);
  return !hasKsbMappings && weekKeys.includes(titleKey) && (typeKey.includes('live') || typeKey.includes('session'));
}

export function createLocalModuleDraft(input: { programme: string; title: string; description: string; weeks: number; status: ModuleStatus; catalogueId?: string; programmeId?: string; programmeStatus?: string; cohortId?: string; cohortName?: string; groupId?: string; groupName?: string; ksbProfileSourceId?: string; sessionsNumber?: number; startDate?: string; endDate?: string }): ModuleCatalogueItem {
  const catalogueId = input.catalogueId || makeAuthoringId('MOD');
  const id = `local-${catalogueId}`;
  const weekCount = Math.max(0, Math.round(Number(input.weeks) || 0));
  const weekStructure = Array.from({ length: weekCount }, (_, index) => createEmptyWeek(id, index + 1));
  return recalculateModule({
    id,
    catalogueId,
    // An unassigned draft carries an EMPTY programmeId, never a placeholder
    // string. 'programme-local' used to be sent here and the backend accepted
    // it as a real identifier, creating junk programme rows. A programme NAME
    // is not an id either, so it is no longer used as a fallback.
    programmeId: input.programmeId || '',
    programmeName: input.programme || 'Unassigned programme',
    programmeStatus: input.programmeStatus || '',
    cohortId: input.cohortId || '',
    cohort: input.cohortName || '',
    groupId: input.groupId || '',
    group: input.groupName || '',
    title: input.title,
    description: input.description,
    status: input.status || 'draft',
    ksbProfileSourceId: input.ksbProfileSourceId || '',
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

export async function createNewModule(input: { programme: string; title: string; description: string; weeks: number; status: ModuleStatus; programmeId?: string; programmeStatus?: string; cohortId?: string; cohortName?: string; groupId?: string; groupName?: string; ksbProfileSourceId?: string; sessionsNumber?: number; startDate?: string; endDate?: string }) {
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
        programmeStatus: draft.programmeStatus,
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

export interface ModuleStructureResolveRequest {
  requestId: string;
  identifier: string;
  identifiers?: string[];
}

export interface ModuleStructureResolveResult {
  requestId: string;
  identifier: string;
  catalogueId: string;
  found: boolean;
  missing?: boolean;
  // Set when several Module Builder modules share the linked title and no id
  // identified which one. Distinct from `missing`: the content exists but cannot
  // be attributed, so it must never be rendered as an empty module.
  ambiguous?: boolean;
  ambiguousCatalogueIds?: string[];
  componentCount?: number;
  hasComponents?: boolean;
  message?: string;
  module?: ModuleCatalogueItem;
}

export async function loadModuleStructuresBatch(modules: ModuleStructureResolveRequest[]): Promise<ModuleStructureResolveResult[]> {
  const response = await apiJson<{ results: ModuleStructureResolveResult[] }>('/curriculum/modules/resolve-structures/', {
    method: 'POST',
    body: JSON.stringify({ modules }),
    timeoutMs: 8000,
  });
  return response.results.map(result => ({
    ...result,
    module: result.module ? recalculateModule(result.module) : undefined,
  }));
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
    // Never derive an id from the programme NAME, and never persist a
    // placeholder. An unassigned legacy draft has no programme id.
    programmeId: '',
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
        points: Number(component.points ?? 0) || 0,
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
    isProgrammeDeleted: Boolean(module.isProgrammeDeleted),
    title,
    description,
    status: module.status || 'draft',
    authoringStatus: module.authoringStatus || module.status || 'draft',
    sourceType: undefined,
    sourceId: undefined,
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
      weightClass: index < 3 ? 'hard' : 'soft',
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
  const weekCount = Math.max(1, source?.weeks || source?.sessionNames?.length || module.weeks || 1);
  const weekStructure = Array.from({ length: weekCount }, (_, index) => {
    const week = createEmptyWeek(module.id, index + 1);
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
      components: (week.components || [])
        .filter(component => !isGeneratedWeekPlaceholderComponent(component, { ...week, weekNumber: index + 1 }))
        .map(component => ({
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
    const weightClass = normaliseKsbWeightClass(mapping.weightClass || mapping.weight_class, classification);
    const weight = clampKsbWeight(mapping.weight);
    return {
      ...mapping,
      sourceType: mapping.sourceType || fallbackSource?.sourceType,
      sourceId: mapping.sourceId || fallbackSource?.sourceId,
      type,
      classification,
      weightClass,
      weight_class: weightClass,
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

function normaliseKsbWeightClass(value?: string, fallbackClassification?: KsbMappingType): KsbWeightClass {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'hard' || raw === 'soft' || raw === 'possible') return raw;
  const legacy = normaliseKsbMappingType(fallbackClassification);
  if (legacy === 'main') return 'hard';
  if (legacy === 'possible') return 'possible';
  return 'soft';
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

export async function uploadComponentResource(input: { moduleCatalogueId: string; componentId: string; componentType: 'podcast' | 'powerpoint' | 'reading' | 'assignment'; file: File }) {
  const form = new FormData();
  form.set('file', input.file);
  form.set('moduleCatalogueId', input.moduleCatalogueId);
  form.set('componentType', input.componentType);
  return apiForm<ComponentUploadResult>(`/curriculum/components/${encodeURIComponent(input.componentId)}/upload/`, form, { timeoutMs: 90000 });
}

export interface TeamsMeetingInput {
  title: string;
  organizerEmail: string;
  attendees: string[];
  presenters?: string[];
  localStartDateTime: string;
  startDateTimeUtc: string;
  durationMinutes: number;
  repeat: 'none' | 'daily' | 'weekdays' | 'weekly';
  repeatOccurrences: number;
  lobbyBypass: string;
  recording: string;
  spokenLanguage: string;
  meetingType: string;
  details: string;
  requestResponses: boolean;
  allowNewTimeProposals: boolean;
  hideAttendees: boolean;
  transactionId: string;
  moduleDraftId?: string;
  moduleCatalogueId?: string;
  moduleTitle?: string;
  scheduledOccurrences?: Array<{
    sessionNumber: number;
    startDateTimeUtc: string;
    durationMinutes: number;
  }>;
}

export interface TeamsMeetingResult {
  created: boolean;
  meeting: {
    liveSessionId: string;
    eventId: string;
    onlineMeetingId: string;
    joinUrl: string;
    webLink: string;
    meetingOptionsUrl: string;
    organizerEmail: string;
    attendees: string[];
    presenters: string[];
    startDateTimeUtc: string;
    durationMinutes: number;
    repeat: string;
    repeatOccurrences: number;
    trackedOccurrences: number;
    provider: string;
    trackingReady: boolean;
    settingsApplied: boolean;
  };
  warnings: string[];
}

export interface TeamsMeetingConfiguration {
  configured: boolean;
  defaultOrganizer: string;
  timeZone: string;
  timeZoneIana: string;
}

// The calendar's own timezone. A session time typed into the wizard means this zone --
// the college's -- and not the zone of whoever happens to be filling the form in, so
// "09:00 Saturday" is the same instant whether the programme is set up from London or
// from Cairo. Viewers are unaffected either way: the event carries one absolute
// instant, and every calendar renders it in its own reader's local time.
let calendarTimeZone = 'Europe/London';

export function getCalendarTimeZone() {
  return calendarTimeZone;
}

function zoneOffsetMs(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).reduce<Record<string, number>>((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = Number(part.value);
    return acc;
  }, {});
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return wallClock - instant.getTime();
}

/** Read a naive `YYYY-MM-DDTHH:mm` wall clock as a time in `timeZone`, as UTC ISO. */
export function zonedNaiveToUtcIso(naiveLocal: string, timeZone = calendarTimeZone) {
  const [datePart, timePart = '00:00'] = (naiveLocal || '').split('T');
  const [year, month, day] = (datePart || '').split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  if ([year, month, day, hour, minute].some(value => !Number.isFinite(value))) {
    return new Date(naiveLocal).toISOString();
  }
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  // Guess the instant as if the wall clock were UTC, then subtract the offset the zone
  // actually had there. A second pass settles the hour a DST jump adds or removes.
  let instant = wallClock;
  for (let pass = 0; pass < 2; pass += 1) {
    const corrected = wallClock - zoneOffsetMs(new Date(instant), timeZone);
    if (corrected === instant) break;
    instant = corrected;
  }
  return new Date(instant).toISOString();
}

function clockIn(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(instant);
}

function shortZoneName(timeZone: string) {
  return timeZone.split('/').pop()?.replace(/_/g, ' ') || timeZone;
}

/**
 * How a wizard session time reads in the calendar's zone and in the viewer's own.
 * `viewer` is omitted when both zones show the same clock, so the hint stays quiet
 * for the people it would tell nothing new.
 */
export function describeSessionTime(naiveLocal: string) {
  const iso = zonedNaiveToUtcIso(naiveLocal);
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone || calendarTimeZone;
  const calendarClock = clockIn(instant, calendarTimeZone);
  const viewerClock = clockIn(instant, viewerZone);
  return {
    iso,
    calendarClock,
    calendarZone: shortZoneName(calendarTimeZone),
    viewerClock: viewerClock === calendarClock ? '' : viewerClock,
    viewerZone: shortZoneName(viewerZone),
  };
}

export function loadTeamsMeetingConfiguration() {
  return apiJson<TeamsMeetingConfiguration>('/curriculum/teams-meetings/', { timeoutMs: 15000 })
    .then(configuration => {
      if (configuration.timeZoneIana) calendarTimeZone = configuration.timeZoneIana;
      return configuration;
    });
}

export function restoreModuleTeamsMeeting(moduleCatalogueId: string) {
  return apiJson<{ restored: boolean; updatedComponents: number; meeting: Record<string, unknown>; module: ModuleCatalogueItem }>(`/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/teams-meetings/restore/`, {
    method: 'POST',
    timeoutMs: 30000,
  }).then(result => ({
    ...result,
    module: recalculateModule(result.module),
  }));
}

export function createTeamsMeeting(input: TeamsMeetingInput) {
  return apiJson<TeamsMeetingResult>('/curriculum/teams-meetings/', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: 45000,
  });
}

export function updateTeamsMeetingSchedule(liveSessionId: string, input: Pick<TeamsMeetingInput, 'title' | 'organizerEmail' | 'localStartDateTime' | 'startDateTimeUtc' | 'durationMinutes' | 'repeat' | 'repeatOccurrences' | 'scheduledOccurrences'> & { eventId?: string }) {
  return apiJson<{ updated: boolean; meeting: TeamsMeetingResult['meeting']; warnings?: Array<{ code?: string; message: string; detail?: string }> }>(`/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/schedule/`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    timeoutMs: 45000,
  });
}

export interface TeamsArtifactSyncResult {
  synced: {
    attendanceReports: number;
    attendanceRecords: number;
    transcripts: number;
    recordings: number;
  };
  errors: string[];
  partial: boolean;
}

export interface TeamsAttendanceRecord {
  id: string;
  email: string;
  display_name: string;
  role: string;
  total_attendance_seconds: number;
  intervals?: Array<{
    joinDateTime?: string;
    leaveDateTime?: string;
  }> | string;
}

export interface TeamsMeetingArtifact {
  id: string;
  artifact_type: 'transcript' | 'recording' | string;
  content_url?: string;
  created_datetime?: string;
  end_datetime?: string;
}

export interface TeamsMeetingOccurrence {
  id: string;
  session_number: number;
  scheduled_start: string;
  scheduled_end: string;
  actual_start?: string;
  actual_end?: string;
  participant_count: number;
  attendance_report_id?: string;
  status: string;
  attendance: TeamsAttendanceRecord[];
  artifacts: TeamsMeetingArtifact[];
}

export interface TeamsMeetingArtifactsResult {
  series: {
    id: string;
    module_title: string;
    organizer_email: string;
    join_url: string;
    online_meeting_id: string;
  };
  occurrences: TeamsMeetingOccurrence[];
}

export function syncTeamsMeetingArtifacts(liveSessionId: string) {
  return apiJson<TeamsArtifactSyncResult>(`/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/artifacts/`, {
    method: 'POST',
    timeoutMs: 45000,
  });
}

export function loadTeamsMeetingArtifacts(liveSessionId: string) {
  return apiJson<TeamsMeetingArtifactsResult>(`/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/artifacts/`, {
    timeoutMs: 30000,
  });
}

export function teamsMeetingArtifactContentUrl(liveSessionId: string, artifactId: string) {
  return `${API_BASE_URL}/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/artifacts/${encodeURIComponent(artifactId)}/content/`;
}

export function teamsMeetingArtifactPreviewUrl(liveSessionId: string, artifactId: string) {
  return `${teamsMeetingArtifactContentUrl(liveSessionId, artifactId)}?preview=1`;
}

export function teamsMeetingRecordingEventsUrl(liveSessionId: string, artifactId: string) {
  return `${API_BASE_URL}/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/artifacts/${encodeURIComponent(artifactId)}/recording-events/`;
}

class ApiError extends Error {
  status: number;
  detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
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
        const detail = typeof payload?.detail === 'string' ? payload.detail : '';
        if (payload?.error) message = detail ? `${payload.error} ${detail}` : payload.error;
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
        const detail = typeof payload?.detail === 'string' ? payload.detail : '';
        if (validation) message = validation;
        else if (payload?.error) message = detail ? `${payload.error} ${detail}` : payload.error;
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

// Retained from the pre-registry authoring implementation for reference and
// backwards-compatible migration work. Runtime defaults come from
// componentAuthoringModel.getDefaultComponentSettings above.
export function getLegacyDefaultComponentSettings(type: ModuleComponentType): Record<string, string | number | boolean | string[]> {
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

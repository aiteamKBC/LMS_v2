import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { useCurriculumModules } from '@/hooks/useCurriculumModules';
import { useCurriculumKsbSets } from '@/hooks/useCurriculumKsbSets';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  fetchCurriculumHolidays,
  fetchCurriculumOverview,
  fetchCurriculumStandards,
  fetchCurriculumTeamsMeetingSummaries,
  fetchCurriculumTutors,
  type CurriculumCohort,
  type CurriculumGroup,
  type CurriculumHoliday,
  type CurriculumKsbSet,
  type CurriculumProgramme,
  type LibraryComponent,
  type CurriculumStaffProfile,
  type CurriculumStandard,
  type CurriculumTeamsMeetingSummary,
} from '@/lib/curriculumApi';
// The delivery side of a module -- which cohort and group run it, when it runs
// and whether its Teams series exists -- used to live on a separate Curriculum
// -> Modules page. This catalogue lists it now, and each delivery row opens the
// module workspace where that delivery (tutor included) is edited.
import { formatDateLabel, moduleIdentity } from '../shared/entities/model';
// Creating a module and moving it between programmes, cohorts and groups is one
// dedicated form, shared with the Group and Module workspaces. It replaced the
// six-step structure wizard this page used to open for both jobs.
import { ModuleFormDrawer, type ModuleFormTarget } from '../shared/entities/moduleForm';
import { ComponentLibraryModal } from './ComponentLibraryModal';
import {
  calculateQualityChecklist,
  componentTypeGroups,
  componentTypes,
  copyComponentIntoWeek,
  createEmptyComponent,
  createEmptyWeek,
  createNewModule,
  groupWeeksByMonth,
  deleteModuleStructure,
  curriculumModuleToCatalogue,
  duplicateModuleStructure,
  flattenKsbEntries,
  getDefaultStructure,
  getDefaultComponentSettings,
  loadModuleStructure,
  loadModuleWeekSessionPlan,
  applyModuleWeekSessionPlan,
  resequenceWeekSessionDates,
  makeAuthoringId,
  recalculateModule,
  restoreModuleTeamsMeeting,
  saveModuleStructure,
  uploadComponentResource,
  type AdvancedModuleDetails,
  type CompletionCriteria,
  type KsbMapping,
  type KsbMappingType,
  type KsbWeightClass,
  type KsbOption,
  type ModuleCatalogueItem,
  type ModuleComponent,
  type ModuleComponentType,
  type ModuleWeek,
} from './moduleAuthoringData';
// The shared week-authoring UI arrives through curriculum/shared/components rather
// than from week-builder/page directly: these three components only render once a
// week is expanded, so the lazy wrappers keep Week Builder's ~159 kB chunk (dnd-kit
// and the RichTextEditor included) off the initial Module Builder load. Types come
// from the non-lazy barrel — type imports are erased and pull in no runtime code.
import { ComponentEditor as WeekComponentEditor, WeekComponentRail, WeekOverviewPanel } from '@/pages/curriculum/shared/components/weekAuthoringLazy';
import type { GroupOption, WeekComponentUploader, WeekScope } from '@/pages/curriculum/shared/components/weekAuthoring';
import { fetchComponentPointsDefaults, fetchWeekTemplates, fetchWeekTemplateDetail, filterWeekTemplatesForScope, loadCurriculumScope, type WeekTemplate } from '@/pages/curriculum/week-builder/weekTemplateData';
// Round-trip the module's components to Excel so KSBs can be filled in ChatGPT
// and imported back. xlsx is dynamically imported inside these helpers, so it
// stays off this page's initial bundle.
import { buildKsbMappingPrompt, describeKsbImport, exportModuleKsbWorkbook, importModuleKsbWorkbook, type KsbProfileEntry } from './ksbExcel';
// Shared labelled form atoms and the Teams meeting modal live in their own files
// so the modal (rendered by the shared week editor, which the Week Builder also
// uses) can reuse them without importing this page.
import { Checkbox, NumberInput, ReadOnlyInput, SelectInput, TextArea, TextInput } from './formInputs';
import { TeamsMeetingModal } from './TeamsMeetingModal';
import { KsbExcelPanel } from './KsbExcelPanel';
import {
  CONTENT_STATUSES,
  MEDIA_SOURCE_TYPES,
  PODCAST_SOURCE_TYPES,
  READING_SOURCE_TYPES,
  firstValidationMessage,
  normaliseVideoSourceType,
  providerForVideoSourceType,
  validateComponentAuthoring,
  validateModuleAuthoringStructure,
} from './componentAuthoringModel';
import { RichTextDraft } from './RichTextEditor';

// Course structure accordion: whether expanding a week collapses the others.
// false = classic single-open accordion (the current default look/feel).
const ALLOW_MULTIPLE_EXPANDED_WEEKS = false;

const FILTER_SELECT_CLASS = 'h-10 min-w-40 rounded-lg border border-background-200 bg-background-100 px-3 text-[13px] text-foreground-900 outline-none transition-smooth focus:border-primary-400 focus:bg-background-50';

type Selection =
  | { kind: 'week'; weekId: string }
  | { kind: 'component'; weekId: string; componentId: string };

type KsbTarget =
  | { scope: 'module' }
  | { scope: 'week'; weekId: string }
  | { scope: 'component'; weekId: string; componentId: string };

type DragState = { type: 'week'; weekId: string } | null;

type ModuleDeliveryUsage = {
  id: string;
  moduleId: string;
  /**
   * The identity the per-module endpoints answer to, resolved exactly the way
   * the entity pages resolve it. `moduleId` above keeps its own legacy order and
   * is used for matching, so the two are deliberately separate.
   */
  deliveryModuleId: string;
  sourceId: string;
  catalogueId: string;
  structureId: string;
  programmeId: string;
  programme: string;
  moduleTitle: string;
  cohortId?: string;
  cohort: string;
  groupId?: string;
  group: string;
  tutor: string;
  deliveryStatus: string;
  startDate?: string;
  endDate?: string;
  sessions: number;
};

type ModuleBuilderListItem = ModuleCatalogueItem & {
  deliveryUsages?: ModuleDeliveryUsage[];
};

type ProgrammeKsbMapState = {
  programmeName: string;
  modules: ModuleBuilderListItem[];
};

type ModuleScopeLock = {
  programmeId: string;
  programmeName: string;
  ksbSourceId: string;
  ksbSourceLabel: string;
  locked: boolean;
};

type QuizPackageSummary = {
  id: number;
  title: string;
  programmeId?: number | string | null;
  programme?: string | null;
  module?: string | null;
  weekId?: string | null;
  questions?: number;
  status?: string;
  version?: string;
  assessmentType?: string;
  packageType?: string;
  duration?: number | null;
  timeUnit?: string | null;
  passingGrade?: number | null;
  linkedCourses?: number;
};

function wait(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function moduleSnapshot(module: ModuleCatalogueItem | null) {
  return module ? JSON.stringify(recalculateModule(module)) : '';
}

function moduleNeedsTeamsRestore(module: ModuleCatalogueItem | null) {
  if (!module) return false;
  return module.weekStructure.some(week => week.components.some(component => (
    component.type === 'live-session'
    && !String(component.settings?.liveSessionUrl || component.settings?.teamsMeetingUrl || '').trim()
  )));
}

async function showBuilderDeleteSwal({
  title,
  message,
  confirmButtonText,
  successTitle,
  successText,
  onConfirm,
}: {
  title: string;
  message: string;
  warning?: string;
  confirmButtonText: string;
  processingText: string;
  successTitle: string;
  successText: string;
  onConfirm: () => Promise<void>;
}) {
  return showCurriculumConfirm({
    title,
    text: message,
    icon: 'warning',
    confirmButtonText,
    cancelButtonText: 'Cancel',
    successTitle,
    successText,
    onConfirm,
  });
}

export default function ModuleBuilder() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [programmeFilter, setProgrammeFilter] = useState<string>('All');
  // The delivery filters the Modules page used to carry. They read the module's
  // own deliveries rather than a second fetch of cohorts and groups, so the
  // cascade can never offer a cohort or group no module is actually delivered to.
  const [cohortFilter, setCohortFilter] = useState(() => searchParams.get('cohort') || '');
  const [groupFilter, setGroupFilter] = useState(() => searchParams.get('group') || '');
  const [tutorFilter, setTutorFilter] = useState(() => searchParams.get('tutor') || '');
  const [tutorProfiles, setTutorProfiles] = useState<CurriculumStaffProfile[]>([]);
  const [teamsMeetings, setTeamsMeetings] = useState<CurriculumTeamsMeetingSummary[]>([]);
  // A tutor is assigned where the rest of a delivery is edited: the module form
  // behind "Edit module", and the delivery workspace each delivery row opens.
  // Both run the same clash check and the same assignment notification, so the
  // catalogue no longer carries a third change-tutor drawer of its own.
  const [workingModule, setWorkingModule] = useState<ModuleCatalogueItem | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [expandedWeekIds, setExpandedWeekIds] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [placementModule, setPlacementModule] = useState<ModuleFormTarget | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // Programme -> cohort -> group tree plus the holiday list: read only by the
  // module form, so it is fetched the first time that drawer opens rather than
  // on every Module Builder load.
  const [moduleFormScope, setModuleFormScope] = useState<{ cohorts: CurriculumCohort[]; groups: CurriculumGroup[]; holidays: CurriculumHoliday[] }>({ cohorts: [], groups: [], holidays: [] });
  const [openingModule, setOpeningModule] = useState<{ title: string; mode: 'builder' | 'settings' } | null>(null);
  const [openingModuleComplete, setOpeningModuleComplete] = useState(false);
  const [duplicatingModule, setDuplicatingModule] = useState<ModuleCatalogueItem | null>(null);
  const [duplicatingModuleComplete, setDuplicatingModuleComplete] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deletingModuleId, setDeletingModuleId] = useState<string | null>(null);
  const [hiddenModuleIds, setHiddenModuleIds] = useState<Set<string>>(new Set());
  const [noticeAlert, setNoticeAlert] = useState<{ title: string; message: string } | null>(null);
  const [lessonPickerWeekId, setLessonPickerWeekId] = useState<string | null>(null);
  const [reusePickerWeekId, setReusePickerWeekId] = useState<string | null>(null);
  const [weekTemplateImportOpen, setWeekTemplateImportOpen] = useState(false);
  const [ksbTarget, setKsbTarget] = useState<KsbTarget | null>(null);
  const [ksbMapModule, setKsbMapModule] = useState<ModuleBuilderListItem | null>(null);
  const [programmeKsbMap, setProgrammeKsbMap] = useState<ProgrammeKsbMapState | null>(null);
  const [ksbMapLoadingId, setKsbMapLoadingId] = useState<string | null>(null);
  const [programmeKsbLoading, setProgrammeKsbLoading] = useState(false);
  const [sessionKsbMappingOpen, setSessionKsbMappingOpen] = useState(false);
  const [dragState, setDragState] = useState<DragState>(null);
  const [quizPackages, setQuizPackages] = useState<QuizPackageSummary[]>([]);
  const [quizzesLoading, setQuizzesLoading] = useState(false);
  const [standards, setStandards] = useState<CurriculumStandard[]>([]);
  const [standardsLoading, setStandardsLoading] = useState(false);
  const [storageVersion, setStorageVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [restoringTeamsModuleId, setRestoringTeamsModuleId] = useState<string | null>(null);
  const [saveStartedAt, setSaveStartedAt] = useState<number | null>(null);
  const [saveElapsedSeconds, setSaveElapsedSeconds] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const deepLinkedModuleRef = useRef('');
  // Until the user drives a filter themselves the URL is read-only: the existing
  // programme deep link resolves an id into a name a beat later, and a sync that
  // deleted params it had not written would erase it before that happens.
  const filtersTouchedRef = useRef(false);
  const savedModuleSnapshotRef = useRef('');
  const saveRequestRef = useRef(0);
  const ksbImportInputRef = useRef<HTMLInputElement>(null);
  const { modules, loading, error, reload } = useCurriculumModules({ compact: true, skipCache: true });
  const { programmes: curriculumProgrammes } = useCurriculumProgrammes({ skipCache: true, visibility: 'all' });
  // KSB sets, standards and their derived labels only matter once something on
  // the page actually asks for KSB data: the build drawer, a card's KSB map, or
  // the programme-wide KSB map. The plain catalogue list never reads them, so
  // fetching them on every page load bought nothing but three wasted requests.
  const needsKsbData = Boolean(workingModule) || Boolean(ksbMapModule) || Boolean(programmeKsbMap);
  const { ksbSets, loading: ksbSetsLoading } = useCurriculumKsbSets({ all: true, enabled: needsKsbData });
  const liveCurriculumProgrammes = curriculumProgrammes;

  // Reuse of the week-builder component editor needs group options, rule-driven
  // points and a scope — sourced the same way the week builder does.
  const [componentGroupOptions, setComponentGroupOptions] = useState<GroupOption[]>([]);
  const [componentPointsByType, setComponentPointsByType] = useState<Partial<Record<ModuleComponentType, number>>>({});
  const componentPointsLoadedRef = useRef(false);
  useEffect(() => {
    // Only the build drawer's component editor reads this -- nothing on the
    // plain catalogue list does.
    if (!workingModule || componentPointsLoadedRef.current) return undefined;
    componentPointsLoadedRef.current = true;
    let active = true;
    fetchComponentPointsDefaults().then(map => { if (active) setComponentPointsByType(map); }).catch(() => {});
    return () => { active = false; };
  }, [workingModule]);
  useEffect(() => {
    let active = true;
    const norm = (value?: string) => String(value ?? '').trim().toLowerCase();
    loadCurriculumScope().then(({ groups }) => {
      if (!active) return;
      const scoped = groups.filter(group => norm(group.programmeId) === norm(workingModule?.programmeId) || norm(group.programme) === norm(workingModule?.programmeName));
      setComponentGroupOptions((scoped.length ? scoped : groups).map(group => ({ key: group.id, name: group.name, cohort: group.cohort })));
    }).catch(() => {});
    return () => { active = false; };
  }, [workingModule?.programmeId, workingModule?.programmeName]);

  const catalogueModules = useMemo(() => {
    void storageVersion;
    const remoteModules = modules.map(module => curriculumModuleToCatalogue(module));
    return buildMasterModuleList(remoteModules, [])
      .filter(module => (
        !hiddenModuleIds.has(module.catalogueId)
        && moduleBelongsToVisibleProgramme(module, curriculumProgrammes)
      ));
  }, [modules, storageVersion, hiddenModuleIds, curriculumProgrammes]);

  const programmeOptions = useMemo(() => {
    const byName = new Map<string, string>();
    curriculumProgrammes.forEach(programme => {
      const name = String(programme.name || programme.sourceId || programme.id || '').trim();
      if (!name) return;
      byName.set(normaliseDeepLinkValue(name) || name.toLowerCase(), name);
    });
    return ['All', ...Array.from(byName.values()).sort((a, b) => a.localeCompare(b))];
  }, [curriculumProgrammes]);

  const programmeLookup = useMemo(() => {
    const lookup = new Map<string, { id: string; name: string }>();
    curriculumProgrammes.forEach(programme => {
      const id = String(programme.id || programme.sourceId || programme.name || '').trim();
      const name = String(programme.name || programme.sourceId || programme.id || '').trim();
      if (!id || !name) return;
      [programme.name, programme.id, programme.sourceId].forEach(value => {
        const key = normaliseDeepLinkValue(value);
        if (key) lookup.set(key, { id, name });
      });
    });
    catalogueModules.forEach(module => {
      const id = String(module.programmeId || '').trim();
      const name = String(module.programmeName || '').trim();
      const key = normaliseDeepLinkValue(name);
      if (id && name && key && !lookup.has(key)) lookup.set(key, { id, name });
    });
    return lookup;
  }, [catalogueModules, curriculumProgrammes]);

  const resolveProgrammeIdentity = useCallback((programmeName: string, fallbackId = '') => {
    const cleanedName = String(programmeName || '').trim() || 'Unassigned programme';
    const matched = programmeLookup.get(normaliseDeepLinkValue(cleanedName));
    return {
      programmeName: matched?.name || cleanedName,
      programmeId: matched?.id || fallbackId || cleanedName,
    };
  }, [programmeLookup]);

  const initialKsbSourceId = useMemo(() => {
    const selectedSource = cleanKsbSourceId(workingModule?.ksbProfileSourceId);
    if (selectedSource && ksbSourceMatchesModule(selectedSource, ksbSets, standards, workingModule, curriculumProgrammes)) return selectedSource;
    const ksbSet = ksbSetForModule(ksbSets, workingModule, curriculumProgrammes);
    if (ksbSet) return ksbSetSourceId(ksbSet);
    const standard = standardForModule(standards, workingModule, curriculumProgrammes);
    return standard ? ksbStandardSourceId(standard) : '';
  }, [curriculumProgrammes, ksbSets, standards, workingModule]);

  const ksbSourceLabels = useMemo(() => ksbSourceLabelMap(standards, ksbSets), [ksbSets, standards]);

  const ksbProfileOptions = useMemo(() => (
    ksbSourceOptions(ksbSets, standards)
  ), [ksbSets, standards]);
  const workspaceKsbProfileValue = useMemo(() => {
    const selectedSource = cleanKsbSourceId(workingModule?.ksbProfileSourceId);
    if (selectedSource && ksbSourceMatchesModule(selectedSource, ksbSets, standards, workingModule, curriculumProgrammes)) return selectedSource;
    const matchingProfile = ksbSetForModule(ksbSets, workingModule, curriculumProgrammes);
    if (matchingProfile) return ksbSetSourceId(matchingProfile);
    const matchingStandard = standardForModule(standards, workingModule, curriculumProgrammes);
    return matchingStandard ? ksbStandardSourceId(matchingStandard) : '';
  }, [curriculumProgrammes, ksbSets, standards, workingModule]);

  // The KSBs the module's selected source actually offers — the profile the
  // ChatGPT prompt pins its mapping to. Resolved the same way the Add-KSB picker
  // resolves its options, so the prompt lists exactly what can be mapped.
  const workspaceKsbProfileEntries = useMemo<KsbProfileEntry[]>(() => {
    const sourceId = workspaceKsbProfileValue;
    if (!sourceId) return [];
    if (sourceId.startsWith('standard:')) {
      const standard = standards.find(item => ksbSourceIdsMatch(ksbStandardSourceId(item), sourceId));
      return standard ? standardToKsbOptions(standard).map(({ code, description, type }) => ({ code, description, type })) : [];
    }
    const set = ksbSets.find(item => ksbSourceIdsMatch(ksbSetSourceId(item), sourceId));
    return set ? flattenKsbEntries(set.ksbs).map(({ code, description, type }) => ({ code, description, type })) : [];
  }, [ksbSets, standards, workspaceKsbProfileValue]);

  const ksbMappingPrompt = useMemo(
    () => buildKsbMappingPrompt({ title: workingModule?.title || '', profile: workspaceKsbProfileEntries }),
    [workingModule?.title, workspaceKsbProfileEntries],
  );

  // The module's programme and KSB source, read off the delivery it is used in.
  // A second branch used to override both from query parameters the structure
  // wizard put on the URL; with the wizard gone the delivery is the only source.
  const resolveModuleScopeLock = useCallback((module: ModuleCatalogueItem | ModuleBuilderListItem): ModuleScopeLock => {
    const usage = deliveryUsageForModuleScope(module as ModuleBuilderListItem, programmeFilter, curriculumProgrammes);
    const rawProgrammeName = usage?.programme || module.programmeName || module.sourceModule?.programme || '';
    const rawProgrammeId = usage?.programmeId || module.programmeId || module.sourceModule?.programmeId || '';
    const programmeIdentity = resolveProgrammeIdentity(rawProgrammeName, String(rawProgrammeId || ''));
    const programmeRecord = programmeForScope(curriculumProgrammes, [
      programmeIdentity.programmeId,
      programmeIdentity.programmeName,
      rawProgrammeId,
      rawProgrammeName,
    ]);
    const programmeKsbSourceId = cleanKsbSourceId(programmeRecord?.ksbProfileSourceId);
    const scopedModule = {
      ...module,
      programmeName: programmeIdentity.programmeName,
      programmeId: programmeIdentity.programmeId,
      ksbProfileSourceId: programmeKsbSourceId || module.ksbProfileSourceId,
    } as ModuleCatalogueItem;
    const matchingProfile = ksbSetForModule(ksbSets, scopedModule, curriculumProgrammes);
    const matchingStandard = standardForModule(standards, scopedModule, curriculumProgrammes);
    const ksbSourceId = programmeKsbSourceId || (matchingProfile ? ksbSetSourceId(matchingProfile) : matchingStandard ? ksbStandardSourceId(matchingStandard) : cleanKsbSourceId(module.ksbProfileSourceId));
    const ksbSourceLabel = ksbSourceLabels[ksbSourceId] || ksbSourceLabels[`profile:${ksbSourceId}`] || ksbSourceLabels[`standard:${ksbSourceId}`] || ksbSourceId;
    const locked = Boolean(
      programmeIdentity.programmeName
      && programmeIdentity.programmeName !== 'Unassigned programme'
      && (usage || programmeRecord || matchingProfile || matchingStandard),
    );
    return {
      programmeId: programmeIdentity.programmeId,
      programmeName: programmeIdentity.programmeName,
      ksbSourceId,
      ksbSourceLabel,
      locked,
    };
  }, [curriculumProgrammes, ksbSets, ksbSourceLabels, programmeFilter, resolveProgrammeIdentity, standards]);

  const workingModuleScopeLock = useMemo(
    () => (workingModule ? resolveModuleScopeLock(workingModule) : null),
    [resolveModuleScopeLock, workingModule],
  );

  // "Module settings" used to reopen the structure wizard on its Modules step
  // just to move a module between programmes, cohorts and groups. That is the
  // same job the Add-module drawer does, so it opens that instead.
  const openPlacementForm = useCallback((module: ModuleCatalogueItem) => {
    setSettingsOpen(false);
    const target = moduleFormTargetFromCatalogue(
      module,
      deliveryUsageForModuleScope(module as ModuleBuilderListItem, programmeFilter, curriculumProgrammes),
    );
    setPlacementModule(target);
  }, [curriculumProgrammes, programmeFilter]);

  const closePlacementForm = useCallback(() => {
    setPlacementModule(null);
  }, []);

  const moduleFormOpen = createOpen || Boolean(placementModule);
  const moduleFormScopeLoadedRef = useRef(false);
  useEffect(() => {
    if (!moduleFormOpen || moduleFormScopeLoadedRef.current) return undefined;
    let active = true;
    void Promise.all([
      fetchCurriculumOverview(undefined, { compact: true }).catch(() => null),
      fetchCurriculumHolidays().catch(() => [] as CurriculumHoliday[]),
    ]).then(([overview, holidays]) => {
      if (!active) return;
      moduleFormScopeLoadedRef.current = true;
      setModuleFormScope({
        cohorts: overview?.cohorts || [],
        groups: overview?.groups || [],
        holidays,
      });
    });
    return () => { active = false; };
  }, [moduleFormOpen]);

  // Scope + module-scoped uploader passed to the shared week-builder editor.
  const weekScopeForModule = useMemo<WeekScope>(() => ({
    courseType: 'paid',
    programmeId: workingModule?.programmeId || '',
    programmeName: workingModule?.programmeName || '',
    moduleName: workingModule?.title || '',
    groupName: workingModule?.group || '',
  }), [workingModule?.programmeId, workingModule?.programmeName, workingModule?.title, workingModule?.group]);
  const uploadComponentForModule = useCallback<WeekComponentUploader>(
    (componentId, file, componentType) => uploadComponentResource({ moduleCatalogueId: workingModule?.catalogueId || '', componentId, componentType, file }),
    [workingModule?.catalogueId],
  );

  const restoreTeamsMeetingForWorkingModule = useCallback(async () => {
    const module = workingModule;
    if (!module?.catalogueId || restoringTeamsModuleId) return;
    setRestoringTeamsModuleId(module.catalogueId);
    setActionMessage(null);
    setNoticeAlert(null);
    const wasDirty = Boolean(savedModuleSnapshotRef.current && moduleSnapshot(module) !== savedModuleSnapshotRef.current);
    try {
      const result = await restoreModuleTeamsMeeting(module.catalogueId);
      const meetingSettings = result.meeting as ModuleComponent['settings'];
      // The endpoint answers with the module as it now stands, and each week's
      // live-session component carries that week's own session — so the stored
      // component is what is merged in, not one set of series settings applied
      // to every week. Unsaved local edits are kept: only live sessions change.
      const restoredWeeks = new Map((result.module?.weekStructure || []).map(week => [week.id, week]));
      let nextSnapshot = '';
      setWorkingModule(current => {
        if (!current || current.catalogueId !== module.catalogueId) return current;
        const next = recalculateModule({
          ...current,
          deliveryMetadata: {
            ...(current.deliveryMetadata || {}),
            ...meetingSettings,
          },
          weekStructure: current.weekStructure.map(week => {
            const restored = restoredWeeks.get(week.id);
            const restoredById = new Map((restored?.components || []).map(component => [component.id, component]));
            const localIds = new Set(week.components.map(component => component.id));
            return {
              ...week,
              sessionDate: restored?.sessionDate ?? week.sessionDate,
              sessionDay: restored?.sessionDay ?? week.sessionDay,
              components: [
                ...week.components.map(component => (
                  component.type === 'live-session'
                    ? { ...component, settings: { ...component.settings, ...(restoredById.get(component.id)?.settings || meetingSettings) } }
                    : component
                )),
                // A week that had no live session now has the one the re-attach
                // created for it; without this the module would only show it
                // after a reload.
                ...(restored?.components || []).filter(component => component.type === 'live-session' && !localIds.has(component.id)),
              ],
            };
          }),
        });
        nextSnapshot = moduleSnapshot(next);
        return next;
      });
      if (!wasDirty && nextSnapshot) {
        savedModuleSnapshotRef.current = nextSnapshot;
      }
      setStorageVersion(version => version + 1);
      setNoticeAlert({
        title: 'Teams data restored',
        message: result.updatedComponents
          ? `Restored the saved Teams meeting into ${result.updatedComponents} live session component${result.updatedComponents === 1 ? '' : 's'}.`
          : 'Loaded the saved Teams meeting for this module.',
      });
      reload({ silent: true });
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to restore saved Teams data.');
    } finally {
      setRestoringTeamsModuleId(null);
    }
  }, [reload, restoringTeamsModuleId, workingModule]);

  // Staff and Teams state are additive: the catalogue must still render if either
  // request fails, so neither is allowed to surface as a page-level error.
  useEffect(() => {
    const controller = new AbortController();
    fetchCurriculumTutors(controller.signal)
      .then(profiles => setTutorProfiles(profiles))
      .catch(() => {});
    fetchCurriculumTeamsMeetingSummaries(controller.signal)
      .then(summaries => setTeamsMeetings(summaries))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const deliveryUsages = useMemo(
    () => catalogueModules.flatMap(module => module.deliveryUsages || []),
    [catalogueModules],
  );

  const cohortFilterOptions = useMemo(() => {
    const options = new Map<string, string>();
    deliveryUsages
      .filter(usage => usageMatchesProgrammeFilter(usage, programmeFilter, curriculumProgrammes))
      .forEach(usage => {
        const value = deliveryFilterValue(usage.cohortId, usage.cohort);
        if (value) options.set(value, cleanModuleMeta(usage.cohort) || value);
      });
    return Array.from(options, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [curriculumProgrammes, deliveryUsages, programmeFilter]);

  const groupFilterOptions = useMemo(() => {
    const options = new Map<string, string>();
    deliveryUsages
      .filter(usage => (
        usageMatchesProgrammeFilter(usage, programmeFilter, curriculumProgrammes)
        && deliveryFilterMatches(cohortFilter, usage.cohortId, usage.cohort)
      ))
      .forEach(usage => {
        const value = deliveryFilterValue(usage.groupId, usage.group);
        if (value) options.set(value, cleanModuleMeta(usage.group) || value);
      });
    return Array.from(options, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [cohortFilter, curriculumProgrammes, deliveryUsages, programmeFilter]);

  /** Every tutor who could be assigned: the staff roster plus anyone already on a delivery. */
  const tutorNames = useMemo(() => {
    const names = new Set<string>();
    tutorProfiles.forEach(profile => {
      const name = tutorDisplayName(profile.name) || tutorDisplayName(profile.email);
      if (name) names.add(name);
    });
    deliveryUsages.forEach(usage => { if (usage.tutor) names.add(usage.tutor); });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [deliveryUsages, tutorProfiles]);

  // Drop a child filter its parent no longer contains, so the cascade can never
  // show a contradictory Programme / Cohort / Group combination.
  useEffect(() => {
    if (cohortFilter && !cohortFilterOptions.some(option => option.value === cohortFilter)) setCohortFilter('');
  }, [cohortFilter, cohortFilterOptions]);
  useEffect(() => {
    if (groupFilter && !groupFilterOptions.some(option => option.value === groupFilter)) setGroupFilter('');
  }, [groupFilter, groupFilterOptions]);

  useEffect(() => {
    if (!filtersTouchedRef.current) return;
    const next = new URLSearchParams(searchParams);
    ([
      ['programme', programmeFilter === 'All' ? '' : programmeFilter],
      ['cohort', cohortFilter],
      ['group', groupFilter],
      ['tutor', tutorFilter],
    ] as const).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key); });
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [cohortFilter, groupFilter, programmeFilter, searchParams, setSearchParams, tutorFilter]);

  const changeFilter = useCallback((apply: () => void) => {
    filtersTouchedRef.current = true;
    apply();
  }, []);

  const teamsByModule = useMemo(() => {
    const map = new Map<string, CurriculumTeamsMeetingSummary>();
    teamsMeetings.forEach(summary => {
      const key = normaliseDeepLinkValue(summary.moduleCatalogueId);
      if (key) map.set(key, summary);
    });
    return map;
  }, [teamsMeetings]);

  const deliveryFiltersActive = Boolean(cohortFilter || groupFilter || tutorFilter);

  const filtered = catalogueModules.filter(module => {
    const text = `${module.title} ${module.catalogueId} ${module.programmeName} ${moduleIdentityText(module)} ${moduleDeliverySearchText(module)}`.toLowerCase();
    if (search && !text.includes(search.toLowerCase())) return false;
    if (programmeFilter !== 'All' && !moduleBelongsToProgrammeFilter(module, programmeFilter, curriculumProgrammes)) return false;
    // A delivery filter is a question about deliveries, so a module qualifies
    // only when one single delivery answers all of them at once -- never one
    // delivery for the cohort and a different one for the tutor.
    if (!deliveryFiltersActive) return true;
    return (module.deliveryUsages || []).some(usage => (
      deliveryFilterMatches(cohortFilter, usage.cohortId, usage.cohort)
      && deliveryFilterMatches(groupFilter, usage.groupId, usage.group)
      && (!tutorFilter || normaliseDeepLinkValue(usage.tutor) === normaliseDeepLinkValue(tutorFilter))
    ));
  });

  const deliveryStats = useMemo(() => ({
    deliveries: deliveryUsages.length,
    withTutor: deliveryUsages.filter(usage => Boolean(usage.tutor)).length,
    sessions: deliveryUsages.reduce((total, usage) => total + (usage.sessions || 0), 0),
    teams: teamsMeetings.length,
  }), [deliveryUsages, teamsMeetings]);

  const published = catalogueModules.filter(module => module.status === 'published').length;
  const draftCount = catalogueModules.filter(module => module.status === 'draft').length;
  const totalComponents = catalogueModules.reduce((total, module) => total + (module.lessonCount || 0), 0);

  const selectedWeek = workingModule?.weekStructure.find(week => week.id === selection?.weekId) || null;
  const selectedComponent =
    selection?.kind === 'component'
      ? selectedWeek?.components.find(component => component.id === selection.componentId) || null
      : null;
  const ksbMapDisplayModule = useMemo(() => {
    if (!ksbMapModule || !workingModule) return ksbMapModule;
    const requestedId = moduleStructureIdentifier(ksbMapModule);
    const workingId = moduleStructureIdentifier(workingModule);
    if (!requestedId || requestedId !== workingId) return ksbMapModule;
    return {
      ...ksbMapModule,
      ...workingModule,
      deliveryUsages: ksbMapModule.deliveryUsages,
    };
  }, [ksbMapModule, workingModule]);
  const hasUnsavedWorkingModuleChanges = Boolean(
    workingModule && savedModuleSnapshotRef.current && moduleSnapshot(workingModule) !== savedModuleSnapshotRef.current,
  );

  const finishLoadingProgress = useCallback(async (markComplete: (value: boolean) => void) => {
    markComplete(true);
    await new Promise(resolve => window.setTimeout(resolve, 120));
  }, []);

  const openModule = useCallback(async (module: ModuleCatalogueItem, openSettings = false) => {
    const structureId = moduleStructureIdentifier(module);
    setOpeningModule({ title: module.title, mode: openSettings ? 'settings' : 'builder' });
    setOpeningModuleComplete(false);
    setActionMessage(null);
    setNoticeAlert(null);
    try {
      const remote = await loadModuleStructure(structureId);
      const loadedBase = remote
        ? {
            ...module,
            ...remote,
            // Each count keeps to its own field. Cross-falling-back between them
            // is what let a delivery-multiplied session total surface as the
            // module's week count (and vice versa) after a reload.
            sessionsNumber: remote.sessionsNumber || module.sessionsNumber,
            weeks: remote.weeks || module.weeks,
            sourceModule: module.sourceModule || remote.sourceModule,
          }
        : module;
      const base = getDefaultStructure(loadedBase);
      const scopeLock = resolveModuleScopeLock(base);
      const scopedBase = {
        ...base,
        programmeId: scopeLock.programmeId || base.programmeId,
        programmeName: scopeLock.programmeName || base.programmeName,
        ksbProfileSourceId: scopeLock.ksbSourceId || base.ksbProfileSourceId,
      } as ModuleBuilderListItem;
      scopedBase.deliveryUsages = (module as ModuleBuilderListItem).deliveryUsages;
      let next = recalculateModule(scopedBase);
      if (moduleNeedsTeamsRestore(next)) {
        try {
          const restored = await restoreModuleTeamsMeeting(next.catalogueId);
          if (restored.module) {
            next = recalculateModule({ ...next, ...restored.module, sourceModule: next.sourceModule || restored.module.sourceModule });
          }
        } catch (err) {
          console.warn('No saved Teams data could be restored for this module.', err);
        }
      }
      const deepLinkTarget = moduleBuilderDeepLinkTarget(next, new URLSearchParams(window.location.search));
      savedModuleSnapshotRef.current = moduleSnapshot(next);
      setWorkingModule(next);
      setSelection(deepLinkTarget.selection || (next.weekStructure[0] ? { kind: 'week', weekId: next.weekStructure[0].id } : null));
      setSettingsOpen(openSettings || deepLinkTarget.openSettings);
      await finishLoadingProgress(setOpeningModuleComplete);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to load module structure.');
    } finally {
      setOpeningModule(null);
      setOpeningModuleComplete(false);
    }
  }, [finishLoadingProgress, resolveModuleScopeLock]);

  const openKsbMap = useCallback(async (module: ModuleBuilderListItem) => {
    const loadingId = module.catalogueId || moduleStructureIdentifier(module) || module.title;
    const requestedId = moduleStructureIdentifier(module);
    const workingId = workingModule ? moduleStructureIdentifier(workingModule) : '';
    setKsbMapLoadingId(loadingId);
    if (!requestedId) {
      await wait(180);
      setKsbMapModule(module);
      setKsbMapLoadingId(null);
      return;
    }
    if (workingModule && requestedId && requestedId === workingId) {
      await wait(180);
      setKsbMapModule({ ...module, ...workingModule, deliveryUsages: module.deliveryUsages });
      setKsbMapLoadingId(null);
      return;
    }

    try {
      const [remote] = await Promise.all([loadModuleStructure(requestedId), wait(180)]);
      setKsbMapModule(remote ? { ...module, ...remote, deliveryUsages: module.deliveryUsages } : module);
    } catch (err) {
      console.warn('Unable to load full module structure for KSB map.', err);
      setKsbMapModule(module);
    } finally {
      setKsbMapLoadingId(null);
    }
  }, [workingModule]);

  const openProgrammeKsbMap = useCallback(async () => {
    if (programmeFilter === 'All' || programmeKsbLoading) return;
    const programmeModules = catalogueModules.filter(module => moduleBelongsToProgrammeFilter(module, programmeFilter, curriculumProgrammes));
    if (!programmeModules.length) return;
    setProgrammeKsbLoading(true);
    setActionMessage(null);
    try {
      const loadedModules = await Promise.all(programmeModules.map(async module => {
        const structureId = moduleStructureIdentifier(module);
        if (!structureId) return module;
        try {
          const remote = await loadModuleStructure(structureId);
          return remote ? mergeKsbStructureForReview(module, remote) : module;
        } catch (err) {
          console.warn('Unable to load full module structure for programme KSB map.', err);
          return module;
        }
      }));
      setProgrammeKsbMap({ programmeName: programmeFilter, modules: loadedModules });
    } finally {
      setProgrammeKsbLoading(false);
    }
  }, [catalogueModules, curriculumProgrammes, programmeFilter, programmeKsbLoading]);

  const quizzesLoadedRef = useRef(false);
  useEffect(() => {
    // Only a quiz-type component's editor (inside the build drawer) reads
    // this -- the plain catalogue list never shows quiz data.
    if (!workingModule || quizzesLoadedRef.current) return undefined;
    quizzesLoadedRef.current = true;
    let active = true;
    setQuizzesLoading(true);
    fetch('/quiz_api/quizzes/?status=all&assessmentType=quiz')
      .then(response => {
        if (!response.ok) throw new Error(`Unable to load quizzes (${response.status})`);
        return response.json();
      })
      .then(data => {
        if (!active) return;
        const results = Array.isArray(data?.results) ? data.results : [];
        setQuizPackages(results);
      })
      .catch(error => {
        if (!active) return;
        console.warn('Unable to load LMS quizzes.', error);
      })
      .finally(() => {
        if (active) setQuizzesLoading(false);
      });
    return () => { active = false; };
  }, [workingModule]);

  const standardsLoadedRef = useRef(false);
  useEffect(() => {
    // Same trigger as needsKsbData: standards only feed KSB source
    // resolution, never the plain catalogue list.
    if (!needsKsbData || standardsLoadedRef.current) return undefined;
    standardsLoadedRef.current = true;
    const controller = new AbortController();
    setStandardsLoading(true);
    fetchCurriculumStandards(controller.signal)
      .then(result => setStandards(result))
      .catch(error => {
        if (controller.signal.aborted) return;
        console.warn('Unable to load Skills England standards.', error);
        setStandards([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setStandardsLoading(false);
      });
    return () => controller.abort();
  }, [needsKsbData]);

  useEffect(() => {
    if (!saving || !saveStartedAt) {
      setSaveElapsedSeconds(0);
      return;
    }
    const tick = () => setSaveElapsedSeconds(Math.max(0, Math.floor((Date.now() - saveStartedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [saveStartedAt, saving]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedProgramme = (params.get('programme') || params.get('programmeId') || '').trim();
    if (!requestedProgramme || loading || programmeFilter !== 'All') return;
    const requestedNormalised = normaliseDeepLinkValue(requestedProgramme);
    // The Programme workspace links with a canonical id, not a name, so resolve
    // the id back to its programme before matching the (name-based) options.
    const byIdentifier = curriculumProgrammes.find(programme => (
      [programme.id, programme.sourceId, programme.name, programme.standard]
        .map(normaliseDeepLinkValue)
        .filter(Boolean)
        .includes(requestedNormalised)
    ));
    const resolvedName = normaliseDeepLinkValue(byIdentifier?.name);
    const match = programmeOptions.find(option => (
      option !== 'All' && (
        option === requestedProgramme
        || normaliseDeepLinkValue(option) === requestedNormalised
        || (Boolean(resolvedName) && normaliseDeepLinkValue(option) === resolvedName)
      )
    ));
    if (match) setProgrammeFilter(match);
  }, [curriculumProgrammes, loading, programmeFilter, programmeOptions]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedModule = params.get('module') || params.get('moduleId') || params.get('catalogueId') || params.get('moduleTitle') || '';
    const requestedKey = requestedModule.trim();
    if (!requestedKey || loading || error || workingModule || deepLinkedModuleRef.current === requestedKey) return;

    const requestedNormalised = normaliseDeepLinkValue(requestedKey);
    const target = catalogueModules.find(module => {
      const identifiers = moduleDeepLinkIdentifiers(module);
      const titles = [module.title, module.sourceModule?.name];
      return identifiers.some(value => value === requestedKey)
        || titles.some(value => normaliseDeepLinkValue(value) === requestedNormalised);
    });

    // A deep link only ever *opens* a module. It used to fall through to creating
    // one from the rest of the query string, which meant a link naming a module
    // that had been renamed or deleted silently wrote a new record instead.
    if (!target) {
      if (catalogueModules.length) {
        deepLinkedModuleRef.current = requestedKey;
        setActionMessage(`Unable to find module "${requestedKey}" in Module Builder.`);
      }
      return;
    }

    deepLinkedModuleRef.current = requestedKey;
    openModule(target);
  }, [catalogueModules, error, loading, openModule, workingModule]);

  const updateWorkingModule = useCallback((updater: (module: ModuleCatalogueItem) => ModuleCatalogueItem) => {
    setActionMessage(null);
    setWorkingModule(current => (current ? recalculateModule(updater(current)) : current));
  }, []);

  // Import a saved week template as a NEW week in this module: copy the week's
  // fields + components, regenerating ids so they're independent of the source.
  const importWeekTemplateAsNewWeek = useCallback((template: WeekTemplate) => {
    updateWorkingModule(module => {
      const shell = createEmptyWeek(module.id, module.weekStructure.length + 1);
      const newWeek: ModuleWeek = {
        ...shell,
        title: template.title || shell.title,
        summary: template.summary || '',
        learningOutcomes: template.learningOutcomes || [],
        ksbMappings: (template.ksbMappings || []).map(mapping => ({ ...mapping, id: makeAuthoringId('ksb') })),
        components: (template.components || []).map(component => ({
          ...component,
          id: makeAuthoringId('component'),
          weekId: shell.id,
          ksbMappings: (component.ksbMappings || []).map(mapping => ({ ...mapping, id: makeAuthoringId('ksb') })),
        })),
      };
      return { ...module, weekStructure: [...module.weekStructure, newWeek] };
    });
    setWeekTemplateImportOpen(false);
  }, [updateWorkingModule]);

  // Copy components chosen from the reuse library into an existing week. The
  // copies land in client state and are persisted by the normal module save -
  // a per-component write would be undone by it, because saving re-upserts the
  // module's whole week structure.
  const addLibraryComponentsToWeek = useCallback((weekId: string, picked: LibraryComponent[]) => {
    let lastComponentId = '';
    updateWorkingModule(module => ({
      ...module,
      weekStructure: module.weekStructure.map(week => {
        if (week.id !== weekId) return week;
        const copies = picked.map(source => copyComponentIntoWeek(source, week.id, module.id));
        if (copies.length) lastComponentId = copies[copies.length - 1].id;
        return { ...week, components: [...week.components, ...copies] };
      }),
    }));
    if (lastComponentId) setSelection({ kind: 'component', weekId, componentId: lastComponentId });
    setReusePickerWeekId(null);
  }, [updateWorkingModule]);

  const confirmDeleteWeek = async (weekId: string) => {
    if (!workingModule) return;
    const week = workingModule.weekStructure.find(item => item.id === weekId);
    const title = week?.title || 'this week';
    const componentCount = week?.components.length || 0;

    await showBuilderDeleteSwal({
      title: 'Delete week?',
      message: `${title} and ${componentCount} component${componentCount === 1 ? '' : 's'} inside it will be removed.`,
      warning: 'This removes the week, its components, KSB mappings, OTJH and points from the module totals.',
      confirmButtonText: 'Delete week',
      processingText: 'Deleting week...',
      successTitle: 'Week deleted',
      successText: `${title} was removed and the remaining weeks were renumbered.`,
      onConfirm: async () => {
        const deletedIndex = workingModule.weekStructure.findIndex(item => item.id === weekId);
        const remainingWeeks = workingModule.weekStructure.filter(item => item.id !== weekId);
        const nextSelectedWeek = remainingWeeks[Math.min(Math.max(deletedIndex, 0), Math.max(remainingWeeks.length - 1, 0))] || null;

        await wait(550);
        updateWorkingModule(module => removeWeekFromModule(module, weekId));
        setDragState(null);
        if (lessonPickerWeekId === weekId) setLessonPickerWeekId(null);
        if (reusePickerWeekId === weekId) setReusePickerWeekId(null);
        if (selection?.weekId === weekId) {
          setSelection(nextSelectedWeek ? { kind: 'week', weekId: nextSelectedWeek.id } : null);
        }
      },
    });
  };

  // Saving keeps you exactly where you are, on the component you were editing.
  // This used to take a `closeAfterSave` option that defaulted to true, and the
  // footer passed this function straight to onClick -- so the click event
  // arrived as `options`, `options.closeAfterSave` read undefined, and every
  // save threw up a "Returning to the modules list" alert and then closed the
  // workspace. Leaving is what the guarded Back button is for.
  const persistWorkingModule = useCallback(async () => {
    if (!workingModule) return null;
    const scopedWorkingModule = workingModuleScopeLock?.locked ? {
      ...workingModule,
      programmeId: workingModuleScopeLock.programmeId || workingModule.programmeId,
      programmeName: workingModuleScopeLock.programmeName || workingModule.programmeName,
      ksbProfileSourceId: workingModuleScopeLock.ksbSourceId || workingModule.ksbProfileSourceId,
    } : workingModule;
    const validationIssues = validateModuleAuthoringStructure(scopedWorkingModule);
    if (validationIssues.length) {
      setActionMessage(firstValidationMessage(validationIssues));
      return null;
    }
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    setSaving(true);
    setSaveStartedAt(Date.now());
    setActionMessage(null);
    const normalisedModule = normaliseComponentTitles(scopedWorkingModule);
    const selectedKsbSourceId = cleanKsbSourceId(workingModuleScopeLock?.locked ? workingModuleScopeLock.ksbSourceId : normalisedModule.ksbProfileSourceId);
    const moduleToSave = recalculateModule({
      ...normalisedModule,
      ksbProfileSourceId: selectedKsbSourceId && (workingModuleScopeLock?.locked || ksbSourceMatchesModule(selectedKsbSourceId, ksbSets, standards, normalisedModule, curriculumProgrammes))
        ? selectedKsbSourceId
        : '',
    });
    try {
      setWorkingModule(moduleToSave);
      const saved = await saveModuleStructure(moduleToSave.catalogueId, moduleToSave);
      const stillCurrent = saveRequestRef.current === requestId;
      if (!stillCurrent) return;
      setWorkingModule(current => {
        if (!current || current.catalogueId !== moduleToSave.catalogueId) return current;
        return saved;
      });
      savedModuleSnapshotRef.current = moduleSnapshot(saved);
      setStorageVersion(version => version + 1);
      setActionMessage(null);
      // No dialog on a successful save. The footer already reads "All changes
      // saved" with a green Saved button, and a modal on every save is an
      // interruption in a screen people save constantly.
      reload();
      return saved;
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to save module structure.');
      return null;
    } finally {
      if (saveRequestRef.current === requestId) {
        setSaving(false);
        setSaveStartedAt(null);
      }
    }
  }, [curriculumProgrammes, ksbSets, reload, standards, workingModule, workingModuleScopeLock]);

  // Export every component to an Excel sheet, one row each, for a curriculum
  // worker to have ChatGPT fill the KSBs against each title/description.
  const exportKsbSheet = useCallback(async () => {
    if (!workingModule) return;
    setActionMessage(null);
    setSaveSuccess(null);
    // Guard before exporting so an empty module never downloads a blank sheet.
    if (!workingModule.weekStructure.some(week => week.components.length)) {
      setActionMessage('This module has no components to export yet.');
      return;
    }
    try {
      const { rows, fileName } = await exportModuleKsbWorkbook(workingModule);
      setNoticeAlert({ title: 'KSB sheet exported', message: `Downloaded ${fileName} with ${rows} component${rows === 1 ? '' : 's'}. Fill the KSBs column in ChatGPT, then re-upload it here.` });
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to export the KSB sheet.');
    }
  }, [workingModule]);

  // Read a filled KSB sheet back onto the components and stage the change as an
  // unsaved edit — the person reviews it and saves like any other authoring change.
  const importKsbSheet = useCallback(async (file: File) => {
    if (!workingModule) return;
    setActionMessage(null);
    setSaveSuccess(null);
    try {
      const { module: nextModule, summary } = await importModuleKsbWorkbook(file, workingModule);
      if (!summary.rowsWithKsbs) {
        setActionMessage('No KSBs were found in the uploaded sheet. Fill the KSBs column before re-uploading.');
        return;
      }
      updateWorkingModule(() => nextModule);
      setNoticeAlert({ title: 'KSB sheet imported', message: describeKsbImport(summary) });
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to read the uploaded KSB sheet.');
    }
  }, [updateWorkingModule, workingModule]);

  const duplicateModule = async (module: ModuleCatalogueItem) => {
    setDuplicatingModule(module);
    setDuplicatingModuleComplete(false);
    setActionMessage(null);
    setNoticeAlert(null);
    try {
      const source = getDefaultStructure((await loadModuleStructure(moduleStructureIdentifier(module))) || module);
      const duplicate = await duplicateModuleStructure(source);
      setNoticeAlert({
        title: 'Module duplicated',
        message: `${duplicate.title} was created as a draft with its authoring structure.`,
      });
      reload();
      await finishLoadingProgress(setDuplicatingModuleComplete);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to duplicate module.');
    } finally {
      setDuplicatingModule(null);
      setDuplicatingModuleComplete(false);
    }
  };

  const deleteModule = async (module: ModuleCatalogueItem) => {
    if (deletingModuleId) return;
    setDeletingModuleId(module.catalogueId);
    setActionMessage(null);
    try {
      await deleteModuleStructure(moduleStructureIdentifier(module));
      setHiddenModuleIds(current => new Set(current).add(module.catalogueId));
      if (workingModule?.catalogueId === module.catalogueId) {
        savedModuleSnapshotRef.current = '';
        setWorkingModule(null);
        setSelection(null);
      }
      setStorageVersion(version => version + 1);
      setDeletingModuleId(null);
      setActionMessage(null);
      reload({ silent: true });
    } catch (err) {
      setDeletingModuleId(null);
      setActionMessage(err instanceof Error ? err.message : 'Unable to delete module.');
      throw err;
    }
  };

  const confirmDeleteModule = async (module: ModuleCatalogueItem) => {
    if (deletingModuleId) return;
    const weekCount = module.weekStructure.length || module.weeks || 0;
    const componentCount = module.lessonCount || module.weekStructure.reduce((total, week) => total + week.components.length, 0);
    await showCurriculumConfirm({
      title: 'Delete this module?',
      text: `${module.title} and its authoring structure will be removed. This deletes ${weekCount} weeks, ${componentCount} components, KSB mappings, completion criteria and advanced details from Module Builder.`,
      icon: 'warning',
      confirmButtonText: 'Yes, delete module',
      cancelButtonText: 'Cancel',
      successTitle: 'Module deleted',
      successText: `${module.title} and all authoring components were deleted.`,
      onConfirm: async () => {
        await deleteModule(module);
      },
    });
  };

  const closeWorkingModule = () => {
    savedModuleSnapshotRef.current = '';
    setWorkingModule(null);
    setSelection(null);
    setSettingsOpen(false);
    setPreviewOpen(false);
    setLessonPickerWeekId(null);
    setNoticeAlert(null);
    setActionMessage(null);
  };

  const restoreSavedWorkingModule = useCallback(() => {
    if (!savedModuleSnapshotRef.current) return workingModule;
    try {
      const restored = recalculateModule(JSON.parse(savedModuleSnapshotRef.current) as ModuleCatalogueItem);
      setWorkingModule(restored);
      return restored;
    } catch {
      return workingModule;
    }
  }, [workingModule]);

  const applySelectionSafely = useCallback((nextSelection: Selection, moduleOverride?: ModuleCatalogueItem | null) => {
    const source = moduleOverride || workingModule;
    if (!source) return;
    const week = source.weekStructure.find(item => item.id === nextSelection.weekId);
    if (!week) {
      const firstWeek = source.weekStructure[0];
      setSelection(firstWeek ? { kind: 'week', weekId: firstWeek.id } : null);
      return;
    }
    if (nextSelection.kind === 'component' && !week.components.some(component => component.id === nextSelection.componentId)) {
      setSelection({ kind: 'week', weekId: week.id });
      return;
    }
    setSelection(nextSelection);
  }, [workingModule]);

  // The placement drawer PATCHes the name, dates, tutor and group straight to
  // the store while the builder is holding its own copy of the module. Without
  // this the workspace keeps showing the old placement and the next builder
  // save writes that stale copy back over what the drawer just stored. Weeks
  // and components are the builder's own, so work in progress is kept.
  const syncWorkingModuleFromStore = useCallback(async () => {
    const current = workingModule;
    if (!current) return;
    const structureId = moduleStructureIdentifier(current);
    if (!structureId) return;
    const remote = await loadModuleStructure(structureId).catch(() => null);
    if (!remote) return;
    const dirty = Boolean(savedModuleSnapshotRef.current && moduleSnapshot(current) !== savedModuleSnapshotRef.current);
    const merged = {
      ...current,
      ...remote,
      sessionsNumber: remote.sessionsNumber || current.sessionsNumber,
      weeks: remote.weeks || current.weeks,
      sourceModule: current.sourceModule || remote.sourceModule,
      deliveryUsages: (remote as ModuleBuilderListItem).deliveryUsages || (current as ModuleBuilderListItem).deliveryUsages,
    } as ModuleBuilderListItem;
    const stored = recalculateModule(getDefaultStructure(merged));
    savedModuleSnapshotRef.current = moduleSnapshot(stored);
    const next = dirty ? recalculateModule({ ...stored, weekStructure: current.weekStructure }) : stored;
    setWorkingModule(latest => (latest && latest.catalogueId === current.catalogueId ? next : latest));
    if (selection) applySelectionSafely(selection, next);
  }, [applySelectionSafely, selection, workingModule]);

  const requestDirtyNavigation = useCallback(async (onNavigate: (moduleAfterDiscard?: ModuleCatalogueItem | null) => void | Promise<void>) => {
    if (saving) return;
    if (!hasUnsavedWorkingModuleChanges) {
      await onNavigate();
      return;
    }
    const result = await Swal.fire({
      title: 'Save changes first?',
      text: 'This module has unsaved edits. Save before continuing, discard the edits, or cancel.',
      icon: 'warning',
      width: 512,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Save',
      denyButtonText: 'Discard',
      cancelButtonText: 'Cancel',
      reverseButtons: true,
      focusCancel: true,
      buttonsStyling: false,
      customClass: {
        popup: 'kbc-standard-swal-popup',
        title: 'kbc-standard-swal-title',
        htmlContainer: 'kbc-standard-swal-text',
        actions: 'kbc-standard-swal-actions',
        confirmButton: 'kbc-standard-swal-confirm',
        denyButton: 'kbc-standard-swal-cancel',
        cancelButton: 'kbc-standard-swal-cancel',
      },
    });
    if (result.isConfirmed) {
      const saved = await persistWorkingModule();
      if (saved) await onNavigate(saved);
      return;
    }
    if (result.isDenied) {
      const restored = restoreSavedWorkingModule();
      await onNavigate(restored);
    }
  }, [hasUnsavedWorkingModuleChanges, persistWorkingModule, restoreSavedWorkingModule, saving]);

  const requestSelectionChange = useCallback((nextSelection: Selection) => {
    applySelectionSafely(nextSelection);
  }, [applySelectionSafely]);

  // The dates the weeks run on come from the module's own session plan, so
  // adding or removing a week has to re-read it: week N is session N, and the
  // seventh week of a six-week module lands on the seventh planned delivery day
  // -- the next one the cohort has not closed for a holiday. Reordering weeks
  // does not ask: it moves content around a timetable that stays put.
  //
  // A module is dated on sight as well, which is what gives weeks the builder
  // had to invent (a delivery slot authored as six sessions with no structure
  // saved yet) the dates the rest of the module already runs to. Only a change
  // in the count moves the module's end date -- opening a module is not an edit
  // to when it finishes.
  const plannedWeekCountRef = useRef<{ catalogueId: string; weeks: number } | null>(null);
  const workingModuleCatalogueId = workingModule?.catalogueId || '';
  const workingModuleWeekCount = workingModule?.weekStructure.length || 0;
  useEffect(() => {
    if (!workingModuleCatalogueId || !workingModuleWeekCount) {
      plannedWeekCountRef.current = null;
      return undefined;
    }
    const planned = plannedWeekCountRef.current;
    if (planned?.catalogueId === workingModuleCatalogueId && planned.weeks === workingModuleWeekCount) return undefined;
    const countChanged = planned?.catalogueId === workingModuleCatalogueId;
    plannedWeekCountRef.current = { catalogueId: workingModuleCatalogueId, weeks: workingModuleWeekCount };
    let active = true;
    void loadModuleWeekSessionPlan(workingModuleCatalogueId, workingModuleWeekCount).then(plan => {
      if (!active || !plan) return;
      setWorkingModule(current => (
        current && current.catalogueId === workingModuleCatalogueId && current.weekStructure.length === workingModuleWeekCount
          ? applyModuleWeekSessionPlan(current, plan, { followEndDate: countChanged })
          : current
      ));
    });
    return () => { active = false; };
  }, [workingModuleCatalogueId, workingModuleWeekCount]);

  // Whichever week is selected (directly, or via one of its components) is
  // always expanded in the Course structure accordion — this is the single
  // source of "make sure the active week's parts are visible."
  useEffect(() => {
    const weekId = selection?.weekId;
    if (!weekId) return;
    setExpandedWeekIds(prev => {
      if (prev.has(weekId) && (ALLOW_MULTIPLE_EXPANDED_WEEKS || prev.size === 1)) return prev;
      return ALLOW_MULTIPLE_EXPANDED_WEEKS ? new Set([...prev, weekId]) : new Set([weekId]);
    });
  }, [selection?.weekId]);

  useEffect(() => {
    if (!hasUnsavedWorkingModuleChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedWorkingModuleChanges]);

  useEffect(() => {
    if (!noticeAlert) return;
    let active = true;
    showCurriculumAlert({
      title: noticeAlert.title,
      text: noticeAlert.message,
      icon: 'success',
      timer: 2600,
      confirmButtonText: 'Done',
    }).finally(() => {
      if (active) setNoticeAlert(null);
    });
    return () => {
      active = false;
    };
  }, [noticeAlert]);

  if (workingModule) {
    return (
      <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Module Builder" pageSubtitle={`${workingModule.title} - authoring workspace`} userName="Rachel Myers" userRole="Curriculum Designer">
        <div className="min-h-[calc(100vh-96px)] bg-background-100 px-3 py-4 sm:px-5 lg:px-6">
          <div className="mx-auto flex w-full max-w-[1840px] flex-col gap-4">
          <WorkspaceHeader
            module={workingModule}
            programmeOptions={programmeOptions.filter(option => option !== 'All')}
            scopeLock={workingModuleScopeLock}
            saving={saving}
            saved={!hasUnsavedWorkingModuleChanges}
            onBack={() => { void requestDirtyNavigation(() => closeWorkingModule()); }}
            onProgrammeChange={programmeName => {
              if (workingModuleScopeLock?.locked) return;
              void requestDirtyNavigation(() => {
                updateWorkingModule(module => {
                  const programmeIdentity = resolveProgrammeIdentity(programmeName, module.programmeId);
                  const nextModule = { ...module, programmeName: programmeIdentity.programmeName, programmeId: programmeIdentity.programmeId };
                  const nextProfile = ksbSetForModule(ksbSets, nextModule, curriculumProgrammes);
                  return { ...nextModule, ksbProfileSourceId: nextProfile ? ksbSetSourceId(nextProfile) : '' };
                });
              });
            }}
            ksbProfileOptions={ksbProfileOptions}
            ksbProfileValue={workingModuleScopeLock?.locked ? workingModuleScopeLock.ksbSourceId : workspaceKsbProfileValue}
            standardsLoading={standardsLoading}
            onKsbProfileChange={sourceId => {
              if (workingModuleScopeLock?.locked) return;
              updateWorkingModule(module => ({ ...module, ksbProfileSourceId: cleanKsbSourceId(sourceId) }));
            }}
          />

          {(saving || (actionMessage && !deletingModuleId)) && (
            <SaveStatusPanel
              saving={saving}
              elapsedSeconds={saveElapsedSeconds}
              error={actionMessage && !deletingModuleId ? actionMessage : null}
              module={workingModule}
            />
          )}

          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)_290px] 2xl:grid-cols-[420px_minmax(560px,1fr)_310px]">
            <CourseStructure
              module={workingModule}
              selection={selection}
              dragState={dragState}
              onDragState={setDragState}
              onSelectWeek={weekId => { void requestSelectionChange({ kind: 'week', weekId }); }}
              onSelectComponent={(weekId, componentId) => { void requestSelectionChange({ kind: 'component', weekId, componentId }); }}
              onAddWeekFromTemplate={() => setWeekTemplateImportOpen(true)}
              onReuseComponents={weekId => setReusePickerWeekId(weekId)}
              onAddWeek={() => {
                const week = createEmptyWeek(workingModule.id, workingModule.weekStructure.length + 1);
                updateWorkingModule(module => ({ ...module, weekStructure: [...module.weekStructure, week] }));
                setSelection({ kind: 'week', weekId: week.id });
              }}
              onGenerateLiveSessions={() => {
                const weekCount = weeksMissingLiveSession(workingModule).length;
                const addedCount = countAddedLiveSessions(workingModule);
                if (!addedCount) return;
                updateWorkingModule(generateMissingLiveSessions);
                void showCurriculumAlert({
                  title: 'Live sessions added',
                  text: `${addedCount} live-session component${addedCount === 1 ? '' : 's'} added across ${weekCount} week${weekCount === 1 ? '' : 's'}. Open each one and use "Create Teams meeting" to schedule it in Teams.`,
                  timer: 3200,
                });
              }}
              onDeleteWeek={weekId => {
                void confirmDeleteWeek(weekId);
              }}
              onDropReorder={targetWeekId => {
                if (!dragState) return;
                // Reordering moves what is taught, not when the module meets, so
                // the dates stay with the positions rather than travelling with
                // the week that was dragged.
                updateWorkingModule(module => ({
                  ...module,
                  weekStructure: resequenceWeekSessionDates(moveById(module.weekStructure, dragState.weekId, targetWeekId)),
                }));
                setDragState(null);
              }}
              onComponentsChange={(weekId, components) => updateWorkingModule(module => ({
                ...module,
                weekStructure: module.weekStructure.map(week => (week.id === weekId ? { ...week, components } : week)),
              }))}
              pointsByType={componentPointsByType}
              expandedWeekIds={expandedWeekIds}
              onExpandedWeekIdsChange={setExpandedWeekIds}
              allowMultipleExpanded={ALLOW_MULTIPLE_EXPANDED_WEEKS}
            />

            <div className="min-w-0">
              {selectedComponent && selectedWeek ? (
                <WeekComponentEditor
                  component={selectedComponent}
                  onChange={updates => updateWorkingModule(module => {
                    const updatedSettings = updates.settings as ModuleComponent['settings'] | undefined;
                    const sharesTeamsLink = selectedComponent.type === 'live-session'
                      && updatedSettings
                      && Object.prototype.hasOwnProperty.call(updatedSettings, 'liveSessionUrl');
                    const sharedTeamsUrl = sharesTeamsLink ? updatedSettings.liveSessionUrl : undefined;
                    return {
                      ...module,
                      weekStructure: module.weekStructure.map(week => ({
                        ...week,
                        components: week.components.map(component => {
                          if (component.id === selectedComponent.id) return { ...component, ...updates };
                          if (sharesTeamsLink && component.type === 'live-session') {
                            return {
                              ...component,
                              settings: { ...component.settings, liveSessionUrl: sharedTeamsUrl },
                            };
                          }
                          return component;
                        }),
                      })),
                    };
                  })}
                  onBack={() => requestSelectionChange({ kind: 'week', weekId: selectedWeek.id })}
                  groupOptions={componentGroupOptions}
                  rulePoints={componentPointsByType[selectedComponent.type]}
                  weekScope={weekScopeForModule}
                  weekSessionDate={selectedWeek.sessionDate}
                  uploadResource={uploadComponentForModule}
                  restoreTeamsMeeting={selectedComponent.type === 'live-session' ? restoreTeamsMeetingForWorkingModule : undefined}
                  restoringTeamsMeeting={restoringTeamsModuleId === workingModule.catalogueId}
                  liveSessionModule={{ catalogueId: workingModule.catalogueId, title: workingModule.title }}
                />
              ) : selectedWeek ? (
                <ModuleWeekPanel
                  week={selectedWeek}
                  onChange={updates => updateWorkingModule(module => ({
                    ...module,
                    weekStructure: module.weekStructure.map(week => week.id === selectedWeek.id ? { ...week, ...updates } : week),
                  }))}
                  onAddLesson={() => {
                    setLessonPickerWeekId(selectedWeek.id);
                  }}
                  onReuseComponents={() => setReusePickerWeekId(selectedWeek.id)}
                />
              ) : (
                <EmptyEditor onAddWeek={() => {
                  const week = createEmptyWeek(workingModule.id, 1);
                  updateWorkingModule(module => ({ ...module, weekStructure: [week] }));
                  setSelection({ kind: 'week', weekId: week.id });
                }} />
              )}
            </div>

              <ApprenticeshipSettings
                module={workingModule}
                week={selectedWeek}
                component={selectedComponent}
                ksbSourceLabels={ksbSourceLabels}
              ksbPrompt={ksbMappingPrompt}
              ksbProfileCount={workspaceKsbProfileEntries.length}
              onExportKsb={() => { void exportKsbSheet(); }}
              onImportKsb={() => ksbImportInputRef.current?.click()}
              onAddKsb={target => setKsbTarget(target)}
              onRemoveKsb={(target, mappingId) => updateWorkingModule(module => removeKsbMapping(module, target, mappingId))}
              onUpdateKsbWeight={(target, mappingId, weight) => updateWorkingModule(module => updateKsbMappingWeight(module, target, mappingId, weight))}
              onUpdateKsbWeightClass={(target, mappingId, weightClass) => updateWorkingModule(module => updateKsbMappingWeightClass(module, target, mappingId, weightClass))}
            />
          </div>
          <WorkspaceActionFooter
            saving={saving}
            saved={!hasUnsavedWorkingModuleChanges}
            onPreview={() => setPreviewOpen(true)}
            onEditModule={() => openPlacementForm(workingModule)}
            onModuleSettings={() => setSettingsOpen(true)}
            onDelete={() => confirmDeleteModule(workingModule)}
            onSave={() => { void persistWorkingModule(); }}
          />
          <input
            ref={ksbImportInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              // Reset first so re-uploading the same file name fires change again.
              event.target.value = '';
              if (file) void importKsbSheet(file);
            }}
          />
          </div>
        </div>

        {settingsOpen && (
          <ModuleSettingsModal
            module={workingModule}
            ksbSourceLabels={ksbSourceLabels}
            saving={saving}
            saved={!hasUnsavedWorkingModuleChanges}
            onClose={() => setSettingsOpen(false)}
            onSave={() => { void persistWorkingModule(); }}
            onChange={updates => updateWorkingModule(module => ({ ...module, ...updates }))}
            onCompletionChange={updates => updateWorkingModule(module => ({ ...module, completionCriteria: { ...module.completionCriteria, ...updates } }))}
            onAdvancedChange={updates => updateWorkingModule(module => ({ ...module, advancedDetails: { ...module.advancedDetails, ...updates } }))}
            onAddKsb={() => setKsbTarget({ scope: 'module' })}
            onRemoveKsb={mappingId => updateWorkingModule(module => removeKsbMapping(module, { scope: 'module' }, mappingId))}
            onUpdateKsbWeight={(mappingId, weight) => updateWorkingModule(module => updateKsbMappingWeight(module, { scope: 'module' }, mappingId, weight))}
            onUpdateKsbWeightClass={(mappingId, weightClass) => updateWorkingModule(module => updateKsbMappingWeightClass(module, { scope: 'module' }, mappingId, weightClass))}
          />
        )}
        <ModuleFormDrawer
          open={Boolean(placementModule)}
          module={placementModule}
          programmes={curriculumProgrammes}
          cohorts={moduleFormScope.cohorts}
          groups={moduleFormScope.groups}
          holidays={moduleFormScope.holidays}
          tutorNames={tutorNames}
          onClose={closePlacementForm}
          onSaved={async () => {
            await syncWorkingModuleFromStore();
            await reload({ silent: true });
          }}
        />
        {previewOpen && <PreviewModal module={workingModule} onClose={() => setPreviewOpen(false)} />}
        {sessionKsbMappingOpen && (
          <SessionKsbMappingModal
            module={workingModule}
            sourceLabels={ksbSourceLabels}
            onClose={() => setSessionKsbMappingOpen(false)}
          />
        )}
        {lessonPickerWeekId && (
          <ComponentTypeModal
            description="Select one or more component types — use Select all for a blank set of everything. Each becomes an empty component to fill in; nothing is copied from a saved template."
            onClose={() => setLessonPickerWeekId(null)}
            onAdd={types => {
              const week = workingModule.weekStructure.find(item => item.id === lessonPickerWeekId);
              if (!week) return;
              const components = createNamedComponents(week, types);
              if (!components.length) return;
              updateWorkingModule(module => ({
                ...module,
                weekStructure: module.weekStructure.map(item => item.id === week.id ? { ...item, components: [...item.components, ...components] } : item),
              }));
              setSelection({ kind: 'component', weekId: week.id, componentId: components[components.length - 1].id });
              setLessonPickerWeekId(null);
            }}
          />
        )}
        {weekTemplateImportOpen && workingModule && (
          <WeekTemplateImportModal
            scope={{ programmeId: workingModule.programmeId, programmeName: workingModule.programmeName }}
            onClose={() => setWeekTemplateImportOpen(false)}
            onImport={importWeekTemplateAsNewWeek}
          />
        )}
        {reusePickerWeekId && (
          <ComponentLibraryModal
            weekLabel={(() => {
              const week = workingModule.weekStructure.find(item => item.id === reusePickerWeekId);
              return week ? `Week ${week.weekNumber}${week.title ? ` — ${week.title}` : ''}` : 'this week';
            })()}
            onClose={() => setReusePickerWeekId(null)}
            onAddMany={picked => addLibraryComponentsToWeek(reusePickerWeekId, picked)}
          />
        )}
        {openingModule && (
          <OpeningModuleAlert
            title={openingModule.title}
            mode={openingModule.mode}
            complete={openingModuleComplete}
          />
        )}
        {duplicatingModule && (
          <ModuleBusyAlert
            title="Duplicating module..."
            message={`Copying ${duplicatingModule.title}, weeks, components and mappings.`}
            detail="Creating an independent draft copy..."
            icon="ri-file-copy-line"
            complete={duplicatingModuleComplete}
          />
        )}
        {ksbTarget && (
            <KsbSelectorModal
              standards={standards}
            standardsLoading={standardsLoading && !standards.length}
            ksbSets={ksbSets}
            ksbSetsLoading={ksbSetsLoading}
            initialSourceId={workspaceKsbProfileValue}
            lockedSourceId={workspaceKsbProfileValue}
            onClose={() => setKsbTarget(null)}
            onAddMany={(items) => {
              updateWorkingModule(module => items.reduce(
                (current, item) => addKsbMapping(current, ksbTarget, item.option, item.weight, item.weightClass),
                module,
              ));
              setKsbTarget(null);
            }}
          />
        )}
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Module Builder" pageSubtitle={`${catalogueModules.length} modules - ${published} published - ${draftCount} draft - ${totalComponents} components`} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-4 sm:p-5 space-y-4">
        <div className="rounded-2xl border border-foreground-200/70 bg-background-50 px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600 ring-1 ring-primary-100">
                <AppIcon className="ri-layout-4-line text-xl"></AppIcon>
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-heading font-bold text-foreground-950">Module Builder</h2>
                <p className="mt-1 max-w-2xl text-[12px] leading-5 text-foreground-500">
                  {loading ? 'Loading live LMS modules...' : 'Manage module structures, delivery scope and KSB mapping in one workspace.'}
                </p>
              </div>
            </div>
            <button onClick={() => setCreateOpen(true)} disabled={saving} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700 disabled:cursor-wait disabled:opacity-70">
              <AppIcon className="ri-add-line"></AppIcon>
              New module
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-background-200 pt-3">
            <BuilderStatChip icon="ri-stack-line" label="Modules" value={catalogueModules.length} />
            <BuilderStatChip icon="ri-route-line" label="Deliveries" value={deliveryStats.deliveries} />
            <BuilderStatChip icon="ri-presentation-line" label="With tutor" value={deliveryStats.withTutor} />
            <BuilderStatChip icon="ri-calendar-2-line" label="Weeks" value={deliveryStats.sessions} />
            <BuilderStatChip icon="ri-vidicon-line" label="Teams meetings" value={deliveryStats.teams} />
          </div>
        </div>

        {error && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            <span>Unable to refresh modules: {error}</span>
            <button type="button" onClick={() => reload()} className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1.5 font-bold text-red-700 hover:bg-red-100">
              Retry
            </button>
          </div>
        )}
        {actionMessage && !deletingModuleId && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            {actionMessage}
          </div>
        )}

        <div className="rounded-2xl border border-foreground-200/60 bg-background-50 shadow-sm">
          <div className="flex flex-col gap-3 border-b border-background-200 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-bold text-foreground-950">Module catalogue</p>
                <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-bold text-foreground-500">{filtered.length} shown</span>
              </div>
              <p className="mt-1 text-[11px] text-foreground-500">Scoped modules can share titles while keeping their own programme, delivery and KSB mapping.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 grow sm:w-72 sm:grow-0">
                <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
                <input type="text" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search modules, tutors, cohorts..." className="h-10 w-full rounded-lg border border-foreground-200/70 bg-background-100 pl-9 pr-3 text-[13px] text-foreground-900 outline-none transition-smooth placeholder:text-foreground-400 focus:border-primary-300 focus:bg-background-50" />
              </div>
              <select
                aria-label="Programme"
                value={programmeFilter}
                onChange={event => changeFilter(() => {
                  setProgrammeFilter(event.target.value);
                  setCohortFilter('');
                  setGroupFilter('');
                })}
                className={FILTER_SELECT_CLASS}
              >
                {programmeOptions.map(option => <option key={option} value={option}>{option === 'All' ? 'All programmes' : option}</option>)}
              </select>
              <select
                aria-label="Cohort"
                value={cohortFilter}
                onChange={event => changeFilter(() => { setCohortFilter(event.target.value); setGroupFilter(''); })}
                className={FILTER_SELECT_CLASS}
              >
                <option value="">{cohortFilterOptions.length ? 'All cohorts' : 'No cohorts in scope'}</option>
                {cohortFilterOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select
                aria-label="Group"
                value={groupFilter}
                onChange={event => changeFilter(() => setGroupFilter(event.target.value))}
                className={FILTER_SELECT_CLASS}
              >
                <option value="">{groupFilterOptions.length ? 'All groups' : 'No groups in scope'}</option>
                {groupFilterOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select
                aria-label="Tutor"
                value={tutorFilter}
                onChange={event => changeFilter(() => setTutorFilter(event.target.value))}
                className={FILTER_SELECT_CLASS}
              >
                <option value="">All tutors</option>
                {tutorNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <button
                type="button"
                disabled={!search && programmeFilter === 'All' && !deliveryFiltersActive}
                onClick={() => changeFilter(() => {
                  setSearch('');
                  setProgrammeFilter('All');
                  setCohortFilter('');
                  setGroupFilter('');
                  setTutorFilter('');
                })}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100 disabled:opacity-40 disabled:hover:bg-background-50"
              >
                <AppIcon className="ri-refresh-line text-sm"></AppIcon>
                Reset
              </button>
            </div>
          </div>
          <div className="max-h-[calc(100vh-270px)] min-h-[480px] overflow-auto bg-background-100/35 p-3">
            {loading ? (
              <ModuleListSkeleton />
            ) : filtered.length > 0 ? (
              <div className="space-y-3">
                {filtered.map(module => (
                  <ModuleCatalogueCard
                    key={module.catalogueId}
                    module={module}
                    teamsSummary={teamsByModule.get(normaliseDeepLinkValue(module.catalogueId))}
                    onKsbMap={() => { void openKsbMap(module); }}
                    ksbMapLoading={ksbMapLoadingId === (module.catalogueId || moduleStructureIdentifier(module) || module.title)}
                    onBuild={() => openModule(module)}
                    onSettings={() => openPlacementForm(module)}
                    onDuplicate={() => duplicateModule(module)}
                    onDelete={() => confirmDeleteModule(module)}
                  />
                ))}
              </div>
            ) : catalogueModules.length > 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-background-100 text-foreground-300">
                  <AppIcon className="ri-search-eye-line text-2xl"></AppIcon>
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-foreground-700">No modules match the current filters.</p>
                  <p className="mt-1 text-[12px] text-foreground-400">Try changing the search, or the programme, cohort, group or tutor filter.</p>
                </div>
                <button
                  type="button"
                  onClick={() => changeFilter(() => {
                    setSearch('');
                    setProgrammeFilter('All');
                    setCohortFilter('');
                    setGroupFilter('');
                    setTutorFilter('');
                  })}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
                >
                  <AppIcon className="ri-refresh-line text-sm"></AppIcon>
                  Reset filters
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-primary-50 text-primary-500">
                  <AppIcon className="ri-book-open-line text-2xl"></AppIcon>
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-foreground-700">No modules yet</p>
                  <p className="mt-1 max-w-xs text-[12px] text-foreground-400">Create your first module to start mapping its delivery, weeks and KSBs.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  disabled={saving}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700 disabled:cursor-wait disabled:opacity-70"
                >
                  <AppIcon className="ri-add-line text-sm"></AppIcon>
                  New module
                </button>
              </div>
            )}
          </div>
        </div>
        <ModuleFormDrawer
          open={createOpen}
          defaults={{
            programmeId: programmeFilter === 'All' ? '' : resolveProgrammeIdentity(programmeFilter).programmeId,
            cohortId: cohortFilter,
            groupId: groupFilter,
          }}
          programmes={curriculumProgrammes}
          cohorts={moduleFormScope.cohorts}
          groups={moduleFormScope.groups}
          holidays={moduleFormScope.holidays}
          tutorNames={tutorNames}
          onClose={() => setCreateOpen(false)}
          onSaved={async () => {
            await reload({ silent: true });
          }}
        />
        <ModuleFormDrawer
          open={Boolean(placementModule)}
          module={placementModule}
          programmes={curriculumProgrammes}
          cohorts={moduleFormScope.cohorts}
          groups={moduleFormScope.groups}
          holidays={moduleFormScope.holidays}
          tutorNames={tutorNames}
          onClose={closePlacementForm}
          onSaved={async () => {
            await reload({ silent: true });
          }}
        />
        {ksbMapDisplayModule && (
          <ModuleKsbMapModal
            module={ksbMapDisplayModule}
            sourceLabels={ksbSourceLabels}
            ksbSets={ksbSets}
            standards={standards}
            programmes={curriculumProgrammes}
            onClose={() => setKsbMapModule(null)}
            onBuild={() => {
              const module = ksbMapDisplayModule;
              setKsbMapModule(null);
              void openModule(module);
            }}
          />
        )}
        {programmeKsbMap && (
          <ProgrammeKsbMapModal
            programmeName={programmeKsbMap.programmeName}
            modules={programmeKsbMap.modules}
            sourceLabels={ksbSourceLabels}
            onClose={() => setProgrammeKsbMap(null)}
          />
        )}
        {openingModule && (
          <OpeningModuleAlert
            title={openingModule.title}
            mode={openingModule.mode}
            complete={openingModuleComplete}
          />
        )}
        {duplicatingModule && (
          <ModuleBusyAlert
            title="Duplicating module..."
            message={`Copying ${duplicatingModule.title}, weeks, components and mappings.`}
            detail="Creating an independent draft copy..."
            icon="ri-file-copy-line"
            complete={duplicatingModuleComplete}
          />
        )}
      </div>
    </WorkspaceShell>
  );
}

// Only the two states worth taking space for: a save in flight, and one that
// failed. A finished save says so in the footer and nowhere else.
function SaveStatusPanel({ saving, elapsedSeconds, error, module }: {
  saving: boolean;
  elapsedSeconds: number;
  error: string | null;
  module: ModuleCatalogueItem;
}) {
  const componentCount = module.weekStructure.reduce((total, week) => total + week.components.length, 0);
  const tone = error ? 'red' : 'amber';
  const icon = error ? 'ri-error-warning-line' : 'ri-loader-4-line animate-spin';
  const title = error ? 'Save failed' : elapsedSeconds > 8 ? 'Still saving module structure' : 'Saving module structure';
  const message = error
    || `${module.weekStructure.length} weeks and ${componentCount} components are being written to the curriculum database. ${elapsedSeconds ? `${elapsedSeconds}s elapsed.` : ''}`;
  const classes = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-800',
  }[tone];
  const barClass = { amber: 'bg-amber-500', red: 'bg-red-500' }[tone];

  return (
    <div className={`overflow-hidden rounded-xl border ${classes}`}>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/70">
            <AppIcon className={`${icon} text-base`}></AppIcon>
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-heading font-bold">{title}</p>
            <p className="mt-0.5 text-[11px] font-semibold opacity-85">{message}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px] font-bold uppercase">
          <span className="rounded-full bg-white/70 px-2.5 py-1">{module.weekStructure.length} weeks</span>
          <span className="rounded-full bg-white/70 px-2.5 py-1">{componentCount} components</span>
        </div>
      </div>
      {saving && (
        <div className="h-1.5 bg-white/60">
          <div className={`h-full w-2/3 animate-pulse rounded-r-full ${barClass}`} />
        </div>
      )}
    </div>
  );
}

function WorkspaceHeader({ module, programmeOptions, ksbProfileOptions, ksbProfileValue, scopeLock, standardsLoading, onBack, onProgrammeChange, onKsbProfileChange }: {
  module: ModuleCatalogueItem;
  programmeOptions: string[];
  ksbProfileOptions: Array<{ id: string; label: string }>;
  ksbProfileValue: string;
  scopeLock: ModuleScopeLock | null;
  saving?: boolean;
  saved?: boolean;
  standardsLoading: boolean;
  onBack: () => void;
  onProgrammeChange: (programmeName: string) => void;
  onKsbProfileChange: (sourceId: string) => void;
}) {
  const moduleMetrics = [
    { label: 'Weeks', value: String(module.weekStructure.length), icon: 'ri-stack-line' },
    { label: 'Components', value: String(module.lessonCount), icon: 'ri-layout-grid-line' },
    { label: 'OTJH', value: module.totalOtjh.toFixed(1), icon: 'ri-time-line' },
  ];
  const programmeLocked = Boolean(scopeLock?.locked);
  const lockedKsbLabel = scopeLock?.ksbSourceLabel || (ksbProfileValue ? ksbProfileValue.replace(/^(profile|standard):/, '') : 'No source selected');

  return (
    <div className="rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
      <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={onBack} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white shadow-sm shadow-primary-500/20 transition-smooth hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:ring-offset-1" title="Back to modules" aria-label="Back to modules">
            <AppIcon className="ri-arrow-left-line text-base"></AppIcon>
            Back to modules
          </button>
          <div className="min-w-0 border-l border-background-200 pl-3">
            <h2 className="max-w-[calc(100vw-180px)] truncate text-lg font-heading font-bold text-foreground-950 lg:max-w-[760px]" title={module.title}>{module.title}</h2>
            {moduleListSubLabel(module) && (
              <p className="mt-0.5 max-w-[calc(100vw-180px)] truncate text-[12px] text-foreground-500 lg:max-w-[760px]">{moduleListSubLabel(module)}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
          <div className="grid grid-cols-3 gap-2">
            {moduleMetrics.map(metric => (
              <div key={metric.label} className="min-w-[78px] rounded-lg border border-background-200 bg-background-100/50 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-foreground-400">
                  <AppIcon className={`${metric.icon} text-[12px]`}></AppIcon>{metric.label}
                </div>
                <div className="mt-0.5 text-[15px] font-heading font-bold text-foreground-950">{metric.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-2 border-t border-background-200 bg-background-100/30 px-4 py-2.5 sm:grid-cols-2 lg:max-w-[760px] lg:px-5">
          <label className="block min-w-0">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-wide text-foreground-400">Programme</span>
            <select value={module.programmeName} disabled={programmeLocked} onChange={event => onProgrammeChange(event.target.value)} className={`h-8 w-full rounded-lg border border-background-200 px-3 text-[12px] font-semibold text-foreground-900 outline-none transition-smooth focus:border-primary-400 focus:bg-background-50 ${programmeLocked ? 'cursor-not-allowed bg-background-100 text-foreground-500' : 'bg-background-50'}`}>
              {programmeOptions.map(option => <option key={option}>{option}</option>)}
              {!programmeOptions.includes(module.programmeName) && <option>{module.programmeName}</option>}
            </select>
            {programmeLocked && <span className="mt-0.5 block text-[9px] font-semibold text-foreground-400">Locked from programme delivery scope</span>}
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-wide text-foreground-400">KSB source</span>
            <select value={ksbProfileValue} disabled={programmeLocked} onChange={event => onKsbProfileChange(event.target.value)} className={`h-8 w-full rounded-lg border border-background-200 px-3 text-[12px] font-semibold text-foreground-900 outline-none transition-smooth focus:border-primary-400 focus:bg-background-50 ${programmeLocked ? 'cursor-not-allowed bg-background-100 text-foreground-500' : 'bg-background-50'}`}>
              <option value="">{standardsLoading ? 'Loading standards...' : 'No source selected'}</option>
              {ksbProfileOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              {ksbProfileValue && !ksbProfileOptions.some(option => option.id === ksbProfileValue) && <option value={ksbProfileValue}>{lockedKsbLabel}</option>}
            </select>
            {programmeLocked && <span className="mt-0.5 block text-[9px] font-semibold text-foreground-400">Locked to programme KSB source</span>}
          </label>
      </div>
    </div>
  );
}

function WorkspaceActionFooter({ saving, saved, onPreview, onEditModule, onModuleSettings, onDelete, onSave }: {
  saving: boolean;
  saved: boolean;
  onPreview: () => void;
  /** Name, placement, dates and tutor — the shared module form. */
  onEditModule: () => void;
  /** Completion criteria, advanced details and module-level KSBs. */
  onModuleSettings: () => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  const saveButtonIcon = saving ? 'ri-loader-4-line animate-spin' : saved ? 'ri-check-line' : 'ri-save-3-line';
  const saveButtonLabel = saving ? 'Saving...' : saved ? 'Saved' : 'Save';
  const stateText = saving ? 'Saving module structure...' : saved ? 'All changes saved' : 'Unsaved changes';
  const stateTone = saving ? 'text-amber-700' : saved ? 'text-emerald-700' : 'text-foreground-600';

  return (
    <div className="sticky bottom-0 z-20 -mx-3 mt-2 border-t border-background-200/80 bg-background-50/95 px-3 py-3 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1840px] flex-wrap items-center justify-between gap-3 pr-0 lg:pr-44">
        <div className={`flex items-center gap-2 text-[12px] font-semibold ${stateTone}`}>
          <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : saved ? 'ri-checkbox-circle-line' : 'ri-edit-line'}></AppIcon>
          {stateText}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <IconButton label="Preview" icon="ri-eye-line" onClick={onPreview} />
          <IconButton label="Edit module" icon="ri-edit-line" onClick={onEditModule} />
          <IconButton label="Module settings" icon="ri-settings-3-line" onClick={onModuleSettings} />
          <IconButton label="Delete module" icon="ri-delete-bin-line" tone="danger" onClick={onDelete} />
          <button onClick={onSave} disabled={saving} className={`inline-flex h-10 min-w-[120px] items-center justify-center gap-1.5 rounded-lg px-4 text-[12px] font-semibold text-white shadow-sm transition-smooth disabled:opacity-70 whitespace-nowrap ${saved ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-primary-500 hover:bg-primary-600'}`}>
            <AppIcon className={saveButtonIcon}></AppIcon>{saveButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Course structure: a week navigator whose rows double as an accordion —
// expanding a week renders its parts timeline (the shared WeekComponentRail,
// nested variant) indented underneath, so the week list and "the week, in
// order" view are one nested panel instead of two side-by-side ones.
function CourseStructure({ module, selection, dragState, onDragState, onSelectWeek, onSelectComponent, onAddWeek, onAddWeekFromTemplate, onGenerateLiveSessions, onDeleteWeek, onDropReorder, onComponentsChange, onReuseComponents, pointsByType, expandedWeekIds, onExpandedWeekIdsChange, allowMultipleExpanded = false }: {
  module: ModuleCatalogueItem;
  selection: Selection | null;
  dragState: DragState;
  onDragState: (state: DragState) => void;
  onSelectWeek: (weekId: string) => void;
  onSelectComponent: (weekId: string, componentId: string) => void;
  onAddWeek: () => void;
  onAddWeekFromTemplate: () => void;
  onGenerateLiveSessions: () => void;
  onDeleteWeek: (weekId: string) => void;
  onDropReorder: (targetWeekId: string) => void;
  onComponentsChange: (weekId: string, components: ModuleComponent[]) => void;
  onReuseComponents: (weekId: string) => void;
  pointsByType: Partial<Record<ModuleComponentType, number>>;
  expandedWeekIds: Set<string>;
  onExpandedWeekIdsChange: (next: Set<string>) => void;
  allowMultipleExpanded?: boolean;
}) {
  const totalComponents = module.weekStructure.reduce((total, week) => total + week.components.length, 0);
  const missingLiveSessionWeekCount = weeksMissingLiveSession(module).length;
  const missingLiveSessionCount = countAddedLiveSessions(module);

  // The weeks, split into the months they run in. A module is authored week by
  // week but delivered and reported on by month, so the rail says which month
  // each stretch of weeks belongs to. Empty until the module has session dates.
  const monthGroups = groupWeeksByMonth(module.weekStructure);
  const monthHeadings = new Map(monthGroups.flatMap(group => {
    const first = group.weeks[0];
    if (!first) return [];
    const otjh = group.weeks.reduce(
      (total, week) => total + week.components.reduce((sum, component) => sum + Number(component.expectedOtjh || 0), 0),
      0,
    );
    const components = group.weeks.reduce((total, week) => total + week.components.length, 0);
    return [[first.id, { label: group.label, weeks: group.weeks.length, components, otjh }]];
  }));

  const toggleExpanded = (weekId: string) => {
    const next = new Set(expandedWeekIds);
    if (next.has(weekId)) {
      next.delete(weekId);
    } else if (allowMultipleExpanded) {
      next.add(weekId);
    } else {
      next.clear();
      next.add(weekId);
    }
    onExpandedWeekIdsChange(next);
  };

  return (
    <aside className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm xl:sticky xl:top-4">
      <div className="border-b border-background-200 bg-background-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-heading font-bold text-foreground-950">Course structure</h3>
            <p className="mt-0.5 text-[11px] text-foreground-500">Weeks, in order</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* The only control on this screen that reads the saved week-template
                library, which is why it is the only one still called a template. */}
            <button onClick={onAddWeekFromTemplate} title="Add a whole new week, built from a saved week template" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-2.5 text-[11px] font-bold text-primary-700 transition-smooth hover:bg-primary-100">
              <AppIcon className="ri-folder-open-line"></AppIcon>
              From template
            </button>
            <button onClick={onAddWeek} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-600">
              <AppIcon className="ri-add-line"></AppIcon>
              Week
            </button>
          </div>
        </div>
        {missingLiveSessionCount > 0 && (
          <button
            onClick={onGenerateLiveSessions}
            title="Add a live-session component for every delivery day a week is still missing one for. It won't be created in Teams until you use Create Teams meeting on it."
            className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-[11px] font-bold text-violet-700 transition-smooth hover:bg-violet-100"
          >
            <AppIcon className="ri-group-line"></AppIcon>
            Generate live sessions ({missingLiveSessionCount} across {missingLiveSessionWeekCount} week{missingLiveSessionWeekCount === 1 ? '' : 's'})
          </button>
        )}
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <MiniStructureMetric label="Items" value={String(totalComponents)} />
          <MiniStructureMetric label="OTJH" value={module.totalOtjh.toFixed(1)} />
          <MiniStructureMetric label="KSBs" value={String(module.ksbCount)} />
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background-200">
          <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min(100, Math.max(0, module.qualityScore))}%` }} />
        </div>
      </div>
      <div className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto p-2.5">
        {module.weekStructure.map((week, index) => {
          const selected = selection?.kind === 'week' && selection.weekId === week.id;
          const selectedChild = selection?.kind === 'component' && selection.weekId === week.id;
          const active = selected || selectedChild;
          const dragging = dragState?.type === 'week' && dragState.weekId === week.id;
          const expanded = expandedWeekIds.has(week.id);
          const totalOtjh = week.components.reduce((total, component) => total + Number(component.expectedOtjh || 0), 0);
          const monthHeading = monthHeadings.get(week.id);
          return (
            <Fragment key={week.id}>
            {monthHeading && (
              <div className="flex items-baseline justify-between gap-2 px-1 pb-0.5 pt-2 first:pt-0">
                <p className="text-[11px] font-heading font-bold uppercase tracking-wider text-primary-700">{monthHeading.label}</p>
                <p className="text-[10px] font-semibold text-foreground-400">
                  {monthHeading.weeks} {monthHeading.weeks === 1 ? 'week' : 'weeks'} · {monthHeading.otjh.toFixed(1)}h
                </p>
              </div>
            )}
            <div
              className={`overflow-visible rounded-xl border transition-smooth ${dragging ? 'border-primary-300 bg-background-50 shadow-lg ring-2 ring-primary-200' : active ? 'border-primary-300 bg-primary-50/70 shadow-sm shadow-primary-100/60' : 'border-background-200 bg-background-50 hover:border-primary-200'}`}
            >
              <div
                draggable
                onDragStart={event => {
                  event.dataTransfer.effectAllowed = 'move';
                  onDragState({ type: 'week', weekId: week.id });
                }}
                onDragEnd={() => onDragState(null)}
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  event.preventDefault();
                  onDropReorder(week.id);
                }}
                className="group/week flex items-center gap-2.5 px-2.5 py-2.5"
              >
                <button type="button" aria-label="Drag to reorder" className="grid h-7 w-5 shrink-0 place-items-center text-foreground-300 hover:text-foreground-600 cursor-grab active:cursor-grabbing touch-none"><AppIcon className="ri-draggable"></AppIcon></button>
                <button type="button" onClick={() => toggleExpanded(week.id)} aria-label={expanded ? `Collapse ${week.title || `Week ${week.weekNumber}`}` : `Expand ${week.title || `Week ${week.weekNumber}`}`} aria-expanded={expanded} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-foreground-400 hover:bg-background-100 hover:text-foreground-700">
                  <AppIcon className={expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}></AppIcon>
                </button>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold shadow-sm ${active ? 'bg-primary-500 text-white ring-4 ring-primary-100' : 'bg-background-200 text-foreground-600'}`}>{index + 1}</span>
                <button onClick={() => onSelectWeek(week.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[12px] font-bold text-foreground-900">{week.title || `Week ${week.weekNumber}`}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-foreground-400">
                    <span>{week.components.length} components</span>
                    <span className="h-1 w-1 rounded-full bg-foreground-300"></span>
                    <span>{totalOtjh.toFixed(1)}h</span>
                    {week.sessionDate && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-foreground-300"></span>
                        <span className="truncate">{formatDateLabel(week.sessionDate)}</span>
                      </>
                    )}
                  </p>
                </button>
                <button
                  type="button"
                  onMouseDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation();
                    onDeleteWeek(week.id);
                  }}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-foreground-400 opacity-0 transition-smooth hover:bg-red-50 hover:text-red-600 group-hover/week:opacity-100"
                  title="Delete week"
                  aria-label={`Delete ${week.title || `Week ${week.weekNumber}`}`}
                >
                  <AppIcon className="ri-delete-bin-line text-sm"></AppIcon>
                </button>
              </div>
              {expanded && (
                <div className="border-t border-background-200 pb-2 pl-11 pr-2 pt-2">
                  <WeekComponentRail
                    weekId={week.id}
                    components={week.components}
                    selectedId={selection?.kind === 'component' && selection.weekId === week.id ? selection.componentId : null}
                    onSelectId={componentId => { if (componentId) onSelectComponent(week.id, componentId); }}
                    onChange={next => onComponentsChange(week.id, next)}
                    pointsByType={pointsByType}
                    variant="nested"
                    weekSessionDate={week.sessionDate}
                    onReuseComponents={() => onReuseComponents(week.id)}
                  />
                </div>
              )}
            </div>
            </Fragment>
          );
        })}
      </div>
    </aside>
  );
}

function MiniStructureMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-background-200 bg-background-50 px-2 py-1">
      <p className="text-[9px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      <p className="text-[12px] font-heading font-bold text-foreground-950">{value}</p>
    </div>
  );
}

function selectedComponentTypes(selectedTypes: Set<ModuleComponentType>) {
  return componentTypes
    .map(item => item.type)
    .filter(type => selectedTypes.has(type));
}

function toggleComponentType(selectedTypes: Set<ModuleComponentType>, type: ModuleComponentType) {
  const next = new Set(selectedTypes);
  if (next.has(type)) {
    next.delete(type);
  } else {
    next.add(type);
  }
  return next;
}

function ComponentTypeChecklist({ selectedTypes, onToggle }: {
  selectedTypes: Set<ModuleComponentType>;
  onToggle: (type: ModuleComponentType) => void;
}) {
  return (
    <div className="space-y-4">
      {componentTypeGroups.map(group => (
        <section key={group} className="rounded-lg border border-background-200 bg-background-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-500">{group}</p>
            <span className="rounded-md bg-background-100 px-2 py-1 text-[9px] font-bold text-foreground-400">
              {componentTypes.filter(item => item.group === group).length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {componentTypes.filter(item => item.group === group).map(item => {
              const tone = componentToneClasses(item.tone);
              const checked = selectedTypes.has(item.type);
              return (
                <label
                  key={item.type}
                  className={`group grid min-h-[68px] cursor-pointer grid-cols-[18px_38px_minmax(0,1fr)_18px] items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-smooth ${checked ? 'border-primary-300 bg-primary-50 text-primary-800 shadow-sm shadow-primary-100/70' : 'border-background-200 bg-background-100/40 text-foreground-700 hover:border-primary-200 hover:bg-primary-50/50'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(item.type)}
                    className="h-4 w-4 rounded border-foreground-300 accent-primary-500"
                  />
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.soft} ${tone.text}`}>
                    <AppIcon className={`${item.icon} text-base`}></AppIcon>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-bold text-foreground-900 group-hover:text-primary-800">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] font-medium leading-snug text-foreground-500">{componentTypeDescription(item.type)}</span>
                  </span>
                  <AppIcon className={`${checked ? 'ri-checkbox-circle-fill text-primary-500' : 'ri-add-circle-line text-foreground-300 group-hover:text-primary-400'} text-base`}></AppIcon>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function ComponentTypeModal({ onClose, onAdd, title = 'What do you want to add?', description = 'Select one or more component types. You can edit the details after.', submitLabel = 'Add', initialSelectedTypes = [] }: {
  onClose: () => void;
  onAdd: (types: ModuleComponentType[]) => void;
  title?: string;
  description?: string;
  submitLabel?: string;
  initialSelectedTypes?: ModuleComponentType[];
}) {
  const [selectedTypes, setSelectedTypes] = useState<Set<ModuleComponentType>>(() => new Set(initialSelectedTypes));
  const selected = selectedComponentTypes(selectedTypes);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-background-200 bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="border-b border-background-200 bg-background-50 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-600">
                <AppIcon className="ri-layout-grid-line text-lg"></AppIcon>
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-heading font-bold text-foreground-950">{title}</h3>
                <p className="mt-1 text-[12px] font-medium text-foreground-500">{description}</p>
              </div>
            </div>
            <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-500 transition-smooth hover:bg-background-100 hover:text-foreground-900" aria-label="Close">
              <AppIcon className="ri-close-line text-lg"></AppIcon>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-lg border border-primary-100 bg-primary-50 px-2.5 py-1 text-[11px] font-bold text-primary-700">{selected.length} selected</span>
            <span className="rounded-lg border border-background-200 bg-background-100 px-2.5 py-1 text-[11px] font-bold text-foreground-500">{componentTypes.length} available</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-background-100/45 p-4">
          <ComponentTypeChecklist
            selectedTypes={selectedTypes}
            onToggle={type => setSelectedTypes(current => toggleComponentType(current, type))}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-background-200 bg-background-50 px-5 py-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSelectedTypes(new Set(componentTypes.map(item => item.type)))} className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-600 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700">
              Select all
            </button>
            <button type="button" onClick={() => setSelectedTypes(new Set())} disabled={!selected.length} className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-600 transition-smooth hover:bg-background-100 disabled:opacity-40">
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-700 transition-smooth hover:bg-background-100">
              Cancel
            </button>
            <button type="button" onClick={() => onAdd(selected)} disabled={!selected.length} className="inline-flex h-9 min-w-[150px] items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-4 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50">
              <AppIcon className="ri-add-line"></AppIcon>
              {submitLabel} {selected.length || ''} component{selected.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OpeningModuleAlert({ title, mode, complete }: { title: string; mode: 'builder' | 'settings'; complete: boolean }) {
  const isSettings = mode === 'settings';
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" aria-live="polite" aria-busy="true">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-background-50 text-center shadow-2xl">
        <div className="p-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-4 border-primary-100 bg-primary-50 text-primary-600">
            <AppIcon className="ri-loader-4-line animate-spin text-3xl"></AppIcon>
          </div>
          <h3 className="mt-4 text-lg font-heading font-bold text-foreground-950">
            {isSettings ? 'Opening module settings...' : 'Opening module builder...'}
          </h3>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-foreground-500">
            Loading <span className="font-semibold text-foreground-900">{title}</span> and preparing the authoring workspace.
          </p>
          <div className="mt-5 rounded-xl border border-background-200 bg-background-100/70 p-3 text-left">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground-700">
              <AppIcon className={`${isSettings ? 'ri-settings-3-line' : 'ri-layout-4-line'} text-primary-600`}></AppIcon>
              {isSettings ? 'Preparing settings panel...' : 'Loading module structure...'}
            </div>
            <LoadingProgressBar complete={complete} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModuleBusyAlert({ title, message, detail, icon, complete }: { title: string; message: string; detail: string; icon: string; complete: boolean }) {
  return (
    <div className="fixed inset-0 z-[92] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" aria-live="polite" aria-busy="true">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-background-50 text-center shadow-2xl">
        <div className="p-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-4 border-primary-100 bg-primary-50 text-primary-600">
            <AppIcon className={`${icon} text-2xl`}></AppIcon>
          </div>
          <h3 className="mt-4 text-lg font-heading font-bold text-foreground-950">{title}</h3>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-foreground-500">{message}</p>
          <div className="mt-5 rounded-xl border border-background-200 bg-background-100/70 p-3 text-left">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground-700">
              <AppIcon className="ri-loader-4-line animate-spin text-primary-600"></AppIcon>
              {detail}
            </div>
            <LoadingProgressBar complete={complete} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingProgressBar({ tone = 'primary', complete }: { tone?: 'primary' | 'danger'; complete: boolean }) {
  const barClass = tone === 'danger' ? 'bg-red-500' : 'bg-primary-500';
  const glowClass = tone === 'danger' ? 'from-red-300/0 via-red-100/70 to-red-300/0' : 'from-primary-300/0 via-white/65 to-primary-300/0';
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (complete) {
      setProgress(100);
      return;
    }

    setProgress(4);
    const timer = window.setInterval(() => {
      setProgress(current => {
        if (current >= 90) return current;
        const remaining = 90 - current;
        return Math.min(90, current + Math.max(0.4, remaining * 0.08));
      });
    }, 180);

    return () => window.clearInterval(timer);
  }, [complete]);

  return (
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Loading progress">
      <div
        className={`relative h-full overflow-hidden rounded-full ${barClass}`}
        style={{ width: `${progress}%`, transition: complete ? 'width 380ms ease-out' : 'width 180ms ease-out' }}
      >
        <div
          className={`absolute inset-y-0 right-0 w-20 bg-gradient-to-r ${glowClass}`}
        />
      </div>
    </div>
  );
}

// Merge note: the former WeekEditor signature was left incomplete when its
// replacement, ModuleWeekPanel, was introduced:
// function WeekEditor({ week, ksbSourceLabels, dragState, onDragState,
//   onDropReorder, onSelectComponent, onChange, onApplyTemplate, onAddLesson })
// The per-week panel, shown when a week is selected but no component is.
// The parts timeline itself now lives inline under the week's row in
// CourseStructure's accordion (WeekComponentRail, variant="nested") — this
// panel just keeps the week-level header actions (Reuse, Session KSB
// Mapping, Add component) and the summary/KSB-coverage inspector.
//
// "Add component" used to have a sibling, "Blank set", that opened the exact
// same multi-select modal and produced the exact same empty components — the
// only differences were which types started ticked and the button's wording.
// They were merged into this one button; the modal's own "Select all" already
// covers what "Blank set" was for. "Reuse" is the one that is actually
// different: it copies real authored components out of the library instead
// of creating empty ones. The only saved-template control on this screen is
// "From template" in the Course structure rail, which builds a whole new week.
function ModuleWeekPanel({ week, onChange, onOpenSessionKsbMapping, onAddLesson, onReuseComponents }: {
  week: ModuleWeek;
  onChange: (updates: Partial<ModuleWeek>) => void;
  onOpenSessionKsbMapping?: () => void;
  onAddLesson: () => void;
  onReuseComponents: () => void;
}) {
  const totalOtjh = week.components.reduce((total, component) => total + Number(component.expectedOtjh || 0), 0);

  return (
    <section className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-foreground-200/60 bg-background-50 px-4 py-3 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-primary-100 px-2.5 py-1 text-[10px] font-bold text-primary-700">Week {week.weekNumber}</span>
            <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-bold text-foreground-500">{week.components.length} components</span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{totalOtjh.toFixed(1)}h OTJH</span>
          </div>
          <div className="mt-1.5">
            <TextInput label="Week title" value={week.title} onChange={value => onChange({ title: value })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button onClick={onReuseComponents} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[11px] font-semibold text-primary-700 transition-smooth hover:bg-primary-100">
            <AppIcon className="ri-file-copy-line"></AppIcon>
            Reuse
          </button>
          <button onClick={onAddLesson} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-3 text-[11px] font-semibold text-white shadow-sm transition-smooth hover:bg-primary-600">
            <AppIcon className="ri-add-line"></AppIcon>
            Add component
          </button>
        </div>
      </div>

      <WeekOverviewPanel
        components={week.components}
        ksbMappings={week.ksbMappings}
        summary={week.summary}
        learningOutcomes={week.learningOutcomes}
        onChangeSummary={value => onChange({ summary: value })}
        onChangeLearningOutcomes={value => onChange({ learningOutcomes: value })}
      />
    </section>
  );
}

function ComponentEditor({ component, module, week, availableModules, liveProgrammes, quizzes, quizzesLoading, onChange, onSettingChange, onAddKsb, onRemoveKsb }: {
  component: ModuleComponent;
  module: ModuleCatalogueItem;
  week: ModuleWeek;
  availableModules: ModuleBuilderListItem[];
  liveProgrammes: CurriculumProgramme[];
  quizzes: QuizPackageSummary[];
  quizzesLoading: boolean;
  onChange: (updates: Partial<ModuleComponent>) => void;
  onSettingChange: (key: string, value: string | number | boolean | string[]) => void;
  onAddKsb: () => void;
  onRemoveKsb: (mappingId: string) => void;
}) {
  const meta = componentTypes.find(item => item.type === component.type);
  const tone = componentToneClasses(meta?.tone);
  const validationIssues = validateComponentAuthoring(component);
  const fieldError = (path: string) => validationIssues.find(issue => issue.path.endsWith(path))?.message || '';
  const showApprenticeshipSettings = component.type !== 'quiz' && component.type !== 'monthly-ksb-quiz';
  return (
    <section className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
      <div className="border-b border-background-200 bg-background-100/60 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tone.soft} ${tone.text}`}>
              <AppIcon className={`${meta?.icon || 'ri-file-line'} text-xl`}></AppIcon>
            </span>
            <div className="min-w-0 flex-1">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-bold ${tone.soft} ${tone.text}`}>{meta?.label || 'Component'}</span>
              <h3 className="mt-2 text-lg font-heading font-bold text-foreground-950 truncate">{readableComponentTitle(component.title) || 'Untitled component'}</h3>
              <p className="mt-1 text-[12px] text-foreground-500">Content, completion rules, OTJH, points and apprenticeship mappings.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label="OTJH" value={Number(component.expectedOtjh || 0).toFixed(1)} />
            <MiniMetric label="Points" value={String(component.points || 0)} />
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <EditorSection title="Identity" icon="ri-edit-line">
          <TextInput label="Title" value={readableComponentTitle(component.title)} onChange={value => onChange({ title: value })} error={fieldError('title')} />
          <TextArea label="Description" value={component.description} onChange={value => onChange({ description: value })} rows={4} />
        </EditorSection>

        <EditorSection title="Component content" icon="ri-file-list-3-line">
          <TypeSpecificFields
            component={component}
            module={module}
            week={week}
            availableModules={availableModules}
            liveProgrammes={liveProgrammes}
            quizzes={quizzes}
            quizzesLoading={quizzesLoading}
            onChange={onChange}
            onSettingChange={onSettingChange}
            fieldError={fieldError}
          />
        </EditorSection>

        <EditorSection title="Completion and reward" icon="ri-checkbox-circle-line">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <NumberInput label="Expected OTJH hours" value={component.expectedOtjh} min={0} step={0.25} onChange={value => onChange({ expectedOtjh: value })} error={fieldError('expectedOtjh')} />
            <NumberInput label="Points" value={component.points} min={0} step={1} onChange={value => onChange({ points: value })} error={fieldError('points')} />
          </div>
        </EditorSection>

        {showApprenticeshipSettings && (
          <EditorSection title="Apprenticeship settings" icon="ri-settings-3-line">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Checkbox label="Reflection required" checked={component.reflectionRequired} onChange={value => onChange({ reflectionRequired: value })} />
              <Checkbox label="Tutor validation" checked={component.tutorValidationRequired} onChange={value => onChange({ tutorValidationRequired: value })} />
            </div>
            <TextArea label="Completion rule" value={String(component.settings.completionRule ?? 'Mark complete')} onChange={value => onSettingChange('completionRule', value)} rows={2} />
            {/* Only asked for once reflection is required — there is nowhere for
                the learner's answer to go while the toggle above is off. */}
            {component.reflectionRequired && (
              <TextArea label="Reflection question" value={component.reflectionQuestion} onChange={value => onChange({ reflectionQuestion: value })} rows={3} error={fieldError('reflectionQuestion')} />
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <SelectInput label="Status" value={String(component.settings.contentStatus ?? 'Draft')} options={CONTENT_STATUSES} onChange={value => onSettingChange('contentStatus', value)} error={fieldError('settings.contentStatus')} />
              <TextInput label="Version" value={String(component.settings.version ?? '0.1')} onChange={value => onSettingChange('version', value)} error={fieldError('settings.version')} />
            </div>
          </EditorSection>
        )}
      </div>
    </section>
  );
}

function EditorSection({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-background-200 bg-background-50 p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-background-100 text-foreground-500">
          <AppIcon className={`${icon} text-sm`}></AppIcon>
        </span>
        <h4 className="text-[12px] font-heading font-bold text-foreground-900">{title}</h4>
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </section>
  );
}

function TypeSpecificFields({
  component,
  module,
  week,
  availableModules,
  liveProgrammes,
  quizzes,
  quizzesLoading,
  onChange,
  onSettingChange,
  fieldError,
}: {
  component: ModuleComponent;
  module: ModuleCatalogueItem;
  week: ModuleWeek;
  availableModules: ModuleBuilderListItem[];
  liveProgrammes: CurriculumProgramme[];
  quizzes: QuizPackageSummary[];
  quizzesLoading: boolean;
  onChange: (patch: Partial<ModuleComponent>) => void;
  onSettingChange: (key: string, value: string | number | boolean | string[]) => void;
  fieldError: (path: string) => string;
}) {
  const s = component.settings;
  const getString = (key: string) => String(s[key] ?? '');
  const getNumber = (key: string) => Number(s[key] ?? 0);
  const getBool = (key: string) => Boolean(s[key]);
  const getStringArray = (key: string) => Array.isArray(s[key]) ? (s[key] as string[]).map(value => String(value || '').trim()).filter(Boolean) : [];
  const [uploadingResource, setUploadingResource] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [teamsMeetingOpen, setTeamsMeetingOpen] = useState(false);

  const handleResourceUpload = async (file: File, componentType: 'podcast' | 'powerpoint' | 'reading' | 'assignment') => {
    setUploadingResource(true);
    setUploadError('');
    try {
      const result = await uploadComponentResource({
        moduleCatalogueId: module.catalogueId,
        componentId: component.id,
        componentType,
        file,
      });
      const uploaded = result.file;
      onSettingChange('uploadedFileName', uploaded.fileName);
      onSettingChange('uploadedFileUrl', uploaded.url);
      onSettingChange('uploadedFileSize', uploaded.size);
      onSettingChange('uploadedFileContentType', uploaded.contentType);
      onSettingChange('uploadSource', 'Device upload');
      if (componentType === 'podcast') {
        onSettingChange('podcastSource', 'Device upload');
        onSettingChange('podcastUrl', uploaded.url);
      } else if (componentType === 'powerpoint') {
        onSettingChange('fileName', uploaded.fileName);
        onSettingChange('presentationUrl', uploaded.url);
      } else if (componentType === 'reading') {
        onSettingChange('readingSource', 'File');
        onSettingChange('resourceUrl', uploaded.url);
      } else {
        onSettingChange('assignmentFileName', uploaded.fileName);
        onSettingChange('assignmentFileUrl', uploaded.url);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Unable to upload file.');
    } finally {
      setUploadingResource(false);
    }
  };

  if (component.type === 'live-session') {
    const groupOptions = liveSessionGroupOptions(module);
    const selectedGroupKeys = getStringArray('selectedGroupKeys');
    const selectedGroupSet = new Set(selectedGroupKeys);
    const updateSelectedGroups = (nextKeys: string[]) => {
      const nextSet = new Set(nextKeys);
      onSettingChange('selectedGroupKeys', nextKeys);
      onSettingChange('selectedGroupNames', groupOptions.filter(option => nextSet.has(option.key)).map(option => option.group));
    };
    const toggleGroup = (key: string) => {
      const nextSet = new Set(selectedGroupKeys);
      if (nextSet.has(key)) nextSet.delete(key);
      else nextSet.add(key);
      updateSelectedGroups(groupOptions.map(option => option.key).filter(optionKey => nextSet.has(optionKey)));
    };
    return (
      <EditorBlock title="Live Teams session">
        <p className="rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-[11px] font-medium text-primary-700">
          Create the Microsoft Teams meeting here, invite attendees, and keep its join link with this live-session component.
        </p>
        <div className="rounded-xl border border-background-200 bg-background-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase text-foreground-400">Assigned groups</p>
              <p className="mt-0.5 text-[11px] font-semibold text-foreground-500">{selectedGroupKeys.length} of {groupOptions.length} selected</p>
            </div>
            {!!groupOptions.length && (
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => updateSelectedGroups(groupOptions.map(option => option.key))} className="h-7 rounded-md bg-background-100 px-2 text-[10px] font-bold text-foreground-700 transition-smooth hover:bg-background-200">
                  Select all
                </button>
                <button type="button" onClick={() => updateSelectedGroups([])} className="h-7 rounded-md bg-background-100 px-2 text-[10px] font-bold text-foreground-700 transition-smooth hover:bg-background-200">
                  Clear
                </button>
              </div>
            )}
          </div>
          {groupOptions.length ? (
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {groupOptions.map(option => (
                <label key={option.key} className={`flex min-h-10 items-start gap-2 rounded-lg border px-3 py-2 transition-smooth ${selectedGroupSet.has(option.key) ? 'border-primary-300 bg-primary-50 text-primary-900' : 'border-background-200 bg-background-100/50 text-foreground-700 hover:border-primary-200'}`}>
                  <input
                    type="checkbox"
                    checked={selectedGroupSet.has(option.key)}
                    onChange={() => toggleGroup(option.key)}
                    className="mt-0.5 h-4 w-4 rounded border-foreground-300 text-primary-600 focus:ring-primary-300"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-bold">{option.group}</span>
                    {option.cohort && <span className="mt-0.5 block truncate text-[10px] font-semibold opacity-70">{option.cohort}</span>}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-background-300 bg-background-100/60 px-3 py-4 text-center text-[11px] font-semibold text-foreground-500">
              No delivery groups are linked to this module yet.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-background-200 bg-background-50 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-foreground-400">Microsoft Teams meeting</p>
              {getString('liveSessionUrl') ? (
                <a href={getString('liveSessionUrl')} target="_blank" rel="noreferrer" className="meeting-join-action mt-1 inline-flex max-w-full items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-bold">
                  <AppIcon className="ri-microsoft-teams-line mr-1"></AppIcon>
                  Open meeting link
                </a>
              ) : (
                <p className="mt-1 text-[11px] font-semibold text-foreground-500">No Teams meeting has been created yet.</p>
              )}
              {getString('teamsOrganizerEmail') && <p className="mt-1 truncate text-[10px] font-semibold text-foreground-400">Organizer: {getString('teamsOrganizerEmail')}</p>}
            </div>
            <button
              type="button"
              onClick={() => setTeamsMeetingOpen(true)}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-4 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-600"
            >
              <AppIcon className="ri-calendar-event-line"></AppIcon>
              {getString('liveSessionUrl') ? 'Create another meeting' : 'Create Teams meeting'}
            </button>
          </div>
          {getString('liveSessionUrl') && (
            <div className="mt-3">
              <TextInput label="Teams meeting URL" value={getString('liveSessionUrl')} onChange={value => onSettingChange('liveSessionUrl', value)} />
            </div>
          )}
        </div>
        <TextArea label="Session outline" value={getString('sessionPurpose')} onChange={value => onSettingChange('sessionPurpose', value)} rows={3} />
        {teamsMeetingOpen && (
          <TeamsMeetingModal
            component={component}
            module={module}
            onClose={() => setTeamsMeetingOpen(false)}
            onCreated={(result, input) => {
              const meeting = result.meeting;
              onSettingChange('liveSessionUrl', meeting.joinUrl || meeting.webLink);
              onSettingChange('teamsEventId', meeting.eventId);
              onSettingChange('teamsLiveSessionId', meeting.liveSessionId);
              onSettingChange('teamsMeetingOptionsUrl', meeting.meetingOptionsUrl);
              onSettingChange('teamsOrganizerEmail', meeting.organizerEmail);
              onSettingChange('teamsAttendees', meeting.attendees);
              onSettingChange('teamsPresenters', meeting.presenters);
              onSettingChange('sessionDateTimeUtc', meeting.startDateTimeUtc);
              onSettingChange('durationMinutes', meeting.durationMinutes);
              onSettingChange('teamsProvider', meeting.provider);
              onSettingChange('teamsRepeat', meeting.repeat);
              onSettingChange('teamsRepeatOccurrences', meeting.repeatOccurrences);
              onSettingChange('teamsLobbyBypass', input.lobbyBypass);
              onSettingChange('teamsRecording', input.recording);
              onSettingChange('teamsSpokenLanguage', input.spokenLanguage);
              onSettingChange('teamsMeetingType', input.meetingType);
              onSettingChange('teamsRequestResponses', input.requestResponses);
              onSettingChange('teamsAllowTimeProposals', input.allowNewTimeProposals);
              onSettingChange('teamsHideAttendees', input.hideAttendees);
            }}
          />
        )}
      </EditorBlock>
    );
  }

  if (component.type === 'video') {
    const sourceType = normaliseVideoSourceType(getString('sourceType') || getString('provider'));
    const updateSourceType = (value: string) => {
      onSettingChange('sourceType', value);
      onSettingChange('provider', providerForVideoSourceType(value));
      onSettingChange('legacyUnsupportedSource', false);
      onSettingChange('legacySourceType', '');
    };

    return (
      <EditorBlock title="Video component">
        {(getString('legacySourceType') === 'Shortcode' || getString('sourceType') === 'Shortcode' || getBool('legacyUnsupportedSource')) && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
            This component uses a legacy Shortcode source. Shortcode playback is not supported in the new Module Builder, so the original value is preserved until you choose a supported source.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
          <SelectInput label="Source type" value={sourceType} options={MEDIA_SOURCE_TYPES} onChange={updateSourceType} />
          {sourceType === 'Embed' ? (
            <TextArea label="Embed iframe content" value={getString('embedCode')} onChange={value => onSettingChange('embedCode', value)} rows={4} error={fieldError('settings.embedCode')} />
          ) : (
            <TextInput label={sourceType === 'HTML (MP4)' ? 'MP4 file URL' : 'Video URL'} value={getString('videoUrl')} onChange={value => onSettingChange('videoUrl', value)} error={fieldError('settings.videoUrl')} />
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:items-end">
          <NumberInput label="Component duration (minutes)" value={getNumber('durationMinutes')} min={0} step={1} onChange={value => onSettingChange('durationMinutes', value)} />
          <NumberInput label="Required progress (%)" value={getNumber('requiredProgressPercentage')} min={0} max={100} step={1} onChange={value => onSettingChange('requiredProgressPercentage', value)} error={fieldError('settings.requiredProgressPercentage')} />
        </div>

        <RichTextDraft label="Component content" value={getString('lessonContent')} onChange={value => onSettingChange('lessonContent', value)} rows={10} />
      </EditorBlock>
    );
  }

  if (component.type === 'podcast') {
    const sourceType = getString('podcastSource') || 'External URL';
    return (
      <EditorBlock title="Podcast source">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
          <SelectInput label="Source type" value={sourceType} options={PODCAST_SOURCE_TYPES} onChange={value => onSettingChange('podcastSource', value)} />
          {sourceType === 'Embed' ? (
            <TextArea label="Embed code" value={getString('embedCode')} onChange={value => onSettingChange('embedCode', value)} rows={4} error={fieldError('settings.embedCode')} />
          ) : sourceType === 'Shortcode' ? (
            <TextInput label="Shortcode" value={getString('shortcode')} onChange={value => onSettingChange('shortcode', value)} />
          ) : (
            <TextInput label={sourceType === 'Device upload' ? 'Uploaded audio URL' : 'Podcast URL'} value={getString('podcastUrl')} onChange={value => onSettingChange('podcastUrl', value)} error={fieldError('settings.podcastUrl')} />
          )}
        </div>
        <ComponentResourceUpload
          label="Upload podcast audio"
          accept="audio/*,.mp3,.m4a,.mp4,.wav,.aac,.ogg,.oga,.webm"
          uploadedName={getString('uploadedFileName')}
          uploadedUrl={getString('uploadedFileUrl')}
          uploadedSize={getNumber('uploadedFileSize')}
          uploading={uploadingResource}
          error={uploadError}
          onUpload={file => handleResourceUpload(file, 'podcast')}
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <NumberInput label="Duration in minutes" value={getNumber('durationMinutes')} min={0} step={1} onChange={value => onSettingChange('durationMinutes', value)} />
          <NumberInput label="Required progress (%)" value={getNumber('requiredProgressPercentage')} min={0} max={100} step={1} onChange={value => onSettingChange('requiredProgressPercentage', value)} error={fieldError('settings.requiredProgressPercentage')} />
        </div>
      </EditorBlock>
    );
  }

  if (component.type === 'reading') {
    const rawReadingSource = getString('readingSource');
    const readingSource = rawReadingSource === 'File'
      ? 'LMS resource'
      : rawReadingSource === 'Text'
        ? 'Written in LMS'
        : (rawReadingSource || 'Written in LMS');
    const isReadingFile = readingSource === 'LMS resource';
    const isReadingUrl = readingSource === 'URL';
    return (
      <EditorBlock title="Reading source and content">
        <SelectInput label="Reading source" value={readingSource} options={READING_SOURCE_TYPES} onChange={value => onSettingChange('readingSource', value === 'LMS resource' ? 'File' : value === 'Written in LMS' ? 'Text' : value)} />
        {isReadingUrl && <TextInput label="Reading URL" value={getString('resourceUrl')} onChange={value => onSettingChange('resourceUrl', value)} error={fieldError('settings.resourceUrl')} />}
        {isReadingFile && (
          <ComponentResourceUpload
            label="Upload reading file"
            accept=".txt,.doc,.docx,.pdf,.rtf,.odt,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,application/vnd.oasis.opendocument.text"
            uploadedName={getString('uploadedFileName')}
            uploadedUrl={getString('uploadedFileUrl') || getString('resourceUrl')}
            uploadedSize={getNumber('uploadedFileSize')}
            uploading={uploadingResource}
            error={uploadError}
            onUpload={file => handleResourceUpload(file, 'reading')}
          />
        )}
        <RichTextDraft label="Short description of the component" value={getString('shortDescription')} onChange={value => onSettingChange('shortDescription', value)} rows={5} compact />
        {!isReadingFile && <RichTextDraft label="Component content" value={getString('readingContent')} onChange={value => onSettingChange('readingContent', value)} rows={14} htmlOnly />}
      </EditorBlock>
    );
  }

  if (component.type === 'powerpoint') {
    return (
      <EditorBlock title="PowerPoint resource">
        <TextInput label="Presentation URL" value={getString('presentationUrl')} onChange={value => onSettingChange('presentationUrl', value)} error={fieldError('settings.presentationUrl')} />
        <ComponentResourceUpload
          label="Upload slide deck"
          accept=".ppt,.pptx,.pps,.ppsx,.pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/pdf"
          uploadedName={getString('uploadedFileName') || getString('fileName')}
          uploadedUrl={getString('uploadedFileUrl')}
          uploadedSize={getNumber('uploadedFileSize')}
          uploading={uploadingResource}
          error={uploadError}
          onUpload={file => handleResourceUpload(file, 'powerpoint')}
        />
      </EditorBlock>
    );
  }

  if (component.type === 'quiz' || component.type === 'monthly-ksb-quiz') {
    return (
      <EditorBlock title={component.type === 'monthly-ksb-quiz' ? 'Monthly KSB quiz link' : 'Linked LMS quiz'}>
        {component.type === 'monthly-ksb-quiz' && <TextInput label="Month focus" value={getString('monthFocus')} onChange={value => onSettingChange('monthFocus', value)} />}
        <LinkedQuizSelector
          component={component}
          module={module}
          week={week}
          availableModules={availableModules}
          liveProgrammes={liveProgrammes}
          quizzes={quizzes}
          loading={quizzesLoading}
          onSettingChange={onSettingChange}
        />
      </EditorBlock>
    );
  }

  if (component.type === 'reflection') {
    return (
      <EditorBlock title="Reflection and guidance">
        {/* For a reflection component the question *is* its content, so this is
            the same first-class field the assurance section edits -- not a
            second copy of it in `settings`. */}
        <TextArea label="Reflection question" value={component.reflectionQuestion} onChange={value => onChange({ reflectionQuestion: value })} rows={4} />
        <NumberInput label="Minimum word count" value={getNumber('minimumWordCount')} min={0} step={50} onChange={value => onSettingChange('minimumWordCount', value)} />
      </EditorBlock>
    );
  }

  if (component.type === 'assignment') {
    return (
      <EditorBlock title="Assignment">
        <TextArea label="Assignment brief" value={getString('assignmentBrief')} onChange={value => onSettingChange('assignmentBrief', value)} rows={4} />
        <ComponentResourceUpload
          label="Upload assignment file"
          accept=".doc,.docx,.pdf,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.zip,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,application/zip"
          uploadedName={getString('uploadedFileName') || getString('assignmentFileName')}
          uploadedUrl={getString('uploadedFileUrl') || getString('assignmentFileUrl')}
          uploadedSize={getNumber('uploadedFileSize')}
          uploading={uploadingResource}
          error={uploadError}
          onUpload={file => handleResourceUpload(file, 'assignment')}
        />
        <TextArea label="Submission instructions" value={getString('submissionInstructions')} onChange={value => onSettingChange('submissionInstructions', value)} rows={3} />
        <TextInput label="Due timing relative to week" value={getString('dueTiming')} onChange={value => onSettingChange('dueTiming', value)} />
      </EditorBlock>
    );
  }

  if (component.type === 'coaching-preparation') {
    return (
      <EditorBlock title="Coaching preparation">
        <TextArea label="Preparation prompt" value={getString('preparationPrompt')} onChange={value => onSettingChange('preparationPrompt', value)} rows={4} />
      </EditorBlock>
    );
  }

  return (
    <EditorBlock title="Checkpoint quiz">
      <TextInput label="Checkpoint title" value={getString('checkpointTitle')} onChange={value => onSettingChange('checkpointTitle', value)} />
      <TextArea label="Checkpoint questions" value={getString('checkpointQuestions')} onChange={value => onSettingChange('checkpointQuestions', value)} rows={4} />
    </EditorBlock>
  );
}

function LinkedQuizSelector({
  component,
  module,
  week,
  availableModules,
  liveProgrammes,
  quizzes,
  loading,
  onSettingChange,
}: {
  component: ModuleComponent;
  module: ModuleCatalogueItem;
  week: ModuleWeek;
  availableModules: ModuleBuilderListItem[];
  liveProgrammes: CurriculumProgramme[];
  quizzes: QuizPackageSummary[];
  loading: boolean;
  onSettingChange: (key: string, value: string | number | boolean | string[]) => void;
}) {
  const settings = component.settings;
  const allDeliveryUsages = uniqueDeliveryUsages([
    ...((module as ModuleBuilderListItem).deliveryUsages || []),
    ...availableModules.flatMap(item => item.deliveryUsages || []),
    ...availableModules.map(moduleDeliveryUsageFallback),
  ]);
  const programmeAliases = buildProgrammeAliasMap(liveProgrammes, allDeliveryUsages);
  const liveProgrammeKeys = new Set(Array.from(programmeAliases.keys()));
  const deliveryUsages = allDeliveryUsages.filter(usage => !liveProgrammeKeys.size || programmeAliases.has(normaliseQuizKey(usage.programme)) || programmeAliases.has(normaliseQuizKey(usage.programmeId)));
  const requestedProgramme = String(settings.quizProgramme || module.programmeName || '');
  const programmeOptions = uniqueTextOptions([
    ...liveProgrammes.map(programme => programme.name),
    ...deliveryUsages.map(usage => usage.programme),
  ]);
  const selectedProgramme = optionOrFirst(canonicalProgrammeName(requestedProgramme, programmeAliases), programmeOptions);

  const selectedProgrammeKeys = programmeMatchKeys(selectedProgramme, programmeAliases);
  const pathsForProgramme = deliveryUsages.filter(usage => matchesProgrammeUsage(usage, selectedProgrammeKeys));
  const cohortOptions = uniqueTextOptions(pathsForProgramme.map(usage => usage.cohort));
  const selectedCohort = optionOrFirst(String(settings.quizCohort || ''), cohortOptions);

  const pathsForCohort = pathsForProgramme.filter(usage => matchesPathValue(usage.cohort, usage.cohortId, selectedCohort));
  const groupOptions = uniqueTextOptions(pathsForCohort.map(usage => usage.group));
  const selectedGroup = optionOrFirst(String(settings.quizGroup || ''), groupOptions);

  const pathsForGroup = pathsForCohort.filter(usage => matchesPathValue(usage.group, usage.groupId, selectedGroup));
  const moduleOptions = uniqueTextOptions(pathsForGroup.map(usage => usage.moduleTitle));
  const selectedModule = optionOrFirst(String(settings.quizModule || module.title || ''), moduleOptions);
  const selectedWeekNumber = String(settings.quizWeekNumber || week.weekNumber || 1);
  const selectedQuizId = String(settings.linkedQuizId || '');

  const selectedModuleItem = findModuleForDeliveryPath(availableModules, {
    programme: selectedProgramme,
    cohort: selectedCohort,
    group: selectedGroup,
    moduleTitle: selectedModule,
  }) || module;
  const weekOptions = uniqueWeekOptions([
    ...selectedModuleItem.weekStructure.map(item => ({
      value: String(item.weekNumber || item.title || item.id),
      label: item.title || `Week ${item.weekNumber}`,
      week: item,
    })),
    {
      value: selectedWeekNumber,
      label: week.title || `Week ${selectedWeekNumber}`,
      week,
    },
  ]);
  const selectedWeek = weekOptions.find(option => option.value === selectedWeekNumber)?.week || week;
  const weekCandidates = quizWeekIdCandidates(selectedModuleItem, selectedWeek, selectedProgramme);
  const eligibleQuizzes = quizzes.filter(quiz => {
    if (String(quiz.status || '').toLowerCase() === 'trash') return false;
    if (quiz.assessmentType && !['quiz', 'monthly-ksb-quiz'].includes(String(quiz.assessmentType).toLowerCase())) return false;
    return true;
  });
  const programmeQuizzes = eligibleQuizzes.filter(quiz => !selectedProgrammeKeys.size || selectedProgrammeKeys.has(normaliseQuizKey(quiz.programme)) || selectedProgrammeKeys.has(normaliseQuizKey(quiz.programmeId)));
  const moduleQuizzes = programmeQuizzes.filter(quiz => !selectedModule || matchesQuizText(quiz.module, selectedModule));
  const weekQuizzes = moduleQuizzes.filter(quiz => weekCandidates.has(String(quiz.weekId || '')));
  const quizOptions = uniqueQuizzes(weekQuizzes.length ? weekQuizzes : moduleQuizzes.length ? moduleQuizzes : programmeQuizzes);
  const selectedQuiz = quizOptions.find(quiz => String(quiz.id) === selectedQuizId)
    || null;
  const selectedQuizValue = selectedQuiz ? selectedQuizId : '';
  const resolvedQuizWeekId = String(selectedQuiz?.weekId || settings.quizWeekId || Array.from(weekCandidates)[0] || '');
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const pathSummary = [
    { label: 'Programme', value: selectedProgramme || 'Not set' },
    { label: 'Cohort', value: selectedCohort || 'Not set' },
    { label: 'Group', value: selectedGroup || 'Not set' },
    { label: 'Module', value: selectedModule || 'Not set' },
    { label: 'Week', value: weekOptions.find(option => option.value === selectedWeekNumber)?.label || selectedWeekNumber || 'Not set' },
  ];

  const applyQuiz = (quizId: string) => {
    const quiz = quizOptions.find(item => String(item.id) === quizId);
    onSettingChange('linkedQuizId', quizId);
    onSettingChange('linkedActivity', quiz?.title || '');
    onSettingChange('quizWeekId', quiz?.weekId || Array.from(weekCandidates)[0] || '');
    onSettingChange('numberOfQuestions', Number(quiz?.questions || 0));
    onSettingChange('passMarkPercentage', Number(quiz?.passingGrade || 0));
    onSettingChange('quizDuration', Number(quiz?.duration || 0));
    onSettingChange('quizStatus', quiz?.status || '');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary-100 bg-primary-50/80 px-3 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
              <AppIcon className="ri-questionnaire-line text-sm"></AppIcon>
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-bold text-primary-950">Linked LMS quiz</p>
              <p className="truncate text-[11px] font-semibold text-primary-700">{selectedQuiz ? selectedQuiz.title : `${quizOptions.length} quiz${quizOptions.length === 1 ? '' : 'zes'} available`}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pathSummary.map(item => (
              <span key={item.label} className="inline-flex max-w-[12rem] items-center gap-1 rounded-full bg-background-50 px-2.5 py-1 text-[10px] font-bold text-foreground-700 ring-1 ring-primary-100" title={`${item.label}: ${item.value}`}>
                <span className="text-foreground-400">{item.label}</span>
                <span className="truncate">{item.value}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <SelectInput label="Programme" value={selectedProgramme} options={programmeOptions} onChange={value => {
          onSettingChange('quizProgramme', value);
          onSettingChange('quizCohort', '');
          onSettingChange('quizGroup', '');
          onSettingChange('quizModule', '');
          onSettingChange('quizWeekNumber', '');
          onSettingChange('quizWeekId', '');
          onSettingChange('linkedQuizId', '');
          onSettingChange('linkedActivity', '');
        }} />
        <SelectInput label="Cohort" value={selectedCohort} options={cohortOptions} onChange={value => {
          onSettingChange('quizCohort', value);
          onSettingChange('quizGroup', '');
          onSettingChange('quizModule', '');
          onSettingChange('quizWeekNumber', '');
          onSettingChange('quizWeekId', '');
          onSettingChange('linkedQuizId', '');
          onSettingChange('linkedActivity', '');
        }} disabled={!cohortOptions.filter(Boolean).length} helper={!cohortOptions.filter(Boolean).length ? 'No cohorts for this programme.' : undefined} />
        <SelectInput label="Group" value={selectedGroup} options={groupOptions} onChange={value => {
          onSettingChange('quizGroup', value);
          onSettingChange('quizModule', '');
          onSettingChange('quizWeekNumber', '');
          onSettingChange('quizWeekId', '');
          onSettingChange('linkedQuizId', '');
          onSettingChange('linkedActivity', '');
        }} disabled={!groupOptions.filter(Boolean).length} helper={!groupOptions.filter(Boolean).length ? 'No groups for this cohort.' : undefined} />
        <SelectInput label="Module" value={selectedModule} options={moduleOptions} onChange={value => {
          onSettingChange('quizModule', value);
          onSettingChange('quizWeekNumber', '');
          onSettingChange('quizWeekId', '');
          onSettingChange('linkedQuizId', '');
          onSettingChange('linkedActivity', '');
        }} disabled={!moduleOptions.filter(Boolean).length} helper={!moduleOptions.filter(Boolean).length ? 'No modules for this group.' : undefined} />
        <SelectInput
          label="Week"
          value={selectedWeekNumber}
          options={weekOptions.map(option => option.value)}
          labels={Object.fromEntries(weekOptions.map(option => [option.value, option.label]))}
          onChange={value => {
            const nextWeek = weekOptions.find(option => option.value === value)?.week;
            onSettingChange('quizWeekNumber', value);
            onSettingChange('quizWeekId', nextWeek ? Array.from(quizWeekIdCandidates(selectedModuleItem, nextWeek, selectedProgramme))[0] || '' : '');
            onSettingChange('linkedQuizId', '');
            onSettingChange('linkedActivity', '');
          }}
          disabled={!weekOptions.length}
        />
        <SelectInput
          label={loading ? 'Loading quizzes...' : 'Quiz'}
          value={selectedQuizValue}
          options={['', ...quizOptions.map(quiz => String(quiz.id))]}
          labels={{ '': quizOptions.length ? 'Choose quiz' : 'No quizzes available', ...Object.fromEntries(quizOptions.map(quiz => [String(quiz.id), quiz.title])) }}
          onChange={applyQuiz}
          disabled={loading || !quizOptions.length}
          helper={!loading && !quizOptions.length ? 'No quiz matches this delivery path.' : undefined}
        />
      </div>
      {selectedQuiz ? (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-background-200 bg-background-50 p-3 sm:grid-cols-4">
          <MiniMetric label="Questions" value={String(selectedQuiz.questions || 0)} />
          <MiniMetric label="Pass mark" value={`${selectedQuiz.passingGrade || 0}%`} />
          <MiniMetric label="Duration" value={`${selectedQuiz.duration || 0} ${selectedQuiz.timeUnit || 'mins'}`} />
          <MiniMetric label="Status" value={selectedQuiz.status || 'draft'} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-background-300 bg-background-50 px-3 py-4 text-center text-[12px] font-semibold text-foreground-500">
          {loading ? 'Loading LMS quizzes...' : 'No quiz selected. Choose any available LMS quiz from the list above.'}
        </div>
      )}
      <div className="rounded-xl border border-background-200 bg-background-50">
        <button
          type="button"
          onClick={() => setTechnicalOpen(open => !open)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[11px] font-bold text-foreground-600 transition-smooth hover:bg-background-100/70"
        >
          <span className="inline-flex items-center gap-2">
            <AppIcon className="ri-code-s-slash-line text-primary-600"></AppIcon>
            Technical link details
          </span>
          <AppIcon className={`ri-arrow-down-s-line text-base transition-transform ${technicalOpen ? 'rotate-180' : ''}`}></AppIcon>
        </button>
        {technicalOpen && (
          <div className="border-t border-background-200 p-3">
            <ReadOnlyInput label="Resolved quiz week id" value={resolvedQuizWeekId} />
          </div>
        )}
      </div>
    </div>
  );
}

function uniqueTextOptions(values: Array<unknown>) {
  const seen = new Set<string>();
  const options = values
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .filter(value => {
      const key = normaliseQuizText(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return options.length ? options : [''];
}

function optionOrFirst(value: string, options: string[]) {
  const requested = String(value || '').trim();
  if (requested && options.some(option => matchesQuizText(option, requested))) {
    return options.find(option => matchesQuizText(option, requested)) || requested;
  }
  return options.find(Boolean) || '';
}

function uniqueWeekOptions(options: Array<{ value: string; label: string; week: ModuleWeek }>) {
  const seen = new Set<string>();
  return options.filter(option => {
    const key = String(option.value || option.week.id || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueQuizzes(quizzes: QuizPackageSummary[]) {
  const seen = new Set<string>();
  return quizzes.filter(quiz => {
    const key = String(quiz.id || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normaliseQuizText(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normaliseQuizKey(value: unknown) {
  return normaliseQuizText(value).replace(/[^a-z0-9]+/g, '');
}

function matchesQuizText(left: unknown, right: unknown) {
  return normaliseQuizText(left) === normaliseQuizText(right);
}

function buildProgrammeAliasMap(programmes: CurriculumProgramme[], usages: ModuleDeliveryUsage[] = []) {
  const aliases = new Map<string, string>();
  programmes.forEach(programme => {
    const name = String(programme.name || programme.sourceId || programme.id || '').trim();
    if (!name) return;
    [programme.name, programme.id, programme.sourceId].forEach(value => {
      const key = normaliseQuizKey(value);
      if (key) aliases.set(key, name);
    });
  });
  usages.forEach(usage => {
    const name = String(usage.programme || usage.programmeId || '').trim();
    if (!name) return;
    [usage.programme, usage.programmeId].forEach(value => {
      const key = normaliseQuizKey(value);
      if (key && !aliases.has(key)) aliases.set(key, name);
    });
  });
  return aliases;
}

function canonicalProgrammeName(value: unknown, aliases: Map<string, string>) {
  const key = normaliseQuizKey(value);
  return key && aliases.has(key) ? aliases.get(key) || String(value || '') : String(value || '');
}

function programmeMatchKeys(programmeName: string, aliases: Map<string, string>) {
  const canonicalName = canonicalProgrammeName(programmeName, aliases);
  const keys = new Set<string>();
  const canonicalKey = normaliseQuizKey(canonicalName);
  if (canonicalKey) keys.add(canonicalKey);
  aliases.forEach((name, aliasKey) => {
    if (matchesQuizText(name, canonicalName)) keys.add(aliasKey);
  });
  return keys;
}

function matchesProgrammeUsage(usage: ModuleDeliveryUsage, programmeKeys: Set<string>) {
  if (!programmeKeys.size) return true;
  return programmeKeys.has(normaliseQuizKey(usage.programme)) || programmeKeys.has(normaliseQuizKey(usage.programmeId));
}

function matchesPathValue(label: unknown, id: unknown, selected: unknown) {
  const selectedText = String(selected || '').trim();
  if (!selectedText) return true;
  return matchesQuizText(label, selectedText)
    || normaliseQuizKey(label) === normaliseQuizKey(selectedText)
    || normaliseQuizKey(id) === normaliseQuizKey(selectedText);
}

function quizWeekIdCandidates(module: ModuleCatalogueItem, week: ModuleWeek, selectedProgramme: string) {
  const candidates = new Set<string>();
  const weekNumber = Number(week.weekNumber || String(week.title || '').match(/\d+/)?.[0] || 0);
  const programmeId = String(module.programmeId || module.sourceModule?.programmeId || '').trim();
  [week.id, String(week.weekNumber || ''), week.title].forEach(value => {
    const text = String(value || '').trim();
    if (text) candidates.add(text);
  });
  if (programmeId && weekNumber) candidates.add(`week-training-module-${programmeId}-${weekNumber}`);
  if (selectedProgramme && weekNumber) candidates.add(`week-training-module-${selectedProgramme}-${weekNumber}`);
  return candidates;
}

function moduleDeliveryUsageFallback(module: ModuleCatalogueItem): ModuleDeliveryUsage {
  const cohort = cleanModuleMeta(module.cohort || module.sourceModule?.cohort);
  const group = cleanModuleMeta(module.group || module.sourceModule?.group);
  return {
    id: [
      'module',
      module.programmeName,
      module.catalogueId,
      cohort,
      group,
    ].filter(Boolean).join('::'),
    moduleId: String(module.sourceModule?.id || module.id || ''),
    deliveryModuleId: (module.sourceModule ? moduleIdentity(module.sourceModule) : '') || String(module.catalogueId || module.id || ''),
    sourceId: String(module.sourceModule?.sourceId || module.sourceId || ''),
    catalogueId: String(module.catalogueId || ''),
    structureId: moduleStructureIdentifier(module),
    programmeId: String(module.programmeId || module.sourceModule?.programmeId || ''),
    programme: module.programmeName || module.sourceModule?.programme || 'Unassigned programme',
    moduleTitle: module.title || module.sourceModule?.name || 'Untitled module',
    cohortId: String(module.sourceModule?.cohortId || module.cohortId || ''),
    cohort,
    groupId: String(module.sourceModule?.groupId || module.groupId || ''),
    group,
    tutor: tutorDisplayName(module.tutor || module.sourceModule?.tutor),
    deliveryStatus: deliveryStatusText(module.deliveryStatus || module.sourceModule?.deliveryStatus).replace(/^Delivery: /, ''),
    startDate: module.startDate || module.sourceModule?.startDate,
    endDate: module.endDate || module.sourceModule?.endDate,
    sessions: module.sourceModule?.sessionsNumber || module.sourceModule?.weeks || module.sessionsNumber || module.weeks || 0,
  };
}

function findModuleForDeliveryPath(
  modules: ModuleBuilderListItem[],
  path: Pick<ModuleDeliveryUsage, 'programme' | 'cohort' | 'group' | 'moduleTitle'>,
) {
  return modules.find(item => {
    const usages = item.deliveryUsages?.length ? item.deliveryUsages : [moduleDeliveryUsageFallback(item)];
    return usages.some(usage => (
      matchesQuizText(usage.programme, path.programme)
      && (!path.cohort || matchesQuizText(usage.cohort, path.cohort))
      && (!path.group || matchesQuizText(usage.group, path.group))
      && matchesQuizText(usage.moduleTitle, path.moduleTitle)
    ));
  }) || null;
}


function ApprenticeshipSettings({ module, week, component, ksbSourceLabels, ksbPrompt, ksbProfileCount, onExportKsb, onImportKsb, onAddKsb, onRemoveKsb, onUpdateKsbWeight, onUpdateKsbWeightClass }: {
  module: ModuleCatalogueItem;
  week: ModuleWeek | null;
  component: ModuleComponent | null;
  ksbSourceLabels: Record<string, string>;
  /** The comprehensive ChatGPT mapping prompt, pinned to the module's KSB profile. */
  ksbPrompt: string;
  /** How many KSBs the module's source offers — 0 warns the prompt has no profile. */
  ksbProfileCount: number;
  onExportKsb: () => void;
  onImportKsb: () => void;
  onAddKsb: (target: KsbTarget) => void;
  onRemoveKsb: (target: KsbTarget, mappingId: string) => void;
  onUpdateKsbWeight: (target: KsbTarget, mappingId: string, weight: number) => void;
  onUpdateKsbWeightClass: (target: KsbTarget, mappingId: string, weightClass: KsbWeightClass) => void;
}) {
  const ksbExcelPanel = <KsbExcelPanel prompt={ksbPrompt} profileCount={ksbProfileCount} onExport={onExportKsb} onImport={onImportKsb} />;
  if (!week) {
    return (
      <aside className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm xl:sticky xl:top-4">
        <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Readiness</p>
        <h3 className="mt-1 text-sm font-heading font-bold text-foreground-950">No week selected</h3>
        <EmptyState text="Select a week or component." />
        <div className="mt-4">{ksbExcelPanel}</div>
      </aside>
    );
  }

  if (!component) {
    const totalOtjh = week.components.reduce((total, item) => total + Number(item.expectedOtjh || 0), 0);
    const totalPoints = week.components.reduce((total, item) => total + Number(item.points || 0), 0);
    const mappedKsbs = uniqueMappings([...week.ksbMappings, ...week.components.flatMap(item => item.ksbMappings)]);
    const weekWeightSummary = ksbWeightSummary(mappedKsbs);
    const readinessItems = [
      { label: 'Components', ready: week.components.length > 0, value: week.components.length ? `${week.components.length} added` : 'Missing' },
      { label: 'OTJH', ready: totalOtjh > 0, value: totalOtjh > 0 ? `${totalOtjh.toFixed(1)} h` : 'Missing' },
      { label: 'KSBs', ready: mappedKsbs.length > 0, value: mappedKsbs.length ? `${mappedKsbs.length} mapped` : 'Needs mapping' },
    ];
    const readyCount = readinessItems.filter(item => item.ready).length;
    const readyPercent = Math.round((readyCount / readinessItems.length) * 100);
    return (
      <aside className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm xl:sticky xl:top-4">
        <div className="border-b border-background-200 bg-background-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Week readiness</p>
              <h3 className="mt-1 truncate text-sm font-heading font-bold text-foreground-950">{week.title || `Week ${week.weekNumber}`}</h3>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${readyPercent === 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {readyPercent}%
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background-200">
            <div className={`h-full rounded-full ${readyPercent === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${readyPercent}%` }} />
          </div>
        </div>
        <div className="space-y-4 p-4">
          <div className="space-y-2">
            {readinessItems.map(item => (
              <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border border-background-200 bg-background-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`grid h-6 w-6 place-items-center rounded-full ${item.ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    <AppIcon className={item.ready ? 'ri-check-line' : 'ri-error-warning-line'}></AppIcon>
                  </span>
                  <span className="text-[11px] font-bold text-foreground-700">{item.label}</span>
                </div>
                <span className="text-[10px] font-semibold text-foreground-500">{item.value}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label="Points" value={totalPoints.toString()} />
            <MiniMetric label="Quality" value={`${module.qualityScore}%`} />
          </div>
          <KsbWeightSummary summary={weekWeightSummary} />
          <WeekKsbCodeSection mappings={mappedKsbs} sourceLabels={ksbSourceLabels} />
          {ksbExcelPanel}
        </div>
      </aside>
    );
  }

  const inheritedWeekMappings = uniqueMappings(week.ksbMappings).filter(weekMapping => (
    !component.ksbMappings.some(componentMapping => String(componentMapping.code || '').trim().toUpperCase() === String(weekMapping.code || '').trim().toUpperCase())
  ));
  const effectiveComponentMappings = uniqueMappings([...component.ksbMappings, ...inheritedWeekMappings]);
  const componentChecks = [
    { label: 'Content', ready: component.description.trim().length > 0 },
    { label: 'OTJH', ready: Number(component.expectedOtjh || 0) > 0 },
    { label: 'Points', ready: Number(component.points || 0) > 0 },
    { label: 'KSBs', ready: effectiveComponentMappings.length > 0 },
  ];
  const componentReadyCount = componentChecks.filter(item => item.ready).length;
  const componentReadyPercent = Math.round((componentReadyCount / componentChecks.length) * 100);
  const componentWeightSummary = ksbWeightSummary(effectiveComponentMappings);

  return (
    <aside className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm xl:sticky xl:top-4">
      <div className="border-b border-background-200 bg-background-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Component readiness</p>
            <h3 className="mt-1 truncate text-sm font-heading font-bold text-foreground-950">{readableComponentTitle(component.title) || 'Selected component'}</h3>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${componentReadyPercent === 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {componentReadyPercent}%
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background-200">
          <div className={`h-full rounded-full ${componentReadyPercent === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${componentReadyPercent}%` }} />
        </div>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-1.5">
          {componentChecks.map(item => (
            <div key={item.label} className={`rounded-lg border px-2 py-2 ${item.ready ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-amber-100 bg-amber-50 text-amber-700'}`}>
              <div className="flex items-center gap-1.5 text-[10px] font-bold">
                <AppIcon className={item.ready ? 'ri-check-line' : 'ri-error-warning-line'}></AppIcon>
                {item.label}
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniMetric label="OTJH" value={Number(component.expectedOtjh || 0).toFixed(1)} />
          <MiniMetric label="Points" value={String(component.points || 0)} />
        </div>
        <KsbWeightSummary summary={componentWeightSummary} />
        <button onClick={() => onAddKsb({ scope: 'component', weekId: week.id, componentId: component.id })} className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-md bg-primary-500 px-3 text-[11px] font-semibold text-white transition-smooth hover:bg-primary-600">
          <AppIcon className="ri-add-line"></AppIcon>
          Add KSBs
        </button>
        {!!inheritedWeekMappings.length && <KsbCards title="Inherited week KSBs" mappings={inheritedWeekMappings} sourceLabels={ksbSourceLabels} />}
        <KsbCards
          title={inheritedWeekMappings.length ? 'Component KSBs' : 'KSBs'}
          mappings={component.ksbMappings}
          sourceLabels={ksbSourceLabels}
          onRemove={mappingId => onRemoveKsb({ scope: 'component', weekId: week.id, componentId: component.id }, mappingId)}
          onWeightChange={(mappingId, weight) => onUpdateKsbWeight({ scope: 'component', weekId: week.id, componentId: component.id }, mappingId, weight)}
          onWeightClassChange={(mappingId, weightClass) => onUpdateKsbWeightClass({ scope: 'component', weekId: week.id, componentId: component.id }, mappingId, weightClass)}
        />
        {ksbExcelPanel}
      </div>
    </aside>
  );
}

function ModuleSettingsModal({ module, ksbSourceLabels, saving, saved, onClose, onSave, onChange, onCompletionChange, onAdvancedChange, onAddKsb, onRemoveKsb, onUpdateKsbWeight, onUpdateKsbWeightClass }: {
  module: ModuleCatalogueItem;
  ksbSourceLabels: Record<string, string>;
  saving: boolean;
  saved: boolean;
  onClose: () => void;
  onSave: () => void;
  onChange: (updates: Partial<ModuleCatalogueItem>) => void;
  onCompletionChange: (updates: Partial<CompletionCriteria>) => void;
  onAdvancedChange: (updates: Partial<AdvancedModuleDetails>) => void;
  onAddKsb: () => void;
  onRemoveKsb: (mappingId: string) => void;
  onUpdateKsbWeight: (mappingId: string, weight: number) => void;
  onUpdateKsbWeightClass: (mappingId: string, weightClass: KsbWeightClass) => void;
}) {
  const checklist = calculateQualityChecklist(module);
  const moduleWeightSummary = ksbWeightSummary(module.moduleKsbMappings);
  const saveButtonIcon = saving ? 'ri-loader-4-line animate-spin' : saved ? 'ri-check-line' : 'ri-save-3-line';
  const saveButtonLabel = saving ? 'Saving...' : saved ? 'Saved' : 'Save changes';
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={saving ? undefined : onClose}>
      <div className="flex w-full max-w-6xl max-h-[92vh] flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="shrink-0 px-5 py-4 bg-primary-950 text-white flex items-center justify-between">
          <div>
            <h3 className="text-sm font-heading font-bold text-white">Module settings</h3>
            <p className="mt-1 text-[12px] text-white/70">{module.catalogueId} - {module.qualityScore}% quality</p>
          </div>
          <button onClick={onClose} disabled={saving} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20 disabled:opacity-50"><AppIcon className="ri-close-line"></AppIcon></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <SettingsSection title="Basic details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextInput label="Module title" value={module.title} onChange={value => onChange({ title: value })} />
              <SelectInput label="Status" value={module.status} options={['draft', 'review', 'published']} onChange={value => onChange({ status: value })} />
              <NumberInput label="Weeks" value={module.weeks} min={1} step={1} onChange={value => resizeWeeks(module, value, onChange)} />
              <NumberInput label="Total OTJH hours" value={module.declaredTotalOtjh ?? module.totalOtjh} min={0} step={0.25} onChange={value => onChange({ declaredTotalOtjh: value })} />
            </div>
            <TextArea label="Short description" value={module.description} onChange={value => onChange({ description: value })} rows={3} />
          </SettingsSection>

          <SettingsSection title="KSBs targeted by this module">
            <KsbWeightSummary summary={moduleWeightSummary} />
            <button onClick={onAddKsb} className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-primary-500 px-3 text-[11px] font-semibold text-white transition-smooth hover:bg-primary-600">
              <AppIcon className="ri-add-line"></AppIcon>
              Add KSBs
            </button>
            <KsbCards title="KSBs" mappings={module.moduleKsbMappings} sourceLabels={ksbSourceLabels} onRemove={onRemoveKsb} onWeightChange={onUpdateKsbWeight} onWeightClassChange={onUpdateKsbWeightClass} />
          </SettingsSection>

          <SettingsSection title="Compliance/context fields">
            <TextArea label="Background" value={module.background} onChange={value => onChange({ background: value })} rows={3} />
            <TextArea label="EPA Requirements Covered" value={module.epaRequirements.join('\n')} onChange={value => onChange({ epaRequirements: lines(value) })} rows={4} />
            <TextArea label="Professional Qualification Outcomes" value={module.qualificationOutcomes.join('\n')} onChange={value => onChange({ qualificationOutcomes: lines(value) })} rows={4} />
          </SettingsSection>

          <SettingsSection title="Completion criteria">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Checkbox label="Quizzes completed" checked={module.completionCriteria.quizzesCompletedRequired} onChange={value => onCompletionChange({ quizzesCompletedRequired: value })} />
              <Checkbox label="Checkpoints completed" checked={module.completionCriteria.checkpointsCompletedRequired} onChange={value => onCompletionChange({ checkpointsCompletedRequired: value })} />
              <Checkbox label="Accepted average score on quizzes and checkpoints" checked={module.completionCriteria.averageScoreRequiredEnabled} onChange={value => onCompletionChange({ averageScoreRequiredEnabled: value })} />
              <NumberInput label="Average score percentage" value={module.completionCriteria.averageScoreRequired} min={0} max={100} step={1} onChange={value => onCompletionChange({ averageScoreRequired: value })} />
              <Checkbox label="Accepted total score across quizzes and checkpoints" checked={module.completionCriteria.totalScoreRequiredEnabled} onChange={value => onCompletionChange({ totalScoreRequiredEnabled: value })} />
              <NumberInput label="Total score points" value={module.completionCriteria.totalScoreRequired} min={0} step={1} onChange={value => onCompletionChange({ totalScoreRequired: value })} />
            </div>
            <TextArea label="Additional notes" value={module.completionCriteria.additionalNotes} onChange={value => onCompletionChange({ additionalNotes: value })} rows={3} />
          </SettingsSection>

          <SettingsSection title="Advanced module details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextArea label="Intent" value={module.advancedDetails.intent} onChange={value => onAdvancedChange({ intent: value })} rows={3} />
              <TextArea label="Learner benefit" value={module.advancedDetails.learnerBenefit} onChange={value => onAdvancedChange({ learnerBenefit: value })} rows={3} />
              <TextArea label="Employer benefit" value={module.advancedDetails.employerBenefit} onChange={value => onAdvancedChange({ employerBenefit: value })} rows={3} />
              <TextArea label="Sequence purpose" value={module.advancedDetails.sequencePurpose} onChange={value => onAdvancedChange({ sequencePurpose: value })} rows={3} />
            </div>
          </SettingsSection>

          <SettingsSection title="Quality check">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {checklist.map(item => (
                <div key={item.label} className={`rounded-xl border px-3 py-2 flex items-center gap-2 ${item.passed ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                  <AppIcon className={item.passed ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'}></AppIcon>
                  <span className="text-[12px] font-semibold">{item.label}</span>
                </div>
              ))}
            </div>
          </SettingsSection>
        </div>
        <div className="shrink-0 border-t border-background-200 bg-background-50 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] text-foreground-500">Changes here update the draft. Use Save changes to persist them.</p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-background-200 bg-background-50 px-4 py-2 text-[12px] font-semibold text-foreground-700 transition-smooth hover:bg-background-100 disabled:opacity-60">
                Close
              </button>
              <button type="button" onClick={onSave} disabled={saving} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold text-white transition-smooth disabled:opacity-70 ${saved ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-primary-500 hover:bg-primary-600'}`}>
                <AppIcon className={saveButtonIcon}></AppIcon>{saveButtonLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionKsbMappingModal({ module, sourceLabels, onClose }: {
  module: ModuleCatalogueItem;
  sourceLabels: Record<string, string>;
  onClose: () => void;
}) {
  const components = module.weekStructure.flatMap(week => week.components.map(component => ({ week, component })));
  const moduleMappings = uniqueMappings([
    ...module.moduleKsbMappings,
    ...module.weekStructure.flatMap(week => week.ksbMappings),
    ...components.flatMap(item => item.component.ksbMappings),
  ]);
  const uniqueMappedCount = moduleMappings.length;
  const occurrenceCount = module.moduleKsbMappings.length
    + module.weekStructure.reduce((total, week) => total + week.ksbMappings.length, 0)
    + components.reduce((total, item) => total + item.component.ksbMappings.length, 0);

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex flex-col gap-3 bg-primary-950 px-5 py-4 text-white lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-white/60">KSB Trace</p>
            <h3 className="mt-0.5 text-base font-heading font-bold text-white">Review Module KSBs</h3>
            <p className="mt-1 line-clamp-1 text-[12px] font-semibold text-white/70">{module.title}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MetricPill label="Components" value={String(components.length)} />
            <MetricPill label="KSB codes" value={String(uniqueMappedCount)} />
            <MetricPill label="Mappings" value={String(occurrenceCount)} />
            <button onClick={onClose} className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white transition-smooth hover:bg-white/20">
              <AppIcon className="ri-close-line"></AppIcon>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {moduleMappings.length ? (
            <div className="space-y-4">
              {!!module.moduleKsbMappings.length && (
                <ReviewKsbBand title="Module-level KSBs" mappings={uniqueMappings(module.moduleKsbMappings)} sourceLabels={sourceLabels} />
              )}
              {module.weekStructure.map(week => (
                <ReviewKsbWeekSection key={week.id} week={week} sourceLabels={sourceLabels} />
              ))}
            </div>
          ) : (
            <EmptyState text="No KSBs are mapped to this module yet." />
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] font-semibold text-foreground-500">
            Read-only review of module, week, and component KSB coverage.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-background-200 bg-background-50 px-4 py-2 text-[12px] font-semibold text-foreground-700 transition-smooth hover:bg-background-100">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white">
      <span className="text-white/60">{label}</span>
      <span>{value}</span>
    </span>
  );
}

function ReviewKsbWeekSection({ week, sourceLabels }: { week: ModuleWeek; sourceLabels: Record<string, string> }) {
  const componentMappings = week.components.flatMap(component => component.ksbMappings);
  const weekMappedKsbs = uniqueMappings([...week.ksbMappings, ...componentMappings]);
  return (
    <section className="overflow-hidden rounded-2xl border border-background-200 bg-background-50">
      <div className="flex flex-col gap-2 border-b border-background-200 bg-background-100/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase text-primary-600">Week {week.weekNumber}</p>
          <h4 className="text-sm font-heading font-bold text-foreground-950">{week.title || `Week ${week.weekNumber}`}</h4>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-background-50 px-2.5 py-1 text-[10px] font-bold text-foreground-500">{week.components.length} components</span>
          <span className="rounded-full bg-background-50 px-2.5 py-1 text-[10px] font-bold text-foreground-500">{weekMappedKsbs.length} KSBs</span>
        </div>
      </div>
      <div className="space-y-3 p-4">
        {!!week.ksbMappings.length && (
          <ReviewKsbBand title="Week-level KSBs" mappings={uniqueMappings(week.ksbMappings)} sourceLabels={sourceLabels} />
        )}
        {week.components.map(component => (
          <ReviewKsbComponentRow key={component.id} week={week} component={component} sourceLabels={sourceLabels} />
        ))}
        {!week.ksbMappings.length && !week.components.length && (
          <EmptyState text="No KSBs or components in this week yet." />
        )}
      </div>
    </section>
  );
}

function ReviewKsbComponentRow({ week, component, sourceLabels }: { week: ModuleWeek; component: ModuleComponent; sourceLabels: Record<string, string> }) {
  const meta = componentTypes.find(item => item.type === component.type);
  const tone = componentToneClasses(meta?.tone);
  const mappings = uniqueMappings(component.ksbMappings);
  return (
    <article className="rounded-xl border border-background-200 bg-background-100/35 p-3">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.soft} ${tone.text}`}>
            <AppIcon className={`${meta?.icon || 'ri-file-line'} text-sm`}></AppIcon>
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-bold text-foreground-950">{readableComponentTitle(component.title)}</p>
            <p className="mt-0.5 text-[10px] font-semibold text-foreground-400">Week {week.weekNumber} - {meta?.label || component.type}</p>
          </div>
        </div>
        <span className="w-fit rounded-full bg-background-50 px-2 py-0.5 text-[10px] font-bold text-foreground-500">{mappings.length} KSB{mappings.length === 1 ? '' : 's'}</span>
      </div>
      {mappings.length ? (
        <div className="grid gap-2 lg:grid-cols-3">
          {(['knowledge', 'skill', 'behaviour'] as const).map(kind => (
            <ReviewKsbKindColumn
              key={kind}
              kind={kind}
              mappings={mappings.filter(mapping => sessionKsbKind(mapping.code) === kind)}
              sourceLabels={sourceLabels}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-background-300 bg-background-50 px-3 py-4 text-center text-[11px] font-semibold text-foreground-400">No KSBs mapped to this component.</p>
      )}
    </article>
  );
}

function ReviewKsbBand({ title, mappings, sourceLabels }: { title: string; mappings: KsbMapping[]; sourceLabels: Record<string, string> }) {
  return (
    <div className="rounded-xl border border-primary-100 bg-primary-50/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase text-primary-700">{title}</p>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-bold text-primary-700">{mappings.length}</span>
      </div>
      <div className="grid gap-2 lg:grid-cols-3">
        {(['knowledge', 'skill', 'behaviour'] as const).map(kind => (
          <ReviewKsbKindColumn
            key={kind}
            kind={kind}
            mappings={mappings.filter(mapping => sessionKsbKind(mapping.code) === kind)}
            sourceLabels={sourceLabels}
          />
        ))}
      </div>
    </div>
  );
}

function ReviewKsbKindColumn({ kind, mappings, sourceLabels }: {
  kind: 'knowledge' | 'skill' | 'behaviour';
  mappings: KsbMapping[];
  sourceLabels: Record<string, string>;
}) {
  const labels = {
    knowledge: 'Knowledge',
    skill: 'Skills',
    behaviour: 'Behaviours',
  };
  return (
    <div className="min-w-0 rounded-lg border border-background-200 bg-background-50 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[9px] font-bold uppercase text-foreground-400">{labels[kind]}</p>
        <span className="rounded-full bg-background-100 px-1.5 py-0.5 text-[9px] font-bold text-foreground-500">{mappings.length}</span>
      </div>
      <div className="space-y-1.5">
        {mappings.map(mapping => <ReviewKsbChip key={mapping.id} mapping={mapping} sourceLabels={sourceLabels} />)}
        {!mappings.length && <p className="text-[10px] font-semibold text-foreground-300">None</p>}
      </div>
    </div>
  );
}

function ReviewKsbChip({ mapping, sourceLabels }: { mapping: KsbMapping; sourceLabels: Record<string, string> }) {
  const sourceLabel = ksbSourceLabel(mapping, sourceLabels);
  const classification = normaliseKsbMappingType(mapping.classification || mapping.type);
  const weightClass = normaliseKsbWeightClass(mapping.weightClass || mapping.weight_class, classification);
  return (
    <div title={mapping.description || mapping.code} className={`rounded-md border px-2 py-1.5 ${ksbCodeChipClass(mapping.code)}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-extrabold text-foreground-950">{mapping.code}</span>
        <span className="rounded bg-white/70 px-1 py-0.5 text-[8px] font-bold">{ksbWeightClassLabel(weightClass)}</span>
        <span className="rounded bg-white/70 px-1 py-0.5 text-[8px] font-bold">{clampKsbWeight(mapping.weight)}%</span>
      </div>
      {mapping.description && <p className="mt-1 line-clamp-2 text-[10px] font-semibold leading-relaxed text-foreground-700">{mapping.description}</p>}
      {sourceLabel && <p className="mt-1 truncate text-[9px] font-bold text-foreground-400">{sourceLabel}</p>}
    </div>
  );
}

function SessionKsbSummaryColumn({ kind, mappings, module, sourceLabels }: {
  kind: 'knowledge' | 'skill' | 'behaviour';
  mappings: KsbMapping[];
  module: ModuleCatalogueItem;
  sourceLabels: Record<string, string>;
}) {
  const labels = {
    knowledge: 'Knowledge',
    skill: 'Skills',
    behaviour: 'Behaviours',
  };
  return (
    <section className="min-w-0 rounded-2xl border border-background-200 bg-background-100/35 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase text-foreground-600">{labels[kind]}</p>
        <span className="rounded-full bg-background-50 px-2 py-0.5 text-[10px] font-bold text-foreground-600">{mappings.length}</span>
      </div>
      <div className="space-y-2">
        {mappings.map(mapping => (
          <SessionKsbReadableCard key={mapping.id} mapping={mapping} module={module} />
        ))}
        {!mappings.length && <p className="rounded-xl border border-dashed border-background-300 bg-background-50 px-3 py-6 text-center text-[11px] font-semibold text-foreground-400">None mapped.</p>}
      </div>
    </section>
  );
}

function SessionKsbReadableCard({ mapping, module }: { mapping: KsbMapping; module: ModuleCatalogueItem }) {
  const classification = normaliseKsbMappingType(mapping.classification || mapping.type);
  const weightClass = normaliseKsbWeightClass(mapping.weightClass || mapping.weight_class, classification);
  const placements = ksbMappingPlacements(module, mapping);
  return (
    <article
      title={mapping.description || mapping.code}
      className={`rounded-xl border p-3 ${ksbCodeChipClass(mapping.code)}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] font-extrabold text-foreground-950">{mapping.code}</span>
        <span className="rounded bg-white/70 px-1.5 py-0.5 text-[9px] font-bold">{ksbWeightClassLabel(weightClass)}</span>
        <span className="rounded bg-white/70 px-1.5 py-0.5 text-[9px] font-bold">{clampKsbWeight(mapping.weight)}%</span>
      </div>
      {mapping.description && <p className="mt-2 text-[11px] font-semibold leading-relaxed text-foreground-700">{mapping.description}</p>}
      <div className="mt-2 flex flex-wrap gap-1">
        {placements.slice(0, 4).map(placement => (
          <span key={placement} className="rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-bold text-foreground-600">{placement}</span>
        ))}
        {placements.length > 4 && <span className="rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-bold text-foreground-500">+{placements.length - 4} more</span>}
      </div>
    </article>
  );
}

function ksbMappingPlacements(module: ModuleCatalogueItem, mapping: KsbMapping) {
  const code = String(mapping.code || '').trim().toUpperCase();
  const placements: string[] = [];
  if (module.moduleKsbMappings.some(item => String(item.code || '').trim().toUpperCase() === code)) {
    placements.push('Module level');
  }
  module.weekStructure.forEach(week => {
    if (week.ksbMappings.some(item => String(item.code || '').trim().toUpperCase() === code)) {
      placements.push(`Week ${week.weekNumber}`);
    }
    week.components.forEach(component => {
      if (!component.ksbMappings.some(item => String(item.code || '').trim().toUpperCase() === code)) return;
      const meta = componentTypes.find(item => item.type === component.type);
      placements.push(`Week ${week.weekNumber} - ${readableComponentTitle(component.title) || meta?.label || 'Component'}`);
    });
  });
  return [...new Set(placements)];
}

function SessionKsbMappingRow({ module, week, component, sourceLabels, onAddKsb, onRemoveKsb }: {
  module: ModuleCatalogueItem;
  week: ModuleWeek;
  component: ModuleComponent;
  sourceLabels: Record<string, string>;
  onAddKsb: () => void;
  onRemoveKsb: (mappingId: string) => void;
}) {
  const meta = componentTypes.find(item => item.type === component.type);
  const tone = componentToneClasses(meta?.tone);
  const groups = componentGroupLabels(module, component);
  return (
    <div className="grid gap-3 px-4 py-3 xl:grid-cols-[minmax(260px,0.95fr)_minmax(180px,0.55fr)_repeat(3,minmax(160px,1fr))_auto] xl:items-start">
      <div className="min-w-0">
        <div className="flex items-start gap-2.5">
          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.soft} ${tone.text}`}>
            <AppIcon className={`${meta?.icon || 'ri-file-line'} text-sm`}></AppIcon>
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-bold text-foreground-950">{readableComponentTitle(component.title)}</p>
            <p className="mt-0.5 text-[10px] font-semibold text-foreground-400">Week {week.weekNumber} · {meta?.label || component.type}</p>
            <p className="mt-1 text-[10px] text-foreground-400">{component.ksbMappings.length} mapping{component.ksbMappings.length === 1 ? '' : 's'}</p>
          </div>
        </div>
      </div>
      <div>
        <p className="mb-1 text-[9px] font-bold uppercase text-foreground-400 xl:hidden">Groups</p>
        <div className="flex flex-wrap gap-1">
          {groups.map(group => (
            <span key={group} className="rounded-full border border-primary-100 bg-primary-50 px-2 py-0.5 text-[10px] font-bold text-primary-700">{group}</span>
          ))}
          {!groups.length && <span className="text-[10px] font-semibold text-foreground-300">No group selected</span>}
        </div>
      </div>
      {(['knowledge', 'skill', 'behaviour'] as const).map(kind => (
        <SessionKsbColumn
          key={kind}
          kind={kind}
          mappings={component.ksbMappings.filter(mapping => sessionKsbKind(mapping.code) === kind)}
          sourceLabels={sourceLabels}
          onRemove={onRemoveKsb}
        />
      ))}
      <div className="flex justify-start xl:justify-end">
        <button type="button" onClick={onAddKsb} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-600">
          <AppIcon className="ri-add-line"></AppIcon>
          Add KSBs
        </button>
      </div>
    </div>
  );
}

function SessionKsbColumn({ kind, mappings, sourceLabels, onRemove }: {
  kind: 'knowledge' | 'skill' | 'behaviour';
  mappings: KsbMapping[];
  sourceLabels: Record<string, string>;
  onRemove: (mappingId: string) => void;
}) {
  const labels = {
    knowledge: 'Knowledge',
    skill: 'Skills',
    behaviour: 'Behaviours',
  };
  return (
    <div className="min-w-0 rounded-xl border border-background-200 bg-background-100/45 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[9px] font-bold uppercase text-foreground-400">{labels[kind]}</p>
        <span className="rounded-full bg-background-50 px-1.5 py-0.5 text-[9px] font-bold text-foreground-500">{mappings.length}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {mappings.map(mapping => (
          <SessionKsbChip key={mapping.id} mapping={mapping} sourceLabels={sourceLabels} onRemove={() => onRemove(mapping.id)} />
        ))}
        {!mappings.length && <span className="text-[10px] font-semibold text-foreground-300">None</span>}
      </div>
    </div>
  );
}

function SessionKsbChip({ mapping, sourceLabels, onRemove }: { mapping: KsbMapping; sourceLabels: Record<string, string>; onRemove: () => void }) {
  const sourceLabel = ksbSourceLabel(mapping, sourceLabels);
  const classification = normaliseKsbMappingType(mapping.classification || mapping.type);
  const weightClass = normaliseKsbWeightClass(mapping.weightClass || mapping.weight_class, classification);
  return (
    <span
      title={`${mapping.description || mapping.code} - ${sourceLabel}`}
      className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold ${ksbCodeChipClass(mapping.code)}`}
    >
      <span>{mapping.code}</span>
      <span className="rounded bg-white/70 px-1 text-[8px] font-semibold">{ksbWeightClassLabel(weightClass)}</span>
      <span className="rounded bg-white/70 px-1 text-[8px] font-semibold">{clampKsbWeight(mapping.weight)}%</span>
      <span className="max-w-[90px] truncate rounded bg-white/70 px-1 text-[8px] font-semibold">{sourceLabel}</span>
      <button type="button" onClick={onRemove} className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-red-500 transition-smooth hover:bg-red-50" aria-label={`Remove ${mapping.code}`}>
        <AppIcon className="ri-close-line text-[11px]"></AppIcon>
      </button>
    </span>
  );
}

function sessionKsbKind(code: string): 'knowledge' | 'skill' | 'behaviour' {
  const prefix = String(code || '').trim().toUpperCase().slice(0, 1);
  if (prefix === 'S') return 'skill';
  if (prefix === 'B') return 'behaviour';
  return 'knowledge';
}

function componentGroupLabels(module: ModuleCatalogueItem, component: ModuleComponent) {
  const settings = component.settings || {};
  const names = Array.isArray(settings.selectedGroupNames) ? settings.selectedGroupNames : [];
  const keys = Array.isArray(settings.selectedGroupKeys) ? settings.selectedGroupKeys : [];
  const fallback = [module.group, module.groupId].filter(Boolean);
  const labels = [...names, ...(names.length ? [] : keys), ...(names.length || keys.length ? [] : fallback)]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(labels)];
}

function KsbSelectorModal({ standards, standardsLoading, ksbSets, ksbSetsLoading, initialSourceId, lockedSourceId, onClose, onAddMany }: {
  standards: CurriculumStandard[];
  standardsLoading: boolean;
  ksbSets: CurriculumKsbSet[];
  ksbSetsLoading: boolean;
  initialSourceId: string;
  lockedSourceId?: string;
  onClose: () => void;
  onAddMany: (items: Array<{ option: KsbOption; weight: number; weightClass: KsbWeightClass }>) => void;
}) {
  const [weightsByKsbId, setWeightsByKsbId] = useState<Record<string, number>>({});
  const [weightClassesByKsbId, setWeightClassesByKsbId] = useState<Record<string, KsbWeightClass>>({});
  const [selectedKsbIds, setSelectedKsbIds] = useState<Set<string>>(new Set());
  const [selectedSourceId, setSelectedSourceId] = useState(initialSourceId);
  const [sourceMode, setSourceMode] = useState<'standard' | 'profile'>('profile');
  const [addingKsbs, setAddingKsbs] = useState(false);
  const [ksbSearch, setKsbSearch] = useState('');
  const [ksbTypeFilter, setKsbTypeFilter] = useState<'all' | 'knowledge' | 'skill' | 'behaviour'>('all');
  const sourceLocked = Boolean(lockedSourceId);
  const standardSourceOptions = useMemo(() => standards.map(standard => ({
      id: ksbStandardSourceId(standard),
      label: `${standard.code} - ${standard.name} (${standard.total} KSBs)`,
      options: standardToKsbOptions(standard),
    })), [standards]);
  const profileSourceOptions = useMemo(() => ksbSets.map(set => {
    const sourceId = ksbSetSourceId(set);
    const options = flattenKsbEntries(set.ksbs).map(option => ({ ...option, sourceType: 'framework', sourceId }));
    return {
      id: sourceId,
      label: `${set.programmeName || set.standard || 'Profile'}${set.standard ? ` (${set.standard})` : ''} (${options.length} KSBs)`,
      options,
    };
  }), [ksbSets]);
  const sourceOptions = [...profileSourceOptions, ...standardSourceOptions];
  useEffect(() => {
    const preferredSourceId = lockedSourceId;
    if (sourceLocked && preferredSourceId) {
      setSourceMode(preferredSourceId.startsWith('standard:') ? 'standard' : 'profile');
      setSelectedSourceId(preferredSourceId);
    }
  }, [lockedSourceId, sourceLocked]);
  const selectedSource = sourceOptions.find(source => ksbSourceIdsMatch(source.id, selectedSourceId)) || null;
  const resolvedSelectedSource = selectedSource
    || sourceOptions.find(source => ksbSourceIdsMatch(source.id, selectedSourceId))
    || null;
  const selectedSourceValue = resolvedSelectedSource?.id || (sourceLocked ? selectedSourceId : '');
  const sourceLabels = Object.fromEntries([
    [
      '',
      ksbSetsLoading || standardsLoading ? 'Loading KSB sources...' : 'No source selected',
    ],
    ...sourceOptions.flatMap(source => ksbSourceIdAliases(source.id).map(alias => [alias, source.label])),
  ]);
  const sourceKsbOptions = resolvedSelectedSource?.options || [];
  const filteredKsbOptions = useMemo(() => {
    const query = ksbSearch.trim().toLowerCase();
    return sourceKsbOptions.filter(option => {
      const tone = ksbVisualTone(option.code, option.type);
      if (ksbTypeFilter !== 'all' && tone.label.toLowerCase() !== ksbTypeFilter) return false;
      if (!query) return true;
      return option.code.toLowerCase().includes(query) || option.description.toLowerCase().includes(query);
    });
  }, [sourceKsbOptions, ksbSearch, ksbTypeFilter]);
  const weightForOption = (option: KsbOption) => weightsByKsbId[option.id] ?? defaultKsbWeight(weightClassForOption(option));
  const updateOptionWeight = (option: KsbOption, value: number) => {
    setWeightsByKsbId(current => ({ ...current, [option.id]: clampKsbWeight(value) }));
  };
  const weightClassForOption = (option: KsbOption) => weightClassesByKsbId[option.id] ?? DEFAULT_KSB_WEIGHT_CLASS;
  const updateOptionWeightClass = (option: KsbOption, value: string) => {
    const nextWeightClass = normaliseKsbWeightClass(value);
    setWeightClassesByKsbId(current => ({ ...current, [option.id]: nextWeightClass }));
    setWeightsByKsbId(current => ({ ...current, [option.id]: defaultKsbWeight(nextWeightClass) }));
  };
  const toggleOption = (option: KsbOption) => {
    setSelectedKsbIds(current => {
      const next = new Set(current);
      if (next.has(option.id)) next.delete(option.id);
      else next.add(option.id);
      return next;
    });
  };
  const selectedItems = sourceKsbOptions
    .filter(option => selectedKsbIds.has(option.id))
    .map(option => {
      const weightClass = weightClassForOption(option);
      return { option, weight: clampPositiveKsbWeight(weightForOption(option), weightClass), weightClass };
    });
  const handleAddSelectedKsbs = () => {
    if (!selectedItems.length || addingKsbs) return;
    const count = selectedItems.length;
    setAddingKsbs(true);
    void Swal.fire({
      title: 'Adding KSBs...',
      text: `Mapping ${count} selected KSB${count === 1 ? '' : 's'}.`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: {
        popup: 'kbc-standard-swal-popup',
        title: 'kbc-standard-swal-title',
        htmlContainer: 'kbc-standard-swal-text',
      },
      didOpen: () => Swal.showLoading(),
    });
    window.setTimeout(() => {
      onAddMany(selectedItems);
      void Swal.fire({
        icon: 'success',
        title: 'KSBs added',
        text: `${count} KSB${count === 1 ? ' has' : 's have'} been mapped successfully.`,
        timer: 1400,
        timerProgressBar: true,
        showConfirmButton: false,
        customClass: {
          popup: 'kbc-standard-swal-popup',
          title: 'kbc-standard-swal-title',
          htmlContainer: 'kbc-standard-swal-text',
        },
      });
    }, 250);
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-background-50 shadow-2xl overflow-hidden" onClick={event => event.stopPropagation()}>
        <div className="px-5 py-4 bg-primary-950 text-white flex items-center justify-between">
          <h3 className="text-sm font-heading font-bold text-white">Add KSBs</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20"><AppIcon className="ri-close-line"></AppIcon></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-3">
            {!sourceLocked ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                <p className="text-[10px] font-bold uppercase text-amber-700">Choose KSB source first</p>
                <p className="mt-0.5 text-[11px] font-semibold text-amber-800">Select a KSB Source from the module-level dropdown, then click Add KSBs again.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-primary-100 bg-primary-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-primary-600">KSB source</p>
                <p className="mt-0.5 truncate text-[12px] font-bold text-primary-950">{sourceLabels[selectedSourceValue] || selectedSourceValue.replace(/^(profile|standard):/, '')}</p>
              </div>
            )}
          </div>
          {resolvedSelectedSource && Boolean(sourceKsbOptions.length) && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 sm:max-w-[220px]">
                <AppIcon className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-foreground-400"></AppIcon>
                <input
                  type="text"
                  value={ksbSearch}
                  onChange={event => setKsbSearch(event.target.value)}
                  placeholder="Search KSB code or text"
                  className="h-8 w-full rounded-md border border-foreground-200/60 bg-background-50 pl-7 pr-2 text-[11px] font-semibold text-foreground-900 outline-none focus:border-primary-300"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {(['all', 'knowledge', 'skill', 'behaviour'] as const).map(filterValue => (
                  <button
                    key={filterValue}
                    type="button"
                    onClick={() => setKsbTypeFilter(filterValue)}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold capitalize transition-smooth ${
                      ksbTypeFilter === filterValue
                        ? 'bg-primary-500 text-white'
                        : 'bg-background-100 text-foreground-500 hover:bg-background-200'
                    }`}
                  >
                    {filterValue}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="max-h-96 overflow-y-auto space-y-2">
            {filteredKsbOptions.map(option => {
              const tone = ksbVisualTone(option.code, option.type);
              const selected = selectedKsbIds.has(option.id);
              return (
              <div key={option.id} className={`rounded-xl border border-l-4 px-3 py-2 transition-smooth ${selected ? tone.selectedRow : tone.row}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleOption(option)}
                      className="mt-1 h-4 w-4 rounded border-foreground-300 text-primary-600 focus:ring-primary-300"
                    />
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${tone.iconClass}`}>
                      <AppIcon className={`${tone.icon} text-[13px]`}></AppIcon>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12px] font-bold text-foreground-900">{option.code}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tone.badgeClass}`}>{tone.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.weightClass}`}>{clampKsbWeight(weightForOption(option))}%</span>
                      </div>
                      <p className="mt-1 text-[11px] text-foreground-600 leading-relaxed">{option.description}</p>
                    </div>
                  </div>
                  <div className="grid shrink-0 grid-cols-2 gap-2 sm:w-56">
                    <label className="block">
                      <span className="text-[9px] font-semibold uppercase text-foreground-400">Weight class</span>
                      <select
                        value={weightClassForOption(option)}
                        onChange={event => updateOptionWeightClass(option, event.target.value)}
                        className="mt-1 h-8 w-full rounded-md border border-foreground-200/60 bg-background-50 px-2 text-[11px] font-bold capitalize text-foreground-900 outline-none focus:border-primary-300"
                      >
                        <option value="hard">Hard</option>
                        <option value="soft">Soft</option>
                        <option value="possible">Possible</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[9px] font-semibold uppercase text-foreground-400">Weight</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={clampPositiveKsbWeight(weightForOption(option), weightClassForOption(option))}
                        onChange={event => updateOptionWeight(option, Number(event.target.value))}
                        className="mt-1 h-8 w-full rounded-md border border-foreground-200/60 bg-background-50 px-2 text-[12px] font-bold text-foreground-900 outline-none focus:border-primary-300"
                      />
                    </label>
                  </div>
                </div>
              </div>
              );
            })}
            {!sourceLocked && !resolvedSelectedSource && <EmptyState text="Choose a KSB Source from the module-level dropdown first." />}
            {sourceLocked && !resolvedSelectedSource && <EmptyState text="Loading the selected KSB Source, or it is no longer available." />}
            {resolvedSelectedSource && !sourceKsbOptions.length && <EmptyState text="No KSBs are available for this selection." />}
            {resolvedSelectedSource && Boolean(sourceKsbOptions.length) && !filteredKsbOptions.length && <EmptyState text="No KSBs match your search or filter." />}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-background-200 pt-3">
            <p className="text-[11px] font-semibold text-foreground-500">{selectedItems.length} KSB{selectedItems.length === 1 ? '' : 's'} selected</p>
            <button
              type="button"
              disabled={!selectedItems.length || addingKsbs}
              onClick={handleAddSelectedKsbs}
              className="h-9 rounded-lg bg-primary-500 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-foreground-200 disabled:text-foreground-400"
            >
              {addingKsbs ? 'Adding...' : 'Add KSBs'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WeekTemplateImportModal({ scope, onClose, onImport }: {
  scope: { programmeId: string; programmeName: string };
  onClose: () => void;
  onImport: (template: WeekTemplate) => void;
}) {
  const [templates, setTemplates] = useState<WeekTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importingId, setImportingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchWeekTemplates({})
      .then(rows => { if (active) { setTemplates(rows); setLoading(false); } })
      .catch(err => { if (active) { setError(err instanceof Error ? err.message : 'Unable to load week templates.'); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const list = filterWeekTemplatesForScope(templates, scope);

  const pick = async (template: WeekTemplate) => {
    setImportingId(template.id);
    setError('');
    try {
      const detail = await fetchWeekTemplateDetail(template.id);
      onImport(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load that template.');
      setImportingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground-950/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 border-b border-background-200 px-5 py-4">
          <div>
            <h3 className="font-heading text-[15px] font-bold text-foreground-950">Add a week from a template</h3>
            <p className="mt-0.5 text-[11px] text-foreground-500">Copies the template's components into a new week in this module.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg bg-background-100 text-foreground-500 hover:bg-background-200"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-foreground-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-background-300 border-t-primary-500" />Loading templates…</div>
          ) : list.length ? (
            <div className="space-y-2">
              {list.map(template => (
                <button key={template.id} type="button" disabled={Boolean(importingId)} onClick={() => void pick(template)} className="flex w-full items-center gap-3 rounded-xl border border-background-200 bg-background-50 p-3 text-left transition-smooth hover:border-primary-300 hover:bg-primary-50 disabled:opacity-60">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-500 text-white"><AppIcon className="ri-calendar-todo-line"></AppIcon></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-foreground-900">{template.title || 'Untitled week'}</span>
                    <span className="block text-[11px] text-foreground-500">{template.componentCount || template.components.length} components{template.programmeName ? ` · ${template.programmeName}` : ''}</span>
                  </span>
                  {importingId === template.id ? <AppIcon className="ri-loader-4-line animate-spin text-foreground-400"></AppIcon> : <AppIcon className="ri-add-line text-primary-600"></AppIcon>}
                </button>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-[12px] text-foreground-400">No week templates found. Create one in the Week Builder first.</p>
          )}
          {error && <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function CreateModuleModal({ programmeOptions, onClose, onCreate }: { programmeOptions: string[]; onClose: () => void; onCreate: (input: { programme: string; title: string; description: string; weeks: number; status: string }) => Promise<void> | void }) {
  const [programme, setProgramme] = useState(programmeOptions[0] || 'Unassigned programme');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startMode, setStartMode] = useState<'blank' | 'weeks'>('blank');
  const [weeks, setWeeks] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const selectedWeeks = startMode === 'blank' ? 0 : Math.max(1, Math.round(weeks || 1));
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={submitting ? undefined : onClose}>
      <form
        className="relative w-full max-w-2xl rounded-2xl bg-background-50 shadow-2xl overflow-hidden"
        onClick={event => event.stopPropagation()}
        onSubmit={async event => {
          event.preventDefault();
          if (!title.trim() || submitting) return;
          setSubmitting(true);
          setSubmitError(null);
          try {
            await onCreate({ programme, title: title.trim(), description, weeks: selectedWeeks, status: 'draft' });
          } catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Unable to create module.');
            setSubmitting(false);
          }
        }}
      >
        <div className="px-5 py-4 bg-primary-950 text-white flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-heading font-bold text-white">Create new module</h3>
            <p className="mt-1 text-[12px] text-white/70">Set the module details first, then open the builder to add weeks, components and KSBs.</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="w-8 h-8 shrink-0 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20 disabled:opacity-50" aria-label="Close"><AppIcon className="ri-close-line"></AppIcon></button>
        </div>
        <fieldset disabled={submitting} className="p-5 space-y-5 disabled:opacity-70">
          <div className="grid grid-cols-[32px_1fr] gap-3 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500 text-white text-[12px] font-bold">1</span>
            <div>
              <p className="text-[12px] font-bold text-primary-900">Module identity</p>
              <p className="mt-1 text-[11px] text-primary-700">This is what designers will see in the catalogue and builder.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SelectInput label="Programme" value={programme} options={programmeOptions.length ? programmeOptions : ['Unassigned programme']} onChange={setProgramme} />
            <TextInput label="Module title" value={title} onChange={setTitle} required />
          </div>
          <TextArea label="Short description" value={description} onChange={setDescription} rows={3} />

          <div className="space-y-3">
            <div className="grid grid-cols-[32px_1fr] gap-3 rounded-xl border border-background-200 bg-background-100/60 px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-background-50 text-foreground-700 text-[12px] font-bold">2</span>
              <div>
                <p className="text-[12px] font-bold text-foreground-900">Starting structure</p>
                <p className="mt-1 text-[11px] text-foreground-500">Choose whether to start clean or pre-create week shells.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setStartMode('blank')}
                className={`rounded-xl border px-4 py-3 text-left transition-smooth ${startMode === 'blank' ? 'border-primary-300 bg-primary-50 ring-2 ring-primary-100' : 'border-background-200 bg-background-50 hover:bg-background-100'}`}
              >
                <span className="flex items-center gap-2 text-[13px] font-bold text-foreground-950"><AppIcon className="ri-layout-row-line text-primary-600"></AppIcon>Blank builder</span>
                <span className="mt-1 block text-[11px] leading-relaxed text-foreground-500">Create the module only. Add Week 1 manually when you are ready.</span>
              </button>
              <button
                type="button"
                onClick={() => setStartMode('weeks')}
                className={`rounded-xl border px-4 py-3 text-left transition-smooth ${startMode === 'weeks' ? 'border-primary-300 bg-primary-50 ring-2 ring-primary-100' : 'border-background-200 bg-background-50 hover:bg-background-100'}`}
              >
                <span className="flex items-center gap-2 text-[13px] font-bold text-foreground-950"><AppIcon className="ri-calendar-check-line text-primary-600"></AppIcon>Pre-create weeks</span>
                <span className="mt-1 block text-[11px] leading-relaxed text-foreground-500">Open with week shells already created for a faster build.</span>
              </button>
            </div>

            {startMode === 'weeks' && (
              <div className="max-w-xs">
                <NumberInput label="Number of weeks" value={weeks} min={1} step={1} onChange={setWeeks} />
              </div>
            )}
          </div>

          <div className="rounded-xl border border-background-200 bg-background-100/50 px-4 py-3">
            <p className="text-[11px] font-semibold text-foreground-500">The module will be saved as a draft and opened in the authoring workspace.</p>
          </div>

          {submitError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-semibold text-red-700">
              {submitError}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-background-200 text-[12px] font-semibold text-foreground-700 hover:bg-background-100">Cancel</button>
            <button type="submit" disabled={!title.trim() || submitting} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white text-[12px] font-semibold hover:bg-primary-600 disabled:opacity-70 disabled:cursor-not-allowed">
              {submitting && <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true"></span>}
              {submitting ? 'Creating module...' : 'Create and open builder'}
            </button>
          </div>
        </fieldset>
        {submitting && (
          <div className="absolute inset-x-0 bottom-0 border-t border-primary-100 bg-primary-50 px-5 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500 text-white">
                <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin"></span>
              </span>
              <div>
                <p className="text-[12px] font-bold text-primary-900">Creating draft module</p>
                <p className="mt-0.5 text-[11px] text-primary-700">Saving the structure and opening the authoring workspace.</p>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

function PreviewModal({ module, onClose }: { module: ModuleCatalogueItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl bg-background-50 shadow-2xl overflow-hidden" onClick={event => event.stopPropagation()}>
        <div className="px-5 py-4 bg-primary-950 text-white flex items-center justify-between">
          <h3 className="text-sm font-heading font-bold text-white">Preview</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20"><AppIcon className="ri-close-line"></AppIcon></button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <div>
            <h2 className="text-lg font-heading font-bold text-foreground-950">{module.title}</h2>
            <p className="text-[12px] text-foreground-500">{module.description || 'No short description set.'}</p>
          </div>
          {module.weekStructure.map(week => (
            <div key={week.id} className="rounded-xl border border-background-200 bg-background-100/50 p-4">
              <h3 className="text-sm font-bold text-foreground-900">Week {week.weekNumber}: {week.title}</h3>
              <p className="text-[11px] text-foreground-500 mt-1">{week.summary}</p>
              <div className="mt-3 space-y-2">
                {week.components.map(component => <div key={component.id} className="rounded-lg bg-background-50 border border-background-200 px-3 py-2 text-[12px] text-foreground-700">{readableComponentTitle(component.title)} - {component.expectedOtjh} OTJH - {component.points} pts</div>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KsbMappingPanel({ mappings, onAdd, onRemove }: { mappings: KsbMapping[]; onAdd: () => void; onRemove: (mappingId: string) => void }) {
  return <KsbCards title="KSB mappings" mappings={mappings} onAdd={onAdd} onRemove={onRemove} />;
}

function ComponentKsbChips({ mappings, sourceLabels }: { mappings: KsbMapping[]; sourceLabels: Record<string, string> }) {
  if (!mappings.length) {
    return <span className="mt-1 block text-[9px] font-medium text-foreground-300">No KSBs mapped</span>;
  }
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {mappings.map(mapping => (
        <span
          key={mapping.id}
          title={`${mapping.description || `${mapping.code} applied`} - ${ksbSourceLabel(mapping, sourceLabels)}`}
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${ksbCodeChipClass(mapping.code)}`}
        >
          {mapping.code} applied
          <span className="rounded-full bg-white/70 px-1 text-[8px]">{Number(mapping.weight || 0)}%</span>
          <span className="max-w-[120px] truncate rounded-full bg-white/70 px-1 text-[8px] font-semibold">{ksbSourceLabel(mapping, sourceLabels)}</span>
        </span>
      ))}
    </span>
  );
}

function standardToKsbOptions(standard: CurriculumStandard): KsbOption[] {
  return (standard.ksbs || []).map(ksb => ({
    id: `${standard.id}-${ksb.id || ksb.code}`,
    code: ksb.code,
    description: ksb.description,
    type: ksb.type,
    title: ksb.code,
    sourceType: 'standard',
    sourceId: ksbStandardSourceId(standard),
  }));
}

function ksbStandardSourceId(standard: CurriculumStandard) {
  return `standard:${standard.id}`;
}

function ksbSetSourceId(set: CurriculumKsbSet) {
  const key = set.frameworkId || set.ksbProfileId || set.profileId || set.programmeId || set.standard || set.programmeName;
  return String(key || 'ksb-set').trim();
}

function ksbSourceIdAliases(value?: string) {
  const raw = String(value || '').trim();
  const cleaned = cleanKsbSourceId(raw);
  const aliases = new Set<string>();
  [raw, cleaned].forEach(source => {
    const id = String(source || '').trim();
    if (!id) return;
    aliases.add(id);
    aliases.add(id.replace(/^profile:/, ''));
    if (!id.startsWith('standard:')) aliases.add(`profile:${id.replace(/^profile:/, '')}`);
    if (/^ksb-\d+$/i.test(id)) aliases.add(id.replace(/^ksb-/i, ''));
    if (/^\d+$/.test(id)) {
      aliases.add(`ksb-${id}`);
      aliases.add(`KSBP-${id}`);
      aliases.add(`profile:KSBP-${id}`);
    }
  });
  return Array.from(aliases).filter(Boolean);
}

function ksbSourceIdsMatch(left?: string, right?: string) {
  const leftAliases = ksbSourceIdAliases(left).map(normaliseDeepLinkValue).filter(Boolean);
  const rightAliases = new Set(ksbSourceIdAliases(right).map(normaliseDeepLinkValue).filter(Boolean));
  return leftAliases.some(alias => rightAliases.has(alias));
}

function ksbSetSourceAliases(set: CurriculumKsbSet) {
  return [
    ksbSetSourceId(set),
    set.frameworkId,
    set.ksbProfileId,
    set.profileId,
    set.profileId ? `KSBP-${set.profileId}` : '',
    set.programmeId,
    set.standard,
    set.programmeName,
    ...(set.programmeIds || []),
  ].flatMap(value => ksbSourceIdAliases(String(value || '').trim())).filter(Boolean);
}

function cleanKsbSourceId(value?: string) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('profile:')) return text.replace(/^profile:/, '');
  return text;
}

function ksbSourceOptions(ksbSets: CurriculumKsbSet[], standards: CurriculumStandard[]) {
  const seen = new Set<string>();
  const profileOptions = ksbSets
    .map(set => {
      const id = ksbSetSourceId(set);
      const title = ksbSetDisplayTitle(set);
      return {
        id,
        label: title,
      };
    });
  const standardOptions = standards
    .map(standard => ({
      id: ksbStandardSourceId(standard),
      label: standard.name || standard.code || standard.standardRef || standard.id,
    }));
  return [...profileOptions, ...standardOptions].filter(option => {
      if (seen.has(option.id)) return false;
      seen.add(option.id);
      return true;
    });
}

function ksbMapSourceOptions(ksbSets: CurriculumKsbSet[], standards: CurriculumStandard[]): KsbSourceOption[] {
  const profileOptions = ksbSets.map(set => {
    const id = ksbSetSourceId(set);
    const options = flattenKsbEntries(set.ksbs).map(option => ({ ...option, sourceType: 'framework', sourceId: id }));
    const name = ksbSetDisplayTitle(set);
    return {
      id,
      label: `${name} - ${options.length} KSBs`,
      title: name,
      subtitle: set.programmeName || set.standard || '',
      options,
    };
  });
  const standardOptions = standards.map(standard => {
    const options = standardToKsbOptions(standard);
    const name = `${standard.code || standard.standardRef || standard.id} - ${standard.name}`;
    return {
      id: ksbStandardSourceId(standard),
      label: `Standard: ${name} - ${options.length || standard.total} KSBs`,
      title: standard.name || standard.code || 'Standard',
      subtitle: standard.code || standard.standardRef || '',
      options,
    };
  });
  const seen = new Set<string>();
  return [...profileOptions, ...standardOptions].filter(option => {
    if (seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });
}

function ksbSourceMatchesModule(sourceId: string, ksbSets: CurriculumKsbSet[], standards: CurriculumStandard[], module: ModuleCatalogueItem | null, programmes: CurriculumProgramme[]) {
  const selectedSource = cleanKsbSourceId(sourceId);
  if (!selectedSource) return false;
  if (ksbSourceOptions(ksbSets, standards).some(option => ksbSourceIdsMatch(option.id, selectedSource))) return true;
  if (ksbSets.some(set => ksbSetSourceAliases(set).some(alias => ksbSourceIdsMatch(alias, selectedSource)))) return true;
  if (!module) return false;
  const matchedSet = ksbSetForModule(ksbSets, module, programmes);
  const matchedStandard = standardForModule(standards, module, programmes);
  return Boolean(
    (matchedSet && ksbSetSourceAliases(matchedSet).some(alias => ksbSourceIdsMatch(alias, selectedSource)))
    || (matchedStandard && ksbSourceIdsMatch(ksbStandardSourceId(matchedStandard), selectedSource))
  );
}

function valuesMatchAny(values: unknown[] | undefined, candidates: unknown[]) {
  const expected = (values || []).map(normaliseDeepLinkValue).filter(Boolean);
  if (!expected.length) return true;
  const actual = new Set(candidates.map(normaliseDeepLinkValue).filter(Boolean));
  return expected.some(value => actual.has(value));
}

function ksbSetMatchesModule(set: CurriculumKsbSet, module: ModuleCatalogueItem | null, programmes: CurriculumProgramme[]) {
  if (!module) return false;
  const programmeCandidates = Array.from(moduleStandardCandidates(module, programmes));
  const moduleCandidates = [module.catalogueId, module.id, module.sourceId, module.sourceModule?.id, module.sourceModule?.sourceId];
  const cohortCandidates = [module.cohortId, module.cohort];
  const groupCandidates = [module.groupId, module.group];
  return valuesMatchAny(set.programmeIds?.length ? set.programmeIds : [set.programmeId], programmeCandidates)
    && valuesMatchAny(set.moduleCatalogueIds, moduleCandidates)
    && valuesMatchAny(set.cohortIds, cohortCandidates)
    && valuesMatchAny(set.groupIds, groupCandidates);
}

function ksbSourceLabelMap(standards: CurriculumStandard[], ksbSets: CurriculumKsbSet[]) {
  const labels: Record<string, string> = {};
  standards.forEach(standard => {
    const label = `Skills standard: ${standard.code || standard.standardRef || standard.id} - ${standard.name}`;
    labels[ksbStandardSourceId(standard)] = label;
    labels[String(standard.id || '').trim()] = label;
  });
  ksbSets.forEach(set => {
    const label = readableKsbSetLabel(set);
    const prefixedSourceId = ksbSetSourceId(set);
    [
      prefixedSourceId,
      prefixedSourceId.replace(/^profile:/, ''),
      set.frameworkId,
      set.profileId,
      set.ksbProfileId,
      set.programmeId,
      ...(set.programmeIds || []),
    ].forEach(value => {
      const id = String(value || '').trim();
      if (!id) return;
      labels[id] = label;
      labels[`profile:${id}`] = label;
      const legacyNumeric = legacyKsbProfileNumericId(id);
      if (legacyNumeric) labels[`ksb-${legacyNumeric}`] = label;
    });
    [set.programmeName, set.standard].forEach(value => {
      const key = normaliseDeepLinkValue(value);
      if (key) labels[`programme:${key}`] = label;
    });
  });
  return labels;
}

function readableKsbSetLabel(set: CurriculumKsbSet) {
  return ksbSetDisplayTitle(set);
}

function ksbSetDisplayTitle(set: CurriculumKsbSet) {
  return String(set.standard || set.programmeName || set.ksbProfileId || set.profileId || set.frameworkId || 'KSB profile').trim();
}

function legacyKsbProfileNumericId(value: string) {
  const match = String(value || '').match(/(?:KSBP-)?\d*?(\d{1,6})$/i);
  if (!match) return '';
  return String(Number(match[1]));
}

function ksbSourceLabel(mapping: KsbMapping, sourceLabels: Record<string, string> = {}, fallbackProgrammeName = '') {
  const sourceId = String(mapping.sourceId || '').trim();
  if (sourceId && sourceLabels[sourceId]) return sourceLabels[sourceId];
  if (sourceId && sourceLabels[`profile:${sourceId}`]) return sourceLabels[`profile:${sourceId}`];
  const programmeLabel = sourceLabels[`programme:${normaliseDeepLinkValue(fallbackProgrammeName)}`];
  if (programmeLabel && /^ksb-\d+$/i.test(sourceId)) return programmeLabel;
  const sourceType = String(mapping.sourceType || '').trim().toLowerCase();
  if (sourceId && sourceId.startsWith('profile:')) return `KSB profile: ${sourceId.replace(/^profile:/, '')}`;
  if (sourceId && sourceId.startsWith('standard:')) return `Skills standard: ${sourceId.replace(/^standard:/, '')}`;
  if (sourceType === 'framework') return sourceId ? `KSB profile: ${sourceId}` : 'KSB profile';
  if (sourceType === 'standard') return sourceId ? `Skills standard: ${sourceId}` : 'Skills standard';
  return 'No source';
}

function conciseKsbSourceLabel(label: string) {
  const text = String(label || '').trim();
  if (!text || text === 'No source') return 'No source';
  return text
    .replace(/^KSB profile:\s*/i, 'Profile - ')
    .replace(/^Skills standard:\s*/i, 'Standard - ');
}

function standardForModule(standards: CurriculumStandard[], module: ModuleCatalogueItem | null, programmes: CurriculumProgramme[]) {
  if (!module || !standards.length) return null;
  const candidates = moduleStandardCandidates(module, programmes);
  if (!candidates.size) return null;
  return standards.find(standard => {
    const standardCandidates = [
      standard.id,
      standard.code,
      standard.standardRef,
      standard.name,
      standard.larsCode,
      `${standard.code} v${standard.version}`,
      `${standard.standardRef} v${standard.version}`,
    ].map(normaliseDeepLinkValue).filter(Boolean);
    return standardCandidates.some(candidate => candidates.has(candidate));
  }) || null;
}

function ksbSetForModule(ksbSets: CurriculumKsbSet[], module: ModuleCatalogueItem | null, programmes: CurriculumProgramme[]) {
  if (!module || !ksbSets.length) return null;
  const candidates = moduleStandardCandidates(module, programmes);
  if (!candidates.size) return null;
  return ksbSets.find(set => {
    if (!ksbSetMatchesModule(set, module, programmes)) return false;
    const setCandidates = [
      set.frameworkId,
      set.profileId,
      set.programmeId,
      ...(set.programmeIds || []),
      set.programmeName,
      set.standard,
    ].map(normaliseDeepLinkValue).filter(Boolean);
    return setCandidates.some(candidate => candidates.has(candidate));
  }) || null;
}

function moduleStandardCandidates(module: ModuleCatalogueItem, programmes: CurriculumProgramme[]) {
  const rawCandidates = [
    module.programmeId,
    module.programmeName,
    module.sourceModule?.programmeId,
    module.sourceModule?.programme,
    ...((module as ModuleBuilderListItem).deliveryUsages || []).flatMap(usage => [usage.programmeId, usage.programme]),
  ];
  const moduleKeys = new Set(rawCandidates.map(normaliseDeepLinkValue).filter(Boolean));
  programmes.forEach(programme => {
    const programmeKeys = [programme.id, programme.sourceId, programme.name].map(normaliseDeepLinkValue).filter(Boolean);
    if (programmeKeys.some(key => moduleKeys.has(key))) {
      rawCandidates.push(programme.standard);
    }
  });
  return new Set(rawCandidates.map(normaliseDeepLinkValue).filter(Boolean));
}

function ksbWeightSummary(mappings: KsbMapping[]) {
  return mappings.reduce(
    (summary, mapping) => {
      const weight = Number(mapping.weight || 0);
      const code = String(mapping.code || '').trim().toUpperCase();
      if (code.startsWith('K')) summary.knowledge += weight;
      else if (code.startsWith('S')) summary.skills += weight;
      else if (code.startsWith('B')) summary.behaviours += weight;
      summary.total += weight;
      return summary;
    },
    { knowledge: 0, skills: 0, behaviours: 0, total: 0 },
  );
}

function KsbWeightSummary({ summary }: { summary: ReturnType<typeof ksbWeightSummary> }) {
  const items = [
    ['K', summary.knowledge],
    ['S', summary.skills],
    ['B', summary.behaviours],
    ['Total', summary.total],
  ] as const;
  return (
    <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-background-200 bg-background-100/35 p-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-background-50 px-2 py-1.5 text-center">
          <p className="text-[9px] font-bold uppercase text-foreground-400">{label}</p>
          <p className="text-[12px] font-heading font-bold text-foreground-900">{Number(value || 0)}%</p>
        </div>
      ))}
    </div>
  );
}

function KsbCards({ title, mappings, sourceLabels = {}, onAdd, onRemove, onWeightChange, onWeightClassChange }: { title: string; mappings: KsbMapping[]; sourceLabels?: Record<string, string>; onAdd?: () => void; onRemove?: (mappingId: string) => void; onWeightChange?: (mappingId: string, weight: number) => void; onWeightClassChange?: (mappingId: string, weightClass: KsbWeightClass) => void }) {
  const totalWeight = mappings.reduce((total, mapping) => total + Number(mapping.weight || 0), 0);
  return (
    <div className="space-y-2 rounded-xl border border-background-200 bg-background-100/35 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase text-foreground-400">{title}</p>
          {!!mappings.length && <p className="mt-0.5 text-[10px] font-semibold text-foreground-500">{totalWeight}% total weight</p>}
        </div>
        {onAdd && (
          <button onClick={onAdd} className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-primary-500 px-2 text-[10px] font-semibold text-white transition-smooth hover:bg-primary-600">
            <AppIcon className="ri-add-line"></AppIcon>
            KSB
          </button>
        )}
      </div>
      <div className="space-y-2">
        {mappings.map(mapping => (
          <KsbCard
            key={mapping.id}
            mapping={mapping}
            sourceLabels={sourceLabels}
            onRemove={onRemove ? () => onRemove(mapping.id) : undefined}
            onWeightChange={onWeightChange ? weight => onWeightChange(mapping.id, weight) : undefined}
            onWeightClassChange={onWeightClassChange ? weightClass => onWeightClassChange(mapping.id, weightClass) : undefined}
          />
        ))}
        {!mappings.length && <p className="text-[11px] text-foreground-400">No KSBs mapped.</p>}
      </div>
    </div>
  );
}

function KsbCard({ mapping, sourceLabels = {}, onRemove, onWeightChange, onWeightClassChange }: { mapping: KsbMapping; sourceLabels?: Record<string, string>; onRemove?: () => void; onWeightChange?: (weight: number) => void; onWeightClassChange?: (weightClass: KsbWeightClass) => void }) {
  const tone = ksbVisualTone(mapping.code, mapping.type);
  const classification = normaliseKsbMappingType(mapping.classification || mapping.type);
  const weightClass = normaliseKsbWeightClass(mapping.weightClass || mapping.weight_class, classification);
  const sourceLabel = ksbSourceLabel(mapping, sourceLabels);
  return (
    <div className={`rounded-lg border border-l-4 p-2 ${tone.row}`} title={mapping.description || `${mapping.code} applied`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${tone.iconClass}`}>
          <AppIcon className={`${tone.icon} text-[13px]`}></AppIcon>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <p className="truncate text-[11px] font-bold text-foreground-900">{mapping.code} applied</p>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tone.badgeClass}`}>{tone.label}</span>
            <span className="rounded-full bg-background-50 px-2 py-0.5 text-[9px] font-bold text-foreground-600">{ksbWeightClassLabel(weightClass)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tone.weightClass}`}>{Number(mapping.weight || 0)}%</span>
          </div>
          <p className="mt-1 truncate text-[10px] font-semibold text-foreground-400">{sourceLabel}</p>
          {(onWeightChange || onWeightClassChange) && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[112px_88px]">
              {onWeightClassChange && (
                <label className="text-[10px] font-semibold uppercase text-foreground-400">
                  Weight class
                  <select
                    value={weightClass}
                    onChange={event => onWeightClassChange(normaliseKsbWeightClass(event.target.value))}
                    className="mt-1 h-7 w-full rounded-md border border-foreground-200/60 bg-background-50 px-2 text-[11px] font-bold capitalize text-foreground-900 outline-none focus:border-primary-300"
                  >
                    <option value="hard">Hard</option>
                    <option value="soft">Soft</option>
                    <option value="possible">Possible</option>
                  </select>
                </label>
              )}
              {onWeightChange && (
                <label className="text-[10px] font-semibold uppercase text-foreground-400">
                  Weight
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={Number(mapping.weight || 0)}
                    onChange={event => onWeightChange(clampKsbWeight(Number(event.target.value)))}
                    className="mt-1 h-7 w-full rounded-md border border-foreground-200/60 bg-background-50 px-2 text-[12px] font-bold text-foreground-900 outline-none focus:border-primary-300"
                  />
                </label>
              )}
            </div>
          )}
          {Number(mapping.weight || 0) <= 0 && (
            <p className="mt-1 text-[10px] font-semibold text-amber-700">Set a positive weight before saving.</p>
          )}
        </div>
        {onRemove && <button onClick={onRemove} className="h-6 w-6 shrink-0 rounded-md text-red-500 hover:bg-red-50"><AppIcon className="ri-close-line text-xs"></AppIcon></button>}
      </div>
    </div>
  );
}

function WeekKsbCodeSection({ mappings, sourceLabels }: { mappings: KsbMapping[]; sourceLabels: Record<string, string> }) {
  const groups = [
    { key: 'K', label: 'Knowledge', items: mappings.filter(mapping => String(mapping.code || '').toUpperCase().startsWith('K')) },
    { key: 'S', label: 'Skills', items: mappings.filter(mapping => String(mapping.code || '').toUpperCase().startsWith('S')) },
    { key: 'B', label: 'Behaviours', items: mappings.filter(mapping => String(mapping.code || '').toUpperCase().startsWith('B')) },
  ];
  return (
    <div className="space-y-2 rounded-xl border border-primary-100 bg-primary-50/35 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase text-primary-700">Week KSBs</p>
        {!!mappings.length && <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-primary-700">{mappings.length}</span>}
      </div>
      {mappings.length ? (
        <div className="space-y-2">
          {groups.map(group => group.items.length ? (
            <div key={group.key} className="space-y-1">
              <p className="text-[9px] font-bold uppercase text-foreground-400">{group.label}</p>
              <div className="flex flex-wrap gap-1">
                {group.items.map(mapping => <KsbCodeOnlyChip key={mapping.id} mapping={mapping} sourceLabels={sourceLabels} />)}
              </div>
            </div>
          ) : null)}
        </div>
      ) : (
        <p className="text-[11px] text-foreground-400">No KSBs mapped.</p>
      )}
    </div>
  );
}

function KsbCodeOnlyChip({ mapping, sourceLabels }: { mapping: KsbMapping; sourceLabels: Record<string, string> }) {
  const sourceLabel = ksbSourceLabel(mapping, sourceLabels);
  return (
    <span
      title={`${mapping.description || mapping.code} - ${sourceLabel}`}
      className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold ${ksbCodeChipClass(mapping.code)}`}
    >
      <span>{mapping.code}</span>
      <span className="max-w-[140px] truncate rounded bg-white/70 px-1 text-[8px] font-semibold">{sourceLabel}</span>
    </span>
  );
}

function ksbVisualTone(code: string, type?: string) {
  const rawType = String(type || '').trim().toLowerCase();
  const prefix = String(code || '').trim().toUpperCase().slice(0, 1);
  if (prefix === 'S' || rawType.startsWith('skill')) {
    return {
      label: 'Skill',
      icon: 'ri-tools-line',
      row: 'border-amber-100 border-l-amber-500 bg-amber-50/35 hover:bg-amber-50',
      selectedRow: 'border-amber-300 border-l-amber-600 bg-amber-50 ring-1 ring-amber-100',
      iconClass: 'bg-amber-100 text-amber-700',
      badgeClass: 'bg-amber-100 text-amber-700',
      weightClass: 'bg-amber-50 text-amber-700',
      chipClass: 'border-amber-100 bg-amber-50 text-amber-700',
    };
  }
  if (prefix === 'B' || rawType.startsWith('behaviour')) {
    return {
      label: 'Behaviour',
      icon: 'ri-user-heart-line',
      row: 'border-emerald-100 border-l-emerald-500 bg-emerald-50/35 hover:bg-emerald-50',
      selectedRow: 'border-emerald-300 border-l-emerald-600 bg-emerald-50 ring-1 ring-emerald-100',
      iconClass: 'bg-emerald-100 text-emerald-700',
      badgeClass: 'bg-emerald-100 text-emerald-700',
      weightClass: 'bg-emerald-50 text-emerald-700',
      chipClass: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    };
  }
  return {
    label: 'Knowledge',
    icon: 'ri-book-open-line',
    row: 'border-primary-100 border-l-primary-500 bg-primary-50/35 hover:bg-primary-50',
    selectedRow: 'border-primary-300 border-l-primary-600 bg-primary-50 ring-1 ring-primary-100',
    iconClass: 'bg-primary-100 text-primary-700',
    badgeClass: 'bg-primary-100 text-primary-700',
    weightClass: 'bg-primary-50 text-primary-700',
    chipClass: 'border-primary-100 bg-primary-50 text-primary-700',
  };
}

function ksbCodeChipClass(code: string) {
  return ksbVisualTone(code).chipClass;
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4 space-y-4">
      <h4 className="text-sm font-heading font-bold text-foreground-950">{title}</h4>
      {children}
    </section>
  );
}

function EditorBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-background-200 bg-background-100/50 p-4 space-y-4">
      <h4 className="text-[12px] font-bold text-foreground-700">{title}</h4>
      {children}
    </div>
  );
}

function ComponentResourceUpload({
  label,
  accept,
  uploadedName,
  uploadedUrl,
  uploadedSize,
  uploading,
  error,
  onUpload,
}: {
  label: string;
  accept: string;
  uploadedName: string;
  uploadedUrl: string;
  uploadedSize: number;
  uploading: boolean;
  error: string;
  onUpload: (file: File) => void | Promise<void>;
}) {
  const inputId = useMemo(() => `component-upload-${Math.random().toString(36).slice(2)}`, []);
  return (
    <div className="rounded-xl border border-background-200 bg-background-50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase text-foreground-400">{label}</p>
          <p className="mt-1 truncate text-[12px] font-semibold text-foreground-700">
            {uploadedName ? uploadedName : 'No file uploaded yet'}
            {uploadedSize > 0 && <span className="ml-2 text-foreground-400">{formatFileSize(uploadedSize)}</span>}
          </p>
          {uploadedUrl && (
            <a href={uploadedUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-primary-700 hover:text-primary-800">
              <AppIcon className="ri-external-link-line"></AppIcon>
              Open uploaded file
            </a>
          )}
        </div>
        <div className="shrink-0">
          <input
            id={inputId}
            type="file"
            accept={accept}
            disabled={uploading}
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void onUpload(file);
            }}
          />
          <label htmlFor={inputId} className={`inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-bold text-white transition-smooth ${uploading ? 'bg-foreground-300' : 'bg-primary-500 hover:bg-primary-600'}`}>
            <AppIcon className={uploading ? 'ri-loader-4-line animate-spin' : 'ri-upload-cloud-2-line'}></AppIcon>
            {uploading ? 'Uploading...' : 'Upload from device'}
          </label>
        </div>
      </div>
      {error && <p className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</p>}
    </div>
  );
}

function formatFileSize(size: number) {
  const value = Number(size || 0);
  if (value <= 0) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <input type="date" value={value} onChange={event => onChange(event.target.value)} className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-300" />
    </label>
  );
}

function ReadOnlyMetricChip({ label, value, suffix, tone }: {
  label: string;
  value: string;
  suffix: string;
  tone: 'emerald' | 'amber';
}) {
  const toneClass = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-amber-200 bg-amber-50 text-amber-800';

  return (
    <span className={`min-w-16 rounded-md border px-2 py-1 text-right text-[10px] font-bold ${toneClass}`} title={`${label}: ${value} ${suffix}`}>
      <span className="block text-left text-[8px] uppercase text-foreground-400">{label}</span>
      <span>
        {value}
        <span className="ml-1 text-[8px] opacity-70">{suffix}</span>
      </span>
    </span>
  );
}

/**
 * Only the states that ask for something are badged. Published is what a
 * finished module is supposed to be, so it carries no badge: on a list where
 * nearly everything is published, the badge said nothing and cost a line.
 */
function StatusBadge({ status }: { status: string }) {
  if (status === 'published') return null;
  const classes = status === 'draft' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700';
  const label = status === 'review' ? 'in review' : status;
  return <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${classes}`}>{label}</span>;
}

function ModuleCatalogueCard({
  module,
  teamsSummary,
  onKsbMap,
  ksbMapLoading,
  onBuild,
  onSettings,
  onDuplicate,
  onDelete,
}: {
  module: ModuleBuilderListItem;
  teamsSummary?: CurriculumTeamsMeetingSummary;
  onKsbMap: () => void;
  ksbMapLoading: boolean;
  onBuild: () => void;
  onSettings: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  // weekStructure is only populated once a module is opened/built. For modules
  // fetched from the catalogue it stays empty, so fall back to lessonCount,
  // which the backend sets to the real authored component count.
  const componentCount = module.weekStructure.reduce((total, week) => total + week.components.length, 0) || module.lessonCount || 0;
  // The authored week count. `sessionsNumber` is no longer a fallback for it: a
  // module delivered twice a week has twice as many sessions as weeks, so
  // borrowing that number here overstated the card.
  const weekCount = module.weekStructure.length || module.weeks || 0;
  const hasContent = componentCount > 0;
  const subLabel = moduleListSubLabel(module);
  const primaryDelivery = (module.deliveryUsages || []).find(usage => usage.deliveryModuleId);
  const primaryDeliveryHref = primaryDelivery ? `/curriculum/modules/${encodeURIComponent(primaryDelivery.deliveryModuleId)}` : '';
  // Legacy fallbacks retained by the merge were:
  // weekCount = module.weekStructure.length || module.weeks || 0

  return (
    <article className="group rounded-xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm transition-smooth hover:border-primary-200/80 hover:shadow-md">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${hasContent ? 'bg-primary-50 text-primary-600 ring-1 ring-primary-100' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'}`}>
              <AppIcon className={hasContent ? 'ri-layout-4-line text-base' : 'ri-draft-line text-base'}></AppIcon>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="truncate text-[14px] font-heading font-bold text-foreground-950">{module.title}</h3>
                <StatusBadge status={module.status} />
              </div>
              {subLabel && <p className="mt-1 text-[11px] text-foreground-500">{subLabel}</p>}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-background-200 bg-background-100 px-2.5 py-1 text-[10px] font-semibold text-foreground-600">
                  {cleanModuleMeta(module.programmeName) || 'No programme'}
                </span>
                <ModuleMetricPill icon="ri-stack-line" label={`${weekCount} weeks`} />
                <ModuleMetricPill icon="ri-puzzle-line" label={`${componentCount} components`} tone={hasContent ? 'default' : 'muted'} />
              </div>
              <ModuleDeliveryRows module={module} teamsSummary={teamsSummary} expectedSessions={module.sessionsNumber || weekCount} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          {primaryDeliveryHref && (
            <Link
              to={primaryDeliveryHref}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[11px] font-bold text-primary-700 transition-smooth hover:border-primary-300 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-100 focus:ring-offset-1"
            >
              <AppIcon name="ri-external-link-line" size={15}></AppIcon>
              Open delivery
            </Link>
          )}
          <button
            onClick={onKsbMap}
            disabled={ksbMapLoading}
            aria-busy={ksbMapLoading}
            className="inline-flex h-9 min-w-[126px] items-center justify-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-700 transition-all duration-150 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-100 focus:ring-offset-1 active:translate-y-px disabled:cursor-wait disabled:border-primary-200 disabled:bg-primary-50 disabled:text-primary-700 disabled:shadow-inner"
          >
            <AppIcon name={ksbMapLoading ? 'ri-loader-4-line' : 'ri-node-tree'} className={ksbMapLoading ? 'animate-spin' : ''} size={15}></AppIcon>
            {ksbMapLoading ? 'Loading module KSBs...' : 'Review module KSBs'}
          </button>
          <button onClick={onBuild} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700">
            <AppIcon name="ri-hammer-line" size={15}></AppIcon>
            Edit components
          </button>
          <ModuleCardActionButton label="Edit module" icon="ri-edit-line" onClick={onSettings} />
          <ModuleCardActionButton label="Duplicate module" icon="ri-file-copy-line" onClick={onDuplicate} />
          <ModuleCardActionButton label="Delete module" icon="ri-delete-bin-line" tone="danger" onClick={onDelete} />
        </div>
      </div>
    </article>
  );
}

function ModuleCardActionButton({ label, icon, onClick, tone = 'default' }: { label: string; icon: string; onClick: () => void; tone?: 'default' | 'danger' }) {
  const classes = tone === 'danger'
    ? 'border-red-100 bg-red-50 text-red-600 hover:border-red-200 hover:bg-red-100 hover:text-red-700 focus:ring-red-100'
    : 'border-background-200 bg-background-50 text-foreground-700 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 focus:ring-primary-100';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-bold transition-smooth focus:outline-none focus:ring-2 focus:ring-offset-1 ${classes}`}
    >
      <AppIcon name={icon} size={15}></AppIcon>
      {label}
    </button>
  );
}

type KsbSourceOption = {
  id: string;
  label: string;
  title: string;
  subtitle: string;
  options: KsbOption[];
};

type ModuleKsbMapRow = {
  code: string;
  description: string;
  source: string;
  sourceFull: string;
  weight: number;
  locations: string[];
  placements: ModuleKsbPlacement[];
  applied: boolean;
  classificationLabels: string[];
};

type ModuleKsbPlacement = {
  label: string;
  scope: 'Module' | 'Week' | 'Component';
  otjh: number;
  points: number;
};

function ModuleKsbMapModal({ module, sourceLabels, ksbSets, standards, programmes, onClose, onBuild }: {
  module: ModuleBuilderListItem;
  sourceLabels: Record<string, string>;
  ksbSets: CurriculumKsbSet[];
  standards: CurriculumStandard[];
  programmes: CurriculumProgramme[];
  onClose: () => void;
  onBuild: () => void;
}) {
  const [query, setQuery] = useState('');
  const allSourceOptions = useMemo(() => ksbMapSourceOptions(ksbSets, standards), [ksbSets, standards]);
  const defaultSourceId = useMemo(() => {
    const selected = cleanKsbSourceId(module.ksbProfileSourceId);
    if (selected && allSourceOptions.some(option => option.id === selected)) return selected;
    const matchingProfile = ksbSetForModule(ksbSets, module, programmes);
    if (matchingProfile) return ksbSetSourceId(matchingProfile);
    const matchingStandard = standardForModule(standards, module, programmes);
    return matchingStandard ? ksbStandardSourceId(matchingStandard) : allSourceOptions[0]?.id || '';
  }, [allSourceOptions, ksbSets, module, programmes, standards]);
  const sourceOptions = useMemo(() => {
    return allSourceOptions
      .map(option => {
        const appliedCount = moduleKsbMapRows(module, sourceLabels, option, option.id === defaultSourceId).length;
        return {
          ...option,
          appliedCount,
        };
      })
      .filter(option => option.appliedCount > 0 || option.id === defaultSourceId);
  }, [allSourceOptions, defaultSourceId, module, sourceLabels]);
  const [selectedSourceId, setSelectedSourceId] = useState(defaultSourceId);
  useEffect(() => {
    if (!selectedSourceId && defaultSourceId) setSelectedSourceId(defaultSourceId);
    else if (selectedSourceId && sourceOptions.length && !sourceOptions.some(option => option.id === selectedSourceId)) setSelectedSourceId(defaultSourceId);
  }, [defaultSourceId, selectedSourceId, sourceOptions]);
  const selectedSource = sourceOptions.find(option => option.id === selectedSourceId) || allSourceOptions.find(option => option.id === selectedSourceId) || null;
  const rows = moduleKsbMapRows(module, sourceLabels, selectedSource, selectedSource?.id === defaultSourceId);
  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter(row => {
      const matchesSearch = !search || [
        row.code,
        row.description,
        row.source,
        row.applied ? 'mapped applied used' : 'not mapped unused',
        ...row.locations,
      ].some(value => String(value || '').toLowerCase().includes(search));
      return matchesSearch;
    });
  }, [query, rows]);
  const groups = [
    { key: 'K' as const, title: 'Knowledge', icon: 'ri-book-open-line', rows: filteredRows.filter(row => row.code.toUpperCase().startsWith('K')) },
    { key: 'S' as const, title: 'Skills', icon: 'ri-tools-line', rows: filteredRows.filter(row => row.code.toUpperCase().startsWith('S')) },
    { key: 'B' as const, title: 'Behaviours', icon: 'ri-user-heart-line', rows: filteredRows.filter(row => row.code.toUpperCase().startsWith('B')) },
  ];
  const visiblePlacementCount = filteredRows.reduce((total, row) => total + row.placements.length, 0);
  const visibleWeight = filteredRows.reduce((total, row) => total + row.weight, 0);
  const visibleOtjh = uniquePlacementOtjh(filteredRows);
  return (
    <div className="fixed inset-0 z-[88] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="border-b border-background-200 bg-primary-950 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-white/60">KSB Coverage</p>
              <h3 className="mt-1 truncate text-base font-heading font-bold text-white">{module.title}</h3>
              <p className="mt-1 text-[11px] font-semibold text-white/70">Applied KSBs, placement, weight and OTJH for this module.</p>
            </div>
            <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-white transition-smooth hover:bg-white/20">
              <AppIcon className="ri-close-line"></AppIcon>
            </button>
          </div>
        </div>
        <div className="border-b border-background-200 bg-background-50 px-5 py-3">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[300px_minmax(260px,1fr)_auto] xl:items-end">
            <div className="block">
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wide text-foreground-400">KSB source</span>
              <div className="flex min-h-10 w-full items-center rounded-lg border border-background-200 bg-background-100 px-3 py-2">
                {selectedSource ? (
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-bold text-foreground-950">{selectedSource.title}</p>
                    <p className="mt-0.5 truncate text-[11px] font-medium text-foreground-500">{selectedSource.subtitle}</p>
                  </div>
                ) : (
                  <span className="text-[12px] font-semibold text-foreground-500">No applied KSB sources</span>
                )}
              </div>
            </div>
            <div className="relative">
              <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search code, description, week or component..." className="h-10 w-full rounded-lg border border-background-200 bg-background-100 pl-9 pr-3 text-[12px] text-foreground-900 outline-none transition-smooth focus:border-primary-300 focus:bg-background-50" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <KsbCoverageMetric label="KSBs" value={String(filteredRows.length)} />
              <KsbCoverageMetric label="Placements" value={String(visiblePlacementCount)} />
              <KsbCoverageMetric label="OTJH" value={formatKsbOtjh(visibleOtjh)} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold text-foreground-500">
            <span className="rounded-md border border-background-200 bg-background-100 px-2 py-1">Mapped weight: {formatKsbWeight(visibleWeight)}</span>
            <span className="rounded-md border border-background-200 bg-background-100 px-2 py-1">Applied KSBs only</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {rows.length ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                {groups.map(group => (
                  <ModuleKsbGroupPanel key={group.key} group={group} />
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-background-300 bg-background-100 p-8 text-center">
              <AppIcon className="ri-node-tree text-3xl text-foreground-300"></AppIcon>
              <p className="mt-2 text-[13px] font-bold text-foreground-700">No applied KSBs for this source</p>
              <p className="mt-1 text-[12px] text-foreground-500">Choose another source or use Edit mappings to attach KSBs to weeks or components.</p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-background-200 bg-background-50 px-4 py-2 text-[12px] font-semibold text-foreground-700 transition-smooth hover:bg-background-100">
            Close
          </button>
          <button type="button" onClick={onBuild} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-[12px] font-bold text-white transition-smooth hover:bg-primary-600">
            <AppIcon className="ri-hammer-line"></AppIcon>
            Edit mappings
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgrammeKsbMapModal({ programmeName, modules, sourceLabels, onClose }: {
  programmeName: string;
  modules: ModuleBuilderListItem[];
  sourceLabels: Record<string, string>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => programmeKsbMapRows(modules, sourceLabels, programmeName), [modules, programmeName, sourceLabels]);
  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter(row => {
      if (!search) return true;
      return [
        row.code,
        row.description,
        row.source,
        ...row.locations,
      ].some(value => String(value || '').toLowerCase().includes(search));
    });
  }, [query, rows]);
  const groups = [
    { key: 'K' as const, title: 'Knowledge', icon: 'ri-book-open-line', rows: filteredRows.filter(row => row.code.toUpperCase().startsWith('K')) },
    { key: 'S' as const, title: 'Skills', icon: 'ri-tools-line', rows: filteredRows.filter(row => row.code.toUpperCase().startsWith('S')) },
    { key: 'B' as const, title: 'Behaviours', icon: 'ri-user-heart-line', rows: filteredRows.filter(row => row.code.toUpperCase().startsWith('B')) },
  ];

  return (
    <div className="fixed inset-0 z-[88] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="border-b border-background-200 bg-primary-950 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-white/60">Programme KSB Coverage</p>
              <h3 className="mt-1 truncate text-base font-heading font-bold text-white">{programmeName}</h3>
              <p className="mt-1 text-[11px] font-semibold text-white/70">Applied KSBs across {modules.length} module{modules.length === 1 ? '' : 's'} in this programme.</p>
            </div>
            <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-white transition-smooth hover:bg-white/20">
              <AppIcon className="ri-close-line"></AppIcon>
            </button>
          </div>
        </div>
        <div className="border-b border-background-200 bg-background-50 px-5 py-3">
          <div className="relative">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search code, source, module, week or component..." className="h-10 w-full rounded-lg border border-background-200 bg-background-100 pl-9 pr-3 text-[12px] text-foreground-900 outline-none transition-smooth focus:border-primary-300 focus:bg-background-50" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {rows.length ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              {groups.map(group => (
                <ModuleKsbGroupPanel key={group.key} group={group} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-background-300 bg-background-100 p-8 text-center">
              <AppIcon className="ri-node-tree text-3xl text-foreground-300"></AppIcon>
              <p className="mt-2 text-[13px] font-bold text-foreground-700">No detailed KSB mappings in this programme</p>
              <p className="mt-1 text-[12px] text-foreground-500">Add KSB mappings to weeks or components to see programme coverage here.</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end border-t border-background-200 bg-background-50 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-background-200 bg-background-50 px-4 py-2 text-[12px] font-semibold text-foreground-700 transition-smooth hover:bg-background-100">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ModuleKsbGroupPanel({ group }: {
  group: { key: 'K' | 'S' | 'B'; title: string; icon: string; rows: ModuleKsbMapRow[] };
}) {
  const tone = ksbVisualTone(group.key);
  const placementCount = group.rows.reduce((total, row) => total + row.placements.length, 0);
  const groupOtjh = uniquePlacementOtjh(group.rows);
  return (
    <section className={`flex min-h-0 flex-col rounded-xl border border-l-4 bg-background-100/35 ${tone.row}`}>
      <div className="border-b border-background-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`grid h-9 w-9 place-items-center rounded-lg ${tone.iconClass}`}>
              <AppIcon className={`${group.icon} text-sm`}></AppIcon>
            </span>
            <div>
              <h4 className="text-[12px] font-black uppercase text-foreground-800">{group.title}</h4>
              <p className="mt-0.5 text-[10px] font-semibold text-foreground-400">{placementCount} placement{placementCount === 1 ? '' : 's'} - {formatKsbOtjh(groupOtjh)} OTJH</p>
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${tone.badgeClass}`}>{group.rows.length}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {group.rows.map(row => (
          <ModuleKsbMapCard key={row.code} row={row} />
        ))}
        {!group.rows.length && <p className="rounded-xl border border-dashed border-background-300 bg-background-50 px-3 py-8 text-center text-[11px] font-semibold text-foreground-400">None mapped.</p>}
      </div>
    </section>
  );
}

function ModuleKsbMapCard({ row }: { row: ModuleKsbMapRow }) {
  const kind = row.code.toUpperCase().slice(0, 1);
  const tone = ksbVisualTone(kind);
  const totalOtjh = row.placements.reduce((total, placement) => total + Number(placement.otjh || 0), 0);
  const totalPoints = row.placements.reduce((total, placement) => total + Number(placement.points || 0), 0);
  return (
    <article className={`rounded-xl border bg-background-50 p-3 shadow-sm transition-smooth hover:border-primary-200 hover:shadow-md ${tone.selectedRow}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-lg border px-2.5 py-1 text-[12px] font-black ${ksbCodeChipClass(row.code)}`}>{row.code}</span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${row.applied ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'}`}>{row.applied ? `${row.placements.length} place${row.placements.length === 1 ? '' : 's'}` : 'Not mapped'}</span>
            {row.classificationLabels.map(label => <span key={label} className="rounded-full bg-background-100 px-2 py-0.5 text-[9px] font-bold text-foreground-500">{label}</span>)}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${row.applied ? ksbCodeChipClass(row.code) : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'}`}>{formatKsbWeight(row.weight)}</span>
      </div>
      <p className="mt-2 line-clamp-3 text-[12px] font-medium leading-relaxed text-foreground-700">{row.description || 'No description available.'}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <KsbCoverageMetric label="Weight" value={formatKsbWeight(row.weight)} compact />
        <KsbCoverageMetric label="OTJH" value={formatKsbOtjh(totalOtjh)} compact />
        <KsbCoverageMetric label="Points" value={String(totalPoints)} compact />
      </div>
      <div className="mt-3 space-y-2">
        {row.applied ? <div>
          <p className="mb-1 flex items-center gap-1 text-[8px] font-black uppercase text-foreground-400">
            <AppIcon className="ri-map-pin-line text-[10px]"></AppIcon>
            Applied in
          </p>
          <div className="space-y-1.5">
            {row.placements.map(placement => (
              <div key={`${placement.scope}:${placement.label}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border border-background-200 bg-background-100 px-2.5 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-black text-foreground-800">{placement.label}</p>
                  <p className="mt-0.5 text-[8px] font-bold uppercase text-foreground-400">{placement.scope}</p>
                </div>
                <span className="rounded-md bg-background-50 px-2 py-1 text-[9px] font-black text-emerald-700">{formatKsbOtjh(placement.otjh)}</span>
                <span className="rounded-md bg-background-50 px-2 py-1 text-[9px] font-black text-foreground-600">{placement.points} pts</span>
              </div>
            ))}
          </div>
        </div> : (
          <div className="rounded-lg border border-dashed border-background-300 bg-background-50 px-2.5 py-2 text-[10px] font-bold text-foreground-400">
            Not applied to any week or component yet.
          </div>
        )}
      </div>
    </article>
  );
}

function KsbCoverageMetric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-background-200 bg-background-100 ${compact ? 'px-2 py-1.5' : 'min-w-20 px-3 py-2'}`}>
      <p className="text-[8px] font-black uppercase text-foreground-400">{label}</p>
      <p className={`${compact ? 'text-[11px]' : 'text-[13px]'} mt-0.5 font-black text-foreground-900`}>{value}</p>
    </div>
  );
}

function ModuleMetricPill({ icon, label, tone = 'default' }: { icon: string; label: string; tone?: 'default' | 'muted' }) {
  const classes = tone === 'muted'
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : 'border-background-200 bg-background-50 text-foreground-600';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${classes}`}>
      <AppIcon className={`${icon} text-[11px]`}></AppIcon>
      {label}
    </span>
  );
}

function BuilderStatChip({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-background-200 bg-background-100 px-2.5 py-1.5 text-[11px] font-semibold text-foreground-600">
      <AppIcon className={`${icon} text-[13px] text-primary-600`}></AppIcon>
      {label}
      <span className="font-heading text-[13px] font-black text-foreground-950">{value}</span>
    </span>
  );
}

/**
 * Which deliveries run this module: one row per cohort/group, because the same
 * authored module can run for several groups on different dates.
 *
 * The row is a compact facts line; the named Open delivery action lives with
 * the other module actions so it is visible before the reader scans details.
 *
 * Staffing is deliberately not shown here: the tutor is changed on the delivery
 * this row opens, where the clash check and the assignment notification live.
 */
function ModuleDeliveryRows({ module, teamsSummary, expectedSessions }: {
  module: ModuleBuilderListItem;
  teamsSummary?: CurriculumTeamsMeetingSummary;
  /** The module's own calendar session count. A delivery only earns a chip when its count disagrees. */
  expectedSessions: number;
}) {
  const usages = module.deliveryUsages || [];
  if (!usages.length) {
    return (
      <p className="mt-3 rounded-lg border border-dashed border-background-300 bg-background-100/70 px-3 py-2 text-[11px] font-semibold text-foreground-500">
        Not attached to a delivery yet. Add it to a group from New module to give it a cohort, tutor and dates.
      </p>
    );
  }
  const teams = teamsMeetingLabel(teamsSummary);
  const rowClasses = 'flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2';
  return (
    <div className="mt-3 divide-y divide-background-200 overflow-hidden rounded-lg border border-background-200 bg-background-50">
      {usages.map(usage => {
        const sessions = usage.sessions || 0;
        const facts = (
          <>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-foreground-900">
              <AppIcon className="ri-route-line text-[12px] text-primary-600"></AppIcon>
              {formatDeliveryUsage(usage)}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground-500">
              <AppIcon className="ri-calendar-event-line text-[12px]"></AppIcon>
              {formatDateLabel(usage.startDate)} – {formatDateLabel(usage.endDate)}
            </span>
            {sessions > 0 && sessions !== expectedSessions && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
                <AppIcon className="ri-calendar-2-line text-[12px]"></AppIcon>
                {sessions} session{sessions === 1 ? '' : 's'}
              </span>
            )}
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${teams.tone}`}>
              <AppIcon className="ri-vidicon-line text-[12px]"></AppIcon>
              {teams.text}
            </span>
          </>
        );
        if (!usage.deliveryModuleId) {
          return <div key={usage.id} className={rowClasses}>{facts}</div>;
        }
        return (
          <div
            key={usage.id}
            className={rowClasses}
          >
            {facts}
          </div>
        );
      })}
    </div>
  );
}

function hasAnyKsbMappings(module: ModuleCatalogueItem) {
  return Boolean(
    module.moduleKsbMappings.length ||
    module.weekStructure.some(week => week.ksbMappings.length || week.components.some(component => component.ksbMappings.length)),
  );
}

function mergeKsbStructureForReview(base: ModuleBuilderListItem, remote: ModuleCatalogueItem): ModuleBuilderListItem {
  const remoteHasMappings = hasAnyKsbMappings(remote);
  return {
    ...base,
    ...remote,
    moduleKsbMappings: remote.moduleKsbMappings.length ? remote.moduleKsbMappings : base.moduleKsbMappings,
    deliveryUsages: base.deliveryUsages,
    ksbProfileSourceId: remote.ksbProfileSourceId || base.ksbProfileSourceId,
    weekStructure: remoteHasMappings ? remote.weekStructure : (remote.weekStructure.length ? remote.weekStructure : base.weekStructure),
  };
}

function buildMasterModuleList(remoteModules: ModuleCatalogueItem[], localModules: ModuleCatalogueItem[]): ModuleBuilderListItem[] {
  const masters = new Map<string, ModuleBuilderListItem>();

  remoteModules.forEach(module => {
    const key = moduleDefinitionKey(module);
    const usage = moduleDeliveryUsage(module);
    const existing = masters.get(key);
    if (!existing) {
      masters.set(key, {
        ...module,
        deliveryUsages: usage ? [usage] : [],
      });
      return;
    }

    const preferred = preferMasterModule(existing, module);
    masters.set(key, {
      ...preferred,
      deliveryUsages: uniqueDeliveryUsages([...(existing.deliveryUsages || []), ...(usage ? [usage] : [])]),
    });
  });

  localModules.forEach(module => {
    const key = moduleDefinitionKey(module);
    const existing = masters.get(key);
    if (!existing) {
      masters.set(key, { ...module, deliveryUsages: [] });
      return;
    }
    const preferred = preferMasterModule(existing, module);
    masters.set(key, {
      ...preferred,
      deliveryUsages: existing.deliveryUsages || [],
    });
  });

  return Array.from(masters.values()).sort(sortCatalogueOptionsForPicker);
}

function moduleDefinitionKey(module: ModuleCatalogueItem) {
  const canonicalId = cleanModuleMeta(module.catalogueId || module.sourceModule?.moduleCatalogueId || module.sourceModule?.moduleId);
  if (canonicalId) return `catalogue::${canonicalId}`;
  const title = cleanModuleMeta(module.title).toLowerCase();
  const programme = cleanModuleMeta(module.programmeName).toLowerCase();
  if (!module.sourceModule) return `local::${programme}::${title || module.catalogueId}`;
  return `${programme || 'programme'}::${title || module.catalogueId}`;
}

/** Every identifier the selected programme answers to: name, id, source id, standard. */
function programmeFilterKeys(programmeName: string, programmes: CurriculumProgramme[]) {
  const selected = programmes.find(programme => normaliseDeepLinkValue(programme.name) === normaliseDeepLinkValue(programmeName));
  return [
    programmeName,
    selected?.name,
    selected?.id,
    selected?.sourceId,
    selected?.standard,
  ].map(normaliseDeepLinkValue).filter(Boolean);
}

function usageMatchesProgrammeFilter(usage: ModuleDeliveryUsage, programmeName: string, programmes: CurriculumProgramme[]) {
  if (programmeName === 'All') return true;
  const selectedKeys = programmeFilterKeys(programmeName, programmes);
  return [usage.programme, usage.programmeId]
    .map(normaliseDeepLinkValue)
    .filter(Boolean)
    .some(key => selectedKeys.includes(key));
}

/**
 * The value a cohort / group filter carries. The id is preferred so a deep link
 * from a Cohort or Group workspace lands exactly; the name is the fallback for
 * deliveries the backend never gave an id.
 */
function deliveryFilterValue(id?: string, name?: string) {
  return String(id || '').trim() || String(name || '').trim();
}

/** Empty means "all". A set filter matches either the delivery's id or its name. */
function deliveryFilterMatches(filter: string, id?: string, name?: string) {
  const key = normaliseDeepLinkValue(filter);
  if (!key) return true;
  return [id, name].map(normaliseDeepLinkValue).filter(Boolean).includes(key);
}

function teamsMeetingLabel(summary?: CurriculumTeamsMeetingSummary) {
  if (!summary) return { text: 'Teams not created', tone: 'text-foreground-400' };
  if (summary.upcomingCount > 0) return { text: `${summary.upcomingCount} upcoming`, tone: 'text-emerald-700' };
  if (summary.occurrenceCount > 0) return { text: `${summary.occurrenceCount} held`, tone: 'text-foreground-600' };
  return { text: 'Teams scheduled', tone: 'text-sky-700' };
}

function moduleBelongsToProgrammeFilter(module: ModuleBuilderListItem, programmeName: string, programmes: CurriculumProgramme[]) {
  const selectedKeys = programmeFilterKeys(programmeName, programmes);
  const moduleKeys = [
    module.programmeName,
    module.programmeId,
    module.sourceModule?.programme,
    module.sourceModule?.programmeId,
    ...(module.deliveryUsages || []).flatMap(usage => [usage.programme, usage.programmeId]),
  ].map(normaliseDeepLinkValue).filter(Boolean);
  return moduleKeys.some(key => selectedKeys.includes(key));
}

function moduleBelongsToVisibleProgramme(module: ModuleBuilderListItem, programmes: CurriculumProgramme[]) {
  if (module.isProgrammeDeleted || module.sourceModule?.isProgrammeDeleted) return false;
  if (!programmes.length) return true;
  const visibleKeys = new Set(
    programmes
      .flatMap(programme => [programme.name, programme.id, programme.sourceId, programme.standard])
      .map(normaliseDeepLinkValue)
      .filter(Boolean),
  );
  const moduleKeys = [
    module.programmeName,
    module.programmeId,
    module.sourceModule?.programme,
    module.sourceModule?.programmeId,
    ...(module.deliveryUsages || []).flatMap(usage => [usage.programme, usage.programmeId]),
  ].map(normaliseDeepLinkValue).filter(Boolean);
  if (!moduleKeys.length) return true;
  return moduleKeys.some(key => visibleKeys.has(key));
}

function programmeForScope(programmes: CurriculumProgramme[], values: unknown[]) {
  const wanted = new Set(values.map(normaliseDeepLinkValue).filter(Boolean));
  if (!wanted.size) return null;
  return programmes.find(programme => (
    [programme.id, programme.sourceId, programme.name]
      .map(normaliseDeepLinkValue)
      .filter(Boolean)
      .some(key => wanted.has(key))
  )) || null;
}

function deliveryUsageForModuleScope(module: ModuleBuilderListItem, programmeName: string, programmes: CurriculumProgramme[]) {
  const usages = module.deliveryUsages || [];
  if (!usages.length) return null;
  if (programmeName === 'All') return usages[0];
  const selectedKeys = programmeFilterKeys(programmeName, programmes);
  return usages.find(usage => (
    [usage.programme, usage.programmeId].map(normaliseDeepLinkValue).some(key => selectedKeys.includes(key))
  )) || usages[0];
}

function moduleDeliveryUsage(module: ModuleCatalogueItem): ModuleDeliveryUsage | null {
  const cohort = cleanModuleMeta(module.sourceModule?.cohort);
  const group = cleanModuleMeta(module.sourceModule?.group);
  if (!cohort && !group) return null;
  return {
    deliveryModuleId: (module.sourceModule ? moduleIdentity(module.sourceModule) : '') || String(module.catalogueId || module.id || ''),
    id: [
      module.sourceModule?.id,
      module.sourceModule?.sourceId,
      module.catalogueId,
      cohort,
      group,
    ].filter(Boolean).join('::'),
    moduleId: String(module.sourceModule?.moduleId || module.sourceModule?.moduleCatalogueId || module.catalogueId || module.id || ''),
    sourceId: String(module.sourceModule?.sourceId || module.sourceId || ''),
    catalogueId: String(module.catalogueId || ''),
    structureId: moduleStructureIdentifier(module),
    programmeId: String(module.programmeId || module.sourceModule?.programmeId || ''),
    programme: module.programmeName || module.sourceModule?.programme || 'Unassigned programme',
    moduleTitle: module.title || module.sourceModule?.name || 'Untitled module',
    cohortId: String(module.cohortId || module.sourceModule?.cohortId || ''),
    cohort,
    groupId: String(module.groupId || module.sourceModule?.groupId || ''),
    group,
    tutor: tutorDisplayName(module.tutor || module.sourceModule?.tutor),
    deliveryStatus: deliveryStatusText(module.deliveryStatus || module.sourceModule?.deliveryStatus).replace(/^Delivery: /, ''),
    startDate: module.startDate || module.sourceModule?.startDate,
    endDate: module.endDate || module.sourceModule?.endDate,
    sessions: module.sourceModule?.sessionsNumber || module.sourceModule?.weeks || module.sessionsNumber || module.weeks || 0,
  };
}

function uniqueDeliveryUsages(usages: ModuleDeliveryUsage[]) {
  const seen = new Set<string>();
  return usages.filter(usage => {
    const key = usage.id || `${usage.cohort}::${usage.group}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function liveSessionGroupOptions(module: ModuleCatalogueItem) {
  const usages = uniqueDeliveryUsages([
    ...((module as ModuleBuilderListItem).deliveryUsages || []),
    moduleDeliveryUsageFallback(module),
  ]);
  const seen = new Set<string>();
  return usages
    .map(usage => {
      const group = cleanModuleMeta(usage.group);
      if (!group) return null;
      const cohort = cleanModuleMeta(usage.cohort);
      const groupId = cleanModuleMeta(usage.groupId);
      const cohortId = cleanModuleMeta(usage.cohortId);
      const key = groupId || [cohortId || cohort, group].filter(Boolean).join('::') || group;
      return { key, group, cohort, groupId, cohortId };
    })
    .filter((option): option is { key: string; group: string; cohort: string; groupId: string; cohortId: string } => Boolean(option?.key && option.group))
    .filter(option => {
      const uniqueKey = normaliseQuizText(option.key);
      if (seen.has(uniqueKey)) return false;
      seen.add(uniqueKey);
      return true;
    });
}

function preferMasterModule(current: ModuleCatalogueItem, candidate: ModuleCatalogueItem) {
  const currentScore = moduleCompletenessScore(current);
  const candidateScore = moduleCompletenessScore(candidate);
  if (candidateScore !== currentScore) return candidateScore > currentScore ? candidate : current;
  return moduleCatalogueRecency(candidate) > moduleCatalogueRecency(current) ? candidate : current;
}

function moduleCompletenessScore(module: ModuleCatalogueItem) {
  const componentCount = module.weekStructure.reduce((total, week) => total + week.components.length, 0);
  return componentCount * 1000 + (module.ksbCount || 0) * 100 + (module.lessonCount || 0) + (module.weekStructure.length ? 50 : 0);
}

function moduleIdentityText(module: ModuleCatalogueItem) {
  const cohort = cleanModuleMeta(module.sourceModule?.cohort);
  const group = cleanModuleMeta(module.sourceModule?.group);
  const parts = [
    cohort ? `Cohort: ${cohort}` : '',
    group ? `Group: ${group}` : '',
  ].filter(Boolean);
  return parts.join(' - ');
}

function normaliseDeepLinkValue(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isCanonicalModuleCatalogueId(value: unknown) {
  return /^MOD-[A-Z0-9][A-Z0-9_-]*$/i.test(String(value || '').trim());
}

function moduleDeepLinkIdentifiers(module: ModuleBuilderListItem) {
  const values = [
    module.catalogueId,
    module.sourceModule?.moduleId,
    module.sourceModule?.moduleCatalogueId,
    module.sourceModule?.structureId,
    module.sourceModule?.deliveryModuleId,
    module.id,
    module.sourceId,
    module.sourceModule?.id,
    module.sourceModule?.sourceId,
    moduleStructureIdentifier(module),
    ...(module.deliveryUsages || []).flatMap(usage => [
      usage.id,
      usage.moduleId,
      usage.sourceId,
      usage.catalogueId,
      usage.structureId,
    ]),
  ];
  const identifiers = new Set<string>();
  values.forEach(value => {
    const text = String(value || '').trim();
    if (!text) return;
    identifiers.add(text);
    if (/^\d+$/.test(text)) identifiers.add(`training-module-${text}`);
    if (text.startsWith('training-module-')) identifiers.add(text.replace(/^training-module-/, ''));
  });
  return Array.from(identifiers);
}

function moduleOptionKey(module: ModuleCatalogueItem) {
  return [
    module.catalogueId,
    module.sourceModule?.moduleId,
    module.sourceModule?.moduleCatalogueId,
    module.id,
    module.sourceModule?.id,
    module.sourceModule?.sourceId,
    cleanModuleMeta(module.sourceModule?.cohort),
    cleanModuleMeta(module.sourceModule?.group),
  ].filter(Boolean).join('::');
}

/** A catalogue item as the shared module form's target. */
function moduleFormTargetFromCatalogue(module: ModuleCatalogueItem, usage?: ModuleDeliveryUsage | null): ModuleFormTarget {
  return {
    id: moduleStructureIdentifier(module) || module.catalogueId,
    name: module.title,
    programmeId: usage?.programmeId || module.programmeId,
    programme: usage?.programme || module.programmeName,
    cohortId: usage?.cohortId || module.cohortId,
    groupId: usage?.groupId || module.groupId,
    sessionsNumber: module.sessionsNumber || usage?.sessions,
    weeks: module.weeks || module.weekStructure?.length,
    startDate: module.startDate || usage?.startDate,
    endDate: module.endDate || usage?.endDate,
    tutor: module.tutor || usage?.tutor,
    status: module.status,
    notes: module.description,
    color: module.color,
    deliveryUsages: (module as ModuleBuilderListItem).deliveryUsages,
  };
}

function moduleStructureIdentifier(module: ModuleCatalogueItem) {
  if (isCanonicalModuleCatalogueId(module.catalogueId)) return module.catalogueId;
  const canonicalId = [
    module.sourceModule?.moduleCatalogueId,
    module.sourceModule?.moduleId,
    module.sourceModule?.structureId,
  ].map(value => String(value || '').trim()).find(isCanonicalModuleCatalogueId);
  if (canonicalId) return canonicalId;
  const sourceId = String(module.sourceModule?.id || module.id || '');
  return sourceId.startsWith('training-module-') ? sourceId : module.catalogueId;
}

function moduleBuilderDeepLinkTarget(module: ModuleCatalogueItem, params: URLSearchParams): { selection: Selection | null; openSettings: boolean } {
  const focus = String(params.get('focus') || '').trim();
  const weekId = String(params.get('week') || params.get('weekId') || '').trim();
  const componentId = String(params.get('component') || params.get('componentId') || '').trim();
  const openSettings = focus === 'module-settings' || params.get('settings') === '1';
  if (componentId) {
    const week = module.weekStructure.find(item => item.components.some(component => component.id === componentId));
    if (week) return { selection: { kind: 'component', weekId: week.id, componentId }, openSettings };
  }
  if (weekId && module.weekStructure.some(week => week.id === weekId)) {
    return { selection: { kind: 'week', weekId }, openSettings };
  }
  return { selection: null, openSettings };
}

function sortCatalogueOptionsForPicker(a: ModuleCatalogueItem, b: ModuleCatalogueItem) {
  const statusRank = (module: ModuleCatalogueItem) => (module.status === 'draft' ? 0 : 1);
  const statusDelta = statusRank(a) - statusRank(b);
  if (statusDelta !== 0) return statusDelta;

  const recencyDelta = moduleCatalogueRecency(b) - moduleCatalogueRecency(a);
  if (recencyDelta !== 0) return recencyDelta;

  return a.title.localeCompare(b.title);
}

function moduleCatalogueRecency(module: ModuleCatalogueItem) {
  const text = `${module.catalogueId} ${module.id}`;
  const timestampMatch = text.match(/20\d{12,}/);
  if (timestampMatch) return Number(timestampMatch[0].slice(0, 14));
  const numericMatch = text.match(/\d+/g);
  return numericMatch ? Number(numericMatch.join('').slice(0, 14)) || 0 : 0;
}

/**
 * The module's own description, and nothing else. It used to read "Scoped
 * module - used in 1 delivery", which restated the delivery rows underneath it
 * in wording only this codebase uses. An empty result means no line is drawn.
 */
function moduleListSubLabel(module: ModuleCatalogueItem) {
  return cleanModuleMeta(module.description);
}

function moduleDeliverySearchText(module: ModuleBuilderListItem) {
  return (module.deliveryUsages || [])
    .map(usage => `${usage.cohort} ${usage.group} ${usage.tutor} ${usage.deliveryStatus}`)
    .join(' ');
}

/** A tutor name, with the backend's "Unassigned" placeholder read as no tutor. */
function tutorDisplayName(value?: string) {
  const text = String(value || '').trim();
  return text.toLowerCase() === 'unassigned' ? '' : text;
}

function formatDeliveryUsage(usage: ModuleDeliveryUsage) {
  const cohort = cleanModuleMeta(usage.cohort);
  const group = cleanModuleMeta(usage.group);
  if (cohort && group) return `${cohort} / ${group}`;
  return cohort || group || 'Delivery';
}

function deliveryStatusText(status?: string) {
  if (!status || status === 'unknown') return '';
  return `Delivery: ${status.replace(/_/g, ' ')}`;
}

function moduleScheduleText(module: ModuleCatalogueItem) {
  const weeks = module.weekStructure?.length || module.weeks || 0;
  const sessions = module.sessionsNumber || weeks;
  const range = module.startDate && module.endDate ? ` - ${module.startDate} to ${module.endDate}` : '';
  return `${sessions} session${sessions === 1 ? '' : 's'} / ${weeks} week${weeks === 1 ? '' : 's'}${range}`;
}

function cleanModuleMeta(value?: string) {
  const text = String(value || '').trim();
  if (!text || ['unassigned cohort', 'default group', 'unassigned'].includes(text.toLowerCase())) return '';
  return text;
}

function IconButton({ label, icon, onClick, tone = 'default' }: { label: string; icon: string; onClick: () => void; tone?: 'default' | 'danger' }) {
  const classes = tone === 'danger'
    ? 'bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700'
    : 'bg-background-100 text-foreground-600 hover:bg-primary-50 hover:text-primary-700';
  return (
    <button onClick={onClick} title={label} aria-label={label} className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-smooth ${classes}`}>
      <AppIcon name={icon} size={15}></AppIcon>
    </button>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-background-200 bg-background-100/60 p-3">
      <p className="text-[9px] uppercase font-bold text-foreground-400">{label}</p>
      <p className="text-lg font-heading font-bold text-foreground-950">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-background-300 bg-background-100/40 px-3 py-5 text-center text-[12px] font-medium text-foreground-400">{text}</div>;
}

function EmptyEditor({ onAddWeek }: { onAddWeek: () => void }) {
  return (
    <section className="rounded-2xl border border-foreground-200/60 bg-background-50 p-8 text-center">
      <AppIcon className="ri-layout-row-line text-3xl text-foreground-300"></AppIcon>
      <p className="mt-2 text-sm font-semibold text-foreground-700">No week selected</p>
      <button onClick={onAddWeek} className="mt-4 px-4 py-2 rounded-lg bg-primary-500 text-white text-[12px] font-semibold hover:bg-primary-600">Add week</button>
    </section>
  );
}

function ModuleListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="rounded-xl border border-background-200 bg-background-50 p-4 animate-pulse">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px_auto] lg:items-center">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-9 w-9 rounded-lg bg-background-200"></span>
                <div className="space-y-2">
                  <span className="block h-3 w-44 rounded bg-background-200"></span>
                  <span className="block h-2.5 w-32 rounded bg-background-200"></span>
                </div>
              </div>
              <div className="flex gap-2">
                <span className="h-6 w-24 rounded-full bg-background-200"></span>
                <span className="h-6 w-20 rounded-full bg-background-200"></span>
                <span className="h-6 w-24 rounded-full bg-background-200"></span>
              </div>
            </div>
            <span className="h-16 rounded-xl bg-background-200"></span>
            <div className="flex gap-2 lg:justify-end">
              <span className="h-8 w-16 rounded-lg bg-background-200"></span>
              <span className="h-8 w-8 rounded-md bg-background-200"></span>
              <span className="h-8 w-8 rounded-md bg-background-200"></span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const DEFAULT_KSB_MAPPING_TYPE: KsbMappingType = 'main';
const DEFAULT_KSB_WEIGHT_CLASS: KsbWeightClass = 'hard';
const DEFAULT_KSB_WEIGHTS: Record<KsbWeightClass, number> = {
  hard: 50,
  soft: 30,
  possible: 20,
};

function defaultKsbWeight(weightClass: KsbWeightClass = DEFAULT_KSB_WEIGHT_CLASS) {
  return DEFAULT_KSB_WEIGHTS[normaliseKsbWeightClass(weightClass)];
}

function clampKsbWeight(value: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed * 100) / 100);
}

function clampPositiveKsbWeight(value: number, weightClass: KsbWeightClass = DEFAULT_KSB_WEIGHT_CLASS) {
  const weight = clampKsbWeight(value);
  return weight > 0 ? weight : defaultKsbWeight(weightClass);
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

function ksbWeightClassLabel(value?: string) {
  const weightClass = normaliseKsbWeightClass(value);
  if (weightClass === 'hard') return 'Hard';
  if (weightClass === 'soft') return 'Soft';
  return 'Possible';
}

function ksbMappingIdentity(value: Pick<KsbMapping, 'code' | 'sourceType' | 'sourceId'> | Pick<KsbOption, 'code' | 'sourceType' | 'sourceId'>) {
  return [
    String(value.code || '').trim().toUpperCase(),
    String(value.sourceType || '').trim().toLowerCase(),
    String(value.sourceId || '').trim().toLowerCase(),
  ].join('|');
}

function mappingsForTarget(module: ModuleCatalogueItem, target: KsbTarget) {
  if (target.scope === 'module') return module.moduleKsbMappings;
  const week = module.weekStructure.find(item => item.id === target.weekId);
  if (!week) return [];
  if (target.scope === 'week') return week.ksbMappings;
  return week.components.find(component => component.id === target.componentId)?.ksbMappings || [];
}

function addKsbMapping(module: ModuleCatalogueItem, target: KsbTarget, option: KsbOption, weight = defaultKsbWeight(), weightClass: KsbWeightClass = DEFAULT_KSB_WEIGHT_CLASS): ModuleCatalogueItem {
  const nextIdentity = ksbMappingIdentity(option);
  if (mappingsForTarget(module, target).some(mapping => ksbMappingIdentity(mapping) === nextIdentity)) return module;
  const mapping: KsbMapping = {
    id: makeAuthoringId('KSBMAP'),
    ksbId: option.id,
    code: option.code,
    description: option.description,
    sourceType: option.sourceType,
    sourceId: option.sourceId,
    type: DEFAULT_KSB_MAPPING_TYPE,
    classification: DEFAULT_KSB_MAPPING_TYPE,
    weight: clampKsbWeight(weight),
    weightClass: normaliseKsbWeightClass(weightClass),
    weight_class: normaliseKsbWeightClass(weightClass),
  };
  if (target.scope === 'module') return { ...module, moduleKsbMappings: [...module.moduleKsbMappings, mapping] };
  return {
    ...module,
    weekStructure: module.weekStructure.map(week => {
      if (week.id !== target.weekId) return week;
      if (target.scope === 'week') return { ...week, ksbMappings: [...week.ksbMappings, mapping] };
      return { ...week, components: week.components.map(component => component.id === target.componentId ? { ...component, ksbMappings: [...component.ksbMappings, mapping] } : component) };
    }),
  };
}

function updateKsbMappingWeight(module: ModuleCatalogueItem, target: KsbTarget, mappingId: string, weight: number): ModuleCatalogueItem {
  const updateMappings = (mappings: KsbMapping[]) => mappings.map(mapping => (
    mapping.id === mappingId ? { ...mapping, weight: clampKsbWeight(weight) } : mapping
  ));
  if (target.scope === 'module') return { ...module, moduleKsbMappings: updateMappings(module.moduleKsbMappings) };
  return {
    ...module,
    weekStructure: module.weekStructure.map(week => {
      if (week.id !== target.weekId) return week;
      if (target.scope === 'week') return { ...week, ksbMappings: updateMappings(week.ksbMappings) };
      return { ...week, components: week.components.map(component => component.id === target.componentId ? { ...component, ksbMappings: updateMappings(component.ksbMappings) } : component) };
    }),
  };
}

function updateKsbMappingWeightClass(module: ModuleCatalogueItem, target: KsbTarget, mappingId: string, weightClass: KsbWeightClass): ModuleCatalogueItem {
  const nextWeightClass = normaliseKsbWeightClass(weightClass);
  const updateMappings = (mappings: KsbMapping[]) => mappings.map(mapping => (
    mapping.id === mappingId
      ? {
          ...mapping,
          weight: defaultKsbWeight(nextWeightClass),
          weightClass: nextWeightClass,
          weight_class: nextWeightClass,
        }
      : mapping
  ));
  if (target.scope === 'module') return { ...module, moduleKsbMappings: updateMappings(module.moduleKsbMappings) };
  return {
    ...module,
    weekStructure: module.weekStructure.map(week => {
      if (week.id !== target.weekId) return week;
      if (target.scope === 'week') return { ...week, ksbMappings: updateMappings(week.ksbMappings) };
      return { ...week, components: week.components.map(component => component.id === target.componentId ? { ...component, ksbMappings: updateMappings(component.ksbMappings) } : component) };
    }),
  };
}

function removeKsbMapping(module: ModuleCatalogueItem, target: KsbTarget, mappingId: string): ModuleCatalogueItem {
  if (target.scope === 'module') return { ...module, moduleKsbMappings: module.moduleKsbMappings.filter(mapping => mapping.id !== mappingId) };
  return {
    ...module,
    weekStructure: module.weekStructure.map(week => {
      if (week.id !== target.weekId) return week;
      if (target.scope === 'week') return { ...week, ksbMappings: week.ksbMappings.filter(mapping => mapping.id !== mappingId) };
      return { ...week, components: week.components.map(component => component.id === target.componentId ? { ...component, ksbMappings: component.ksbMappings.filter(mapping => mapping.id !== mappingId) } : component) };
    }),
  };
}

function moveById<T extends { id: string }>(items: T[], sourceId: string, targetId: string): T[] {
  const sourceIndex = items.findIndex(item => item.id === sourceId);
  const targetIndex = items.findIndex(item => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

function uniqueMappings(mappings: KsbMapping[]) {
  const seen = new Set<string>();
  return mappings.filter(mapping => {
    const key = ksbMappingIdentity(mapping);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function moduleKsbMapRows(module: ModuleCatalogueItem, sourceLabels: Record<string, string>, source?: KsbSourceOption | null, allowSelectedSourceCodeFallback = false): ModuleKsbMapRow[] {
  const rows = new Map<string, ModuleKsbMapRow>();
  const fallbackSourceFull = source ? (sourceLabels[source.id] || source.label) : '';
  const fallbackSource = conciseKsbSourceLabel(fallbackSourceFull);
  const sourceCodes = new Set<string>();
  source?.options.forEach(option => {
    const code = String(option.code || '').trim().toUpperCase();
    if (!code) return;
    sourceCodes.add(code);
    const sourceId = String(option.sourceId || source.id || '').trim();
    const key = ksbMappingIdentity({ code, sourceType: option.sourceType || (sourceId.startsWith('standard:') ? 'standard' : 'framework'), sourceId });
    rows.set(key, {
      code,
      description: option.description || option.title || '',
      source: fallbackSource,
      sourceFull: fallbackSourceFull,
      weight: 0,
      locations: [],
      placements: [],
      applied: false,
      classificationLabels: [],
    });
  });
  const addMapping = (mapping: KsbMapping, placement: ModuleKsbPlacement) => {
    const location = placement.label;
    const code = String(mapping.code || '').trim().toUpperCase();
    if (!code) return;
    if (isLegacyModuleLevelKsbFallback(mapping, location)) return;
    const sourceFull = ksbSourceLabel(mapping, sourceLabels);
    const sourceLabel = conciseKsbSourceLabel(sourceFull);
    const mappingSourceId = cleanKsbSourceId(mapping.sourceId);
    const selectedSourceId = cleanKsbSourceId(source?.id);
    const mappingKey = ksbMappingIdentity(mapping);
    const selectedSourceKey = selectedSourceId
      ? ksbMappingIdentity({
        code,
        sourceType: selectedSourceId.startsWith('standard:') ? 'standard' : 'framework',
        sourceId: selectedSourceId,
      })
      : '';
    const canUseSelectedSourceByCode = Boolean(allowSelectedSourceCodeFallback && selectedSourceId && sourceCodes.has(code));
    if (selectedSourceId && mappingSourceId && mappingSourceId !== selectedSourceId && !canUseSelectedSourceByCode) return;
    const rowKey = selectedSourceKey && canUseSelectedSourceByCode && rows.has(selectedSourceKey)
      ? selectedSourceKey
      : rows.has(mappingKey)
        ? mappingKey
        : (selectedSourceKey && rows.has(selectedSourceKey) ? selectedSourceKey : mappingKey);
    const current = rows.get(rowKey) || {
      code,
      description: mapping.description || '',
      source: canUseSelectedSourceByCode ? fallbackSource : sourceLabel || fallbackSource,
      sourceFull: canUseSelectedSourceByCode ? fallbackSourceFull : sourceFull || fallbackSourceFull,
      weight: 0,
      locations: [],
      placements: [],
      applied: false,
      classificationLabels: [],
    };
    current.weight += Number(mapping.weight || 0);
    current.applied = true;
    const classification = ksbWeightClassLabel(mapping.weightClass || mapping.weight_class);
    if (classification && !current.classificationLabels.includes(classification)) current.classificationLabels.push(classification);
    if (!current.description && mapping.description) current.description = mapping.description;
    if (!current.locations.includes(location)) current.locations.push(location);
    if (!current.placements.some(item => item.label === placement.label && item.scope === placement.scope)) current.placements.push(placement);
    rows.set(rowKey, current);
  };

  const modulePlacement = {
    label: 'Module',
    scope: 'Module' as const,
    otjh: Number(module.declaredTotalOtjh ?? module.totalOtjh ?? 0) || 0,
    points: module.weekStructure.reduce((total, week) => total + week.components.reduce((weekTotal, component) => weekTotal + Number(component.points || 0), 0), 0),
  };
  module.moduleKsbMappings.forEach(mapping => addMapping(mapping, modulePlacement));
  module.weekStructure.forEach(week => {
    const weekLabel = week.title || `Week ${week.weekNumber}`;
    const weekPlacement = {
      label: weekLabel,
      scope: 'Week' as const,
      otjh: week.components.reduce((total, component) => total + Number(component.expectedOtjh || 0), 0),
      points: week.components.reduce((total, component) => total + Number(component.points || 0), 0),
    };
    week.ksbMappings.forEach(mapping => addMapping(mapping, weekPlacement));
    week.components.forEach(component => {
      const location = `${weekLabel} / ${readableComponentTitle(component.title) || 'Component'}`;
      const componentPlacement = {
        label: location,
        scope: 'Component' as const,
        otjh: Number(component.expectedOtjh || 0),
        points: Number(component.points || 0),
      };
      component.ksbMappings.forEach(mapping => addMapping(mapping, componentPlacement));
    });
  });

  return Array.from(rows.values()).filter(row => row.applied).sort((a, b) => {
    const codeSort = a.code.localeCompare(b.code, undefined, { numeric: true });
    if (codeSort) return codeSort;
    return a.source.localeCompare(b.source);
  });
}

function programmeKsbMapRows(modules: ModuleCatalogueItem[], sourceLabels: Record<string, string>, programmeName = ''): ModuleKsbMapRow[] {
  const rows = new Map<string, ModuleKsbMapRow>();
  const addMapping = (mapping: KsbMapping, placement: ModuleKsbPlacement) => {
    const location = placement.label;
    const code = String(mapping.code || '').trim().toUpperCase();
    if (!code) return;
    if (isLegacyModuleLevelKsbFallback(mapping, location)) return;
    const sourceFull = ksbSourceLabel(mapping, sourceLabels, programmeName);
    const source = conciseKsbSourceLabel(sourceFull);
    const key = `${code}::${normaliseDeepLinkValue(sourceFull) || normaliseDeepLinkValue(mapping.description) || 'source'}`;
    const current = rows.get(key) || {
      code,
      description: mapping.description || '',
      source,
      sourceFull,
      weight: 0,
      locations: [],
      placements: [],
      applied: true,
      classificationLabels: [],
    };
    current.weight += Number(mapping.weight || 0);
    const classification = ksbWeightClassLabel(mapping.weightClass || mapping.weight_class);
    if (classification && !current.classificationLabels.includes(classification)) current.classificationLabels.push(classification);
    if (!current.description && mapping.description) current.description = mapping.description;
    if (!current.locations.includes(location)) current.locations.push(location);
    if (!current.placements.some(item => item.label === placement.label && item.scope === placement.scope)) current.placements.push(placement);
    rows.set(key, current);
  };

  modules.forEach(module => {
    const moduleLabel = module.title || module.programmeName || 'Module';
    const modulePlacement = {
      label: `${moduleLabel} / Module`,
      scope: 'Module' as const,
      otjh: Number(module.declaredTotalOtjh ?? module.totalOtjh ?? 0) || 0,
      points: module.weekStructure.reduce((total, week) => total + week.components.reduce((weekTotal, component) => weekTotal + Number(component.points || 0), 0), 0),
    };
    module.moduleKsbMappings.forEach(mapping => addMapping(mapping, modulePlacement));
    module.weekStructure.forEach(week => {
      const weekLabel = week.title || `Week ${week.weekNumber}`;
      const weekPlacement = {
        label: `${moduleLabel} / ${weekLabel}`,
        scope: 'Week' as const,
        otjh: week.components.reduce((total, component) => total + Number(component.expectedOtjh || 0), 0),
        points: week.components.reduce((total, component) => total + Number(component.points || 0), 0),
      };
      week.ksbMappings.forEach(mapping => addMapping(mapping, weekPlacement));
      week.components.forEach(component => {
        const componentLabel = readableComponentTitle(component.title) || 'Component';
        const componentPlacement = {
          label: `${moduleLabel} / ${weekLabel} / ${componentLabel}`,
          scope: 'Component' as const,
          otjh: Number(component.expectedOtjh || 0),
          points: Number(component.points || 0),
        };
        component.ksbMappings.forEach(mapping => addMapping(mapping, componentPlacement));
      });
    });
  });

  return Array.from(rows.values()).filter(hasReadableKsbSource).sort((a, b) => {
    const codeSort = a.code.localeCompare(b.code, undefined, { numeric: true });
    if (codeSort) return codeSort;
    return a.source.localeCompare(b.source);
  });
}

function isLegacyModuleLevelKsbFallback(mapping: KsbMapping, location: string) {
  return (
    /\/ Module$/i.test(location) &&
    /^Mapped KSB\s+/i.test(String(mapping.description || '').trim())
  );
}

function hasReadableKsbSource(row: Pick<ModuleKsbMapRow, 'source' | 'sourceFull'>) {
  const source = String(row.source || '').trim().toLowerCase();
  const sourceFull = String(row.sourceFull || '').trim().toLowerCase();
  if (!source || source === 'no source' || !sourceFull || sourceFull === 'no source') return false;
  return !/^profile\s*-\s*ksbp-/i.test(row.source) && !/^ksb profile:\s*ksbp-/i.test(row.sourceFull);
}

function uniquePlacementOtjh(rows: ModuleKsbMapRow[]) {
  const placements = new Map<string, number>();
  rows.forEach(row => {
    row.placements.forEach(placement => {
      const key = `${placement.scope}:${placement.label}`;
      if (!placements.has(key)) placements.set(key, Number(placement.otjh || 0));
    });
  });
  return Array.from(placements.values()).reduce((total, value) => total + value, 0);
}

function formatKsbOtjh(value: number) {
  const amount = Number(value || 0);
  return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}h`;
}

function formatKsbWeight(value: number) {
  const amount = Number(value || 0);
  return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}%`;
}

function componentDisplayTitle(title: string) {
  return title.replace(/\s*(?:-|—)\s*Week\s*\d+\s*$/i, '').trim();
}

function readableComponentTitle(title: string) {
  const cleaned = componentDisplayTitle(title);
  if (!cleaned || /\s/.test(cleaned)) return cleaned;
  return cleaned
    .replace(/([A-Za-z])of([A-Z])/g, '$1 of $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function normaliseComponentTitles(module: ModuleCatalogueItem): ModuleCatalogueItem {
  return {
    ...module,
    weekStructure: module.weekStructure.map(week => ({
      ...week,
      components: week.components.map(component => ({
        ...component,
        title: readableComponentTitle(component.title) || component.title,
      })),
    })),
  };
}

function resizeWeeks(module: ModuleCatalogueItem, count: number, onChange: (updates: Partial<ModuleCatalogueItem>) => void) {
  const nextCount = Math.max(1, Math.round(count || 1));
  let weekStructure = module.weekStructure;
  if (nextCount > weekStructure.length) {
    weekStructure = [
      ...weekStructure,
      ...Array.from({ length: nextCount - weekStructure.length }, (_, index) => createEmptyWeek(module.id, weekStructure.length + index + 1)),
    ];
  } else {
    weekStructure = weekStructure.slice(0, nextCount);
  }
  onChange({ weekStructure, weeks: nextCount });
}

function removeWeekFromModule(module: ModuleCatalogueItem, weekId: string): ModuleCatalogueItem {
  const weekStructure = module.weekStructure
    .filter(week => week.id !== weekId)
    .map((week, index) => ({
      ...week,
      weekNumber: index + 1,
      title: /^Week\s+\d+$/i.test(week.title.trim()) ? `Week ${index + 1}` : week.title,
    }));
  return {
    ...module,
    weekStructure,
    weeks: weekStructure.length,
    sessionsNumber: weekStructure.length,
  };
}

// sessionsNumber is the calendar session count (weeks x delivery days per
// week) while weekStructure.length is the authored week count — a module
// delivered twice a week runs two live sessions per authored week, not one.
function moduleDeliveryDaysPerWeek(module: ModuleCatalogueItem) {
  const weeks = module.weekStructure.length || module.weeks || 0;
  if (!weeks) return 1;
  return Math.max(1, Math.round((module.sessionsNumber || weeks) / weeks));
}

// Weeks that don't yet carry one live-session component per delivery day —
// the ones "Generate live sessions" tops up. A week keeps whatever live
// sessions it already has (created, linked to Teams, or not), so this only
// ever adds the shortfall, never replaces or removes.
function liveSessionShortfallByWeek(module: ModuleCatalogueItem) {
  const perWeek = moduleDeliveryDaysPerWeek(module);
  return module.weekStructure
    .map(week => ({ week, shortfall: perWeek - week.components.filter(component => component.type === 'live-session').length }))
    .filter(entry => entry.shortfall > 0);
}

function weeksMissingLiveSession(module: ModuleCatalogueItem) {
  return liveSessionShortfallByWeek(module).map(entry => entry.week);
}

/**
 * Give every week its full set of live-session components — one per delivery
 * day — unattached to any Teams meeting yet. This is the explicit, opt-in
 * counterpart to the Teams tab's "Re-attach to components": that one
 * recreates missing live-session components from a meeting that already
 * exists, this one creates the placeholders before a meeting exists at all.
 * Weeks that already have enough live sessions are left untouched.
 */
function generateMissingLiveSessions(module: ModuleCatalogueItem): ModuleCatalogueItem {
  const shortfalls = liveSessionShortfallByWeek(module);
  if (!shortfalls.length) return module;
  const shortfallByWeekId = new Map(shortfalls.map(entry => [entry.week.id, entry.shortfall]));
  return {
    ...module,
    weekStructure: module.weekStructure.map(week => {
      const shortfall = shortfallByWeekId.get(week.id);
      if (!shortfall) return week;
      const existingLiveSessions = week.components.filter(component => component.type === 'live-session').length;
      const additions = Array.from({ length: shortfall }, (_, offset) => {
        const component = createNamedComponent(week, 'live-session', week.components.length + offset + 1);
        return { ...component, title: `${component.title} ${existingLiveSessions + offset + 1}` };
      });
      return { ...week, components: [...week.components, ...additions] };
    }),
  };
}

function countAddedLiveSessions(module: ModuleCatalogueItem) {
  return liveSessionShortfallByWeek(module).reduce((total, entry) => total + entry.shortfall, 0);
}

function createNamedComponent(week: ModuleWeek, type: ModuleComponentType, index = week.components.length + 1) {
  const component = createEmptyComponent(week.id, type, index);
  const label = componentTypes.find(item => item.type === type)?.label || 'Component';
  return {
    ...component,
    title: label,
    description: componentTypeDescription(type),
  };
}

function createNamedComponents(week: ModuleWeek, types: ModuleComponentType[]) {
  return types.map((type, index) => createNamedComponent(week, type, week.components.length + index + 1));
}

function componentTypeDescription(type: ModuleComponentType) {
  const descriptions: Record<ModuleComponentType, string> = {
    'live-session': 'Tutor-led session via Teams',
    video: 'Upload or link a video',
    podcast: 'Upload audio or podcast link',
    reading: 'PDF, Word, or typed text',
    powerpoint: 'Slide deck for the week',
    quiz: 'Short weekly check',
    assignment: 'Monthly submission task',
    reflection: 'Learner written reflection',
    checkpoint: 'End-of-month KSB check',
    'monthly-ksb-quiz': 'Tracks KSB progression',
    'coaching-preparation': 'Monthly coaching meeting prep',
    'recording-placeholder': 'Teams recording placeholder',
    'workplace-evidence': 'Workplace evidence upload',
  };
  return descriptions[type] || 'Add a component';
}

function nextModuleNumber(modules: ModuleCatalogueItem[]) {
  const numbers = modules.flatMap(module => {
    const text = `${module.title} ${module.catalogueId}`;
    const matches = Array.from(text.matchAll(/\b(?:M|Module)\s*-?\s*(\d+)\b/gi));
    return matches.map(match => Number(match[1])).filter(Number.isFinite);
  });
  return Math.max(modules.length, 0, ...numbers) + 1;
}

function componentToneClasses(tone = 'slate') {
  const map: Record<string, { soft: string; text: string; ring: string }> = {
    violet: { soft: 'bg-violet-100', text: 'text-violet-700', ring: 'border-violet-200' },
    slate: { soft: 'bg-slate-100', text: 'text-slate-700', ring: 'border-slate-200' },
    rose: { soft: 'bg-rose-100', text: 'text-rose-700', ring: 'border-rose-200' },
    amber: { soft: 'bg-amber-100', text: 'text-amber-700', ring: 'border-amber-200' },
    emerald: { soft: 'bg-emerald-100', text: 'text-emerald-700', ring: 'border-emerald-200' },
    orange: { soft: 'bg-orange-100', text: 'text-orange-700', ring: 'border-orange-200' },
    sky: { soft: 'bg-sky-100', text: 'text-sky-700', ring: 'border-sky-200' },
    purple: { soft: 'bg-purple-100', text: 'text-purple-700', ring: 'border-purple-200' },
    teal: { soft: 'bg-teal-100', text: 'text-teal-700', ring: 'border-teal-200' },
    lime: { soft: 'bg-lime-100', text: 'text-lime-700', ring: 'border-lime-200' },
    blue: { soft: 'bg-blue-100', text: 'text-blue-700', ring: 'border-blue-200' },
    pink: { soft: 'bg-pink-100', text: 'text-pink-700', ring: 'border-pink-200' },
  };
  return map[tone] || map.slate;
}

function lines(value: string) {
  return value.split('\n').map(item => item.trim()).filter(Boolean);
}

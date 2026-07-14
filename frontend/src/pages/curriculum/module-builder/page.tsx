import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { useCurriculumModules } from '@/hooks/useCurriculumModules';
import { useCurriculumKsbSets } from '@/hooks/useCurriculumKsbSets';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { curriculumNavItems } from '@/mocks/navigation';
import { fetchCurriculumStandards, type CurriculumKsbSet, type CurriculumProgramme, type CurriculumStandard } from '@/lib/curriculumApi';
import {
  calculateQualityChecklist,
  componentTypeGroups,
  componentTypes,
  createEmptyComponent,
  createEmptyWeek,
  createNewModule,
  deleteModuleStructure,
  curriculumModuleToCatalogue,
  duplicateModuleStructure,
  flattenKsbEntries,
  getDefaultStructure,
  loadModuleStructure,
  loadLocalModules,
  loadSavedModuleStructure,
  makeAuthoringId,
  recalculateModule,
  saveLocalModules,
  saveModuleStructure,
  wizardDraftLocalIdFromKey,
  writeModuleBuilderSync,
  type AdvancedModuleDetails,
  type CompletionCriteria,
  type KsbMapping,
  type KsbMappingType,
  type KsbOption,
  type ModuleCatalogueItem,
  type ModuleComponent,
  type ModuleComponentType,
  type ModuleWeek,
} from './moduleAuthoringData';

type Selection =
  | { kind: 'week'; weekId: string }
  | { kind: 'component'; weekId: string; componentId: string };

type KsbTarget =
  | { scope: 'module' }
  | { scope: 'week'; weekId: string }
  | { scope: 'component'; weekId: string; componentId: string };

type DragState =
  | { type: 'week'; weekId: string }
  | { type: 'component'; weekId: string; componentId: string }
  | null;

type NewModuleInput = {
  programme: string;
  programmeId?: string;
  title: string;
  description: string;
  sessionsNumber: number;
  startDate: string;
  endDate: string;
};

type ModuleDeliveryUsage = {
  id: string;
  moduleId: string;
  sourceId: string;
  catalogueId: string;
  structureId: string;
  programmeId: string;
  programme: string;
  moduleTitle: string;
  cohort: string;
  group: string;
  deliveryStatus: string;
  startDate?: string;
  endDate?: string;
  sessions: number;
};

type ModuleBuilderListItem = ModuleCatalogueItem & {
  deliveryUsages?: ModuleDeliveryUsage[];
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

type WizardModuleDraftPayload = {
  programmeId?: string;
  programme?: string;
  cohortId?: string;
  cohortName?: string;
  groupId?: string;
  groupName?: string;
  title?: string;
  description?: string;
  sessionsNumber?: number;
  startDate?: string;
  endDate?: string;
};

const statusFilters = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Draft' },
  { key: 'review', label: 'In Review' },
];

function wait(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function moduleSnapshot(module: ModuleCatalogueItem | null) {
  return module ? JSON.stringify(recalculateModule(module)) : '';
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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [programmeFilter, setProgrammeFilter] = useState<string>('All');
  const [workingModule, setWorkingModule] = useState<ModuleCatalogueItem | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creatingQuickModule, setCreatingQuickModule] = useState(false);
  const [creatingQuickModuleComplete, setCreatingQuickModuleComplete] = useState(false);
  const [openingModule, setOpeningModule] = useState<{ title: string; mode: 'builder' | 'settings' } | null>(null);
  const [openingModuleComplete, setOpeningModuleComplete] = useState(false);
  const [duplicatingModule, setDuplicatingModule] = useState<ModuleCatalogueItem | null>(null);
  const [duplicatingModuleComplete, setDuplicatingModuleComplete] = useState(false);
  const [quickCreateRetryInput, setQuickCreateRetryInput] = useState<NewModuleInput | null>(null);
  const [quickCreateError, setQuickCreateError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deletingModuleId, setDeletingModuleId] = useState<string | null>(null);
  const [hiddenModuleIds, setHiddenModuleIds] = useState<Set<string>>(new Set());
  const [saveSuccess, setSaveSuccess] = useState<{ title: string; message: string } | null>(null);
  const [noticeAlert, setNoticeAlert] = useState<{ title: string; message: string } | null>(null);
  const [lessonPickerWeekId, setLessonPickerWeekId] = useState<string | null>(null);
  const [ksbTarget, setKsbTarget] = useState<KsbTarget | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [localModules, setLocalModules] = useState<ModuleCatalogueItem[]>(() => loadLocalModules());
  const [quizPackages, setQuizPackages] = useState<QuizPackageSummary[]>([]);
  const [quizzesLoading, setQuizzesLoading] = useState(false);
  const [standards, setStandards] = useState<CurriculumStandard[]>([]);
  const [standardsLoading, setStandardsLoading] = useState(false);
  const [storageVersion, setStorageVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveStartedAt, setSaveStartedAt] = useState<number | null>(null);
  const [saveElapsedSeconds, setSaveElapsedSeconds] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const deepLinkedModuleRef = useRef('');
  const wizardDraftLocalIdRef = useRef('');
  const savedModuleSnapshotRef = useRef('');
  const { modules, loading, error, reload } = useCurriculumModules();
  const { programmes: curriculumProgrammes } = useCurriculumProgrammes();
  const { ksbSets, loading: ksbSetsLoading } = useCurriculumKsbSets();
  const liveCurriculumProgrammes = useMemo(
    () => curriculumProgrammes.filter(programme => String(programme.status || '').toLowerCase() !== 'archived'),
    [curriculumProgrammes],
  );

  const catalogueModules = useMemo(() => {
    void storageVersion;
    const remoteModules = modules.map(module => {
      const base = curriculumModuleToCatalogue(module);
      const saved = loadSavedModuleStructure(moduleStructureIdentifier(base)) || loadSavedModuleStructure(base.catalogueId);
      return saved ? recalculateModule({ ...saved, sourceModule: module }) : base;
    });
    return buildMasterModuleList(remoteModules, localModules.map(module => recalculateModule(module)))
      .filter(module => !hiddenModuleIds.has(module.catalogueId));
  }, [modules, localModules, storageVersion, hiddenModuleIds]);

  const programmeOptions = useMemo(() => {
    const byName = new Map<string, string>();
    const addName = (value: unknown) => {
      const name = String(value || '').trim();
      if (!name) return;
      byName.set(normaliseDeepLinkValue(name) || name.toLowerCase(), name);
    };
    curriculumProgrammes.forEach(programme => addName(programme.name));
    catalogueModules.forEach(module => addName(module.programmeName));
    return ['All', ...Array.from(byName.values()).sort((a, b) => a.localeCompare(b))];
  }, [catalogueModules, curriculumProgrammes]);

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
    const standard = standardForModule(standards, workingModule, curriculumProgrammes);
    if (standard) return ksbStandardSourceId(standard);
    const ksbSet = ksbSetForModule(ksbSets, workingModule, curriculumProgrammes);
    return ksbSet ? ksbSetSourceId(ksbSet) : '';
  }, [curriculumProgrammes, ksbSets, standards, workingModule]);

  const filtered = catalogueModules.filter(module => {
    const text = `${module.title} ${module.catalogueId} ${module.programmeName} ${moduleIdentityText(module)} ${moduleDeliverySearchText(module)}`.toLowerCase();
    if (search && !text.includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && module.status !== statusFilter) return false;
    if (programmeFilter !== 'All' && module.programmeName !== programmeFilter) return false;
    return true;
  });

  const published = catalogueModules.filter(module => module.status === 'published').length;
  const draftCount = catalogueModules.filter(module => module.status === 'draft').length;
  const totalLessons = catalogueModules.reduce((total, module) => total + (module.lessonCount || 0), 0);
  const totalDeliveryUses = catalogueModules.reduce((total, module) => total + (module.deliveryUsages?.length || 0), 0);

  const selectedWeek = workingModule?.weekStructure.find(week => week.id === selection?.weekId) || null;
  const selectedComponent =
    selection?.kind === 'component'
      ? selectedWeek?.components.find(component => component.id === selection.componentId) || null
      : null;
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
      const cached = loadSavedModuleStructure(structureId) || loadSavedModuleStructure(module.catalogueId);
      const next = recalculateModule(cached ? { ...cached, sourceModule: module.sourceModule || cached.sourceModule } : getDefaultStructure(module));
      savedModuleSnapshotRef.current = moduleSnapshot(next);
      setWorkingModule(next);
      setSelection(next.weekStructure[0] ? { kind: 'week', weekId: next.weekStructure[0].id } : null);
      setExpandedWeeks(new Set(next.weekStructure.map(week => week.id)));
      setSettingsOpen(openSettings);
      if ((next as ModuleCatalogueItem & { localFallback?: boolean }).localFallback) {
        setNoticeAlert({
          title: 'Loaded locally',
          message: 'Backend sync is unavailable, so this module was loaded from local storage.',
        });
      }
      await finishLoadingProgress(setOpeningModuleComplete);
      void loadModuleStructure(structureId).then(remote => {
        if (!remote) return;
        const synced = recalculateModule({ ...remote, sourceModule: module.sourceModule || remote.sourceModule });
        setWorkingModule(current => {
          if (!current || moduleStructureIdentifier(current) !== structureId) return current;
          savedModuleSnapshotRef.current = moduleSnapshot(synced);
          return synced;
        });
        setSelection(current => {
          if (current && synced.weekStructure.some(week => week.id === current.weekId)) return current;
          return synced.weekStructure[0] ? { kind: 'week', weekId: synced.weekStructure[0].id } : null;
        });
        setExpandedWeeks(new Set(synced.weekStructure.map(week => week.id)));
      }).catch(err => {
        const message = err instanceof Error ? err.message : 'Unable to refresh module structure.';
        setNoticeAlert({
          title: 'Module opened',
          message: `Opened from the available structure. Background refresh did not complete: ${message}`,
        });
      });
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to load module structure.');
    } finally {
      setOpeningModule(null);
      setOpeningModuleComplete(false);
    }
  }, [finishLoadingProgress]);

  useEffect(() => {
    const controller = new AbortController();
    setQuizzesLoading(true);
    fetch('/quiz_api/quizzes/?status=all&assessmentType=quiz', { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Unable to load quizzes (${response.status})`);
        return response.json();
      })
      .then(data => {
        const results = Array.isArray(data?.results) ? data.results : [];
        setQuizPackages(results);
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.warn('Unable to load LMS quizzes.', error);
      })
      .finally(() => setQuizzesLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
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
  }, []);

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
    const requestedModule = params.get('module') || params.get('moduleId') || params.get('catalogueId') || params.get('moduleTitle') || '';
    const wizardModuleKey = params.get('wizardModule') || '';
    if (wizardModuleKey && !wizardDraftLocalIdRef.current) {
      wizardDraftLocalIdRef.current = wizardDraftLocalIdFromKey(wizardModuleKey);
    }
    const requestedKey = requestedModule.trim();
    if (!requestedKey || loading || workingModule || deepLinkedModuleRef.current === requestedKey) return;

    const requestedNormalised = normaliseDeepLinkValue(requestedKey);
    const target = catalogueModules.find(module => {
      const identifiers = moduleDeepLinkIdentifiers(module);
      const titles = [module.title, module.sourceModule?.name];
      return identifiers.some(value => value === requestedKey)
        || titles.some(value => normaliseDeepLinkValue(value) === requestedNormalised);
    });

    if (!target) {
      const wizardPayload = readWizardModuleDraft(wizardModuleKey);
      if (wizardPayload?.title) {
        deepLinkedModuleRef.current = requestedKey;
        setOpeningModule({ title: wizardPayload.title, mode: 'builder' });
        setOpeningModuleComplete(false);
        setActionMessage(null);
        setNoticeAlert(null);
        void createNewModule({
          programmeId: wizardPayload.programmeId || '',
          programme: wizardPayload.programme || (programmeFilter !== 'All' ? programmeFilter : 'Unassigned programme'),
          cohortId: wizardPayload.cohortId || '',
          cohortName: wizardPayload.cohortName || '',
          groupId: wizardPayload.groupId || '',
          groupName: wizardPayload.groupName || '',
          title: wizardPayload.title,
          description: wizardPayload.description || '',
          weeks: Math.max(1, Math.round(Number(wizardPayload.sessionsNumber) || 1)),
          sessionsNumber: Math.max(1, Math.round(Number(wizardPayload.sessionsNumber) || 1)),
          startDate: wizardPayload.startDate || todayDateInput(),
          endDate: wizardPayload.endDate || '',
          status: 'draft',
        }).then(async module => {
          const nextModule = recalculateModule(module);
          if ((nextModule as ModuleCatalogueItem & { localFallback?: boolean }).localFallback) {
            const nextLocalModules = [...localModules.filter(item => item.catalogueId !== nextModule.catalogueId), nextModule];
            setLocalModules(nextLocalModules);
            saveLocalModules(nextLocalModules);
            setNoticeAlert({
              title: 'Saved locally',
              message: `${nextModule.title} was opened locally because backend sync is unavailable.`,
            });
          } else {
            setNoticeAlert({
              title: 'Module created',
              message: `${nextModule.title} was created in Module Builder and saved to the database.`,
            });
            reload({ silent: true });
          }
          savedModuleSnapshotRef.current = moduleSnapshot(nextModule);
          setWorkingModule(nextModule);
          setSelection(nextModule.weekStructure[0] ? { kind: 'week', weekId: nextModule.weekStructure[0].id } : null);
          setExpandedWeeks(new Set(nextModule.weekStructure.map(week => week.id)));
          setSettingsOpen(false);
          writeModuleBuilderSync(nextModule, wizardDraftLocalIdRef.current);
          await finishLoadingProgress(setOpeningModuleComplete);
        }).catch(err => {
          setActionMessage(err instanceof Error ? err.message : 'Unable to create module from Curriculum Studio.');
        }).finally(() => {
          setOpeningModule(null);
          setOpeningModuleComplete(false);
        });
        if (wizardModuleKey) window.localStorage.removeItem(wizardModuleKey);
        return;
      }
      if (catalogueModules.length) {
        deepLinkedModuleRef.current = requestedKey;
        setActionMessage(`Unable to find module "${requestedKey}" in Module Builder.`);
      }
      return;
    }

    deepLinkedModuleRef.current = requestedKey;
    openModule(target);
  }, [catalogueModules, finishLoadingProgress, loading, localModules, openModule, programmeFilter, reload, workingModule]);

  const updateWorkingModule = useCallback((updater: (module: ModuleCatalogueItem) => ModuleCatalogueItem) => {
    setSaveSuccess(null);
    setActionMessage(null);
    setWorkingModule(current => (current ? recalculateModule(updater(current)) : current));
  }, []);

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
        setExpandedWeeks(current => {
          const next = new Set(current);
          next.delete(weekId);
          return next;
        });
        setDragState(null);
        if (lessonPickerWeekId === weekId) setLessonPickerWeekId(null);
        if (selection?.weekId === weekId) {
          setSelection(nextSelectedWeek ? { kind: 'week', weekId: nextSelectedWeek.id } : null);
        }
      },
    });
  };

  const confirmDeleteComponent = async (weekId: string, componentId: string) => {
    const component = workingModule?.weekStructure.find(week => week.id === weekId)?.components.find(item => item.id === componentId);
    const title = component?.title || 'this component';

    await showBuilderDeleteSwal({
      title: 'Delete component?',
      message: `${title} will be removed from this week.`,
      confirmButtonText: 'Delete component',
      processingText: 'Deleting component...',
      successTitle: 'Component deleted',
      successText: `${title} was removed successfully.`,
      onConfirm: async () => {
        await wait(550);
        updateWorkingModule(module => ({
          ...module,
          weekStructure: module.weekStructure.map(week => (week.id === weekId ? { ...week, components: week.components.filter(componentItem => componentItem.id !== componentId) } : week)),
        }));
        setSelection({ kind: 'week', weekId });
      },
    });
  };

  const persistWorkingModule = async () => {
    if (!workingModule) return;
    setSaving(true);
    setSaveStartedAt(Date.now());
    setActionMessage(null);
    setSaveSuccess(null);
    const moduleToSave = recalculateModule(normaliseComponentTitles(workingModule));
    try {
      setWorkingModule(moduleToSave);
      const saved = await saveModuleStructure(moduleToSave.catalogueId, moduleToSave);
      if (localModules.some(module => module.catalogueId === saved.catalogueId)) {
        const nextLocal = localModules.map(module => (module.catalogueId === saved.catalogueId ? saved : module));
        setLocalModules(nextLocal);
        saveLocalModules(nextLocal);
      }
      setWorkingModule(saved);
      savedModuleSnapshotRef.current = moduleSnapshot(saved);
      setStorageVersion(version => version + 1);
      writeModuleBuilderSync(saved, wizardDraftLocalIdRef.current);
      const savedLocally = Boolean((saved as ModuleCatalogueItem & { localFallback?: boolean }).localFallback);
      setActionMessage(null);
      setSaveSuccess({
        title: savedLocally ? 'Saved locally' : 'Module saved',
        message: wizardDraftLocalIdRef.current
          ? 'Module structure saved and synced back to the curriculum wizard.'
          : savedLocally ? 'Your module changes are saved locally. Returning to the modules list.' : 'Module structure saved successfully. Returning to the modules list.',
      });
      reload();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to save module structure.');
    } finally {
      setSaving(false);
      setSaveStartedAt(null);
    }
  };

  const duplicateModule = async (module: ModuleCatalogueItem) => {
    setDuplicatingModule(module);
    setDuplicatingModuleComplete(false);
    setActionMessage(null);
    setNoticeAlert(null);
    try {
      const source = getDefaultStructure((await loadModuleStructure(moduleStructureIdentifier(module))) || loadSavedModuleStructure(module.catalogueId) || module);
      const duplicate = await duplicateModuleStructure(source);
      if ((duplicate as ModuleCatalogueItem & { localFallback?: boolean }).localFallback) {
        const nextLocal = [...localModules.filter(item => item.catalogueId !== duplicate.catalogueId), duplicate];
        setLocalModules(nextLocal);
        saveLocalModules(nextLocal);
        setNoticeAlert({
          title: 'Saved locally',
          message: `${duplicate.title} was duplicated locally because backend sync is unavailable.`,
        });
      } else {
        setNoticeAlert({
          title: 'Module duplicated',
          message: `${duplicate.title} was created as a draft with its authoring structure.`,
        });
        reload();
      }
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
      const nextLocal = localModules.filter(item => item.catalogueId !== module.catalogueId);
      setLocalModules(nextLocal);
      saveLocalModules(nextLocal);
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

  const createModule = async (input: { programme: string; programmeId?: string; title: string; description: string; weeks: number; status: string }, options: { openSettings?: boolean } = {}) => {
    setActionMessage(null);
    setNoticeAlert(null);
    try {
      const programmeIdentity = resolveProgrammeIdentity(input.programme, input.programmeId);
      const module = await createNewModule({
        ...input,
        programme: programmeIdentity.programmeName,
        programmeId: programmeIdentity.programmeId,
      });
      if ((module as ModuleCatalogueItem & { localFallback?: boolean }).localFallback) {
        const nextLocal = [...localModules.filter(item => item.catalogueId !== module.catalogueId), module];
        setLocalModules(nextLocal);
        saveLocalModules(nextLocal);
        setNoticeAlert({
          title: 'Saved locally',
          message: `${module.title} was created locally because backend sync is unavailable.`,
        });
      } else {
        setActionMessage(null);
        reload();
      }
      setCreateOpen(false);
      await openModule(module, Boolean(options.openSettings));
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to create module.');
      throw err;
    }
  };

  const createQuickModule = async (input?: NewModuleInput) => {
    if (creatingQuickModule) return;
    const availableProgrammes = programmeOptions.filter(option => option !== 'All');
    const programme = input?.programme || (programmeFilter !== 'All' ? programmeFilter : availableProgrammes[0] || 'Unassigned programme');
    const title = input?.title?.trim() || nextModuleTitle(catalogueModules);
    const description = input?.description || '';
    const sessionsNumber = Math.max(1, Math.round(Number(input?.sessionsNumber) || 1));
    const startDate = input?.startDate || todayDateInput();
    const endDate = input?.endDate || calculateWeeklyEndDate(startDate, sessionsNumber);
    const programmeIdentity = resolveProgrammeIdentity(programme, input?.programmeId);
    setCreatingQuickModule(true);
    setCreatingQuickModuleComplete(false);
    setQuickCreateRetryInput({ programme: programmeIdentity.programmeName, programmeId: programmeIdentity.programmeId, title, description, sessionsNumber, startDate, endDate });
    setQuickCreateError(null);
    setActionMessage(null);
    try {
      const module = await createNewModule({
        programme: programmeIdentity.programmeName,
        programmeId: programmeIdentity.programmeId,
        title,
        description,
        weeks: sessionsNumber,
        sessionsNumber,
        startDate,
        endDate,
        status: 'draft',
      });
      const nextModule = recalculateModule(module);
      if ((nextModule as ModuleCatalogueItem & { localFallback?: boolean }).localFallback) {
        const nextLocal = [...localModules.filter(item => item.catalogueId !== nextModule.catalogueId), nextModule];
        setLocalModules(nextLocal);
        saveLocalModules(nextLocal);
      }
      savedModuleSnapshotRef.current = moduleSnapshot(nextModule);
      setWorkingModule(nextModule);
      setSelection(null);
      setExpandedWeeks(new Set());
      setSettingsOpen(false);
      setPreviewOpen(false);
      setLessonPickerWeekId(null);
      setCreateOpen(false);
      setQuickCreateRetryInput(null);
      setActionMessage(null);
      reload({ silent: true });
      await finishLoadingProgress(setCreatingQuickModuleComplete);
    } catch (err) {
      setQuickCreateError(err instanceof Error ? err.message : 'Unable to create module.');
      setActionMessage(null);
    } finally {
      setCreatingQuickModule(false);
      setCreatingQuickModuleComplete(false);
    }
  };

  const closeWorkingModule = () => {
    savedModuleSnapshotRef.current = '';
    setWorkingModule(null);
    setSelection(null);
    setSettingsOpen(false);
    setPreviewOpen(false);
    setLessonPickerWeekId(null);
    setSaveSuccess(null);
    setNoticeAlert(null);
    setActionMessage(null);
  };

  const requestCloseWorkingModule = async () => {
    if (saving) return;
    if (!hasUnsavedWorkingModuleChanges) {
      closeWorkingModule();
      return;
    }
    await showCurriculumConfirm({
      title: 'Discard unsaved changes?',
      text: 'You have edits in this module that have not been saved yet. Continue editing to keep them, or discard to go back.',
      icon: 'warning',
      confirmButtonText: 'Discard changes',
      cancelButtonText: 'Continue editing',
      onConfirm: async () => {
        closeWorkingModule();
      },
    });
  };

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

  useEffect(() => {
    if (!saveSuccess) return;
    let active = true;
    showCurriculumAlert({
      title: saveSuccess.title,
      text: saveSuccess.message,
      icon: 'success',
      timer: 3200,
      confirmButtonText: 'Back to modules',
    }).finally(() => {
      if (active) closeWorkingModule();
    });
    return () => {
      active = false;
    };
  }, [saveSuccess]);

  useEffect(() => {
    if (!quickCreateError) return;
    let active = true;
    const retryInput = quickCreateRetryInput;
    showCurriculumConfirm({
      title: 'Module was not created',
      text: quickCreateError,
      icon: 'error',
      confirmButtonText: 'Try again',
      cancelButtonText: 'Close',
      onConfirm: async () => undefined,
    }).then(confirmed => {
      if (!active) return;
      setQuickCreateError(null);
      if (confirmed) createQuickModule(retryInput || undefined);
    });
    return () => {
      active = false;
    };
  }, [quickCreateError, quickCreateRetryInput]);

  if (workingModule) {
    return (
      <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Module Builder" pageSubtitle={`${workingModule.title} - authoring workspace`} userName="Rachel Myers" userRole="Curriculum Designer">
        <div className="min-h-[calc(100vh-96px)] bg-background-100 px-3 py-4 sm:px-5 lg:px-6">
          <div className="mx-auto flex w-full max-w-[1840px] flex-col gap-4">
          <WorkspaceHeader
            module={workingModule}
            modules={[workingModule, ...catalogueModules.filter(module => module.catalogueId !== workingModule.catalogueId)]}
            programmeOptions={programmeOptions.filter(option => option !== 'All')}
            saving={saving}
            saved={!hasUnsavedWorkingModuleChanges}
            onBack={() => { void requestCloseWorkingModule(); }}
            onProgrammeChange={programmeName => updateWorkingModule(module => {
              const programmeIdentity = resolveProgrammeIdentity(programmeName, module.programmeId);
              return { ...module, programmeName: programmeIdentity.programmeName, programmeId: programmeIdentity.programmeId };
            })}
            onModuleChange={catalogueId => {
              const module = catalogueModules.find(item => item.catalogueId === catalogueId);
              if (module) openModule(module);
            }}
            onStatusChange={status => updateWorkingModule(module => ({ ...module, status }))}
          />

          {(saving || saveSuccess || (actionMessage && !deletingModuleId)) && (
            <SaveStatusPanel
              saving={saving}
              elapsedSeconds={saveElapsedSeconds}
              success={saveSuccess}
              error={actionMessage && !deletingModuleId ? actionMessage : null}
              module={workingModule}
            />
          )}

          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)_290px] 2xl:grid-cols-[320px_minmax(760px,1fr)_310px]">
            <CourseStructure
              module={workingModule}
              selection={selection}
              expandedWeeks={expandedWeeks}
              dragState={dragState}
              onDragState={setDragState}
              onToggleWeek={weekId => {
                setExpandedWeeks(current => {
                  const next = new Set(current);
                  next.has(weekId) ? next.delete(weekId) : next.add(weekId);
                  return next;
                });
              }}
              onSelectWeek={weekId => setSelection({ kind: 'week', weekId })}
              onSelectComponent={(weekId, componentId) => setSelection({ kind: 'component', weekId, componentId })}
              onAddWeek={() => {
                const week = createEmptyWeek(workingModule.id, workingModule.weekStructure.length + 1);
                updateWorkingModule(module => ({ ...module, weekStructure: [...module.weekStructure, week] }));
                setExpandedWeeks(current => new Set([...current, week.id]));
                setSelection({ kind: 'week', weekId: week.id });
              }}
              onDeleteWeek={weekId => {
                void confirmDeleteWeek(weekId);
              }}
              onAddComponent={(weekId, type) => {
                const week = workingModule.weekStructure.find(item => item.id === weekId);
                if (!week) return;
                const component = createNamedComponent(week, type);
                updateWorkingModule(module => ({
                  ...module,
                  weekStructure: module.weekStructure.map(item => (item.id === weekId ? { ...item, components: [...item.components, component] } : item)),
                }));
                setExpandedWeeks(current => new Set([...current, weekId]));
                setSelection({ kind: 'component', weekId, componentId: component.id });
              }}
              onDeleteComponent={(weekId, componentId) => {
                void confirmDeleteComponent(weekId, componentId);
              }}
              onDuplicateComponent={(weekId, componentId) => {
                const week = workingModule.weekStructure.find(item => item.id === weekId);
                const component = week?.components.find(item => item.id === componentId);
                if (!component) return;
                const duplicate = cloneComponentForWeek(component, weekId, `${componentDisplayTitle(component.title)} copy`);
                updateWorkingModule(module => ({
                  ...module,
                  weekStructure: module.weekStructure.map(item => (item.id === weekId ? { ...item, components: [...item.components, duplicate] } : item)),
                }));
                setSelection({ kind: 'component', weekId, componentId: duplicate.id });
              }}
              onAutoCheckpoints={() => {
                updateWorkingModule(module => ({
                  ...module,
                  weekStructure: module.weekStructure.map((week, index) => {
                    if ((index + 1) % 4 !== 0) return week;
                    return {
                      ...week,
                      components: [...week.components, { ...createEmptyComponent(week.id, 'checkpoint', week.components.length + 1), title: `Month ${Math.ceil((index + 1) / 4)} checkpoint` }],
                    };
                  }),
                }));
              }}
              onDropReorder={(targetWeekId, targetComponentId) => {
                if (!dragState) return;
                if (dragState.type === 'week') {
                  updateWorkingModule(module => ({ ...module, weekStructure: moveById(module.weekStructure, dragState.weekId, targetWeekId) }));
                } else {
                  updateWorkingModule(module => ({ ...module, weekStructure: moveComponent(module.weekStructure, dragState, targetWeekId, targetComponentId) }));
                }
                setDragState(null);
              }}
            />

            <div className="min-w-0">
              {selectedComponent && selectedWeek ? (
                <ComponentEditor
                  component={selectedComponent}
                  module={workingModule}
                  week={selectedWeek}
                  availableModules={catalogueModules}
                  liveProgrammes={liveCurriculumProgrammes}
                  quizzes={quizPackages}
                  quizzesLoading={quizzesLoading}
                  onChange={updates => updateWorkingModule(module => ({
                    ...module,
                    weekStructure: module.weekStructure.map(week => week.id === selectedWeek.id ? {
                      ...week,
                      components: week.components.map(component => component.id === selectedComponent.id ? { ...component, ...updates } : component),
                    } : week),
                  }))}
                  onSettingChange={(key, value) => updateWorkingModule(module => ({
                    ...module,
                    weekStructure: module.weekStructure.map(week => week.id === selectedWeek.id ? {
                      ...week,
                      components: week.components.map(component => component.id === selectedComponent.id ? { ...component, settings: { ...component.settings, [key]: value } } : component),
                    } : week),
                  }))}
                  onAddKsb={() => setKsbTarget({ scope: 'component', weekId: selectedWeek.id, componentId: selectedComponent.id })}
                  onRemoveKsb={mappingId => updateWorkingModule(module => removeKsbMapping(module, { scope: 'component', weekId: selectedWeek.id, componentId: selectedComponent.id }, mappingId))}
                />
              ) : selectedWeek ? (
                <WeekEditor
                  week={selectedWeek}
                  dragState={dragState}
                  onDragState={setDragState}
                  onSelectComponent={componentId => setSelection({ kind: 'component', weekId: selectedWeek.id, componentId })}
                  onDropReorder={targetComponentId => {
                    if (!dragState || dragState.type !== 'component') return;
                    updateWorkingModule(module => ({ ...module, weekStructure: moveComponent(module.weekStructure, dragState, selectedWeek.id, targetComponentId) }));
                    setDragState(null);
                  }}
                  onChange={updates => updateWorkingModule(module => ({
                    ...module,
                    weekStructure: module.weekStructure.map(week => week.id === selectedWeek.id ? { ...week, ...updates } : week),
                  }))}
                  onApplyTemplate={() => {
                    const template = createWeekTemplateComponents(selectedWeek, { skipExistingTypes: true });
                    updateWorkingModule(module => ({
                      ...module,
                      weekStructure: module.weekStructure.map(week => week.id === selectedWeek.id ? { ...week, components: [...week.components, ...template] } : week),
                    }));
                  }}
                  onAddLesson={() => {
                    setLessonPickerWeekId(selectedWeek.id);
                  }}
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
              onAddKsb={target => setKsbTarget(target)}
              onRemoveKsb={(target, mappingId) => updateWorkingModule(module => removeKsbMapping(module, target, mappingId))}
              onUpdateKsbWeight={(target, mappingId, weight) => updateWorkingModule(module => updateKsbMappingWeight(module, target, mappingId, weight))}
            />
          </div>
          <WorkspaceActionFooter
            saving={saving}
            saved={!hasUnsavedWorkingModuleChanges}
            onPreview={() => setPreviewOpen(true)}
            onSettings={() => setSettingsOpen(true)}
            onDelete={() => confirmDeleteModule(workingModule)}
            onSave={persistWorkingModule}
          />
          </div>
        </div>

        {settingsOpen && (
          <ModuleSettingsModal
            module={workingModule}
            saving={saving}
            saved={Boolean(saveSuccess)}
            onClose={() => setSettingsOpen(false)}
            onSave={persistWorkingModule}
            onChange={updates => updateWorkingModule(module => ({ ...module, ...updates }))}
            onCompletionChange={updates => updateWorkingModule(module => ({ ...module, completionCriteria: { ...module.completionCriteria, ...updates } }))}
            onAdvancedChange={updates => updateWorkingModule(module => ({ ...module, advancedDetails: { ...module.advancedDetails, ...updates } }))}
            onAddKsb={() => setKsbTarget({ scope: 'module' })}
            onRemoveKsb={mappingId => updateWorkingModule(module => removeKsbMapping(module, { scope: 'module' }, mappingId))}
            onUpdateKsbWeight={(mappingId, weight) => updateWorkingModule(module => updateKsbMappingWeight(module, { scope: 'module' }, mappingId, weight))}
          />
        )}
        {previewOpen && <PreviewModal module={workingModule} onClose={() => setPreviewOpen(false)} />}
        {lessonPickerWeekId && (
          <LessonTypeModal
            onClose={() => setLessonPickerWeekId(null)}
            onSelect={type => {
              const week = workingModule.weekStructure.find(item => item.id === lessonPickerWeekId);
              if (!week) return;
              const component = createNamedComponent(week, type);
              updateWorkingModule(module => ({
                ...module,
                weekStructure: module.weekStructure.map(item => item.id === week.id ? { ...item, components: [...item.components, component] } : item),
              }));
              setSelection({ kind: 'component', weekId: week.id, componentId: component.id });
              setExpandedWeeks(current => new Set([...current, week.id]));
              setLessonPickerWeekId(null);
            }}
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
        {creatingQuickModule && <CreatingModuleAlert complete={creatingQuickModuleComplete} />}
        {ksbTarget && (
          <KsbSelectorModal
            standards={standards}
            standardsLoading={standardsLoading}
            ksbSets={ksbSets}
            ksbSetsLoading={ksbSetsLoading}
            initialSourceId={initialKsbSourceId}
            onClose={() => setKsbTarget(null)}
            onAddMany={(items) => {
              updateWorkingModule(module => items.reduce(
                (current, item) => addKsbMapping(current, ksbTarget, item.option, item.weight),
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
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Module Builder" pageSubtitle={`${catalogueModules.length} modules - ${published} published - ${draftCount} draft - ${totalLessons} sessions`} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-layout-4-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Module Builder</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                {loading ? 'Loading live LMS modules...' : 'Design and manage learning modules with sessions and KSB mapping from the LMS database'}
              </p>
            </div>
            <button onClick={() => setCreateOpen(true)} disabled={saving || creatingQuickModule} className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-xl text-[12px] font-semibold hover:bg-white/30 transition-smooth cursor-pointer whitespace-nowrap disabled:cursor-wait disabled:opacity-70">
              {creatingQuickModule ? (
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true"></span>
              ) : (
                <i className="ri-add-line"></i>
              )}
              {creatingQuickModule ? 'Creating...' : 'New Module'}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            Curriculum API error: {error}. Start the Django backend on port 8000 and refresh.
          </div>
        )}
        {actionMessage && !deletingModuleId && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            {actionMessage}
          </div>
        )}

        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search modules..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <select value={programmeFilter} onChange={event => setProgrammeFilter(event.target.value)} className="px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
            {programmeOptions.map(option => <option key={option}>{option}</option>)}
          </select>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
            {statusFilters.map(filter => (
              <button key={filter.key} onClick={() => setStatusFilter(filter.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${statusFilter === filter.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, index) => <StatsCardSkeleton key={index} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatsCard label="Total Modules" value={catalogueModules.length.toString()} icon="ri-stack-line" color="primary" />
            <StatsCard label="Published" value={published.toString()} icon="ri-check-double-line" color="emerald" />
            <StatsCard label="Sessions" value={totalLessons.toString()} icon="ri-book-open-line" color="accent" />
            <StatsCard label="Delivery Uses" value={totalDeliveryUses.toString()} icon="ri-route-line" color="secondary" />
          </div>
        )}

        <div className="rounded-2xl border border-foreground-200/60 bg-background-50">
          <div className="flex flex-col gap-2 border-b border-background-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[12px] font-bold text-foreground-900">Module catalogue</p>
              <p className="text-[11px] text-foreground-500">One master module per programme. Delivery usage is shown only as context.</p>
            </div>
            <span className="rounded-full bg-background-100 px-3 py-1 text-[11px] font-semibold text-foreground-600">
              {filtered.length} shown
            </span>
          </div>
          <div className="max-h-[calc(100vh-345px)] min-h-[420px] overflow-auto p-3">
            {loading ? (
              <ModuleListSkeleton />
            ) : filtered.length > 0 ? (
              <div className="space-y-3">
                {filtered.map(module => (
                  <ModuleCatalogueCard
                    key={module.catalogueId}
                    module={module}
                    onBuild={() => openModule(module)}
                    onSettings={() => openModule(module, true)}
                    onDuplicate={() => duplicateModule(module)}
                    onDelete={() => confirmDeleteModule(module)}
                  />
                ))}
              </div>
            ) : (
              <div className="px-4 py-14 text-center">
                <i className="ri-inbox-line mb-3 block text-3xl text-foreground-300"></i>
                <p className="text-[13px] font-semibold text-foreground-700">No modules match the current filters.</p>
                <p className="mt-1 text-[12px] text-foreground-400">Try changing the search, programme, or status filter.</p>
              </div>
            )}
          </div>
        </div>
        {createOpen && (
          <NewModuleChoiceModal
            programmeOptions={programmeOptions.filter(option => option !== 'All')}
            defaultProgramme={programmeFilter !== 'All' ? programmeFilter : undefined}
            onClose={() => setCreateOpen(false)}
            onCreate={input => {
              setCreateOpen(false);
              createQuickModule(input);
            }}
          />
        )}
        {creatingQuickModule && <CreatingModuleAlert complete={creatingQuickModuleComplete} />}
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

function SaveStatusPanel({ saving, elapsedSeconds, success, error, module }: {
  saving: boolean;
  elapsedSeconds: number;
  success: { title: string; message: string } | null;
  error: string | null;
  module: ModuleCatalogueItem;
}) {
  const componentCount = module.weekStructure.reduce((total, week) => total + week.components.length, 0);
  const tone = error ? 'red' : saving ? 'amber' : 'emerald';
  const icon = error ? 'ri-error-warning-line' : saving ? 'ri-loader-4-line animate-spin' : 'ri-checkbox-circle-line';
  const title = error ? 'Save failed' : saving ? (elapsedSeconds > 8 ? 'Still saving module structure' : 'Saving module structure') : (success?.title || 'Module saved');
  const message = error || (saving
    ? `${module.weekStructure.length} weeks and ${componentCount} components are being written to the curriculum database. ${elapsedSeconds ? `${elapsedSeconds}s elapsed.` : ''}`
    : success?.message || 'Changes are saved.');
  const classes = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    red: 'border-red-200 bg-red-50 text-red-800',
  }[tone];
  const barClass = {
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    red: 'bg-red-500',
  }[tone];

  return (
    <div className={`overflow-hidden rounded-xl border ${classes}`}>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/70">
            <i className={`${icon} text-base`}></i>
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

function WorkspaceHeader({ module, modules, programmeOptions, saving, saved, onBack, onProgrammeChange, onModuleChange, onStatusChange }: {
  module: ModuleCatalogueItem;
  modules: ModuleCatalogueItem[];
  programmeOptions: string[];
  saving: boolean;
  saved: boolean;
  onBack: () => void;
  onProgrammeChange: (programmeName: string) => void;
  onModuleChange: (catalogueId: string) => void;
  onStatusChange: (status: string) => void;
}) {
  const moduleMetrics = [
    { label: 'Sessions', value: String(module.sessionsNumber || module.sourceModule?.weeks || module.weeks || 0), icon: 'ri-calendar-check-line' },
    { label: 'Weeks', value: String(module.weekStructure.length), icon: 'ri-stack-line' },
    { label: 'Components', value: String(module.lessonCount), icon: 'ri-layout-grid-line' },
    { label: 'OTJH', value: module.totalOtjh.toFixed(1), icon: 'ri-time-line' },
  ];
  const saveStateLabel = saving ? 'Saving changes' : saved ? 'Saved' : 'Unsaved draft';
  const saveStateClasses = saving
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : saved
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-background-100 text-foreground-500 border-background-200';

  return (
    <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm lg:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_140px] lg:items-start">
        <div className="flex min-w-0 items-start gap-3">
          <button onClick={onBack} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-700 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700" title="Back" aria-label="Back">
            <i className="ri-arrow-left-line"></i>
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={module.status} />
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold ${saveStateClasses}`}>
                <i className={saving ? 'ri-loader-4-line animate-spin' : saved ? 'ri-check-line' : 'ri-pencil-line'}></i>
                {saveStateLabel}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-bold uppercase text-foreground-500">
                <i className="ri-calendar-check-line"></i>
                {module.sessionsNumber || module.sourceModule?.weeks || module.weeks || 0} sessions
              </span>
            </div>
            <h2 className="mt-2 max-w-[calc(100vw-140px)] truncate text-xl font-heading font-bold text-foreground-950 lg:max-w-[820px]" title={module.title}>{module.title}</h2>
            <p className="mt-1 max-w-[calc(100vw-140px)] truncate text-[12px] text-foreground-500 lg:max-w-[820px]">{moduleListSubLabel(module)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <select value={module.status} onChange={event => onStatusChange(event.target.value)} className="h-10 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-semibold text-foreground-900 outline-none transition-smooth focus:border-primary-400">
            <option value="draft">Draft</option>
            <option value="review">In Review</option>
            <option value="published">Published</option>
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-background-200 pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[220px_minmax(300px,1fr)]">
          <label className="block min-w-0">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-wide text-foreground-400">Programme</span>
            <select value={module.programmeName} onChange={event => onProgrammeChange(event.target.value)} className="h-9 w-full rounded-lg border border-background-200 bg-background-100/50 px-3 text-[12px] font-semibold text-foreground-900 outline-none transition-smooth focus:border-primary-400 focus:bg-background-50">
              {programmeOptions.map(option => <option key={option}>{option}</option>)}
              {!programmeOptions.includes(module.programmeName) && <option>{module.programmeName}</option>}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-wide text-foreground-400">Open module</span>
            <select value={module.catalogueId} onChange={event => onModuleChange(event.target.value)} className="h-9 w-full rounded-lg border border-background-200 bg-background-100/50 px-3 text-[12px] font-semibold text-foreground-900 outline-none transition-smooth focus:border-primary-400 focus:bg-background-50">
              {modules.map(item => <option key={item.catalogueId} value={item.catalogueId}>{moduleSelectLabel(item)}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
          <QualityRing score={module.qualityScore} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {moduleMetrics.map(metric => (
              <div key={metric.label} className="min-w-[82px] rounded-lg border border-background-200 bg-background-100/50 px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-foreground-400">
                  <i className={`${metric.icon} text-[12px]`}></i>{metric.label}
                </div>
                <div className="mt-0.5 text-[15px] font-heading font-bold text-foreground-950">{metric.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function QualityRing({ score }: { score: number }) {
  const bounded = Math.max(0, Math.min(100, Math.round(score || 0)));
  return (
    <div className="flex min-w-[138px] items-center gap-2 rounded-lg border border-primary-100 bg-primary-50 px-2.5 py-2">
      <div
        className="grid h-9 w-9 place-items-center rounded-full"
        style={{ background: `conic-gradient(oklch(var(--primary-500)) ${bounded * 3.6}deg, oklch(var(--background-200)) 0deg)` }}
      >
        <div className="grid h-6 w-6 place-items-center rounded-full bg-background-50 text-[9px] font-bold text-primary-700">{bounded}%</div>
      </div>
      <div>
        <p className="text-[9px] font-bold uppercase tracking-wide text-primary-700">Quality</p>
        <p className="text-[11px] font-medium text-foreground-500">Authoring health</p>
      </div>
    </div>
  );
}

function WorkspaceActionFooter({ saving, saved, onPreview, onSettings, onDelete, onSave }: {
  saving: boolean;
  saved: boolean;
  onPreview: () => void;
  onSettings: () => void;
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
          <i className={saving ? 'ri-loader-4-line animate-spin' : saved ? 'ri-checkbox-circle-line' : 'ri-edit-line'}></i>
          {stateText}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <IconButton label="Preview" icon="ri-eye-line" onClick={onPreview} />
          <IconButton label="Module settings" icon="ri-settings-3-line" onClick={onSettings} />
          <IconButton label="Delete module" icon="ri-delete-bin-line" tone="danger" onClick={onDelete} />
          <button onClick={onSave} disabled={saving} className={`inline-flex h-10 min-w-[120px] items-center justify-center gap-1.5 rounded-lg px-4 text-[12px] font-semibold text-white shadow-sm transition-smooth disabled:opacity-70 whitespace-nowrap ${saved ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-primary-500 hover:bg-primary-600'}`}>
            <i className={saveButtonIcon}></i>{saveButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CourseStructure({ module, selection, expandedWeeks, dragState, onDragState, onToggleWeek, onSelectWeek, onSelectComponent, onAddWeek, onDeleteWeek, onAddComponent, onDeleteComponent, onDuplicateComponent, onAutoCheckpoints, onDropReorder }: {
  module: ModuleCatalogueItem;
  selection: Selection | null;
  expandedWeeks: Set<string>;
  dragState: DragState;
  onDragState: (state: DragState) => void;
  onToggleWeek: (weekId: string) => void;
  onSelectWeek: (weekId: string) => void;
  onSelectComponent: (weekId: string, componentId: string) => void;
  onAddWeek: () => void;
  onDeleteWeek: (weekId: string) => void;
  onAddComponent: (weekId: string, type: ModuleComponentType) => void;
  onDeleteComponent: (weekId: string, componentId: string) => void;
  onDuplicateComponent: (weekId: string, componentId: string) => void;
  onAutoCheckpoints: () => void;
  onDropReorder: (targetWeekId: string, targetComponentId?: string) => void;
}) {
  const [openAddWeekId, setOpenAddWeekId] = useState<string | null>(null);
  const totalComponents = module.weekStructure.reduce((total, week) => total + week.components.length, 0);

  return (
    <aside className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm xl:sticky xl:top-4">
      <div className="border-b border-background-200 bg-background-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-heading font-bold text-foreground-950">Course structure</h3>
            <p className="mt-0.5 text-[11px] text-foreground-500">Weeks, lessons and order</p>
          </div>
          <button onClick={onAddWeek} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-600">
            <i className="ri-add-line"></i>
            Week
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <MiniStructureMetric label="Items" value={String(totalComponents)} />
          <MiniStructureMetric label="OTJH" value={module.totalOtjh.toFixed(1)} />
          <MiniStructureMetric label="KSBs" value={String(module.ksbCount)} />
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background-200">
          <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min(100, Math.max(0, module.qualityScore))}%` }} />
        </div>
      </div>
      <div className="space-y-1.5 max-h-[calc(100vh-300px)] overflow-y-auto p-2.5">
        {module.weekStructure.map(week => {
          const expanded = expandedWeeks.has(week.id);
          const selected = selection?.kind === 'week' && selection.weekId === week.id;
          const selectedChild = selection?.kind === 'component' && selection.weekId === week.id;
          return (
            <div
              key={week.id}
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
              className={`overflow-visible rounded-xl border transition-smooth ${selected || selectedChild ? 'border-primary-300 bg-primary-50/70 shadow-sm shadow-primary-100/60' : 'border-background-200 bg-background-50 hover:border-primary-200'}`}
            >
              <div className="flex items-center gap-1.5 p-2">
                <span className="cursor-grab text-foreground-300"><i className="ri-draggable"></i></span>
                <button onClick={() => onToggleWeek(week.id)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background-50 text-foreground-500 hover:bg-background-100">
                  <i className={expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}></i>
                </button>
                <button onClick={() => onSelectWeek(week.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[12px] font-bold text-foreground-900">{week.title || `Week ${week.weekNumber}`}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-foreground-400">
                    <span>{week.components.length} lessons</span>
                    <span className="h-1 w-1 rounded-full bg-foreground-300"></span>
                    <span>{week.components.reduce((total, component) => total + Number(component.expectedOtjh || 0), 0).toFixed(1)}h</span>
                  </p>
                </button>
                <button
                  type="button"
                  onMouseDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation();
                    onDeleteWeek(week.id);
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-red-500 transition-smooth hover:bg-red-50 hover:text-red-700"
                  title="Delete week"
                  aria-label={`Delete ${week.title || `Week ${week.weekNumber}`}`}
                >
                  <i className="ri-delete-bin-line text-sm"></i>
                </button>
              </div>
              {expanded && (
                <div className="space-y-1 px-2 pb-2">
                  {week.components.map(component => (
                    <ComponentTreeRow
                      key={component.id}
                      week={week}
                      component={component}
                      selected={selection?.kind === 'component' && selection.componentId === component.id}
                      dragging={dragState?.type === 'component' && dragState.componentId === component.id}
                      onSelect={() => onSelectComponent(week.id, component.id)}
                      onDelete={() => onDeleteComponent(week.id, component.id)}
                      onDuplicate={() => onDuplicateComponent(week.id, component.id)}
                      onDragStart={() => onDragState({ type: 'component', weekId: week.id, componentId: component.id })}
                      onDrop={() => onDropReorder(week.id, component.id)}
                      onDragEnd={() => onDragState(null)}
                    />
                  ))}
                  <div className="relative">
                    {dragState?.type === 'component' && (
                      <div
                        onDragOver={event => event.preventDefault()}
                        onDrop={event => {
                          event.preventDefault();
                          onDropReorder(week.id);
                        }}
                        className="mb-2 rounded-lg border border-dashed border-primary-300 bg-primary-50 px-3 py-2 text-center text-[11px] font-semibold text-primary-700"
                      >
                        Drop here to move to the end
                      </div>
                    )}
                    <button
                      onClick={() => setOpenAddWeekId(current => current === week.id ? null : week.id)}
                      className="w-full rounded-lg border border-dashed border-background-300 bg-background-50 px-3 py-2 text-left text-[12px] font-semibold text-foreground-600 transition-smooth hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
                    >
                      <i className="ri-add-line mr-1.5"></i>Add component
                    </button>
                    {openAddWeekId === week.id && (
                      <ComponentAddMenu
                        onAdd={type => {
                          onAddComponent(week.id, type);
                          setOpenAddWeekId(null);
                        }}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-background-200 bg-background-50 p-3">
        <button onClick={onAutoCheckpoints} className="w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-[11px] font-semibold text-primary-700 transition-smooth hover:bg-primary-100">
          <i className="ri-magic-line mr-1.5"></i>Auto-add monthly checkpoints
        </button>
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

function ComponentAddMenu({ onAdd }: { onAdd: (type: ModuleComponentType) => void }) {
  return (
    <div className="mt-2 max-h-[420px] overflow-y-auto rounded-xl border border-background-200 bg-background-50 p-2 shadow-lg ring-1 ring-black/5">
      {componentTypeGroups.map(group => (
        <div key={group} className="border-b border-background-200 last:border-b-0 py-2 first:pt-0 last:pb-0">
          <p className="px-2 pb-1 text-[9px] font-bold uppercase tracking-wide text-foreground-400">{group}</p>
          {componentTypes.filter(item => item.group === group).map(item => {
            const tone = componentToneClasses(item.tone);
            return (
              <button key={item.type} onClick={() => onAdd(item.type)} className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold text-foreground-700 hover:bg-primary-50 hover:text-primary-800 transition-smooth">
                <span className="text-foreground-300 group-hover:text-primary-400">
                  <i className="ri-draggable text-xs"></i>
                </span>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tone.soft} ${tone.text}`}>
                  <i className={`${item.icon} text-[13px]`}></i>
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function LessonTypeModal({ onClose, onSelect }: { onClose: () => void; onSelect: (type: ModuleComponentType) => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-background-200">
          <div>
            <h3 className="text-base font-heading font-bold text-foreground-950">What do you want to add?</h3>
            <p className="mt-1 text-[12px] text-foreground-500">Pick a lesson type. You can edit the details after.</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-500 hover:bg-background-100 hover:text-foreground-900" aria-label="Close">
            <i className="ri-close-line text-lg"></i>
          </button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto p-5 space-y-5">
          {componentTypeGroups.map(group => (
            <section key={group} className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">{group}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {componentTypes.filter(item => item.group === group).map(item => {
                  const tone = componentToneClasses(item.tone);
                  return (
                    <button
                      key={item.type}
                      onClick={() => onSelect(item.type)}
                      className="group flex min-h-[70px] items-center gap-3 rounded-xl border border-background-200 bg-background-50 px-3 py-3 text-left shadow-sm transition-smooth hover:border-primary-300 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-200"
                    >
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone.soft} ${tone.text}`}>
                        <i className={`${item.icon} text-lg`}></i>
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-bold text-foreground-900 group-hover:text-primary-800">{item.label}</span>
                        <span className="block text-[11px] font-medium leading-snug text-foreground-500">{lessonTypeDescription(item.type)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function ComponentTreeRow({ week, component, selected, dragging, onSelect, onDelete, onDuplicate, onDragStart, onDrop, onDragEnd }: {
  week: ModuleWeek;
  component: ModuleComponent;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onDragStart: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const meta = componentTypes.find(item => item.type === component.type);
  const tone = componentToneClasses(meta?.tone);
  return (
    <div
      draggable
      onDragStart={event => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={event => {
        event.stopPropagation();
        onDragEnd();
      }}
      onDragOver={event => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={event => {
        event.preventDefault();
        event.stopPropagation();
        onDrop();
      }}
      className={`group grid min-h-8 grid-cols-[14px_22px_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border px-1.5 py-1 transition-smooth ${selected ? 'border-primary-300 bg-primary-100/70' : dragging ? 'border-primary-200 bg-primary-50' : 'border-background-200 bg-background-100/70 hover:border-primary-200 hover:bg-background-50'}`}
    >
      <span className="cursor-grab text-foreground-300"><i className="ri-draggable"></i></span>
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${tone.soft} ${tone.text}`}>
        <i className={`${meta?.icon || 'ri-file-line'} text-xs`}></i>
      </span>
      <button onClick={onSelect} className="min-w-0 flex-1 text-left" title={readableComponentTitle(component.title)}>
        <p className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-semibold text-foreground-800">{readableComponentTitle(component.title)}</p>
      </button>
      <span className="flex items-center gap-1">
        <button onClick={onDuplicate} className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-foreground-500 hover:bg-background-200 group-hover:flex" title="Duplicate"><i className="ri-file-copy-line text-xs"></i></button>
        <button onClick={onDelete} className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-red-500 hover:bg-red-50 group-hover:flex" title="Delete"><i className="ri-delete-bin-line text-xs"></i></button>
      </span>
    </div>
  );
}

function CreatingModuleAlert({ complete }: { complete: boolean }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-background-50 text-center shadow-2xl">
        <div className="p-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-4 border-primary-100 bg-primary-50 text-primary-600">
            <i className="ri-loader-4-line animate-spin text-3xl"></i>
          </div>
          <h3 className="mt-4 text-lg font-heading font-bold text-foreground-950">Creating new module...</h3>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-foreground-500">
            Saving a blank draft and opening the authoring workspace.
          </p>
          <div className="mt-5 rounded-xl border border-background-200 bg-background-100/70 p-3 text-left">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground-700">
              <i className="ri-database-2-line text-primary-600"></i>
              Preparing module structure...
            </div>
            <LoadingProgressBar complete={complete} />
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
            <i className="ri-loader-4-line animate-spin text-3xl"></i>
          </div>
          <h3 className="mt-4 text-lg font-heading font-bold text-foreground-950">
            {isSettings ? 'Opening module settings...' : 'Opening module builder...'}
          </h3>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-foreground-500">
            Loading <span className="font-semibold text-foreground-900">{title}</span> and preparing the authoring workspace.
          </p>
          <div className="mt-5 rounded-xl border border-background-200 bg-background-100/70 p-3 text-left">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground-700">
              <i className={`${isSettings ? 'ri-settings-3-line' : 'ri-layout-4-line'} text-primary-600`}></i>
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
            <i className={`${icon} text-2xl`}></i>
          </div>
          <h3 className="mt-4 text-lg font-heading font-bold text-foreground-950">{title}</h3>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-foreground-500">{message}</p>
          <div className="mt-5 rounded-xl border border-background-200 bg-background-100/70 p-3 text-left">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground-700">
              <i className="ri-loader-4-line animate-spin text-primary-600"></i>
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

function WeekEditor({ week, dragState, onDragState, onDropReorder, onSelectComponent, onChange, onApplyTemplate, onAddLesson }: {
  week: ModuleWeek;
  dragState: DragState;
  onDragState: (state: DragState) => void;
  onDropReorder: (targetComponentId?: string) => void;
  onSelectComponent: (componentId: string) => void;
  onChange: (updates: Partial<ModuleWeek>) => void;
  onApplyTemplate: () => void;
  onAddLesson: () => void;
}) {
  const totalOtjh = week.components.reduce((total, component) => total + Number(component.expectedOtjh || 0), 0);
  const totalPoints = week.components.reduce((total, component) => total + Number(component.points || 0), 0);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setDetailsOpen(Boolean(week.summary || week.learningOutcomes.length));
  }, [week.id]);

  return (
    <section className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50 shadow-sm">
      <div className="grid gap-3 border-b border-background-200 bg-background-50 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-primary-100 px-2.5 py-1 text-[10px] font-bold text-primary-700">Week {week.weekNumber}</span>
            <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-bold text-foreground-500">{week.components.length} lessons</span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{totalOtjh.toFixed(1)}h OTJH</span>
          </div>
          <h3 className="mt-1.5 truncate text-lg font-heading font-bold text-foreground-950">{week.title || `Week ${week.weekNumber}`}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button onClick={() => setDetailsOpen(current => !current)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-semibold text-foreground-600 transition-smooth hover:bg-background-100">
            <i className={detailsOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}></i>
            Details
          </button>
          <button onClick={onApplyTemplate} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[11px] font-semibold text-primary-700 transition-smooth hover:bg-primary-100">
            <i className="ri-sparkling-2-line"></i>
            Apply template
          </button>
          <button onClick={onAddLesson} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-3 text-[11px] font-semibold text-white shadow-sm transition-smooth hover:bg-primary-600">
            <i className="ri-add-line"></i>
            Add lesson
          </button>
        </div>
      </div>

      <div className="space-y-3 p-4 lg:p-5">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_240px]">
          <TextInput label="Week title" value={week.title} onChange={value => onChange({ title: value })} />
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label="Points" value={String(totalPoints)} />
            <MiniMetric label="KSB mappings" value={String(uniqueMappings([...week.ksbMappings, ...week.components.flatMap(item => item.ksbMappings)]).length)} />
          </div>
        </div>
        {detailsOpen && (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-background-200 bg-background-100/35 p-3 2xl:grid-cols-2">
            <TextArea label="Week summary" value={week.summary} onChange={value => onChange({ summary: value })} rows={3} />
            <TextArea label="Learning outcomes" value={week.learningOutcomes.join('\n')} onChange={value => onChange({ learningOutcomes: value.split('\n').map(item => item.trim()).filter(Boolean) })} rows={3} />
          </div>
        )}
        <div className="rounded-xl border border-background-200 bg-background-100/35 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-[11px] font-bold uppercase text-foreground-500">Lessons in this week</h4>
            </div>
            <span className="rounded-full bg-background-50 px-2.5 py-1 text-[10px] font-semibold text-foreground-500">{week.components.length} components</span>
          </div>
          <div className="space-y-2">
            {week.components.map((component, index) => {
              const meta = componentTypes.find(item => item.type === component.type);
              const tone = componentToneClasses(meta?.tone);
              const isDragging = dragState?.type === 'component' && dragState.componentId === component.id;
              return (
                <div
                  key={component.id}
                  draggable
                  onDragStart={(event: DragEvent<HTMLDivElement>) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = 'move';
                    onDragState({ type: 'component', weekId: week.id, componentId: component.id });
                  }}
                  onDragEnd={event => {
                    event.stopPropagation();
                    onDragState(null);
                  }}
                  onDragOver={event => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onDrop={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDropReorder(component.id);
                  }}
                  className={`grid grid-cols-[20px_28px_minmax(0,1fr)_auto_20px] items-center gap-2.5 rounded-lg border px-3 py-2 transition-smooth ${isDragging ? 'border-primary-300 bg-primary-50' : 'border-background-200 bg-background-50 hover:border-primary-200'}`}
                >
                  <span className="cursor-grab text-foreground-300"><i className="ri-draggable"></i></span>
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tone.soft} ${tone.text}`}>
                    <i className={`${meta?.icon || 'ri-file-line'} text-sm`}></i>
                  </span>
                  <button onClick={() => onSelectComponent(component.id)} className="min-w-0 text-left" title={readableComponentTitle(component.title)}>
                    <p className="truncate text-[12px] font-semibold leading-snug text-foreground-900">{readableComponentTitle(component.title)}</p>
                    <p className="mt-0.5 text-[9px] text-foreground-400">Order {index + 1} · {meta?.label || 'Lesson'}</p>
                    <ComponentKsbChips mappings={component.ksbMappings} />
                  </button>
                  <div className="hidden items-center gap-2 sm:flex">
                    <ReadOnlyMetricChip label="OTJH" value={Number(component.expectedOtjh || 0).toFixed(1)} suffix="h" tone="emerald" />
                    <ReadOnlyMetricChip label="Points" value={String(component.points || 0)} suffix="pts" tone="amber" />
                  </div>
                  <i className="ri-arrow-right-s-line text-foreground-300"></i>
                </div>
              );
            })}
            {dragState?.type === 'component' && (
              <div
                onDragOver={event => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onDrop={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDropReorder();
                }}
                className="rounded-xl border border-dashed border-primary-300 bg-primary-50 px-3 py-3 text-center text-[11px] font-semibold text-primary-700"
              >
                Drop here to move to the end of this week
              </div>
            )}
            {!week.components.length && <EmptyState text="No components in this week yet." />}
          </div>
        </div>
      </div>
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
  onSettingChange: (key: string, value: string | number | boolean) => void;
  onAddKsb: () => void;
  onRemoveKsb: (mappingId: string) => void;
}) {
  const meta = componentTypes.find(item => item.type === component.type);
  const tone = componentToneClasses(meta?.tone);
  return (
    <section className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
      <div className="border-b border-background-200 bg-background-100/60 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tone.soft} ${tone.text}`}>
              <i className={`${meta?.icon || 'ri-file-line'} text-xl`}></i>
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
          <TextInput label="Title" value={readableComponentTitle(component.title)} onChange={value => onChange({ title: value })} />
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
            onSettingChange={onSettingChange}
          />
        </EditorSection>

        <EditorSection title="Completion and reward" icon="ri-checkbox-circle-line">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <NumberInput label="Expected OTJH hours" value={component.expectedOtjh} min={0} step={0.25} onChange={value => onChange({ expectedOtjh: value })} />
            <NumberInput label="Points" value={component.points} min={0} step={1} onChange={value => onChange({ points: value })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Checkbox label="Reflection required" checked={component.reflectionRequired} onChange={value => onChange({ reflectionRequired: value })} />
            <Checkbox label="Workplace evidence required" checked={component.workplaceEvidenceRequired} onChange={value => onChange({ workplaceEvidenceRequired: value })} />
            <Checkbox label="Tutor validation" checked={component.tutorValidationRequired} onChange={value => onChange({ tutorValidationRequired: value })} />
          </div>
        </EditorSection>

        <ComponentAdvancedSettings component={component} onSettingChange={onSettingChange} />
      </div>
    </section>
  );
}

function EditorSection({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-background-200 bg-background-50 p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-background-100 text-foreground-500">
          <i className={`${icon} text-sm`}></i>
        </span>
        <h4 className="text-[12px] font-heading font-bold text-foreground-900">{title}</h4>
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </section>
  );
}

function ComponentAdvancedSettings({ component, onSettingChange }: { component: ModuleComponent; onSettingChange: (key: string, value: string | number | boolean) => void }) {
  const setting = (key: string, fallback = '') => String(component.settings[key] ?? fallback);
  return (
    <details open className="rounded-xl border border-background-200 bg-background-100/50 p-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[12px] font-bold text-foreground-700">
        <i className="ri-arrow-down-s-line text-foreground-400"></i>
        <span>Advanced settings</span>
      </summary>
      <div className="mt-3 space-y-3">
        <TextInput
          label="Completion rule"
          value={setting('completionRule', defaultCompletionRule(component.type))}
          onChange={value => onSettingChange('completionRule', value)}
        />
        <TextInput
          label="Evidence required"
          value={setting('evidenceRequired', defaultEvidenceRequired(component.type))}
          onChange={value => onSettingChange('evidenceRequired', value)}
        />
        <TextArea
          label="Reflection prompt"
          value={setting('reflectionPrompt', defaultReflectionPrompt(component.type))}
          onChange={value => onSettingChange('reflectionPrompt', value)}
          rows={3}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectInput
            label="Status"
            value={setting('contentStatus', 'Draft')}
            options={['Draft', 'Ready for QA', 'Needs changes', 'Approved']}
            onChange={value => onSettingChange('contentStatus', value)}
          />
          <TextInput
            label="Version"
            value={setting('version', '0.1')}
            onChange={value => onSettingChange('version', value)}
          />
        </div>
      </div>
    </details>
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
  onSettingChange,
}: {
  component: ModuleComponent;
  module: ModuleCatalogueItem;
  week: ModuleWeek;
  availableModules: ModuleBuilderListItem[];
  liveProgrammes: CurriculumProgramme[];
  quizzes: QuizPackageSummary[];
  quizzesLoading: boolean;
  onSettingChange: (key: string, value: string | number | boolean) => void;
}) {
  const s = component.settings;
  const getString = (key: string) => String(s[key] ?? '');
  const getNumber = (key: string) => Number(s[key] ?? 0);
  const getBool = (key: string) => Boolean(s[key]);

  if (component.type === 'live-session') {
    return (
      <EditorBlock title="Live Teams session">
        <p className="rounded-lg bg-primary-50 border border-primary-100 px-3 py-2 text-[11px] font-medium text-primary-700">Teams link, date and attendance sync are added later by MIS when this module is allocated to a cohort.</p>
        <TextArea label="Tutor-led session outline" value={getString('sessionPurpose')} onChange={value => onSettingChange('sessionPurpose', value)} rows={3} />
        <TextArea label="Learner preparation before session" value={getString('preparationInstructions')} onChange={value => onSettingChange('preparationInstructions', value)} rows={3} />
        <TextArea label="Reflection questions after the session" value={getString('reflectionQuestions')} onChange={value => onSettingChange('reflectionQuestions', value)} rows={3} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Checkbox label="Attendance required" checked={getBool('attendanceRequired')} onChange={value => onSettingChange('attendanceRequired', value)} />
          <Checkbox label="Recording expected" checked={getBool('recordingExpected')} onChange={value => onSettingChange('recordingExpected', value)} />
        </div>
      </EditorBlock>
    );
  }

  if (component.type === 'recording-placeholder') {
    return (
      <EditorBlock title="Recording placeholder">
        <p className="rounded-lg bg-background-50 border border-background-200 px-3 py-2 text-[11px] font-medium text-foreground-500">Recording files are attached later after cohort allocation. This placeholder reserves the lesson space and completion rule.</p>
        <TextArea label="Recording purpose" value={getString('recordingPurpose')} onChange={value => onSettingChange('recordingPurpose', value)} rows={3} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectInput label="Source" value={getString('source')} options={['MIS allocation', 'Tutor upload', 'External link']} onChange={value => onSettingChange('source', value)} />
          <TextInput label="Expected availability" value={getString('expectedAvailability')} onChange={value => onSettingChange('expectedAvailability', value)} />
        </div>
        <Checkbox label="Captions expected" checked={getBool('captionsExpected')} onChange={value => onSettingChange('captionsExpected', value)} />
      </EditorBlock>
    );
  }

  if (component.type === 'video') {
    return (
      <EditorBlock title="Video source">
        <div className="grid grid-cols-1 md:grid-cols-[160px_minmax(0,1fr)] gap-2">
          <SelectInput label="Video provider" value={getString('provider')} options={['YouTube', 'Vimeo', 'Upload file', 'External link']} onChange={value => onSettingChange('provider', value)} />
          <TextInput label="Video URL" value={getString('videoUrl')} onChange={value => onSettingChange('videoUrl', value)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] gap-2 items-end">
          <NumberInput label="Duration in minutes" value={getNumber('durationMinutes')} min={0} step={1} onChange={value => onSettingChange('durationMinutes', value)} />
          <Checkbox label="Captions available" checked={getBool('captionsAvailable')} onChange={value => onSettingChange('captionsAvailable', value)} />
        </div>
        <TextArea label="Video learning brief" value={getString('learningBrief')} onChange={value => onSettingChange('learningBrief', value)} rows={3} />
        <TextArea label="Learner task after watching" value={getString('postWatchTask')} onChange={value => onSettingChange('postWatchTask', value)} rows={2} />
      </EditorBlock>
    );
  }

  if (component.type === 'podcast') {
    return (
      <EditorBlock title="Podcast source">
        <div className="grid grid-cols-1 md:grid-cols-[160px_minmax(0,1fr)] gap-2">
          <SelectInput label="Podcast source" value={getString('podcastSource')} options={['External URL', 'Upload', 'LMS resource']} onChange={value => onSettingChange('podcastSource', value)} />
          <TextInput label="Podcast URL" value={getString('podcastUrl')} onChange={value => onSettingChange('podcastUrl', value)} />
        </div>
        <NumberInput label="Duration in minutes" value={getNumber('durationMinutes')} min={0} step={1} onChange={value => onSettingChange('durationMinutes', value)} />
        <TextArea label="Listening focus" value={getString('listeningFocus')} onChange={value => onSettingChange('listeningFocus', value)} rows={3} />
        <TextArea label="Reflection question" value={getString('podcastReflectionQuestion')} onChange={value => onSettingChange('podcastReflectionQuestion', value)} rows={2} />
      </EditorBlock>
    );
  }

  if (component.type === 'reading') {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SelectInput label="Difficulty" value={getString('difficulty') || 'Standard'} options={['Introductory', 'Standard', 'Advanced']} onChange={value => onSettingChange('difficulty', value)} />
          <SelectInput label="Requirement" value={getString('requirement') || 'Required'} options={['Required', 'Recommended', 'Stretch']} onChange={value => onSettingChange('requirement', value)} />
        </div>
        <EditorBlock title="Reading source and content">
          <SelectInput label="Reading source" value={getString('readingSource')} options={['Written in LMS', 'URL', 'PDF', 'Word document', 'LMS resource']} onChange={value => onSettingChange('readingSource', value)} />
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_260px] gap-3">
            <RichTextDraft label="Reading content" value={getString('readingContent')} onChange={value => onSettingChange('readingContent', value)} />
            <div className="space-y-3">
              <TextArea label="Main learning outcomes" value={getString('mainLearningOutcomes')} onChange={value => onSettingChange('mainLearningOutcomes', value)} rows={5} />
              <TextArea label="KSBs to evidence" value={getString('ksbEvidenceNotes')} onChange={value => onSettingChange('ksbEvidenceNotes', value)} rows={4} />
            </div>
          </div>
          <TextInput label="Pages or sections to focus on" value={getString('focusSections')} onChange={value => onSettingChange('focusSections', value)} />
          <TextArea label="Learner instruction" value={getString('learnerInstruction')} onChange={value => onSettingChange('learnerInstruction', value)} rows={2} />
          <AccordionRow title="Key points, terms and summary" badge={getString('keyPointCount') || '0'} defaultOpen={false}>
            <TextArea label="Key points" value={getString('keyPoints')} onChange={value => onSettingChange('keyPoints', value)} rows={4} />
            <TextArea label="Glossary or terminology" value={getString('glossaryTerms')} onChange={value => onSettingChange('glossaryTerms', value)} rows={3} />
          </AccordionRow>
          <AccordionRow title="OTJH breakdown" badge={`${getNumber('estimatedReadingTime') || 0} mins`}>
            <NumberInput label="Estimated reading time" value={getNumber('estimatedReadingTime')} min={0} step={1} onChange={value => onSettingChange('estimatedReadingTime', value)} />
            <TextArea label="How this contributes to OTJH" value={getString('otjhRationale')} onChange={value => onSettingChange('otjhRationale', value)} rows={2} />
          </AccordionRow>
          <AccordionRow title="Voice-over and audio" badge={getBool('audioEnabled') ? 'On' : 'Off'}>
            <Checkbox label="Audio version available" checked={getBool('audioEnabled')} onChange={value => onSettingChange('audioEnabled', value)} />
            <TextInput label="Audio URL" value={getString('audioUrl')} onChange={value => onSettingChange('audioUrl', value)} />
          </AccordionRow>
          <AccordionRow title="Reflection and evidence" badge={getString('reflectionQuestionCount') || '0 qs'}>
            <TextArea label="Reflection prompts" value={getString('readingReflectionPrompts')} onChange={value => onSettingChange('readingReflectionPrompts', value)} rows={4} />
            <TextArea label="Evidence learners should capture" value={getString('readingEvidenceRequired')} onChange={value => onSettingChange('readingEvidenceRequired', value)} rows={3} />
          </AccordionRow>
          <AccordionRow title="Completion rules" badge={getString('completionRuleCount') || '3 rules'}>
            <Checkbox label="Required reading" checked={getBool('requiredReading')} onChange={value => onSettingChange('requiredReading', value)} />
            <Checkbox label="Learner must confirm completion" checked={getBool('completionConfirmationRequired')} onChange={value => onSettingChange('completionConfirmationRequired', value)} />
            <TextInput label="Completion rule" value={getString('completionRule')} onChange={value => onSettingChange('completionRule', value)} />
          </AccordionRow>
          <AccordionRow title="Linked quizzes, assignments and coaching">
            <TextInput label="Linked quiz or task" value={getString('linkedActivity')} onChange={value => onSettingChange('linkedActivity', value)} />
            <TextArea label="Coaching discussion prompt" value={getString('coachingPrompt')} onChange={value => onSettingChange('coachingPrompt', value)} rows={2} />
          </AccordionRow>
          <p className="rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-[11px] font-medium text-primary-700">Tip: Map KSBs in the right-hand Apprenticeship panel. They apply to this reading lesson.</p>
        </EditorBlock>
      </div>
    );
  }

  if (component.type === 'powerpoint') {
    return (
      <EditorBlock title="PowerPoint resource">
        <TextInput label="PowerPoint file name" value={getString('fileName')} onChange={value => onSettingChange('fileName', value)} />
        <TextInput label="Slide range or deck section" value={getString('slideRange')} onChange={value => onSettingChange('slideRange', value)} />
        <TextArea label="Speaker notes or learner guidance" value={getString('speakerNotes')} onChange={value => onSettingChange('speakerNotes', value)} rows={3} />
        <Checkbox label="Learner download allowed" checked={getBool('downloadAllowed')} onChange={value => onSettingChange('downloadAllowed', value)} />
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
        <Checkbox label="Affects KSB progression" checked={getBool('affectsKsbProgression')} onChange={value => onSettingChange('affectsKsbProgression', value)} />
        <TextArea label="Feedback shown after completion" value={getString('completionFeedback')} onChange={value => onSettingChange('completionFeedback', value)} rows={2} />
      </EditorBlock>
    );
  }

  if (component.type === 'reflection') {
    return (
      <EditorBlock title="Reflection and guidance">
        <TextArea label="Reflection prompt" value={getString('reflectionPrompt')} onChange={value => onSettingChange('reflectionPrompt', value)} rows={4} />
        <NumberInput label="Minimum word count" value={getNumber('minimumWordCount')} min={0} step={50} onChange={value => onSettingChange('minimumWordCount', value)} />
        <TextArea label="Learner guidance" value={getString('learnerGuidance')} onChange={value => onSettingChange('learnerGuidance', value)} rows={3} />
        <TextArea label="Tutor review guidance" value={getString('tutorReviewGuidance')} onChange={value => onSettingChange('tutorReviewGuidance', value)} rows={3} />
        <Checkbox label="Tutor validation" checked={component.tutorValidationRequired} onChange={() => undefined} disabled />
      </EditorBlock>
    );
  }

  if (component.type === 'workplace-evidence') {
    return (
      <EditorBlock title="Workplace evidence">
        <TextArea label="Evidence instructions" value={getString('evidenceInstructions')} onChange={value => onSettingChange('evidenceInstructions', value)} rows={4} />
        <TextInput label="Accepted evidence types" value={getString('acceptedEvidenceTypes')} onChange={value => onSettingChange('acceptedEvidenceTypes', value)} />
        <TextArea label="Assessment checklist" value={getString('assessmentChecklist')} onChange={value => onSettingChange('assessmentChecklist', value)} rows={3} />
        <NumberInput label="Minimum description words" value={getNumber('minimumDescriptionWords')} min={0} step={25} onChange={value => onSettingChange('minimumDescriptionWords', value)} />
        <Checkbox label="Workplace evidence required" checked={component.workplaceEvidenceRequired} onChange={() => undefined} disabled />
        <Checkbox label="Tutor validation required" checked={component.tutorValidationRequired} onChange={() => undefined} disabled />
      </EditorBlock>
    );
  }

  if (component.type === 'assignment') {
    return (
      <EditorBlock title="Assignment">
        <TextArea label="Assignment brief" value={getString('assignmentBrief')} onChange={value => onSettingChange('assignmentBrief', value)} rows={4} />
        <TextArea label="Submission instructions" value={getString('submissionInstructions')} onChange={value => onSettingChange('submissionInstructions', value)} rows={3} />
        <TextInput label="Due timing relative to week" value={getString('dueTiming')} onChange={value => onSettingChange('dueTiming', value)} />
        <TextArea label="Marking rubric" value={getString('markingRubric')} onChange={value => onSettingChange('markingRubric', value)} rows={4} />
        <Checkbox label="Tutor validation required" checked={component.tutorValidationRequired} onChange={() => undefined} disabled />
      </EditorBlock>
    );
  }

  if (component.type === 'coaching-preparation') {
    return (
      <EditorBlock title="Coaching preparation">
        <TextArea label="Preparation prompt" value={getString('preparationPrompt')} onChange={value => onSettingChange('preparationPrompt', value)} rows={4} />
        <TextArea label="Evidence or notes to bring" value={getString('evidenceToBring')} onChange={value => onSettingChange('evidenceToBring', value)} rows={3} />
        <TextArea label="Coach discussion points" value={getString('coachDiscussionPoints')} onChange={value => onSettingChange('coachDiscussionPoints', value)} rows={3} />
        <Checkbox label="Monthly coaching review linked" checked={getBool('coachingReviewLinked')} onChange={value => onSettingChange('coachingReviewLinked', value)} />
      </EditorBlock>
    );
  }

  return (
    <EditorBlock title="Checkpoint quiz">
      <TextInput label="Checkpoint title" value={getString('checkpointTitle')} onChange={value => onSettingChange('checkpointTitle', value)} />
      <TextArea label="Checkpoint questions" value={getString('checkpointQuestions')} onChange={value => onSettingChange('checkpointQuestions', value)} rows={4} />
      <Checkbox label="Progress review linked" checked={getBool('progressReviewLinked')} onChange={value => onSettingChange('progressReviewLinked', value)} />
      <Checkbox label="Monthly coaching review linked" checked={getBool('monthlyCoachingReviewLinked')} onChange={value => onSettingChange('monthlyCoachingReviewLinked', value)} />
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
  onSettingChange: (key: string, value: string | number | boolean) => void;
}) {
  const settings = component.settings;
  const liveProgrammeKeys = new Set(liveProgrammes.map(programme => normaliseQuizText(programme.name)));
  const deliveryUsages = uniqueDeliveryUsages([
    ...((module as ModuleBuilderListItem).deliveryUsages || []),
    ...availableModules.flatMap(item => item.deliveryUsages || []),
    ...availableModules.map(moduleDeliveryUsageFallback),
  ]).filter(usage => !liveProgrammeKeys.size || liveProgrammeKeys.has(normaliseQuizText(usage.programme)));
  const requestedProgramme = String(settings.quizProgramme || module.programmeName || '');
  const programmeOptions = uniqueTextOptions([
    ...liveProgrammes.map(programme => programme.name),
  ]);
  const selectedProgramme = optionOrFirst(requestedProgramme, programmeOptions);

  const pathsForProgramme = deliveryUsages.filter(usage => matchesQuizText(usage.programme, selectedProgramme));
  const cohortOptions = uniqueTextOptions(pathsForProgramme.map(usage => usage.cohort));
  const selectedCohort = optionOrFirst(String(settings.quizCohort || ''), cohortOptions);

  const pathsForCohort = pathsForProgramme.filter(usage => !selectedCohort || matchesQuizText(usage.cohort, selectedCohort));
  const groupOptions = uniqueTextOptions(pathsForCohort.map(usage => usage.group));
  const selectedGroup = optionOrFirst(String(settings.quizGroup || ''), groupOptions);

  const pathsForGroup = pathsForCohort.filter(usage => !selectedGroup || matchesQuizText(usage.group, selectedGroup));
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
  const programmeQuizzes = eligibleQuizzes.filter(quiz => !selectedProgramme || matchesQuizText(quiz.programme, selectedProgramme));
  const moduleQuizzes = programmeQuizzes.filter(quiz => !selectedModule || matchesQuizText(quiz.module, selectedModule));
  const weekQuizzes = moduleQuizzes.filter(quiz => weekCandidates.has(String(quiz.weekId || '')));
  const quizOptions = uniqueQuizzes(weekQuizzes.length ? weekQuizzes : moduleQuizzes.length ? moduleQuizzes : programmeQuizzes);
  const selectedQuiz = quizOptions.find(quiz => String(quiz.id) === selectedQuizId)
    || null;
  const selectedQuizValue = selectedQuiz ? selectedQuizId : '';

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
      <p className="rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-[11px] font-medium text-primary-700">
        This component links to an existing quiz from the LMS quiz table. Select the delivery path, then choose a quiz attached to that week.
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <SelectInput label="Programme" value={selectedProgramme} options={programmeOptions} onChange={value => {
          onSettingChange('quizProgramme', value);
          onSettingChange('quizCohort', '');
          onSettingChange('quizGroup', '');
          onSettingChange('quizModule', '');
          onSettingChange('linkedQuizId', '');
        }} />
        <SelectInput label="Cohort" value={selectedCohort} options={cohortOptions} onChange={value => {
          onSettingChange('quizCohort', value);
          onSettingChange('quizGroup', '');
          onSettingChange('quizModule', '');
          onSettingChange('linkedQuizId', '');
        }} />
        <SelectInput label="Group" value={selectedGroup} options={groupOptions} onChange={value => {
          onSettingChange('quizGroup', value);
          onSettingChange('quizModule', '');
          onSettingChange('linkedQuizId', '');
        }} />
        <SelectInput label="Module" value={selectedModule} options={moduleOptions} onChange={value => { onSettingChange('quizModule', value); onSettingChange('linkedQuizId', ''); }} />
        <SelectInput
          label="Week"
          value={selectedWeekNumber}
          options={weekOptions.map(option => option.value)}
          labels={Object.fromEntries(weekOptions.map(option => [option.value, option.label]))}
          onChange={value => { onSettingChange('quizWeekNumber', value); onSettingChange('linkedQuizId', ''); }}
        />
        <SelectInput
          label={loading ? 'Loading quizzes...' : 'Quiz'}
          value={selectedQuizValue}
          options={['', ...quizOptions.map(quiz => String(quiz.id))]}
          labels={{ '': quizOptions.length ? 'Choose quiz' : 'No quizzes available', ...Object.fromEntries(quizOptions.map(quiz => [String(quiz.id), quiz.title])) }}
          onChange={applyQuiz}
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
      <ReadOnlyInput label="Resolved quiz week id" value={String(selectedQuiz?.weekId || settings.quizWeekId || Array.from(weekCandidates)[0] || '')} />
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

function matchesQuizText(left: unknown, right: unknown) {
  return normaliseQuizText(left) === normaliseQuizText(right);
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
    sourceId: String(module.sourceModule?.sourceId || module.sourceId || ''),
    catalogueId: String(module.catalogueId || ''),
    structureId: moduleStructureIdentifier(module),
    programmeId: String(module.programmeId || module.sourceModule?.programmeId || ''),
    programme: module.programmeName || module.sourceModule?.programme || 'Unassigned programme',
    moduleTitle: module.title || module.sourceModule?.name || 'Untitled module',
    cohort,
    group,
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

function defaultCompletionRule(type: ModuleComponentType) {
  const rules: Partial<Record<ModuleComponentType, string>> = {
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
  return rules[type] || 'Mark complete';
}

function defaultEvidenceRequired(type: ModuleComponentType) {
  const evidence: Partial<Record<ModuleComponentType, string>> = {
    'live-session': 'Attendance or recording completion',
    reflection: 'Reflection + signature',
    'workplace-evidence': 'File + 100-word description',
    assignment: 'Submission file',
    'coaching-preparation': 'Preparation notes',
    checkpoint: 'Quiz result',
    quiz: 'Quiz result',
    'monthly-ksb-quiz': 'Quiz result',
  };
  return evidence[type] || '-';
}

function defaultReflectionPrompt(type: ModuleComponentType) {
  if (type === 'workplace-evidence') return 'What workplace evidence have you uploaded, and which KSBs does it demonstrate?';
  if (type === 'quiz' || type === 'monthly-ksb-quiz' || type === 'checkpoint') return 'Which questions or topics do you need to revisit after this activity?';
  return 'What did you learn? How will you apply this at work? Which KSBs did this develop?';
}

function RichTextDraft({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <div className="mt-1 overflow-hidden rounded-lg border border-foreground-200/60 bg-background-50">
        <div className="flex flex-wrap items-center gap-1 border-b border-background-200 bg-background-100/70 px-2 py-1.5 text-[11px] text-foreground-500">
          {['B', 'I', 'U', 'H1', 'H2'].map(item => <span key={item} className="rounded px-1.5 py-0.5 font-bold">{item}</span>)}
          <i className="ri-list-unordered text-sm"></i>
          <i className="ri-link text-sm"></i>
          <i className="ri-double-quotes-l text-sm"></i>
          <span className="ml-auto rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-bold text-primary-700">Visual</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-foreground-500">HTML</span>
        </div>
        <textarea value={value} onChange={event => onChange(event.target.value)} rows={9} className="w-full resize-y bg-background-50 px-3 py-2 text-[13px] text-foreground-900 outline-none" placeholder="Write headings, lists, bold text, links, or paste prepared content here." />
      </div>
    </label>
  );
}

function AccordionRow({ title, badge, defaultOpen = false, children }: { title: string; badge?: string; defaultOpen?: boolean; children?: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="rounded-lg border border-background-200 bg-background-50">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12px] font-bold text-foreground-700">
        <i className="ri-arrow-right-s-line text-foreground-400"></i>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {badge && <span className="rounded-full bg-background-200 px-2 py-0.5 text-[10px] font-bold text-foreground-500">{badge}</span>}
      </summary>
      <div className="space-y-3 border-t border-background-200 p-3">
        {children}
      </div>
    </details>
  );
}

function ApprenticeshipSettings({ module, week, component, onAddKsb, onRemoveKsb, onUpdateKsbWeight }: {
  module: ModuleCatalogueItem;
  week: ModuleWeek | null;
  component: ModuleComponent | null;
  onAddKsb: (target: KsbTarget) => void;
  onRemoveKsb: (target: KsbTarget, mappingId: string) => void;
  onUpdateKsbWeight: (target: KsbTarget, mappingId: string, weight: number) => void;
}) {
  if (!week) {
    return (
      <aside className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm xl:sticky xl:top-4">
        <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Readiness</p>
        <h3 className="mt-1 text-sm font-heading font-bold text-foreground-950">No week selected</h3>
        <EmptyState text="Select a week or component." />
      </aside>
    );
  }

  if (!component) {
    const totalOtjh = week.components.reduce((total, item) => total + Number(item.expectedOtjh || 0), 0);
    const totalPoints = week.components.reduce((total, item) => total + Number(item.points || 0), 0);
    const mappedKsbs = uniqueMappings([...week.ksbMappings, ...week.components.flatMap(item => item.ksbMappings)]);
    const weekWeightSummary = ksbWeightSummary(mappedKsbs);
    const readinessItems = [
      { label: 'Lessons', ready: week.components.length > 0, value: week.components.length ? `${week.components.length} added` : 'Missing' },
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
                    <i className={item.ready ? 'ri-check-line' : 'ri-error-warning-line'}></i>
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
          <WeekKsbCodeSection mappings={mappedKsbs} />
        </div>
      </aside>
    );
  }

  const componentChecks = [
    { label: 'Content', ready: component.description.trim().length > 0 },
    { label: 'OTJH', ready: Number(component.expectedOtjh || 0) > 0 },
    { label: 'Points', ready: Number(component.points || 0) > 0 },
    { label: 'KSBs', ready: component.ksbMappings.length > 0 },
  ];
  const componentReadyCount = componentChecks.filter(item => item.ready).length;
  const componentReadyPercent = Math.round((componentReadyCount / componentChecks.length) * 100);
  const componentWeightSummary = ksbWeightSummary(component.ksbMappings);

  return (
    <aside className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm xl:sticky xl:top-4">
      <div className="border-b border-background-200 bg-background-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Component readiness</p>
            <h3 className="mt-1 truncate text-sm font-heading font-bold text-foreground-950">{readableComponentTitle(component.title) || 'Selected lesson'}</h3>
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
                <i className={item.ready ? 'ri-check-line' : 'ri-error-warning-line'}></i>
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
          <i className="ri-add-line"></i>
          Add KSBs
        </button>
        <KsbCards
          title="KSBs"
          mappings={component.ksbMappings}
          onRemove={mappingId => onRemoveKsb({ scope: 'component', weekId: week.id, componentId: component.id }, mappingId)}
          onWeightChange={(mappingId, weight) => onUpdateKsbWeight({ scope: 'component', weekId: week.id, componentId: component.id }, mappingId, weight)}
        />
      </div>
    </aside>
  );
}

function ModuleSettingsModal({ module, saving, saved, onClose, onSave, onChange, onCompletionChange, onAdvancedChange, onAddKsb, onRemoveKsb, onUpdateKsbWeight }: {
  module: ModuleCatalogueItem;
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
          <button onClick={onClose} disabled={saving} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20 disabled:opacity-50"><i className="ri-close-line"></i></button>
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
              <i className="ri-add-line"></i>
              Add KSBs
            </button>
            <KsbCards title="KSBs" mappings={module.moduleKsbMappings} onRemove={onRemoveKsb} onWeightChange={onUpdateKsbWeight} />
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
                  <i className={item.passed ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'}></i>
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
                <i className={saveButtonIcon}></i>{saveButtonLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KsbSelectorModal({ standards, standardsLoading, ksbSets, ksbSetsLoading, initialSourceId, onClose, onAddMany }: {
  standards: CurriculumStandard[];
  standardsLoading: boolean;
  ksbSets: CurriculumKsbSet[];
  ksbSetsLoading: boolean;
  initialSourceId: string;
  onClose: () => void;
  onAddMany: (items: Array<{ option: KsbOption; weight: number }>) => void;
}) {
  const [weightsByKsbId, setWeightsByKsbId] = useState<Record<string, number>>({});
  const [selectedKsbIds, setSelectedKsbIds] = useState<Set<string>>(new Set());
  const [selectedSourceId, setSelectedSourceId] = useState(initialSourceId);
  const [sourceMode, setSourceMode] = useState<'standard' | 'profile'>(initialSourceId.startsWith('profile:') ? 'profile' : 'standard');
  const standardSourceOptions = useMemo(() => standards.map(standard => ({
      id: ksbStandardSourceId(standard),
      label: `${standard.code} - ${standard.name} (${standard.total} KSBs)`,
      options: standardToKsbOptions(standard),
    })), [standards]);
  const profileSourceOptions = useMemo(() => ksbSets.map(set => {
    const options = flattenKsbEntries(set.ksbs);
    return {
      id: ksbSetSourceId(set),
      label: `${set.programmeName || set.standard || 'Profile'}${set.standard ? ` (${set.standard})` : ''} (${options.length} KSBs)`,
      options,
    };
  }), [ksbSets]);
  const sourceOptions = sourceMode === 'standard' ? standardSourceOptions : profileSourceOptions;
  useEffect(() => {
    if (!selectedSourceId && initialSourceId) {
      setSourceMode(initialSourceId.startsWith('profile:') ? 'profile' : 'standard');
      setSelectedSourceId(initialSourceId);
    }
  }, [initialSourceId, selectedSourceId]);
  const selectedSource = sourceOptions.find(source => source.id === selectedSourceId) || null;
  const selectedSourceValue = selectedSource ? selectedSourceId : '';
  const sourceLabels = Object.fromEntries([
    [
      '',
      sourceMode === 'standard'
        ? standardsLoading ? 'Loading standards...' : 'Select a Skills England standard'
        : ksbSetsLoading ? 'Loading KSB profiles...' : 'Select a KSB profile',
    ],
    ...sourceOptions.map(source => [source.id, source.label]),
  ]);
  const sourceKsbOptions = selectedSource?.options || [];
  const weightForOption = (option: KsbOption) => weightsByKsbId[option.id] ?? defaultKsbWeight();
  const updateOptionWeight = (option: KsbOption, value: number) => {
    setWeightsByKsbId(current => ({ ...current, [option.id]: clampKsbWeight(value) }));
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
    .map(option => ({ option, weight: clampKsbWeight(weightForOption(option)) }));
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-background-50 shadow-2xl overflow-hidden" onClick={event => event.stopPropagation()}>
        <div className="px-5 py-4 bg-primary-950 text-white flex items-center justify-between">
          <h3 className="text-sm font-heading font-bold text-white">Add KSBs</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="ri-close-line"></i></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase text-foreground-400">Choose KSB source</p>
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  { mode: 'standard' as const, title: 'Skills standards', detail: `${standardSourceOptions.length} standards` },
                  { mode: 'profile' as const, title: 'KSB profiles', detail: `${profileSourceOptions.length} profiles` },
                ].map(item => (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => {
                      setSourceMode(item.mode);
                      setSelectedSourceId('');
                      setWeightsByKsbId({});
                      setSelectedKsbIds(new Set());
                    }}
                    className={`rounded-xl border px-3 py-2 text-left transition-smooth ${sourceMode === item.mode ? 'border-primary-300 bg-primary-50 ring-2 ring-primary-100' : 'border-background-200 bg-background-50 hover:bg-background-100'}`}
                  >
                    <span className="block text-[12px] font-bold text-foreground-900">{item.title}</span>
                    <span className="mt-0.5 block text-[10px] font-semibold text-foreground-500">{item.detail}</span>
                  </button>
                ))}
              </div>
            </div>
            <SelectInput
              label={sourceMode === 'standard' ? 'Standard' : 'KSB profile'}
              value={selectedSourceValue}
              options={['', ...sourceOptions.map(source => source.id)]}
              labels={sourceLabels}
              onChange={value => {
                setSelectedSourceId(value);
                setWeightsByKsbId({});
                setSelectedKsbIds(new Set());
              }}
            />
          </div>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {sourceKsbOptions.map(option => {
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
                      <i className={`${tone.icon} text-[13px]`}></i>
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
                  <div className="flex shrink-0 items-end gap-2">
                    <label className="block">
                      <span className="text-[9px] font-semibold uppercase text-foreground-400">Weight</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={clampKsbWeight(weightForOption(option))}
                        onChange={event => updateOptionWeight(option, Number(event.target.value))}
                        className="mt-1 h-8 w-20 rounded-md border border-foreground-200/60 bg-background-50 px-2 text-[12px] font-bold text-foreground-900 outline-none focus:border-primary-300"
                      />
                    </label>
                  </div>
                </div>
              </div>
              );
            })}
            {!selectedSource && <EmptyState text={sourceMode === 'standard' ? 'Select a Skills England standard to load its KSBs.' : 'Select a KSB profile to load its KSBs.'} />}
            {selectedSource && !sourceKsbOptions.length && <EmptyState text="No KSBs are available for this selection." />}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-background-200 pt-3">
            <p className="text-[11px] font-semibold text-foreground-500">{selectedItems.length} KSB{selectedItems.length === 1 ? '' : 's'} selected</p>
            <button
              type="button"
              disabled={!selectedItems.length}
              onClick={() => onAddMany(selectedItems)}
              className="h-9 rounded-lg bg-primary-500 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-foreground-200 disabled:text-foreground-400"
            >
              Add KSBs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewModuleChoiceModal({ programmeOptions, defaultProgramme, onClose, onCreate }: {
  programmeOptions: string[];
  defaultProgramme?: string;
  onClose: () => void;
  onCreate: (input: NewModuleInput) => void;
}) {
  const usableProgrammes = programmeOptions.length ? programmeOptions : ['Unassigned programme'];
  const [programme, setProgramme] = useState(defaultProgramme || usableProgrammes[0]);
  const [customTitle, setCustomTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sessionsNumber, setSessionsNumber] = useState(1);
  const [startDate, setStartDate] = useState(todayDateInput());
  const suggestedEndDate = calculateWeeklyEndDate(startDate, sessionsNumber);
  const [endDate, setEndDate] = useState(suggestedEndDate);
  const [endDateTouched, setEndDateTouched] = useState(false);
  const dateError = Boolean(startDate && endDate && endDate < startDate);
  const canCreate = Boolean(customTitle.trim()) && Boolean(programme) && sessionsNumber > 0 && Boolean(startDate) && Boolean(endDate) && !dateError;

  useEffect(() => {
    if (!endDateTouched) setEndDate(suggestedEndDate);
  }, [endDateTouched, suggestedEndDate]);

  const handleCreate = () => {
    if (!canCreate) return;
    onCreate({
      programme,
      title: customTitle.trim(),
      description,
      sessionsNumber,
      startDate,
      endDate,
    });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-background-50 shadow-2xl"
        onClick={event => event.stopPropagation()}
        onSubmit={event => {
          event.preventDefault();
          handleCreate();
        }}
      >
        <div className="relative shrink-0 overflow-hidden bg-primary-950 px-5 py-5 text-white">
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/10" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/15">
                <i className="ri-layout-4-line text-xl"></i>
              </span>
              <div>
                <h3 className="text-base font-heading font-bold text-white">Create new module</h3>
                <p className="mt-1 text-[12px] text-white/70">Set the core module details, then open the builder to add weeks and components.</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="w-8 h-8 shrink-0 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20" aria-label="Close"><i className="ri-close-line"></i></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3">
              <p className="text-[10px] font-bold uppercase text-primary-600">Step 1</p>
              <p className="mt-1 text-[12px] font-bold text-primary-950">Programme</p>
            </div>
            <div className="rounded-xl border border-background-200 bg-background-100/60 px-4 py-3">
              <p className="text-[10px] font-bold uppercase text-foreground-400">Step 2</p>
              <p className="mt-1 text-[12px] font-bold text-foreground-900">Module identity</p>
            </div>
            <div className="rounded-xl border border-background-200 bg-background-100/60 px-4 py-3">
              <p className="text-[10px] font-bold uppercase text-foreground-400">Step 3</p>
              <p className="mt-1 text-[12px] font-bold text-foreground-900">Sessions and dates</p>
            </div>
          </div>

          <section className="rounded-2xl border border-background-200 bg-background-50 p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-700"><i className="ri-book-open-line"></i></span>
              <div>
                <p className="text-[13px] font-bold text-foreground-950">Module setup</p>
                <p className="text-[11px] text-foreground-500">Only new draft modules are created here.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <SelectInput label="Programme" value={programme} options={usableProgrammes} onChange={setProgramme} />
              <TextInput label="Module title" value={customTitle} onChange={setCustomTitle} required />
            </div>
            <div className="mt-4">
              <TextArea label="Short description" value={description} onChange={setDescription} rows={3} />
            </div>
          </section>

          <section className="rounded-2xl border border-background-200 bg-background-50 p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary-100 text-secondary-700"><i className="ri-calendar-check-line"></i></span>
              <div>
                <p className="text-[13px] font-bold text-foreground-950">Delivery shape</p>
                <p className="text-[11px] text-foreground-500">Set the session count and module date range.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <NumberInput label="Number of sessions" value={sessionsNumber} min={1} step={1} onChange={value => setSessionsNumber(Math.max(1, Math.round(value || 1)))} />
              <DateInput label="Module start date" value={startDate} onChange={value => {
                setStartDate(value);
                if (!endDateTouched) setEndDate(calculateWeeklyEndDate(value, sessionsNumber));
              }} />
              <DateInput label="Module end date" value={endDate} onChange={value => {
                setEndDate(value);
                setEndDateTouched(true);
              }} />
            </div>
            <div className="mt-3 flex flex-col gap-2 rounded-xl border border-background-200 bg-background-100/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className={`text-[11px] font-semibold ${dateError ? 'text-red-600' : 'text-foreground-500'}`}>
                {dateError ? 'End date must be on or after the start date.' : `${sessionsNumber} weekly session${sessionsNumber === 1 ? '' : 's'} from ${startDate || 'start date'} to ${endDate || 'end date'}.`}
              </p>
              <button
                type="button"
                onClick={() => {
                  setEndDate(suggestedEndDate);
                  setEndDateTouched(false);
                }}
                className="w-fit rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-[11px] font-bold text-primary-700 hover:bg-primary-100"
              >
                Use suggested end: {suggestedEndDate || 'Set start date'}
              </button>
            </div>
          </section>

          <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3">
            <p className="text-[11px] font-semibold text-primary-800">The module will be saved as a draft and opened immediately in the Module Builder.</p>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-background-200 text-[12px] font-semibold text-foreground-700 hover:bg-background-100">Cancel</button>
            <button type="submit" disabled={!canCreate} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-500 px-5 py-2 text-[12px] font-bold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60">
              <i className="ri-add-circle-line"></i>Create and open builder
            </button>
          </div>
        </div>
      </form>
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
            <p className="mt-1 text-[12px] text-white/70">Set the module details first, then open the builder to add weeks, lessons and KSBs.</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="w-8 h-8 shrink-0 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20 disabled:opacity-50" aria-label="Close"><i className="ri-close-line"></i></button>
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
                <span className="flex items-center gap-2 text-[13px] font-bold text-foreground-950"><i className="ri-layout-row-line text-primary-600"></i>Blank builder</span>
                <span className="mt-1 block text-[11px] leading-relaxed text-foreground-500">Create the module only. Add Week 1 manually when you are ready.</span>
              </button>
              <button
                type="button"
                onClick={() => setStartMode('weeks')}
                className={`rounded-xl border px-4 py-3 text-left transition-smooth ${startMode === 'weeks' ? 'border-primary-300 bg-primary-50 ring-2 ring-primary-100' : 'border-background-200 bg-background-50 hover:bg-background-100'}`}
              >
                <span className="flex items-center gap-2 text-[13px] font-bold text-foreground-950"><i className="ri-calendar-check-line text-primary-600"></i>Pre-create weeks</span>
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
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="ri-close-line"></i></button>
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

function ComponentKsbChips({ mappings }: { mappings: KsbMapping[] }) {
  if (!mappings.length) {
    return <span className="mt-1 block text-[9px] font-medium text-foreground-300">No KSBs mapped</span>;
  }
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {mappings.map(mapping => (
        <span
          key={mapping.id}
          title={mapping.description || `${mapping.code} applied`}
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${ksbCodeChipClass(mapping.code)}`}
        >
          {mapping.code} applied
          <span className="rounded-full bg-white/70 px-1 text-[8px]">{Number(mapping.weight || 0)}%</span>
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
  }));
}

function ksbStandardSourceId(standard: CurriculumStandard) {
  return `standard:${standard.id}`;
}

function ksbSetSourceId(set: CurriculumKsbSet) {
  const key = set.frameworkId || set.profileId || set.programmeId || set.programmeName || set.standard;
  return `profile:${String(key || 'ksb-set').trim()}`;
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
    const setCandidates = [
      set.frameworkId,
      set.profileId,
      set.programmeId,
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

function KsbCards({ title, mappings, onAdd, onRemove, onWeightChange }: { title: string; mappings: KsbMapping[]; onAdd?: () => void; onRemove: (mappingId: string) => void; onWeightChange?: (mappingId: string, weight: number) => void }) {
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
            <i className="ri-add-line"></i>
            KSB
          </button>
        )}
      </div>
      <div className="space-y-2">
        {mappings.map(mapping => (
          <KsbCard
            key={mapping.id}
            mapping={mapping}
            onRemove={() => onRemove(mapping.id)}
            onWeightChange={onWeightChange ? weight => onWeightChange(mapping.id, weight) : undefined}
          />
        ))}
        {!mappings.length && <p className="text-[11px] text-foreground-400">No KSBs mapped.</p>}
      </div>
    </div>
  );
}

function KsbCard({ mapping, onRemove, onWeightChange }: { mapping: KsbMapping; onRemove?: () => void; onWeightChange?: (weight: number) => void }) {
  const tone = ksbVisualTone(mapping.code, mapping.type);
  return (
    <div className={`rounded-lg border border-l-4 p-2 ${tone.row}`} title={mapping.description || `${mapping.code} applied`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${tone.iconClass}`}>
          <i className={`${tone.icon} text-[13px]`}></i>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <p className="truncate text-[11px] font-bold text-foreground-900">{mapping.code} applied</p>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tone.badgeClass}`}>{tone.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tone.weightClass}`}>{Number(mapping.weight || 0)}%</span>
          </div>
          {onWeightChange && (
            <label className="mt-1 flex items-center gap-2 text-[10px] font-semibold uppercase text-foreground-400">
              Weight
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={Number(mapping.weight || 0)}
                onChange={event => onWeightChange(clampKsbWeight(Number(event.target.value)))}
                className="h-7 w-20 rounded-md border border-foreground-200/60 bg-background-50 px-2 text-[12px] font-bold text-foreground-900 outline-none focus:border-primary-300"
              />
              %
            </label>
          )}
        </div>
        {onRemove && <button onClick={onRemove} className="h-6 w-6 shrink-0 rounded-md text-red-500 hover:bg-red-50"><i className="ri-close-line text-xs"></i></button>}
      </div>
    </div>
  );
}

function WeekKsbCodeSection({ mappings }: { mappings: KsbMapping[] }) {
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
                {group.items.map(mapping => <KsbCodeOnlyChip key={mapping.id} mapping={mapping} />)}
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

function KsbCodeOnlyChip({ mapping }: { mapping: KsbMapping }) {
  return (
    <span
      title={mapping.description || mapping.code}
      className={`rounded-md border px-2 py-1 text-[10px] font-bold ${ksbCodeChipClass(mapping.code)}`}
    >
      {mapping.code}
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

function TextInput({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}{required ? ' *' : ''}</span>
      <input required={required} value={value} onChange={event => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-foreground-200/60 bg-background-50 px-3 text-[13px] text-foreground-900 transition-smooth focus:border-primary-300 focus:outline-none" />
    </label>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <input type="date" value={value} onChange={event => onChange(event.target.value)} className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-300" />
    </label>
  );
}

function ReadOnlyInput({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <input type="text" value={value} readOnly className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 outline-none" />
    </label>
  );
}

function TextArea({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <textarea value={value} onChange={event => onChange(event.target.value)} rows={rows} className="mt-1 w-full resize-y rounded-lg border border-foreground-200/60 bg-background-50 px-3 py-2 text-[13px] text-foreground-900 transition-smooth focus:border-primary-300 focus:outline-none" />
    </label>
  );
}

function formatNumberDraft(value: number) {
  return Number.isFinite(value) ? String(value) : '';
}

function parseNumberDraft(value: string) {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function NumberInput({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  const [draft, setDraft] = useState(formatNumberDraft(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(formatNumberDraft(value));
  }, [focused, value]);

  const updateDraft = (nextValue: string) => {
    setDraft(nextValue);
    const parsed = parseNumberDraft(nextValue);
    if (parsed !== null) onChange(parsed);
  };

  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <input
        type="number"
        value={focused ? draft : formatNumberDraft(value)}
        min={min}
        max={max}
        step={step}
        onFocus={() => {
          setFocused(true);
          setDraft(formatNumberDraft(value));
        }}
        onBlur={() => {
          setFocused(false);
          const parsed = parseNumberDraft(draft);
          setDraft(parsed === null ? formatNumberDraft(value) : formatNumberDraft(parsed));
        }}
        onChange={event => updateDraft(event.target.value)}
        className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-300"
      />
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

function SelectInput({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-300">
        {options.map(option => <option key={option || 'empty'} value={option}>{labels?.[option] || option}</option>)}
      </select>
    </label>
  );
}

function Checkbox({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[12px] font-semibold text-foreground-700 ${disabled ? 'opacity-60' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="accent-primary-600" />
      <span>{label}</span>
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes = status === 'published' ? 'bg-emerald-100 text-emerald-700' : status === 'draft' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700';
  const label = status === 'review' ? 'in review' : status;
  return <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${classes}`}>{label}</span>;
}

function ModuleCatalogueCard({
  module,
  onBuild,
  onSettings,
  onDuplicate,
  onDelete,
}: {
  module: ModuleBuilderListItem;
  onBuild: () => void;
  onSettings: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const componentCount = module.weekStructure.reduce((total, week) => total + week.components.length, 0);
  const hasContent = componentCount > 0;

  return (
    <article className="group rounded-xl border border-background-200 bg-background-50 p-4 shadow-sm transition-smooth hover:border-primary-200 hover:shadow-md">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${hasContent ? 'bg-primary-100 text-primary-700' : 'bg-amber-100 text-amber-700'}`}>
              <i className={hasContent ? 'ri-layout-4-line text-base' : 'ri-draft-line text-base'}></i>
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-[14px] font-heading font-bold text-foreground-950">{module.title}</h3>
              <p className="mt-0.5 text-[11px] text-foreground-500">{moduleListSubLabel(module)}</p>
            </div>
            <StatusBadge status={module.status} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-semibold text-foreground-600">
              {cleanModuleMeta(module.programmeName) || 'No programme'}
            </span>
            <ModuleMetricPill icon="ri-calendar-check-line" label={`${module.sessionsNumber || module.weeks || 0} sessions`} />
            <ModuleMetricPill icon="ri-stack-line" label={`${module.weekStructure.length || module.weeks || 0} weeks`} />
            <ModuleMetricPill icon="ri-puzzle-line" label={`${componentCount} components`} tone={hasContent ? 'default' : 'muted'} />
          </div>
        </div>

        <ModuleDeliverySummary module={module} />

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button onClick={onBuild} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-2 text-[11px] font-bold text-white transition-smooth hover:bg-primary-600">
            <i className="ri-hammer-line"></i>
            Build
          </button>
          <IconButton label="Module settings" icon="ri-settings-3-line" onClick={onSettings} />
          <IconButton label="Duplicate" icon="ri-file-copy-line" onClick={onDuplicate} />
          <IconButton label="Delete module" icon="ri-delete-bin-line" tone="danger" onClick={onDelete} />
        </div>
      </div>
    </article>
  );
}

function ModuleMetricPill({ icon, label, tone = 'default' }: { icon: string; label: string; tone?: 'default' | 'muted' }) {
  const classes = tone === 'muted'
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : 'border-background-200 bg-background-50 text-foreground-600';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${classes}`}>
      <i className={`${icon} text-[11px]`}></i>
      {label}
    </span>
  );
}

function ModuleDeliverySummary({ module }: { module: ModuleBuilderListItem }) {
  const usages = module.deliveryUsages || [];
  if (!usages.length) {
    return (
      <div className="rounded-xl border border-dashed border-background-300 bg-background-100/40 px-3 py-2">
        <p className="text-[10px] font-bold uppercase text-foreground-400">Delivery usage</p>
        <p className="mt-1 text-[12px] font-semibold text-foreground-600">Not attached to a delivery yet</p>
      </div>
    );
  }
  const visible = usages.slice(0, 2);
  const remaining = usages.length - visible.length;
  return (
    <div className="rounded-xl border border-primary-100 bg-primary-50/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase text-primary-700">Used in {usages.length} {usages.length === 1 ? 'delivery' : 'deliveries'}</p>
        <i className="ri-route-line text-primary-500"></i>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
      {visible.map(usage => (
        <span key={usage.id} className="rounded-full bg-background-50 px-2 py-1 text-[10px] font-semibold text-foreground-700 shadow-sm">
          {formatDeliveryUsage(usage)}
        </span>
      ))}
      {remaining > 0 && (
        <span className="rounded-full bg-primary-100 px-2 py-1 text-[10px] font-bold text-primary-700">+{remaining} more</span>
      )}
      </div>
    </div>
  );
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
  const title = cleanModuleMeta(module.title).toLowerCase();
  const programme = cleanModuleMeta(module.programmeName).toLowerCase();
  if (!module.sourceModule) return `local::${programme}::${title || module.catalogueId}`;
  return `${programme || 'programme'}::${title || module.catalogueId}`;
}

function moduleDeliveryUsage(module: ModuleCatalogueItem): ModuleDeliveryUsage | null {
  const cohort = cleanModuleMeta(module.sourceModule?.cohort);
  const group = cleanModuleMeta(module.sourceModule?.group);
  if (!cohort && !group) return null;
  return {
    id: [
      module.sourceModule?.id,
      module.sourceModule?.sourceId,
      module.catalogueId,
      cohort,
      group,
    ].filter(Boolean).join('::'),
    moduleId: String(module.sourceModule?.id || module.id || ''),
    sourceId: String(module.sourceModule?.sourceId || module.sourceId || ''),
    catalogueId: String(module.catalogueId || ''),
    structureId: moduleStructureIdentifier(module),
    programmeId: String(module.programmeId || module.sourceModule?.programmeId || ''),
    programme: module.programmeName || module.sourceModule?.programme || 'Unassigned programme',
    moduleTitle: module.title || module.sourceModule?.name || 'Untitled module',
    cohort,
    group,
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

function moduleDeepLinkIdentifiers(module: ModuleBuilderListItem) {
  const values = [
    module.catalogueId,
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

function readWizardModuleDraft(storageKey: string): WizardModuleDraftPayload | null {
  if (!storageKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as WizardModuleDraftPayload;
  } catch {
    return null;
  }
}

function moduleOptionKey(module: ModuleCatalogueItem) {
  return [
    module.catalogueId,
    module.id,
    module.sourceModule?.id,
    module.sourceModule?.sourceId,
    cleanModuleMeta(module.sourceModule?.cohort),
    cleanModuleMeta(module.sourceModule?.group),
  ].filter(Boolean).join('::');
}

function moduleStructureIdentifier(module: ModuleCatalogueItem) {
  const sourceId = String(module.sourceModule?.id || module.id || '');
  return sourceId.startsWith('training-module-') ? sourceId : module.catalogueId;
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

function todayDateInput() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calculateWeeklyEndDate(startDate: string, sessionsNumber: number) {
  if (!startDate) return '';
  const [year, month, day] = startDate.split('-').map(Number);
  if (!year || !month || !day) return '';
  const sessions = Math.max(1, Math.round(Number(sessionsNumber) || 1));
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + sessions * 7);
  const endYear = date.getFullYear();
  const endMonth = String(date.getMonth() + 1).padStart(2, '0');
  const endDay = String(date.getDate()).padStart(2, '0');
  return `${endYear}-${endMonth}-${endDay}`;
}

function moduleSelectLabel(module: ModuleCatalogueItem) {
  const identity = moduleIdentityText(module);
  return identity ? `${module.title} - ${identity}` : module.title;
}

function moduleListSubLabel(module: ModuleCatalogueItem) {
  const usages = (module as ModuleBuilderListItem).deliveryUsages || [];
  if (usages.length) {
    const deliveryWord = usages.length === 1 ? 'delivery' : 'deliveries';
    return `Master module - used in ${usages.length} ${deliveryWord}`;
  }
  const description = cleanModuleMeta(module.description);
  return description || 'Master module - not attached to a delivery yet';
}

function moduleDeliverySearchText(module: ModuleBuilderListItem) {
  return (module.deliveryUsages || [])
    .map(usage => `${usage.cohort} ${usage.group} ${usage.deliveryStatus}`)
    .join(' ');
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
  const sessions = module.sessionsNumber || module.weeks || 0;
  const range = module.startDate && module.endDate ? ` - ${module.startDate} to ${module.endDate}` : '';
  return `${sessions} session${sessions === 1 ? '' : 's'} / ${module.weeks} weeks${range}`;
}

function nextModuleTitle(modules: ModuleCatalogueItem[]) {
  const highestNumber = modules.reduce((highest, module) => {
    const match = module.title.trim().match(/^M(\d+)\b/i);
    return match ? Math.max(highest, Number(match[1]) || 0) : highest;
  }, 0);
  const nextNumber = highestNumber + 1;
  return `M${nextNumber} - Module ${nextNumber}`;
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
    <button onClick={onClick} title={label} aria-label={label} className={`w-7 h-7 rounded-md flex items-center justify-center transition-smooth ${classes}`}>
      <i className={`${icon} text-sm`}></i>
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
      <i className="ri-layout-row-line text-3xl text-foreground-300"></i>
      <p className="mt-2 text-sm font-semibold text-foreground-700">No week selected</p>
      <button onClick={onAddWeek} className="mt-4 px-4 py-2 rounded-lg bg-primary-500 text-white text-[12px] font-semibold hover:bg-primary-600">Add week</button>
    </section>
  );
}

function StatsCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  const bgMap: Record<string, string> = { primary: 'bg-primary-100 text-primary-600', emerald: 'bg-emerald-100 text-emerald-600', accent: 'bg-accent-100 text-accent-600', secondary: 'bg-secondary-100 text-secondary-600' };
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-7 h-7 rounded-md ${bgMap[color]} flex items-center justify-center`}>
          <i className={`${icon} text-xs`}></i>
        </span>
        <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900">{value}</p>
    </div>
  );
}

function StatsCardSkeleton() {
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-md bg-background-200"></span>
        <span className="h-2.5 w-24 rounded bg-background-200"></span>
      </div>
      <span className="block h-6 w-12 rounded bg-background-200"></span>
    </div>
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
const DEFAULT_KSB_WEIGHT = 10;

function defaultKsbWeight() {
  return DEFAULT_KSB_WEIGHT;
}

function clampKsbWeight(value: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed * 100) / 100));
}

function addKsbMapping(module: ModuleCatalogueItem, target: KsbTarget, option: KsbOption, weight = defaultKsbWeight()): ModuleCatalogueItem {
  const mapping: KsbMapping = {
    id: makeAuthoringId('KSBMAP'),
    ksbId: option.id,
    code: option.code,
    description: option.description,
    type: DEFAULT_KSB_MAPPING_TYPE,
    weight: clampKsbWeight(weight),
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

function moveComponent(weeks: ModuleWeek[], drag: { weekId: string; componentId: string }, targetWeekId: string, targetComponentId?: string): ModuleWeek[] {
  let moved: ModuleComponent | null = null;
  const without = weeks.map(week => {
    if (week.id !== drag.weekId) return week;
    moved = week.components.find(component => component.id === drag.componentId) || null;
    return { ...week, components: week.components.filter(component => component.id !== drag.componentId) };
  });
  if (!moved) return weeks;
  return without.map(week => {
    if (week.id !== targetWeekId) return week;
    const nextComponent = { ...moved, weekId: targetWeekId };
    const targetIndex = targetComponentId ? week.components.findIndex(component => component.id === targetComponentId) : week.components.length;
    const next = [...week.components];
    next.splice(targetIndex < 0 ? next.length : targetIndex, 0, nextComponent);
    return { ...week, components: next };
  });
}

function uniqueMappings(mappings: KsbMapping[]) {
  const seen = new Set<string>();
  return mappings.filter(mapping => {
    const key = String(mapping.code || '').trim().toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function createWeekTemplateComponents(week: ModuleWeek, options: { skipExistingTypes?: boolean } = {}) {
  const existingTypes = new Set(week.components.map(component => component.type));
  const templates: Array<{ type: ModuleComponentType; title: string; otjh: number; points: number; description: string }> = [
    { type: 'live-session', title: 'Live Teams session', otjh: 2, points: 20, description: `Tutor-led live session for Week ${week.weekNumber}.` },
    { type: 'recording-placeholder', title: 'Recorded session placeholder', otjh: 2, points: 10, description: `Auto-published recording placeholder for Week ${week.weekNumber}.` },
    { type: 'video', title: 'Pre-recorded video', otjh: 0, points: 10, description: 'Short video introducing the weekly topic.' },
    { type: 'podcast', title: 'Podcast', otjh: 2, points: 10, description: 'Audio learning resource for this week.' },
    { type: 'reading', title: 'Reading text', otjh: 2, points: 10, description: 'Core reading material for the weekly topic.' },
    { type: 'powerpoint', title: 'PowerPoint', otjh: 2, points: 5, description: 'Slide deck for the week.' },
    { type: 'quiz', title: 'Weekly quiz', otjh: 2, points: 20, description: 'Knowledge check for this week.' },
  ];

  return templates
    .filter(template => !options.skipExistingTypes || !existingTypes.has(template.type))
    .map((template, index) => ({
      ...createEmptyComponent(week.id, template.type, week.components.length + index + 1),
      title: template.title,
      description: template.description,
      expectedOtjh: template.otjh,
      points: template.points,
    }));
}

function createNamedComponent(week: ModuleWeek, type: ModuleComponentType) {
  const component = createEmptyComponent(week.id, type, week.components.length + 1);
  const label = componentTypes.find(item => item.type === type)?.label || 'Component';
  return {
    ...component,
    title: label,
  };
}

function cloneComponentForWeek(component: ModuleComponent, weekId: string, title: string): ModuleComponent {
  const clonedId = createLocalComponentId();
  return {
    ...component,
    id: clonedId,
    weekId,
    title,
    settings: { ...(component.settings || {}) },
    ksbMappings: component.ksbMappings.map(mapping => ({
      ...mapping,
      id: makeAuthoringId('KSBMAP'),
    })),
  };
}

function createLocalComponentId() {
  return makeAuthoringId('COMP');
}

function lessonTypeDescription(type: ModuleComponentType) {
  const descriptions: Record<ModuleComponentType, string> = {
    'live-session': 'Tutor-led session via Teams',
    'recording-placeholder': 'Auto-published after live session',
    video: 'Upload or link a video',
    podcast: 'Upload audio or podcast link',
    reading: 'PDF, Word, or typed text',
    powerpoint: 'Slide deck for the week',
    quiz: 'Short weekly check',
    assignment: 'Monthly submission task',
    reflection: 'Learner written reflection',
    'workplace-evidence': 'Workplace artefact upload',
    checkpoint: 'End-of-month KSB check',
    'monthly-ksb-quiz': 'Tracks KSB progression',
    'coaching-preparation': 'Monthly coaching meeting prep',
  };
  return descriptions[type] || 'Add a lesson component';
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

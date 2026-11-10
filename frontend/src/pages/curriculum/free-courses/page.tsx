import { useEffect, useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { Link, useNavigate } from 'react-router-dom';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { curriculumNavItems } from '@/mocks/navigation';
import { formatHoursMinutes } from '@/lib/format';
import { CurriculumApiError, cloneModuleToFreeCourseAuthoring, createFreeCourseAuthoring, createFreeCourseQuiz, deleteFreeCourseAuthoring, fetchCurriculumProgrammeDetail, fetchCurriculumProgrammes, fetchFreeCourseAuthoringCatalogue, fetchFreeCourseAuthoringCourse, injectFreeCourseIntoGroup, unlinkFreeCourseQuiz, updateFreeCourseAuthoring, type ConvertFreeCourseResult, type CurriculumModule, type CurriculumProgramme, type CurriculumProgrammeDetail, type FreeCourseAuthoringDocument, type FreeProgrammeModule } from '@/lib/curriculumApi';
import {
  fetchWeekTemplateDetail,
  fetchWeekTemplates,
  type ModuleComponent,
  type WeekTemplate,
} from '@/pages/curriculum/week-builder/weekTemplateData';

type ComponentKind = 'video' | 'reading' | 'audio' | 'powerpoint' | 'quiz' | 'assignment';

interface FreeCourseComponent {
  id: string;
  kind: ComponentKind;
  code: string;
  title: string;
  meta: string;
  duration: string;
  details: string;
  rawComponent: ModuleComponent;
  sourceWeekId?: string;
  sourceWeekTitle?: string;
  manualUnlock?: boolean;
  locked?: boolean;
  persistedId?: string;
  legacyCopiedFromWeekId?: string | null;
}

interface FreeCourse {
  id: string;
  title: string;
  subtitle: string;
  coverImageUrl: string;
  isForSale: boolean;
  price: string;
  category: string;
  audience: string;
  color: string;
  accent: string;
  components: FreeCourseComponent[];
}

interface SavedFreeCourseCard {
  key: string;
  courseId: string;
  title: string;
  description: string;
  coverImageUrl: string;
  isForSale: boolean;
  price: string;
  weeks: FreeProgrammeModule[];
  componentCount: number;
  totalOtjh: number;
  revision: string;
}

const COMPONENT_META: Record<ComponentKind, { label: string; icon: string; color: string }> = {
  video: { label: 'Video lesson', icon: 'ri-video-line', color: 'text-orange-600 bg-orange-50 border-orange-100' },
  reading: { label: 'Reading material', icon: 'ri-file-text-line', color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
  audio: { label: 'Audio lesson', icon: 'ri-headphone-line', color: 'text-sky-600 bg-sky-50 border-sky-100' },
  powerpoint: { label: 'PowerPoint', icon: 'ri-presentation-line', color: 'text-violet-600 bg-violet-50 border-violet-100' },
  quiz: { label: 'Quiz', icon: 'ri-questionnaire-line', color: 'text-amber-600 bg-amber-50 border-amber-100' },
  assignment: { label: 'Assignment', icon: 'ri-file-edit-line', color: 'text-fuchsia-600 bg-fuchsia-50 border-fuchsia-100' },
};

function requestKey(prefix = 'free-course') {
  const value = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${value}`;
}

function nextComponentCode(kind: ComponentKind, count: number) {
  const prefix = kind === 'quiz' ? 'Q' : kind === 'video' ? 'P-VID' : kind === 'audio' ? 'P-AUD' : kind === 'powerpoint' ? 'P-PPT' : kind === 'assignment' ? 'P-ASG' : 'P-RD';
  return `${prefix}${count + 1}`;
}

function componentKindFromWeek(type: string): ComponentKind {
  if (type === 'reading') return 'reading';
  if (type === 'podcast') return 'audio';
  if (type === 'powerpoint') return 'powerpoint';
  if (type === 'quiz') return 'quiz';
  if (type === 'assignment') return 'assignment';
  return 'video';
}

function weekComponentToFreeComponent(component: ModuleComponent, week: WeekTemplate, index: number): FreeCourseComponent {
  const kind = componentKindFromWeek(component.type);
  const meta = COMPONENT_META[kind];
  const duration = kind === 'quiz'
    ? `${Math.max(1, Number(component.points) || 10)} points`
    : component.expectedOtjh ? formatHoursMinutes(component.expectedOtjh) : `${Math.max(1, Number(component.points) || 5)} pts`;
  return {
    id: `${week.id}-${component.id}-${index}`,
    kind,
    code: nextComponentCode(kind, index),
    title: component.title || meta.label,
    meta: meta.label,
    duration,
    details: component.description || `${meta.label} imported from "${week.title}".`,
    rawComponent: component,
    sourceWeekId: week.id,
    sourceWeekTitle: week.title,
    manualUnlock: Boolean(component.settings?.manualUnlock),
    locked: kind === 'quiz',
  };
}

function freeModuleComponentToCourseComponent(component: FreeProgrammeModule['components'][number], week: FreeProgrammeModule, index: number): FreeCourseComponent {
  const type = component.type as ModuleComponent['type'];
  const sourceWeekId = week.freeCourseWeekId || week.id;
  const rawComponent: ModuleComponent = {
    id: component.id,
    weekId: sourceWeekId,
    type,
    title: component.title,
    description: component.description,
    expectedOtjh: component.expectedOtjh,
    points: component.points,
    reflectionRequired: component.reflectionRequired,
    // Free courses keep their components in their own tables, which have no
    // reflection-question column — the legacy settings key is all there is.
    reflectionQuestion: String(component.settings?.reflectionPrompt ?? ''),
    workplaceEvidenceRequired: component.workplaceEvidenceRequired,
    tutorValidationRequired: component.tutorValidationRequired,
    // Free-course components have no coach-validation column of their own, and
    // the flag is on unless an author turned it off.
    coachValidationRequired: true,
    ksbMappings: [],
    settings: (component.settings || {}) as ModuleComponent['settings'],
  };
  const kind = componentKindFromWeek(component.type);
  const meta = COMPONENT_META[kind];
  const duration = kind === 'quiz'
    ? `${Math.max(1, Number(component.points) || 10)} points`
    : component.expectedOtjh ? formatHoursMinutes(component.expectedOtjh) : `${Math.max(1, Number(component.points) || 5)} pts`;
  return {
    id: component.id,
    kind,
    code: nextComponentCode(kind, index),
    title: component.title || meta.label,
    meta: meta.label,
    duration,
    details: component.description || `${meta.label} imported from "${week.weekTitle || 'week'}".`,
    rawComponent,
    sourceWeekId,
    sourceWeekTitle: week.weekTitle || 'Untitled week',
    manualUnlock: Boolean(component.settings?.manualUnlock),
    locked: kind === 'quiz',
    persistedId: component.id,
    legacyCopiedFromWeekId: week.legacyCopiedFromWeekId,
  };
}

function authoringDocumentToModules(document: FreeCourseAuthoringDocument): FreeProgrammeModule[] {
  return document.weeks.map(week => ({
    id: week.freeCourseWeekId,
    freeCourseWeekId: week.freeCourseWeekId,
    legacyCopiedFromWeekId: week.legacyCopiedFromWeekId,
    weekId: week.legacyCopiedFromWeekId || '',
    courseId: document.course.courseId,
    weekNumber: week.weekNumber,
    weekTitle: week.title,
    courseName: document.course.courseName,
    title: document.course.courseName,
    description: document.course.description,
    coverImageUrl: document.course.coverImageUrl,
    isForSale: document.course.isForSale,
    price: document.course.price,
    currency: 'GBP',
    displayOrder: week.displayOrder,
    componentCount: week.components.length,
    totalOtjh: week.components.reduce((sum, component) => sum + Number(component.expectedOtjh || 0), 0),
    components: week.components.map(component => ({
      ...component,
      expectedOtjh: Number(component.expectedOtjh || 0),
      weekId: week.legacyCopiedFromWeekId || '',
    })),
  }));
}

async function loadCanonicalFreeCourses(signal?: AbortSignal) {
  const catalogue = await fetchFreeCourseAuthoringCatalogue(signal);
  const documents = await Promise.all(catalogue.courses.map(course => fetchFreeCourseAuthoringCourse(course.courseId, signal)));
  return { catalogue, documents };
}

export default function FreeCoursesPage() {
  const [course, setCourse] = useState<FreeCourse>({
    id: '',
    title: '',
    subtitle: '',
    coverImageUrl: '',
    isForSale: false,
    price: '',
    category: 'Free Course',
    audience: 'Learners',
    color: '#6d28d9',
    accent: '#22c55e',
    components: [],
  });
  const [selectedComponentId, setSelectedComponentId] = useState('');
  const [completedPreviewIds, setCompletedPreviewIds] = useState<Set<string>>(() => new Set());
  const [weekTemplates, setWeekTemplates] = useState<WeekTemplate[]>([]);
  const [weekLoading, setWeekLoading] = useState(true);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [addingWeekId, setAddingWeekId] = useState<string | null>(null);
  const [expandedWeekIds, setExpandedWeekIds] = useState<Set<string>>(() => new Set());
  const [weekDetails, setWeekDetails] = useState<Record<string, WeekTemplate>>({});
  const [openingWeekId, setOpeningWeekId] = useState<string | null>(null);
  const [savingCourse, setSavingCourse] = useState(false);
  const [savedModules, setSavedModules] = useState<FreeProgrammeModule[]>([]);
  const [catalogueRevision, setCatalogueRevision] = useState('');
  const [documentsByCourse, setDocumentsByCourse] = useState<Record<string, FreeCourseAuthoringDocument>>({});
  const [removedWeekIds, setRemovedWeekIds] = useState<Set<string>>(() => new Set());
  const [weekTitleOverrides, setWeekTitleOverrides] = useState<Record<string, string>>({});
  const [weekOrderIds, setWeekOrderIds] = useState<string[]>([]);
  const [savedCoursesLoading, setSavedCoursesLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingCourseKey, setEditingCourseKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const [convertCard, setConvertCard] = useState<SavedFreeCourseCard | null>(null);
  const [convertProgrammes, setConvertProgrammes] = useState<CurriculumProgramme[]>([]);
  const [convertProgrammesLoading, setConvertProgrammesLoading] = useState(false);
  const [convertProgrammeId, setConvertProgrammeId] = useState('');
  const [convertDetail, setConvertDetail] = useState<CurriculumProgrammeDetail | null>(null);
  const [convertDetailLoading, setConvertDetailLoading] = useState(false);
  const [convertCohortId, setConvertCohortId] = useState('');
  const [convertGroupId, setConvertGroupId] = useState('');
  const [converting, setConverting] = useState(false);
  // Real programmes only — never offer the synthetic FREE-COURSES container.
  const convertProgrammeOptions = useMemo(
    () => convertProgrammes.filter(programme => programme.structureType !== 'free' && (programme.sourceId || programme.id) !== 'FREE-COURSES'),
    [convertProgrammes],
  );
  const convertCohorts = convertDetail?.cohorts ?? [];
  const convertGroups = convertCohorts.find(cohort => cohort.id === convertCohortId)?.groups ?? [];
  // Import a programme module -> a new free course (the reverse direction).
  const [importOpen, setImportOpen] = useState(false);
  const [importProgrammeId, setImportProgrammeId] = useState('');
  const [importDetail, setImportDetail] = useState<CurriculumProgrammeDetail | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importCohortId, setImportCohortId] = useState('');
  const [importGroupId, setImportGroupId] = useState('');
  const [importSearch, setImportSearch] = useState('');
  // Kept as module objects (not ids) so a pick survives switching programme,
  // cohort or group — the scoped list no longer contains it, the selection does.
  const [importSelected, setImportSelected] = useState<CurriculumModule[]>([]);
  const [importSelectionOpen, setImportSelectionOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const moduleKey = (module: CurriculumModule) => module.moduleCatalogueId || module.id;
  const importCohorts = importDetail?.cohorts ?? [];
  const importGroups = useMemo(
    () => importDetail?.cohorts.find(cohort => cohort.id === importCohortId)?.groups ?? [],
    [importDetail, importCohortId],
  );
  // Narrow to the picked group, else the picked cohort's groups, else the whole
  // programme. A module attached to several groups is listed once.
  const importModules = useMemo(() => {
    if (!importDetail) return [];
    const scoped = importGroupId
      ? importGroups.find(group => group.id === importGroupId)?.modules ?? []
      : importCohortId
        ? importGroups.flatMap(group => group.modules)
        : importDetail.flat.modules;
    const seen = new Set<string>();
    return scoped.filter(module => {
      const key = moduleKey(module);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [importDetail, importGroups, importCohortId, importGroupId]);
  // Live, convertible modules only — hide programme-deleted/archived ones.
  const importOptions = useMemo(
    () => importModules.filter(module => !module.isProgrammeDeleted && (module.status || '').toLowerCase() !== 'archived'),
    [importModules],
  );
  const importFiltered = useMemo(() => {
    const term = importSearch.trim().toLowerCase();
    if (!term) return importOptions;
    return importOptions.filter(module =>
      [module.name, module.cohort, module.group].filter(Boolean).some(value => String(value).toLowerCase().includes(term)),
    );
  }, [importOptions, importSearch]);
  const importSelectedKeys = useMemo(() => new Set(importSelected.map(moduleKey)), [importSelected]);
  const toggleImportSelected = (module: CurriculumModule) => {
    const key = moduleKey(module);
    setImportSelected(current => (current.some(item => moduleKey(item) === key)
      ? current.filter(item => moduleKey(item) !== key)
      : [...current, module]));
  };
  const selectedComponent = course.components.find(component => component.id === selectedComponentId) || course.components[0];
  const firstLockedIndex = course.components.findIndex(component => component.kind === 'quiz');
  const learnerCompletedCount = course.components.filter(component => completedPreviewIds.has(component.id)).length;
  const selectedWeekIds = useMemo(() => new Set(course.components.map(component => component.sourceWeekId).filter(Boolean)), [course.components]);
  const draftWeeks = useMemo(() => {
    const weeks: Array<{ id: string; title: string; count: number }> = [];
    course.components.forEach(component => {
      const id = component.sourceWeekId || 'manual-week';
      const existing = weeks.find(week => week.id === id);
      if (existing) existing.count += 1;
      else weeks.push({ id, title: component.sourceWeekTitle || `Week ${weeks.length + 1}`, count: 1 });
    });
    const stored = course.id ? documentsByCourse[course.id] : undefined;
    stored?.weeks.forEach(week => {
      if (!removedWeekIds.has(week.freeCourseWeekId) && !weeks.some(item => item.id === week.freeCourseWeekId)) {
        weeks.push({ id: week.freeCourseWeekId, title: weekTitleOverrides[week.freeCourseWeekId] ?? week.title, count: 0 });
      }
    });
    const order = new Map(weekOrderIds.map((id, index) => [id, index]));
    return weeks.sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  }, [course.components, course.id, documentsByCourse, removedWeekIds, weekTitleOverrides, weekOrderIds]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const controller = new AbortController();
    setWeekLoading(true);
    fetchWeekTemplates({ courseType: 'free' }, controller.signal)
      .then(templates => {
        setWeekTemplates(templates);
        setWeekError(templates.length ? null : 'No saved free week templates found yet. Create a free week in Week Builder first.');
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setWeekTemplates([]);
        setWeekError(err instanceof Error ? err.message : 'Unable to load week templates.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setWeekLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setSavedCoursesLoading(true);
    loadCanonicalFreeCourses(controller.signal)
      .then(({ catalogue, documents }) => {
        setCatalogueRevision(catalogue.revision);
        setDocumentsByCourse(Object.fromEntries(documents.map(document => [document.course.courseId, document])));
        setSavedModules(documents.flatMap(authoringDocumentToModules));
      })
      .catch(() => {
        if (!controller.signal.aborted) setSavedModules([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSavedCoursesLoading(false);
      });
    return () => controller.abort();
  }, []);

  // Load the programme list the first time the convert or import dialog opens.
  // The re-entry guard is the loaded result only (never the loading flag): under
  // StrictMode's mount/abort/remount, gating on the flag would leave it stuck
  // true after the first run's fetch aborts, and the dropdown would never fill.
  useEffect(() => {
    if ((!convertCard && !importOpen) || convertProgrammes.length) return;
    const controller = new AbortController();
    let active = true;
    setConvertProgrammesLoading(true);
    fetchCurriculumProgrammes(controller.signal, { visibility: 'all' })
      .then(programmes => { if (active) setConvertProgrammes(programmes); })
      .catch(() => { if (active) setConvertProgrammes([]); })
      .finally(() => { if (active) setConvertProgrammesLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [convertCard, importOpen, convertProgrammes.length]);

  // Load the selected programme's cohorts + groups for the cascading dropdowns.
  useEffect(() => {
    if (!convertProgrammeId) {
      setConvertDetail(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setConvertDetailLoading(true);
    setConvertDetail(null);
    // Reads the nested cohorts -> groups only: no stats, components or week components.
    fetchCurriculumProgrammeDetail(convertProgrammeId, controller.signal, { visibility: 'all', deferStats: true, omitComponents: true, omitWeekComponents: true })
      .then(detail => { if (active) setConvertDetail(detail); })
      .catch(() => { if (active) setConvertDetail(null); })
      .finally(() => { if (active) setConvertDetailLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [convertProgrammeId]);

  // Load only the picked programme's modules (with its cohorts + groups for the
  // narrowing dropdowns) — never the whole site's module catalogue.
  useEffect(() => {
    if (!importProgrammeId) {
      setImportDetail(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setImportLoading(true);
    setImportDetail(null);
    // The picker lists module-level fields and the import sends only the
    // module id, so stats, components and week components are left out.
    fetchCurriculumProgrammeDetail(importProgrammeId, controller.signal, { visibility: 'all', deferStats: true, omitComponents: true, omitWeekComponents: true, skipCache: true })
      .then(detail => { if (active) setImportDetail(detail); })
      .catch(() => { if (active) setImportDetail(null); })
      .finally(() => { if (active) setImportLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [importProgrammeId]);

  const totals = useMemo(() => ({
    weeks: selectedWeekIds.size,
    components: course.components.length,
    quizzes: course.components.filter(item => item.kind === 'quiz').length,
  }), [course.components, selectedWeekIds.size]);

  const savedCourseCards = useMemo(() => groupSavedFreeCourses(savedModules, documentsByCourse), [savedModules, documentsByCourse]);

  const refreshSavedCourses = async () => {
    const { catalogue, documents } = await loadCanonicalFreeCourses();
    setCatalogueRevision(catalogue.revision);
    setDocumentsByCourse(Object.fromEntries(documents.map(document => [document.course.courseId, document])));
    setSavedModules(documents.flatMap(authoringDocumentToModules));
  };

  const handleCoverImageUpload = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      await showCurriculumAlert({
        title: 'Choose an image file',
        text: 'Please upload a PNG, JPG, WEBP or similar image.',
        icon: 'warning',
      });
      return;
    }
    if (file.size > 1024 * 1024) {
      await showCurriculumAlert({
        title: 'Image is too large',
        text: 'Please choose an image under 1 MB so the full course stays within the 2 MiB save limit.',
        icon: 'warning',
      });
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Unable to read image.'));
        reader.readAsDataURL(file);
      });
      setCourse(previous => ({ ...previous, coverImageUrl: dataUrl }));
    } catch {
      await showCurriculumAlert({
        title: 'Could not read image',
        text: 'Please try another image file.',
        icon: 'error',
      });
    }
  };

  const resetDraftCourse = () => {
    setCourse(previous => ({ ...previous, id: '', title: '', subtitle: '', coverImageUrl: '', isForSale: false, price: '', components: [] }));
    setSelectedComponentId('');
    setCompletedPreviewIds(new Set());
    setEditingCourseKey(null);
    setRemovedWeekIds(new Set());
    setWeekTitleOverrides({});
    setWeekOrderIds([]);
  };

  const openAddWizard = () => {
    resetDraftCourse();
    setWizardOpen(true);
  };

  const openEditWizard = (card: SavedFreeCourseCard) => {
    const components = card.weeks.flatMap((week, weekIndex) =>
      (week.components || []).map((component, componentIndex) => freeModuleComponentToCourseComponent(component, week, weekIndex + componentIndex)),
    );
    setCourse(previous => ({
      ...previous,
      id: card.courseId,
      title: card.title,
      subtitle: card.description,
      coverImageUrl: card.coverImageUrl,
      isForSale: card.isForSale,
      price: card.price,
      components,
    }));
    setSelectedComponentId(components[0]?.id || '');
    setCompletedPreviewIds(new Set());
    setEditingCourseKey(card.key);
    setWeekOrderIds(card.weeks.map(week => week.freeCourseWeekId || week.id));
    setWizardOpen(true);
  };

  const removeComponent = (componentId: string) => {
    setCourse(previous => ({ ...previous, components: previous.components.filter(item => item.id !== componentId) }));
    setCompletedPreviewIds(previous => {
      const next = new Set(previous);
      next.delete(componentId);
      return next;
    });
  };

  const confirmRemoveComponent = async (component: FreeCourseComponent) => {
    await showCurriculumConfirm({
      title: 'Remove component?',
      text: `"${component.title || 'This component'}" will be removed from this free course.`,
      confirmButtonText: 'Remove',
      cancelButtonText: 'Keep it',
      onConfirm: async () => {
        removeComponent(component.id);
      },
    });
  };

  const addWeekToCourse = async (template: WeekTemplate) => {
    setAddingWeekId(template.id);
    setWeekError(null);
    try {
      const detail = await fetchWeekTemplateDetail(template.id);
      const importedComponents = detail.components.map((component, index) => weekComponentToFreeComponent(component, detail, index));
      if (!importedComponents.length) return;
      setCourse(previous => {
        const existing = previous.components.filter(component => component.sourceWeekId !== detail.id);
        return { ...previous, components: [...existing, ...importedComponents] };
      });
      setRemovedWeekIds(previous => {
        const next = new Set(previous);
        next.delete(detail.id);
        return next;
      });
      setWeekOrderIds(previous => previous.includes(detail.id) ? previous : [...previous, detail.id]);
      setSelectedComponentId(importedComponents[0].id);
      setCompletedPreviewIds(new Set());
    } catch (err) {
      setWeekError(err instanceof Error ? err.message : 'Unable to import this week.');
    } finally {
      setAddingWeekId(null);
    }
  };

  const removeWeekFromCourse = (weekId: string) => {
    setCourse(previous => ({ ...previous, components: previous.components.filter(component => component.sourceWeekId !== weekId) }));
    setRemovedWeekIds(previous => new Set(previous).add(weekId));
    setWeekOrderIds(previous => previous.filter(id => id !== weekId));
    setCompletedPreviewIds(new Set());
  };

  const renameWeek = (weekId: string, title: string) => {
    setWeekTitleOverrides(previous => ({ ...previous, [weekId]: title }));
    setCourse(previous => ({
      ...previous,
      components: previous.components.map(component => component.sourceWeekId === weekId
        ? { ...component, sourceWeekTitle: title }
        : component),
    }));
  };

  const moveWeek = (weekId: string, direction: -1 | 1) => {
    setWeekOrderIds(() => {
      const ids = draftWeeks.map(week => week.id);
      const index = ids.indexOf(weekId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ids.length) return ids;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      return ids;
    });
    setCourse(previous => {
      const ids = Array.from(new Set(previous.components.map(component => component.sourceWeekId || 'manual-week')));
      const index = ids.indexOf(weekId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ids.length) return previous;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      return {
        ...previous,
        components: ids.flatMap(id => previous.components.filter(component => (component.sourceWeekId || 'manual-week') === id)),
      };
    });
  };

  const confirmRemoveDraftWeek = async (week: { id: string; title: string; count: number }) => {
    await showCurriculumConfirm({
      title: 'Remove week?',
      text: `"${week.title || 'This week'}" and its ${week.count} activit${week.count === 1 ? 'y' : 'ies'} will be removed when you save.`,
      confirmButtonText: 'Remove week',
      cancelButtonText: 'Keep it',
      onConfirm: async () => removeWeekFromCourse(week.id),
    });
  };

  const updateSelectedComponent = (patch: { title?: string; details?: string }) => {
    if (!selectedComponent) return;
    setCourse(previous => ({
      ...previous,
      components: previous.components.map(component => component.id === selectedComponent.id ? {
        ...component,
        ...patch,
        rawComponent: {
          ...component.rawComponent,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.details !== undefined ? { description: patch.details } : {}),
        },
      } : component),
    }));
  };

  const confirmRemoveWeekFromCourse = async (template: WeekTemplate) => {
    const componentCount = course.components.filter(component => component.sourceWeekId === template.id).length;
    await showCurriculumConfirm({
      title: 'Remove week?',
      text: `"${template.title || 'This week'}" and ${componentCount || 'its'} component${componentCount === 1 ? '' : 's'} will be removed from this free course.`,
      confirmButtonText: 'Remove week',
      cancelButtonText: 'Keep it',
      onConfirm: async () => {
        removeWeekFromCourse(template.id);
      },
    });
  };

  const toggleWeekDetails = async (template: WeekTemplate) => {
    const isOpen = expandedWeekIds.has(template.id);
    setExpandedWeekIds(previous => {
      const next = new Set(previous);
      isOpen ? next.delete(template.id) : next.add(template.id);
      return next;
    });
    if (isOpen || weekDetails[template.id]) return;
    setOpeningWeekId(template.id);
    setWeekError(null);
    try {
      const detail = await fetchWeekTemplateDetail(template.id);
      setWeekDetails(previous => ({ ...previous, [template.id]: detail }));
    } catch (err) {
      setWeekError(err instanceof Error ? err.message : 'Unable to load this week.');
    } finally {
      setOpeningWeekId(null);
    }
  };

  const togglePreviewCompletion = (componentId: string) => {
    setCompletedPreviewIds(previous => {
      const next = new Set(previous);
      if (next.has(componentId)) next.delete(componentId);
      else next.add(componentId);
      return next;
    });
  };

  const toggleQuizManualUnlock = (componentId: string) => {
    setCourse(previous => ({
      ...previous,
      components: previous.components.map(component => {
        if (component.id !== componentId || component.kind !== 'quiz') return component;
        const manualUnlock = !component.manualUnlock;
        return {
          ...component,
          manualUnlock,
          rawComponent: {
            ...component.rawComponent,
            settings: {
              ...(component.rawComponent.settings || {}),
              manualUnlock,
            },
          },
        };
      }),
    }));
  };

  const openQuizEditor = async (component: FreeCourseComponent) => {
    if (!course.id || !component.persistedId || !component.sourceWeekId) {
      await showCurriculumAlert({
        title: 'Save the course first',
        text: 'Quiz ownership needs the saved Free Course, Free Week and activity IDs.',
        icon: 'warning',
      });
      return;
    }
    const document = documentsByCourse[course.id];
    if (!document) return;
    try {
      let quizId = Number(component.rawComponent.settings?.linkedQuizId || 0);
      let revision = document.revision;
      if (!quizId) {
        const result = await createFreeCourseQuiz(course.id, {
          expectedRevision: revision,
          freeCourseWeekId: component.sourceWeekId,
          componentId: component.persistedId,
          title: component.title,
        });
        quizId = result.quiz.quiz.id;
        revision = result.course.revision;
        await refreshSavedCourses();
      }
      const params = new URLSearchParams({
        freeCourseId: course.id,
        componentId: component.persistedId,
        expectedRevision: revision,
      });
      navigate(`/curriculum/quiz-xml/${quizId}/edit?${params.toString()}`);
    } catch (err) {
      await showCurriculumAlert({
        title: 'Could not open quiz',
        text: err instanceof Error ? err.message : 'Please reload the Free Course and try again.',
        icon: 'error',
      });
    }
  };

  const unlinkQuiz = async (component: FreeCourseComponent) => {
    const quizId = Number(component.rawComponent.settings?.linkedQuizId || 0);
    const document = course.id ? documentsByCourse[course.id] : undefined;
    if (!quizId || !course.id || !component.persistedId || !document) return;
    await showCurriculumConfirm({
      title: 'Unlink quiz?',
      text: 'The quiz record is preserved. This activity will no longer open it for learners.',
      confirmButtonText: 'Unlink quiz',
      cancelButtonText: 'Keep linked',
      onConfirm: async () => {
        await unlinkFreeCourseQuiz(course.id, quizId, {
          expectedRevision: document.revision,
          componentId: component.persistedId!,
        });
        await refreshSavedCourses();
        setCourse(previous => ({
          ...previous,
          components: previous.components.map(item => {
            if (item.persistedId !== component.persistedId) return item;
            const settings = { ...(item.rawComponent.settings || {}) };
            delete settings.linkedQuizId;
            return { ...item, rawComponent: { ...item.rawComponent, settings } };
          }),
        }));
      },
      successTitle: 'Quiz unlinked',
      successText: 'The quiz record was preserved.',
    });
  };

  const handleComponentDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : '';
    if (!overId || activeId === overId) return;
    setCourse(previous => {
      const oldIndex = previous.components.findIndex(component => component.id === activeId);
      const newIndex = previous.components.findIndex(component => component.id === overId);
      if (oldIndex < 0 || newIndex < 0) return previous;
      return { ...previous, components: arrayMove(previous.components, oldIndex, newIndex) };
    });
    setSelectedComponentId(activeId);
  };

  // Same rule the server applies (course_pricing.pricing_values).
  const pricingError = course.isForSale && (
    !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(course.price.trim())
    || Number(course.price) <= 0 || Number(course.price) > 99999999.99
  ) ? 'Enter a GBP price between £0.01 and £99,999,999.99, with at most two decimal places.' : '';

  const draftWeekInputs = () => {
    const storedDocument = course.id ? documentsByCourse[course.id] : undefined;
    const orderedWeeks = draftWeeks.map(week => ({
      id: week.id,
      title: week.title,
      components: course.components.filter(component => (component.sourceWeekId || 'manual-week') === week.id),
    }));
    return orderedWeeks.map((week, weekIndex) => {
      const storedWeek = storedDocument?.weeks.find(item => item.freeCourseWeekId === week.id);
      return ({
      ...(storedWeek ? { freeCourseWeekId: storedWeek.freeCourseWeekId } : { clientId: `week:${weekIndex}:${week.id}` }),
      legacyCopiedFromWeekId: storedWeek?.legacyCopiedFromWeekId || (!storedWeek ? week.id : null),
      weekNumber: weekIndex + 1,
      title: week.title,
      summary: storedWeek?.summary || '',
      learningOutcomes: storedWeek?.learningOutcomes || [],
      status: storedWeek?.status || 'active',
      holidayNoteEnabled: storedWeek?.holidayNoteEnabled || false,
      holidayNote: storedWeek?.holidayNote || '',
      displayOrder: weekIndex,
      components: week.components.map((component, componentIndex) => ({
        ...(component.persistedId ? { id: component.persistedId } : { clientId: `component:${weekIndex}:${componentIndex}:${component.id}` }),
        displayOrder: componentIndex,
        type: component.rawComponent.type,
        title: component.rawComponent.title || component.title,
        description: component.rawComponent.description || component.details,
        expectedOtjh: component.rawComponent.expectedOtjh,
        points: component.rawComponent.points,
        reflectionRequired: component.rawComponent.reflectionRequired,
        workplaceEvidenceRequired: component.rawComponent.workplaceEvidenceRequired,
        tutorValidationRequired: component.rawComponent.tutorValidationRequired,
        settings: {
          ...(component.rawComponent.settings || {}),
          manualUnlock: component.manualUnlock || false,
        },
      })),
    });
    });
  };

  const createFreeCourse = async () => {
    const courseName = course.title.trim();
    if (!courseName || !course.components.length || savingCourse || savedCoursesLoading) return;
    if (pricingError) {
      await showCurriculumAlert({ title: 'Check the course price', text: pricingError, icon: 'error' });
      return;
    }
    setSavingCourse(true);
    try {
      const weeks = draftWeekInputs();
      if (course.id) {
        const stored = documentsByCourse[course.id];
        if (!stored) throw new Error('Reload this Free Course before saving.');
        const currentWeekIds = new Set(weeks.flatMap(week => 'freeCourseWeekId' in week && week.freeCourseWeekId ? [week.freeCourseWeekId] : []));
        const currentComponentIds = new Set(weeks.flatMap(week => week.components.flatMap(component => 'id' in component && component.id ? [component.id] : [])));
        await updateFreeCourseAuthoring(course.id, {
          expectedRevision: stored.revision,
          course: { courseName, description: course.subtitle, isForSale: course.isForSale, price: course.isForSale ? course.price.trim() : null, currency: 'GBP', coverImageUrl: course.coverImageUrl },
          weeks,
          deletedWeekIds: stored.weeks.filter(week => !currentWeekIds.has(week.freeCourseWeekId)).map(week => week.freeCourseWeekId),
          deletedComponentIds: stored.weeks.flatMap(week => week.components).filter(component => !currentComponentIds.has(component.id)).map(component => component.id),
        });
      } else {
        await createFreeCourseAuthoring({
          expectedRevision: catalogueRevision,
          clientId: requestKey('course-client'),
          course: { courseName, description: course.subtitle, isForSale: course.isForSale, price: course.isForSale ? course.price.trim() : null, currency: 'GBP', coverImageUrl: course.coverImageUrl, courseType: 'free' },
          weeks,
        }, requestKey('create'));
      }
      await refreshSavedCourses();
      resetDraftCourse();
      setWizardOpen(false);
      await showCurriculumAlert({
        title: editingCourseKey ? 'Free course updated' : 'Free course created',
        text: `${courseName} was saved with ${weeks.length} week${weeks.length === 1 ? '' : 's'}.`,
        icon: 'success',
        timer: 1800,
      });
    } catch (err) {
      const stale = err instanceof CurriculumApiError && err.status === 409;
      await showCurriculumAlert({
        title: stale ? 'This Free Course changed' : 'Could not save free course',
        text: stale ? 'Reload the course before applying your changes again.' : err instanceof Error ? err.message : 'Please try again.',
        icon: 'error',
      });
    } finally {
      setSavingCourse(false);
    }
  };

  const deleteFreeCourse = async (card: SavedFreeCourseCard) => {
    await showCurriculumConfirm({
      title: 'Delete free course?',
      text: `"${card.title}" and its ${card.weeks.length} week${card.weeks.length === 1 ? '' : 's'} will be removed.`,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Keep it',
      onConfirm: async () => {
        await deleteFreeCourseAuthoring(card.courseId, card.revision);
        await refreshSavedCourses();
        if (editingCourseKey === card.key) resetDraftCourse();
      },
      successTitle: 'Free course deleted',
      successText: `"${card.title}" was removed.`,
    });
  };

  const openConvertWizard = (card: SavedFreeCourseCard) => {
    setConvertCard(card);
    setConvertProgrammeId('');
    setConvertDetail(null);
    setConvertCohortId('');
    setConvertGroupId('');
  };

  const closeConvertWizard = () => {
    if (converting) return;
    setConvertCard(null);
  };

  const submitConvert = async () => {
    const card = convertCard;
    if (!card || converting) return;
    const groupId = convertGroupId.trim();
    if (!groupId) {
      await showCurriculumAlert({
        title: 'Pick a destination',
        text: 'Choose the programme, cohort and group to inject this course into.',
        icon: 'warning',
      });
      return;
    }
    const programme = convertProgrammeOptions.find(item => (item.sourceId || item.id) === convertProgrammeId);
    const groupLabel = convertGroups.find(group => group.id === groupId)?.name || 'the selected group';
    const programmeLabel = programme?.name || 'the programme';
    let result: ConvertFreeCourseResult | null = null;
    setConverting(true);
    try {
      await showCurriculumConfirm({
        title: 'Add to this group?',
        text: `"${card.title}" will be added as a module to "${groupLabel}" in ${programmeLabel}. The free course stays exactly as it is.`,
        icon: 'question',
        confirmButtonText: 'Add module',
        cancelButtonText: 'Cancel',
        onConfirm: async () => {
          result = await injectFreeCourseIntoGroup('FREE-COURSES', {
            courseId: card.courseId,
            mode: 'clone',
            groupId,
          });
          await refreshSavedCourses();
        },
        successTitle: 'Module added',
        successText: 'Opening the Module Builder to add KSBs and hours.',
      });
    } finally {
      setConverting(false);
    }
    if (result) {
      setConvertCard(null);
      const injected: ConvertFreeCourseResult = result;
      const params = new URLSearchParams({ module: injected.moduleCatalogueId });
      if (injected.programmeId) params.set('programme', injected.programmeId);
      navigate(`/curriculum/module-builder?${params.toString()}`);
    }
  };

  const openImportPicker = () => {
    setImportOpen(true);
    setImportCohortId('');
    setImportGroupId('');
    setImportSearch('');
    setImportSelected([]);
    setImportSelectionOpen(false);
  };

  const closeImportPicker = () => {
    if (importing) return;
    setImportOpen(false);
  };

  const submitImport = async () => {
    const modules = importSelected;
    if (!modules.length || importing) return;
    const count = modules.length;
    const subject = count === 1 ? `"${modules[0].name}"` : `${count} modules`;
    const sourceLabel = count === 1 ? modules[0].programme || 'its programme' : 'their programmes';
    let imported = false;
    setImporting(true);
    try {
      await showCurriculumConfirm({
        title: 'Copy to free courses?',
        text: `${subject} will each be copied into a new free course. ${count === 1 ? 'The module stays' : 'The modules stay'} in ${sourceLabel}. KSB mappings and hours are not carried over.`,
        icon: 'question',
        confirmButtonText: count === 1 ? 'Create free course' : `Create ${count} free courses`,
        cancelButtonText: 'Cancel',
        onConfirm: async () => {
          // One request per module, in order. Each done module leaves the
          // selection, so after a mid-batch failure a retry only does the rest.
          let done = 0;
          try {
            for (const module of modules) {
              const result = await cloneModuleToFreeCourseAuthoring({
                moduleCatalogueId: moduleKey(module),
                mode: 'clone',
                expectedRevision: (await fetchFreeCourseAuthoringCatalogue()).revision,
                clientId: `module:${moduleKey(module)}`,
              }, requestKey('clone'));
              setDocumentsByCourse(previous => ({ ...previous, [result.course.courseId]: result }));
              done += 1;
            }
          } catch (err) {
            if (done) setImportSelected(modules.slice(done));
            const reason = err instanceof Error ? err.message : 'Unable to complete this action.';
            throw new Error(done ? `${done} of ${count} done; stopped at "${modules[done].name}": ${reason}` : reason);
          }
          imported = true;
        },
        successTitle: count === 1 ? 'Free course created' : 'Free courses created',
        successText: `${subject} ${count === 1 ? 'is' : 'are'} now available under Free courses.`,
      });
    } finally {
      setImporting(false);
    }
    if (imported) {
      await refreshSavedCourses();
      setImportOpen(false);
      // Drop the loaded programme so the next open sees newly available source content.
      setImportProgrammeId('');
    }
  };

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Free Courses"
      pageSubtitle={`${totals.weeks} selected weeks - ${totals.components} components - ${totals.quizzes} quizzes`}
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <main className="curriculum-library-page min-h-[calc(100vh-150px)] space-y-4 bg-background-50 px-4 py-4 md:px-6">
        <WorkspaceHeroBanner
          className="curriculum-library-hero"
          decorative
          eyebrow="Learning resources"
          title="Free Courses"
          description="Build short open-access courses from customised video, reading, PowerPoint, audio and quiz components."
          icon="ri-graduation-cap-line"
          statIconPosition="leading"
          stats={[
            { label: 'Weeks', value: String(totals.weeks), icon: 'ri-calendar-line' },
            { label: 'Components', value: String(totals.components), icon: 'ri-layout-4-line' },
            { label: 'Quizzes', value: String(totals.quizzes), icon: 'ri-questionnaire-line' },
          ]}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openImportPicker}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-primary-300 bg-white/70 px-4 text-sm font-bold text-primary-800 transition hover:bg-white"
              >
                <AppIcon name="ri-download-2-line" size={16} />
                Import from a programme
              </button>
              <button
                type="button"
                onClick={openAddWizard}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-bold text-primary-900 transition hover:bg-primary-50"
              >
                <AppIcon name="ri-add-line" size={16} />
                Add free course
              </button>
            </div>
          )}
        />

        <section className="overflow-hidden rounded-lg border border-background-200 bg-white shadow-sm">
          <div className="border-b border-background-200 bg-background-50 px-5 py-5 md:px-7">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide text-foreground-700">Created free courses</h2>
                <p className="mt-1 text-xs text-foreground-400">Courses saved for the curriculum team.</p>
              </div>
              {savedCoursesLoading && <AppIcon name="ri-loader-4-line" className="animate-spin text-foreground-400" size={16} />}
            </div>
            {savedCourseCards.length > 0 ? (
  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {savedCourseCards.map(card => (
                  <SavedFreeCourseCardView
                    key={card.key}
                    card={card}
                    onEdit={() => openEditWizard(card)}
                    onDelete={() => { void deleteFreeCourse(card); }}
                    onConvert={() => openConvertWizard(card)}
                  />
                ))}
              </div>
            ) : (
              !savedCoursesLoading && (
                <div className="rounded-lg border border-dashed border-background-300 bg-white px-4 py-8 text-center">
                  <AppIcon name="ri-graduation-cap-line" className="mx-auto text-3xl text-foreground-300" />
                  <p className="mt-2 text-sm font-bold text-foreground-700">No free courses created yet</p>
                  <p className="mt-1 text-xs text-foreground-400">Use Add free course to build the first one.</p>
                </div>
              )
            )}
          </div>

          {wizardOpen && (
            <div className="fixed inset-0 z-50 overflow-y-auto bg-foreground-950/55 px-4 py-6 backdrop-blur-sm">
              <div className="mx-auto max-w-[1500px] overflow-hidden rounded-xl bg-white shadow-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-background-200 px-5 py-4">
                  <div>
                    <h2 className="font-heading text-xl font-bold text-foreground-950">{editingCourseKey ? 'Edit free course' : 'Add free course'}</h2>
                    <p className="mt-1 text-sm text-foreground-500">Name the course, choose weeks, then save it for the curriculum catalogue.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setWizardOpen(false);
                      resetDraftCourse();
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-500 transition hover:bg-background-100 hover:text-foreground-900"
                    aria-label="Close wizard"
                  >
                    <AppIcon name="ri-close-line" size={18} />
                  </button>
                </div>

          <div className="border-b border-background-200 bg-white px-5 py-4 md:px-7">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
              <label>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-foreground-500">Course name</span>
                <input
                  value={course.title}
                  onChange={event => setCourse(previous => ({ ...previous, title: event.target.value }))}
                  placeholder="Name this free course"
                  className="h-11 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-sm font-semibold outline-none transition focus:border-primary-300 focus:bg-white"
                />
              </label>
              <button
                type="button"
                disabled={!course.title.trim() || totals.weeks === 0 || savingCourse || savedCoursesLoading}
                onClick={() => { void createFreeCourse(); }}
                className="primary-action inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingCourse ? <AppIcon name="ri-loader-4-line" className="animate-spin" size={16} /> : <AppIcon name="ri-check-line" size={16} />}
                {savingCourse ? 'Saving...' : editingCourseKey ? 'Save changes' : 'Create free course'}
              </button>
              <label className="lg:col-span-2">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-foreground-500">Description</span>
                <textarea
                  value={course.subtitle}
                  onChange={event => setCourse(previous => ({ ...previous, subtitle: event.target.value }))}
                  placeholder="Describe what learners will get from this free course"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-sm font-semibold outline-none transition focus:border-primary-300 focus:bg-white"
                />
              </label>
              <div className="lg:col-span-2">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-foreground-500">Cover image</span>
                <div className="grid gap-3 rounded-lg border border-background-200 bg-background-50 p-3 md:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="overflow-hidden rounded-lg border border-background-200 bg-white">
                    {course.coverImageUrl ? (
                      <img src={course.coverImageUrl} alt="" className="h-28 w-full object-cover" />
                    ) : (
                      <div className="flex h-28 items-center justify-center bg-[linear-gradient(135deg,#f7f4ff_0%,#ffffff_48%,#ecfdf5_100%)] text-primary-700">
                        <AppIcon name="ri-image-add-line" size={24} />
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col justify-center gap-2">
                    <div className="flex flex-wrap gap-2">
                      <label className="primary-action inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 text-sm font-bold text-white transition hover:bg-primary-600">
                        <AppIcon name="ri-upload-cloud-2-line" size={16} />
                        Upload image
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={event => { void handleCoverImageUpload(event.target.files?.[0]); event.target.value = ''; }}
                        />
                      </label>
                      {course.coverImageUrl && (
                        <button
                          type="button"
                          onClick={() => setCourse(previous => ({ ...previous, coverImageUrl: '' }))}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-bold text-red-600 ring-1 ring-red-100 transition hover:bg-red-50"
                        >
                          <AppIcon name="ri-delete-bin-line" size={15} />
                          Remove
                        </button>
                      )}
                    </div>
                    <input
                      value={course.coverImageUrl.startsWith('data:') ? '' : course.coverImageUrl}
                      onChange={event => setCourse(previous => ({ ...previous, coverImageUrl: event.target.value }))}
                      placeholder="Or paste an image URL"
                      className="h-10 w-full rounded-lg border border-background-200 bg-white px-3 text-sm font-semibold outline-none transition focus:border-primary-300"
                    />
                  </div>
                </div>
              </div>
              <fieldset className="lg:col-span-2 space-y-3 rounded-lg border border-primary-100 bg-primary-50/40 p-3">
                <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-foreground-500">Course pricing</legend>
                <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-foreground-900">
                  <input
                    type="checkbox"
                    checked={course.isForSale}
                    onChange={event => setCourse(previous => ({ ...previous, isForSale: event.target.checked }))}
                    className="h-4 w-4 rounded border-primary-300 accent-primary-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  />
                  Available for sale
                </label>
                {course.isForSale ? (
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-foreground-500">Price (GBP)</span>
                    <input
                      value={course.price}
                      inputMode="decimal"
                      placeholder="e.g. 49.99"
                      aria-invalid={Boolean(pricingError)}
                      onChange={event => setCourse(previous => ({ ...previous, price: event.target.value }))}
                      className="h-10 w-full max-w-xs rounded-lg border border-background-200 bg-white px-3 text-sm font-semibold outline-none transition focus:border-primary-300"
                    />
                    {pricingError && <span className="mt-1 block text-xs font-semibold text-red-600">{pricingError}</span>}
                  </label>
                ) : <p className="text-xs text-foreground-600">This course has no sale price.</p>}
              </fieldset>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_540px] md:p-6">
            <div className="min-w-0">
              <section className="rounded-lg border border-background-200 bg-white shadow-sm">
                <div className="border-b border-background-200 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: course.color }}>
                      <AppIcon name="ri-book-open-line" size={22} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate font-heading text-lg font-bold text-foreground-950">{course.title.trim() || 'Untitled free course'}</h2>
                      <p className="text-sm text-foreground-500">Final learner course built from the weeks you choose.</p>
                    </div>
                  </div>
                </div>

                <div className="px-4 py-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-foreground-500">Course builder</h3>
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-700">
                      Sequential unlock
                    </span>
                  </div>
                  {draftWeeks.length > 0 && (
                    <div className="mb-4 space-y-2 rounded-lg border border-background-200 bg-background-50 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-500">Weeks</p>
                      {draftWeeks.map((week, index) => (
                        <div key={week.id} className="flex items-center gap-2">
                          <span className="w-14 text-xs font-bold text-foreground-500">Week {index + 1}</span>
                          <input
                            value={week.title}
                            onChange={event => renameWeek(week.id, event.target.value)}
                            className="h-9 min-w-0 flex-1 rounded-lg border border-background-200 bg-white px-3 text-sm font-semibold outline-none focus:border-primary-300"
                            aria-label={`Week ${index + 1} title`}
                          />
                          <span className="text-[10px] font-bold text-foreground-400">{week.count}</span>
                          <button type="button" disabled={index === 0} onClick={() => moveWeek(week.id, -1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-500 hover:bg-white disabled:opacity-30" aria-label={`Move ${week.title} up`}><AppIcon name="ri-arrow-up-line" size={14} /></button>
                          <button type="button" disabled={index === draftWeeks.length - 1} onClick={() => moveWeek(week.id, 1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-500 hover:bg-white disabled:opacity-30" aria-label={`Move ${week.title} down`}><AppIcon name="ri-arrow-down-line" size={14} /></button>
                          <button type="button" onClick={() => { void confirmRemoveDraftWeek(week); }} className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-50" aria-label={`Remove ${week.title}`}><AppIcon name="ri-delete-bin-line" size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="overflow-hidden rounded-lg border border-background-200">
                    {course.components.length === 0 && (
                      <div className="px-4 py-10 text-center">
                        <AppIcon name="ri-calendar-line" className="mx-auto text-3xl text-foreground-300" />
                        <p className="mt-3 text-sm font-bold text-foreground-700">No weeks selected yet</p>
                        <p className="mt-1 text-xs text-foreground-400">Choose one or more free week templates from the panel on the right.</p>
                      </div>
                    )}
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleComponentDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
                      <SortableContext items={course.components.map(component => component.id)} strategy={verticalListSortingStrategy}>
                        {course.components.map((component, index) => (
                          <SortableCourseComponentRow
                            key={component.id}
                            component={component}
                            index={index}
                            selected={selectedComponent?.id === component.id}
                            onSelect={() => setSelectedComponentId(component.id)}
                            onRemove={() => { void confirmRemoveComponent(component); }}
                            onToggleManualUnlock={() => toggleQuizManualUnlock(component.id)}
                            onOpenQuiz={() => { void openQuizEditor(component); }}
                            onUnlinkQuiz={() => { void unlinkQuiz(component); }}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  </div>
                  {selectedComponent && (
                    <div className="mt-4 grid gap-3 rounded-lg border border-background-200 bg-background-50 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-500">Selected activity</p>
                      <label className="grid gap-1 text-xs font-bold text-foreground-600">
                        Title
                        <input value={selectedComponent.title} onChange={event => updateSelectedComponent({ title: event.target.value })} className="h-9 rounded-lg border border-background-200 bg-white px-3 text-sm font-semibold outline-none focus:border-primary-300" />
                      </label>
                      <label className="grid gap-1 text-xs font-bold text-foreground-600">
                        Description
                        <textarea value={selectedComponent.details} onChange={event => updateSelectedComponent({ details: event.target.value })} rows={3} className="rounded-lg border border-background-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-primary-300" />
                      </label>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <aside className="min-w-0 space-y-4">
              <section className="rounded-lg border border-background-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-foreground-500">Week Builder templates</h3>
                    <p className="mt-1 text-xs text-foreground-400">Choose free-course weeks built in Week Builder.</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!weekLoading && (
                      <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-bold text-foreground-500">
                        {selectedWeekIds.size}/{weekTemplates.length}
                      </span>
                    )}
                    {weekLoading && <AppIcon name="ri-loader-4-line" className="animate-spin text-foreground-400" size={16} />}
                  </div>
                </div>
                {weekError && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
                    {weekError}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3">
                  {weekTemplates.map(template => {
                    const selected = selectedWeekIds.has(template.id);
                    const componentCount = template.componentCount || template.components.length;
                    return (
                      <div
                        key={template.id}
                        className={`rounded-lg border p-3 transition ${
                          selected ? 'border-primary-300 bg-primary-50 shadow-sm ring-1 ring-primary-100' : 'border-background-200 bg-background-50 hover:border-primary-100 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ${
                            selected ? 'bg-primary-700 text-white ring-primary-700' : 'bg-white text-primary-700 ring-background-200'
                          }`}>
                            <AppIcon name={selected ? 'ri-checkbox-circle-line' : 'ri-calendar-line'} size={18} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-start justify-between gap-3">
                              <button
                                type="button"
                                onClick={() => { void toggleWeekDetails(template); }}
                                className="min-w-0 overflow-x-auto whitespace-nowrap pr-2 text-left text-sm font-bold leading-5 text-foreground-950 transition hover:text-primary-700"
                                aria-expanded={expandedWeekIds.has(template.id)}
                              >
                                {template.title || 'Untitled week'}
                              </button>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                selected ? 'bg-primary-700 text-white' : 'bg-white text-foreground-500 ring-1 ring-background-200'
                              }`}>
                                {selected ? 'Added to course' : 'Available'}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-foreground-500">
                              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 ring-1 ring-background-200">
                                <AppIcon name="ri-stack-line" size={13} />
                                {componentCount} components
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 ring-1 ring-background-200">
                                <AppIcon name="ri-award-line" size={13} />
                                {template.points || 0} points
                              </span>
                            </div>
                            {template.summary && <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-foreground-500">{template.summary}</p>}
                          </div>
                        </div>
                        {expandedWeekIds.has(template.id) && (
                          <div className="mt-3 rounded-lg border border-background-200 bg-white">
                            {openingWeekId === template.id && !weekDetails[template.id] ? (
                              <div className="flex items-center gap-2 px-3 py-3 text-xs font-semibold text-foreground-500">
                                <AppIcon name="ri-loader-4-line" className="animate-spin" size={14} />
                                Loading components
                              </div>
                            ) : (
                              <div className="divide-y divide-background-100">
                                {(weekDetails[template.id]?.components || template.components || []).length ? (
                                  (weekDetails[template.id]?.components || template.components || []).map((component, componentIndex) => {
                                    const kind = componentKindFromWeek(component.type);
                                    const meta = COMPONENT_META[kind];
                                    return (
                                      <div key={`${template.id}-${component.id}-${componentIndex}`} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
                                        <span className={`flex h-7 w-7 items-center justify-center rounded-md border ${meta.color}`}>
                                          <AppIcon name={meta.icon} size={13} />
                                        </span>
                                        <span className="min-w-0">
                                          <span className="block truncate text-xs font-bold text-foreground-800">{component.title || meta.label}</span>
                                          <span className="block text-[11px] text-foreground-500">{meta.label}</span>
                                        </span>
                                        <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">
                                          {component.expectedOtjh ? formatHoursMinutes(component.expectedOtjh) : `${Number(component.points) || 0} pts`}
                                        </span>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <div className="px-3 py-3 text-xs font-semibold text-foreground-500">No components in this week.</div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                          <button
                            type="button"
                            onClick={() => { void toggleWeekDetails(template); }}
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-foreground-700 ring-1 ring-background-200 transition hover:bg-background-100"
                          >
                            <AppIcon name={expandedWeekIds.has(template.id) ? 'ri-arrow-up-s-line' : 'ri-eye-line'} size={14} />
                            {expandedWeekIds.has(template.id) ? 'Hide components' : 'Open components'}
                          </button>
                          <Link
                            to={`/curriculum/week-builder?template=${encodeURIComponent(template.id)}&from=free-courses`}
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-foreground-700 ring-1 ring-background-200 transition hover:bg-background-100"
                          >
                            <AppIcon name="ri-external-link-line" size={14} />
                            Week Builder
                          </Link>
                        </div>
                        <div className="mt-2">
                          <button
                            type="button"
                            disabled={addingWeekId === template.id}
                            onClick={() => {
                              if (selected) void confirmRemoveWeekFromCourse(template);
                              else void addWeekToCourse(template);
                            }}
                            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold transition disabled:opacity-60 ${
                              selected ? 'bg-white text-red-600 ring-1 ring-red-100 hover:bg-red-50' : 'primary-action bg-primary-700 text-white hover:bg-primary-600'
                            }`}
                          >
                            {addingWeekId === template.id ? <AppIcon name="ri-loader-4-line" className="animate-spin" size={14} /> : <AppIcon name={selected ? 'ri-close-line' : 'ri-add-line'} size={14} />}
                            {selected ? 'Remove week' : 'Add week'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-lg border border-background-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-foreground-500">Learner preview</h3>
                    <p className="mt-1 text-xs text-foreground-400">Toggle completion to test quiz unlocking.</p>
                  </div>
                  <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-bold text-primary-700">
                    {learnerCompletedCount}/{course.components.length}
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border border-background-200">
                  {course.components.map((component, index) => {
                    const meta = COMPONENT_META[component.kind];
                    const priorComponents = course.components.slice(0, index);
                    const isQuizLocked = component.kind === 'quiz' && !component.manualUnlock && priorComponents.some(item => !completedPreviewIds.has(item.id));
                    const isComplete = completedPreviewIds.has(component.id);
                    return (
                      <button
                        key={`preview-${component.id}`}
                        type="button"
                        onClick={() => !isQuizLocked && togglePreviewCompletion(component.id)}
                        disabled={isQuizLocked}
                        className={`grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-background-200 px-3 py-3 text-left last:border-b-0 ${
                          isQuizLocked ? 'bg-background-100 text-foreground-400' : 'bg-white hover:bg-primary-50'
                        }`}
                      >
                        <span className="text-xs font-semibold">{index + 1}</span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <AppIcon name={meta.icon} className={isQuizLocked ? 'text-foreground-300' : 'text-primary-600'} size={15} />
                            <span className="truncate text-xs font-bold">{component.code} - {component.title}</span>
                          </span>
                          <span className="mt-1 block text-[11px]">{isQuizLocked ? 'Locked until previous components are completed' : component.manualUnlock ? 'Manually unlocked' : meta.label}</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                          {isQuizLocked ? <AppIcon name="ri-lock-line" size={14} /> : component.manualUnlock ? <AppIcon name="ri-lock-unlock-line" className="text-emerald-600" size={14} /> : isComplete ? <AppIcon name="ri-checkbox-circle-line" className="text-emerald-600" size={14} /> : null}
                          {isQuizLocked ? 'Locked' : isComplete ? 'Done' : 'Open'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {firstLockedIndex >= 0 && (
                  <p className="mt-3 text-[11px] leading-5 text-foreground-500">
                    The first quiz appears at item {firstLockedIndex + 1}; learners must complete every component above it before it opens.
                  </p>
                )}
              </section>
            </aside>
          </div>
              </div>
            </div>
          )}

          {convertCard && (
            <div className="fixed inset-0 z-50 overflow-y-auto bg-foreground-950/55 px-4 py-6 backdrop-blur-sm">
              <div className="mx-auto max-w-[560px] overflow-hidden rounded-xl bg-white shadow-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-background-200 px-5 py-4">
                  <div>
                    <h2 className="font-heading text-xl font-bold text-foreground-950">Convert to programme</h2>
                    <p className="mt-1 text-sm text-foreground-500">Turn “{convertCard.title}” into a real, enrolable programme module.</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeConvertWizard}
                    disabled={converting}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-500 transition hover:bg-background-100 hover:text-foreground-900 disabled:opacity-50"
                    aria-label="Close convert dialog"
                  >
                    <AppIcon name="ri-close-line" size={18} />
                  </button>
                </div>

                <div className="space-y-5 px-5 py-5">
                  <div>
                    <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-foreground-500">Mode</span>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="rounded-lg border border-primary-300 bg-primary-50 px-3 py-2.5 ring-1 ring-primary-200">
                        <span className="flex items-center gap-1.5 text-sm font-bold text-foreground-900">
                          <AppIcon name="ri-file-copy-line" size={15} />
                          Clone
                        </span>
                        <span className="mt-0.5 block text-[11px] text-foreground-500">Keep the canonical free course as-is</span>
                      </div>
                    </div>
                  </div>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-foreground-500">Programme</span>
                    <select
                      value={convertProgrammeId}
                      onChange={event => { setConvertProgrammeId(event.target.value); setConvertCohortId(''); setConvertGroupId(''); }}
                      disabled={convertProgrammesLoading}
                      className="w-full rounded-lg border border-background-300 bg-white px-3 py-2.5 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60"
                    >
                      <option value="">{convertProgrammesLoading ? 'Loading programmes…' : 'Select a programme'}</option>
                      {convertProgrammeOptions.map(programme => (
                        <option key={programme.sourceId || programme.id} value={programme.sourceId || programme.id}>{programme.name}</option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-foreground-500">Cohort</span>
                      <select
                        value={convertCohortId}
                        onChange={event => { setConvertCohortId(event.target.value); setConvertGroupId(''); }}
                        disabled={!convertProgrammeId || convertDetailLoading}
                        className="w-full rounded-lg border border-background-300 bg-white px-3 py-2.5 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60"
                      >
                        <option value="">{!convertProgrammeId ? 'Select a programme first' : convertDetailLoading ? 'Loading cohorts…' : convertCohorts.length ? 'Select a cohort' : 'No cohorts in this programme'}</option>
                        {convertCohorts.map(cohort => (
                          <option key={cohort.id} value={cohort.id}>{cohort.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-foreground-500">Group</span>
                      <select
                        value={convertGroupId}
                        onChange={event => setConvertGroupId(event.target.value)}
                        disabled={!convertCohortId}
                        className="w-full rounded-lg border border-background-300 bg-white px-3 py-2.5 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60"
                      >
                        <option value="">{!convertCohortId ? 'Select a cohort first' : convertGroups.length ? 'Select a group' : 'No groups in this cohort'}</option>
                        {convertGroups.map(group => (
                          <option key={group.id} value={group.id}>{group.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <p className="rounded-lg border border-background-200 bg-background-50 px-3 py-2.5 text-[11px] leading-5 text-foreground-500">
                    The course is added as a module to the group you pick. KSB mappings and off-the-job hours aren’t carried over — free courses don’t have them. You’ll add those in the Module Builder, which opens automatically.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-background-200 px-5 py-4">
                  <button
                    type="button"
                    onClick={closeConvertWizard}
                    disabled={converting}
                    className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-bold text-foreground-600 transition hover:bg-background-100 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => { void submitConvert(); }}
                    disabled={converting || !convertGroupId}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 text-sm font-bold text-white transition hover:bg-primary-600 disabled:opacity-60"
                  >
                    <AppIcon name={converting ? 'ri-loader-4-line' : 'ri-exchange-line'} className={converting ? 'animate-spin' : ''} size={15} />
                    Add module
                  </button>
                </div>
              </div>
            </div>
          )}

          {importOpen && (
            <div className="fixed inset-0 z-50 overflow-y-auto bg-foreground-950/55 px-4 py-6 backdrop-blur-sm">
              <div className="mx-auto flex max-h-[calc(100vh-48px)] max-w-[680px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-background-200 px-5 py-4">
                  <div>
                    <h2 className="font-heading text-xl font-bold text-foreground-950">Import from a programme</h2>
                    <p className="mt-1 text-sm text-foreground-500">Turn a programme module into a free course. KSBs and hours aren’t carried over.</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeImportPicker}
                    disabled={importing}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-500 transition hover:bg-background-100 hover:text-foreground-900 disabled:opacity-50"
                    aria-label="Close import dialog"
                  >
                    <AppIcon name="ri-close-line" size={18} />
                  </button>
                </div>

                <div className="space-y-3 border-b border-background-200 px-5 py-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-foreground-500">Programme</span>
                    <select
                      value={importProgrammeId}
                      onChange={event => { setImportProgrammeId(event.target.value); setImportCohortId(''); setImportGroupId(''); }}
                      disabled={convertProgrammesLoading}
                      className="w-full rounded-lg border border-background-300 bg-white px-3 py-2.5 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60"
                    >
                      <option value="">{convertProgrammesLoading ? 'Loading programmes…' : 'Select a programme'}</option>
                      {convertProgrammeOptions.map(programme => (
                        <option key={programme.sourceId || programme.id} value={programme.sourceId || programme.id}>{programme.name}</option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-foreground-500">Cohort</span>
                      <select
                        value={importCohortId}
                        onChange={event => { setImportCohortId(event.target.value); setImportGroupId(''); }}
                        disabled={!importDetail || !importCohorts.length}
                        className="w-full rounded-lg border border-background-300 bg-white px-3 py-2.5 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60"
                      >
                        <option value="">{!importProgrammeId ? 'Select a programme first' : importLoading ? 'Loading cohorts…' : importCohorts.length ? 'All cohorts' : 'No cohorts in this programme'}</option>
                        {importCohorts.map(cohort => (
                          <option key={cohort.id} value={cohort.id}>{cohort.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-foreground-500">Group</span>
                      <select
                        value={importGroupId}
                        onChange={event => { setImportGroupId(event.target.value); }}
                        disabled={!importCohortId || !importGroups.length}
                        className="w-full rounded-lg border border-background-300 bg-white px-3 py-2.5 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60"
                      >
                        <option value="">{!importCohortId ? 'Select a cohort first' : importGroups.length ? 'All groups' : 'No groups in this cohort'}</option>
                        {importGroups.map(group => (
                          <option key={group.id} value={group.id}>{group.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-background-300 px-3 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-100">
                      <AppIcon name="ri-search-line" size={16} className="text-foreground-400" />
                      <input
                        type="text"
                        value={importSearch}
                        onChange={event => setImportSearch(event.target.value)}
                        disabled={!importDetail}
                        placeholder="Search modules by name…"
                        className="h-full w-full bg-transparent text-sm text-foreground-900 outline-none placeholder:text-foreground-400 disabled:cursor-not-allowed"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setImportSelectionOpen(open => !open)}
                      disabled={!importSelected.length}
                      aria-expanded={importSelectionOpen && importSelected.length > 0}
                      className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        importSelectionOpen && importSelected.length ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-background-300 bg-white text-foreground-700 hover:border-background-400'
                      }`}
                    >
                      <AppIcon name="ri-checkbox-multiple-line" size={15} />
                      My selection
                      <span className="rounded-full bg-primary-700 px-1.5 text-[11px] leading-5 text-white">{importSelected.length}</span>
                      <AppIcon name={importSelectionOpen && importSelected.length ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} size={15} />
                    </button>
                  </div>

                  {importSelectionOpen && importSelected.length > 0 && (
                    <div className="rounded-lg border border-primary-200 bg-primary-50/40">
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-foreground-500">{importSelected.length} selected</span>
                        <button
                          type="button"
                          onClick={() => { setImportSelected([]); setImportSelectionOpen(false); }}
                          disabled={importing}
                          className="text-xs font-bold text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          Clear all
                        </button>
                      </div>
                      <ul className="max-h-40 space-y-1 overflow-y-auto px-2 pb-2">
                        {importSelected.map(module => (
                          <li key={moduleKey(module)} className="flex items-center gap-2 rounded-md bg-white px-2.5 py-1.5">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-foreground-900">{module.name || 'Untitled module'}</span>
                              <span className="block truncate text-[11px] text-foreground-500">{[module.programme, module.cohort, module.group].filter(Boolean).join(' · ')}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleImportSelected(module)}
                              disabled={importing}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                              aria-label={`Unselect ${module.name || 'module'}`}
                            >
                              <AppIcon name="ri-close-line" size={16} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="min-h-[180px] flex-1 overflow-y-auto px-2 py-2">
                  {!importProgrammeId ? (
                    <p className="px-3 py-6 text-center text-sm text-foreground-500">Select a programme to see its modules.</p>
                  ) : importLoading ? (
                    <p className="flex items-center gap-2 px-3 py-6 text-sm text-foreground-500"><AppIcon name="ri-loader-4-line" className="animate-spin" size={16} />Loading modules…</p>
                  ) : importFiltered.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-foreground-500">{importOptions.length === 0 ? 'No modules are available to import here.' : 'No modules match your search.'}</p>
                  ) : (
                    <ul className="space-y-1">
                      {importFiltered.map(module => {
                        const key = moduleKey(module);
                        const selected = importSelectedKeys.has(key);
                        const context = [module.programme, module.cohort, module.group].filter(Boolean).join(' · ');
                        const facts = [`${module.weeks || 0} ${module.weeks === 1 ? 'week' : 'weeks'}`, `${module.lessons || 0} lessons`, `${module.quizzes || 0} quizzes`].join(' · ');
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              onClick={() => toggleImportSelected(module)}
                              aria-pressed={selected}
                              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                                selected ? 'border-primary-300 bg-primary-50 ring-1 ring-primary-200' : 'border-transparent hover:border-background-300 hover:bg-background-50'
                              }`}
                            >
                              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background-100 text-foreground-400">
                                {module.coverImage ? <img src={module.coverImage} alt="" className="h-full w-full object-cover" /> : <AppIcon name="ri-book-2-line" size={18} />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold text-foreground-900">{module.name || 'Untitled module'}</span>
                                {context && <span className="block truncate text-[11px] text-foreground-500">{context}</span>}
                                <span className="mt-0.5 block text-[11px] text-foreground-400">{facts}</span>
                              </span>
                              <AppIcon name={selected ? 'ri-checkbox-fill' : 'ri-checkbox-blank-line'} size={18} className={`shrink-0 ${selected ? 'text-primary-600' : 'text-foreground-300'}`} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="border-t border-background-200 px-5 py-4">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-foreground-500">Mode</span>
                  <div className="grid grid-cols-1 gap-2">
                    {([
                      { value: 'clone', title: 'Clone', hint: 'Keep the module in its programme' },
                    ] as const).map(option => (
                      <div
                        key={option.value}
                        className="rounded-lg border border-primary-300 bg-primary-50 px-3 py-2.5 text-left ring-1 ring-primary-200"
                      >
                        <span className="flex items-center gap-1.5 text-sm font-bold text-foreground-900">
                          <AppIcon name="ri-file-copy-line" size={15} />
                          {option.title}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-foreground-500">{option.hint}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={closeImportPicker}
                      disabled={importing}
                      className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-bold text-foreground-600 transition hover:bg-background-100 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => { void submitImport(); }}
                      disabled={importing || !importSelected.length}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 text-sm font-bold text-white transition hover:bg-primary-600 disabled:opacity-60"
                    >
                      <AppIcon name={importing ? 'ri-loader-4-line' : 'ri-download-2-line'} className={importing ? 'animate-spin' : ''} size={15} />
                      Convert to free courses
                      {importSelected.length > 1 && ` (${importSelected.length})`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </WorkspaceShell>
  );
}

function groupSavedFreeCourses(modules: FreeProgrammeModule[], documents: Record<string, FreeCourseAuthoringDocument>): SavedFreeCourseCard[] {
  const groups = new Map<string, SavedFreeCourseCard>();
  modules.forEach(module => {
    const title = module.courseName || module.title || 'Untitled free course';
    const description = module.description || '';
    const coverImageUrl = module.coverImageUrl || '';
    const key = module.courseId || `${title}::${description}`;
    const existing = groups.get(key);
    if (existing) {
      existing.weeks.push(module);
      existing.componentCount += module.componentCount || module.components?.length || 0;
      existing.totalOtjh += Number(module.totalOtjh || 0);
      return;
    }
    groups.set(key, {
      key,
      courseId: module.courseId || module.id,
      title,
      description,
      coverImageUrl,
      isForSale: module.isForSale === true,
      price: module.price ?? '',
      weeks: [module],
      componentCount: module.componentCount || module.components?.length || 0,
      totalOtjh: Number(module.totalOtjh || 0),
      revision: documents[module.courseId || module.id]?.revision || '',
    });
  });
  return Array.from(groups.values()).map(card => ({
    ...card,
    weeks: [...card.weeks].sort((left, right) => Number(left.weekNumber || 0) - Number(right.weekNumber || 0)),
    totalOtjh: Math.round(card.totalOtjh * 100) / 100,
  }));
}

function SavedFreeCourseCardView({ card, onEdit, onDelete, onConvert }: { card: SavedFreeCourseCard; onEdit: () => void; onDelete: () => void; onConvert: () => void }) {
  const shownWeeks = card.weeks.slice(0, 3);
  const hiddenWeekCount = Math.max(0, card.weeks.length - shownWeeks.length);
  const otjhLabel = formatHoursMinutes(card.totalOtjh);
  const [coverBroken, setCoverBroken] = useState(false);
  const showCoverImage = Boolean(card.coverImageUrl && !coverBroken);

  useEffect(() => {
    setCoverBroken(false);
  }, [card.coverImageUrl]);

  return (
    <article className="group flex min-h-[620px] w-full flex-col overflow-hidden rounded-lg border border-background-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md">
      <div className="relative h-60 overflow-hidden bg-background-100">
        {showCoverImage ? (
          <img
            src={card.coverImageUrl}
            alt=""
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            onError={() => setCoverBroken(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,#f7f4ff_0%,#ffffff_48%,#ecfdf5_100%)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white text-primary-700 shadow-sm ring-1 ring-primary-100">
              <AppIcon name="ri-graduation-cap-line" size={24} />
            </div>
          </div>
        )}
        <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase text-primary-800 shadow-sm ring-1 ring-white/60">
          <AppIcon name="ri-book-open-line" size={12} />
          Free course
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="min-h-[96px]">
          <h3 className="line-clamp-2 font-heading text-base font-bold leading-6 text-foreground-950">{card.title}</h3>
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-foreground-500">{card.description || 'No description added yet.'}</p>
        </div>

        <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-lg border border-background-200 bg-background-50">
          <CourseStat icon="ri-calendar-line" label="Weeks" value={card.weeks.length} />
          <CourseStat icon="ri-stack-line" label="Parts" value={card.componentCount} />
          <CourseStat icon="ri-time-line" label="OTJH" value={otjhLabel} />
        </div>

        <div className="mt-4 space-y-2">
          {shownWeeks.map((week, index) => (
            <div key={week.id} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-background-100 bg-white px-2.5 py-2 text-[11px] shadow-[0_1px_0_rgba(15,23,42,0.03)]">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-50 text-[10px] font-bold text-primary-700 ring-1 ring-primary-100">
                {week.weekNumber || index + 1}
              </span>
              <span className="min-w-0 truncate font-bold text-foreground-700">{week.weekTitle || 'Untitled week'}</span>
              <span className="shrink-0 rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">
                {week.componentCount || week.components?.length || 0}
              </span>
            </div>
          ))}
          {hiddenWeekCount > 0 && (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-background-200 bg-background-50 px-3 py-2 text-[11px] font-bold text-foreground-500">
              +{hiddenWeekCount} more week{hiddenWeekCount === 1 ? '' : 's'}
            </div>
          )}
        </div>

        <div className="mt-auto space-y-2 pt-5">
          <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-3">
            <button type="button" onClick={onEdit} className="primary-action inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary-700 px-3 text-sm font-bold text-white transition hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-200">
              <AppIcon name="ri-edit-2-line" size={15} />
              Edit
            </button>
            <button type="button" onClick={onDelete} className="inline-flex h-11 items-center justify-center rounded-lg bg-red-50 text-red-600 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-100" aria-label={`Delete ${card.title}`}>
              <AppIcon name="ri-delete-bin-line" size={16} />
            </button>
          </div>
          <button type="button" onClick={onConvert} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-background-300 bg-white px-3 text-sm font-bold text-foreground-700 transition hover:border-primary-300 hover:bg-primary-50 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-100">
            <AppIcon name="ri-exchange-line" size={15} />
            Convert to programme
          </button>
        </div>
      </div>
    </article>
  );
}

function CourseStat({ icon, label, value }: { icon: string; label: string; value: number | string }) {
  return (
    <div className="border-r border-background-200 px-2.5 py-2.5 last:border-r-0">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-foreground-400">
        <AppIcon name={icon} size={12} />
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-bold text-foreground-900">{value}</p>
    </div>
  );
}

function SortableCourseComponentRow({
  component,
  index,
  selected,
  onSelect,
  onRemove,
  onToggleManualUnlock,
  onOpenQuiz,
  onUnlinkQuiz,
}: {
  component: FreeCourseComponent;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onToggleManualUnlock: () => void;
  onOpenQuiz: () => void;
  onUnlinkQuiz: () => void;
}) {
  const meta = COMPONENT_META[component.kind];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: component.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') onSelect();
      }}
      className={`grid w-full grid-cols-[28px_32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-background-200 px-3 py-3 text-left transition last:border-b-0 ${
        selected ? 'bg-primary-50' : 'bg-background-100/70 hover:bg-background-100'
      } ${isDragging ? 'relative z-10 shadow-lg ring-2 ring-primary-200' : ''}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex h-8 w-8 touch-none items-center justify-center rounded-lg text-foreground-300 transition hover:bg-white hover:text-foreground-600 focus:outline-none focus:ring-2 focus:ring-primary-200"
        aria-label={`Drag ${component.title}`}
        onClick={event => event.stopPropagation()}
      >
        <AppIcon name="ri-drag-move-2-line" size={16} />
      </button>
      <span className="text-xs font-semibold text-foreground-400">{index + 1}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${meta.color}`}>
            <AppIcon name={meta.icon} size={14} />
          </span>
          <p className="truncate text-sm font-bold text-foreground-900">{component.code} - {component.title}</p>
        </div>
        <p className="mt-1 text-xs text-foreground-500">
          {meta.label} - {component.duration}
          {component.sourceWeekTitle ? ` - ${component.sourceWeekTitle}` : ''}
          {component.kind === 'quiz' ? ` - ${component.manualUnlock ? 'Manual unlock' : 'Automatic unlock'}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {component.kind === 'quiz' && (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onOpenQuiz();
            }}
            className="flex h-8 items-center justify-center gap-1 rounded-lg bg-primary-50 px-2 text-xs font-bold text-primary-700 transition hover:bg-primary-100"
            title="Create or edit the canonical Free Course quiz"
          >
            <AppIcon name="ri-questionnaire-line" size={15} />
            Quiz
          </button>
        )}
        {component.kind === 'quiz' && Boolean(component.rawComponent.settings?.linkedQuizId) && (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onUnlinkQuiz();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50"
            title="Unlink quiz without deleting its record"
            aria-label={`Unlink quiz from ${component.title}`}
          >
            <AppIcon name="ri-link-unlink" size={15} />
          </button>
        )}
        {component.kind === 'quiz' && (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onToggleManualUnlock();
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
              component.manualUnlock ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'text-foreground-400 hover:bg-background-100 hover:text-foreground-700'
            }`}
            title={component.manualUnlock ? 'Manual unlock is on' : 'Automatic unlock: opens after previous components are complete'}
            aria-label={component.manualUnlock ? `Set ${component.title} to automatic unlock` : `Manually unlock ${component.title}`}
          >
            <AppIcon name={component.manualUnlock ? 'ri-lock-unlock-line' : 'ri-lock-line'} size={15} />
          </button>
        )}
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            onRemove();
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50"
          aria-label={`Remove ${component.title}`}
        >
          <AppIcon name="ri-delete-bin-line" size={15} />
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/10 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-white/55">{label}</p>
      <p className="mt-1 text-xl font-heading font-bold text-white">{value}</p>
    </div>
  );
}

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
import { fetchCurriculumProgrammeDetail, fetchCurriculumProgrammes, fetchFreeProgrammeModules, importModuleToFreeCourses, injectFreeCourseIntoGroup, saveFreeProgrammeModules, type ConvertFreeCourseResult, type CurriculumModule, type CurriculumProgramme, type CurriculumProgrammeDetail, type FreeProgrammeComponentInput, type FreeProgrammeModule, type FreeProgrammeModuleInput } from '@/lib/curriculumApi';
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
}

interface FreeCourse {
  id: string;
  title: string;
  subtitle: string;
  coverImageUrl: string;
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
  weeks: FreeProgrammeModule[];
  componentCount: number;
  totalOtjh: number;
}

const COMPONENT_META: Record<ComponentKind, { label: string; icon: string; color: string }> = {
  video: { label: 'Video lesson', icon: 'ri-video-line', color: 'text-orange-600 bg-orange-50 border-orange-100' },
  reading: { label: 'Reading material', icon: 'ri-file-text-line', color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
  audio: { label: 'Audio lesson', icon: 'ri-headphone-line', color: 'text-sky-600 bg-sky-50 border-sky-100' },
  powerpoint: { label: 'PowerPoint', icon: 'ri-presentation-line', color: 'text-violet-600 bg-violet-50 border-violet-100' },
  quiz: { label: 'Quiz', icon: 'ri-questionnaire-line', color: 'text-amber-600 bg-amber-50 border-amber-100' },
  assignment: { label: 'Assignment', icon: 'ri-file-edit-line', color: 'text-fuchsia-600 bg-fuchsia-50 border-fuchsia-100' },
};

function createFreeCourseId() {
  const now = new Date();
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  const timestamp = [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
    pad(now.getUTCMilliseconds(), 3),
  ].join('');
  return `FREECOURSE-${timestamp}${pad(Math.floor(Math.random() * 1000), 3)}`;
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

function freeModuleComponentToCourseComponent(component: FreeProgrammeModule['components'][number], week: FreeProgrammeModule, index: number, templates: WeekTemplate[] = []): FreeCourseComponent {
  const type = component.type as ModuleComponent['type'];
  const sourceWeekTemplateId = typeof component.settings?.sourceWeekTemplateId === 'string' ? component.settings.sourceWeekTemplateId : '';
  const sourceWeekTitle = typeof component.settings?.sourceWeekTitle === 'string' ? component.settings.sourceWeekTitle : '';
  const matchedTemplate = templates.find(template => template.id === week.weekId || template.title === week.weekTitle || template.title === sourceWeekTitle);
  const sourceWeekId = sourceWeekTemplateId || matchedTemplate?.id || week.weekId || week.id;
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
    id: `${sourceWeekId}-${component.id}-${index}`,
    kind,
    code: nextComponentCode(kind, index),
    title: component.title || meta.label,
    meta: meta.label,
    duration,
    details: component.description || `${meta.label} imported from "${week.weekTitle || 'week'}".`,
    rawComponent,
    sourceWeekId,
    sourceWeekTitle: sourceWeekTitle || matchedTemplate?.title || week.weekTitle || 'Untitled week',
    manualUnlock: Boolean(component.settings?.manualUnlock),
    locked: kind === 'quiz',
  };
}

export default function FreeCoursesPage() {
  const [course, setCourse] = useState<FreeCourse>({
    id: '',
    title: '',
    subtitle: '',
    coverImageUrl: '',
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
  const [savedCoursesLoading, setSavedCoursesLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingCourseKey, setEditingCourseKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const [convertCard, setConvertCard] = useState<SavedFreeCourseCard | null>(null);
  const [convertMode, setConvertMode] = useState<'clone' | 'move'>('clone');
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
  const [importSelectedId, setImportSelectedId] = useState('');
  const [importMode, setImportMode] = useState<'clone' | 'move'>('clone');
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
  const selectedComponent = course.components.find(component => component.id === selectedComponentId) || course.components[0];
  const firstLockedIndex = course.components.findIndex(component => component.kind === 'quiz');
  const learnerCompletedCount = course.components.filter(component => completedPreviewIds.has(component.id)).length;
  const selectedWeekIds = useMemo(() => new Set(course.components.map(component => component.sourceWeekId).filter(Boolean)), [course.components]);
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
    fetchFreeProgrammeModules('FREE-COURSES', controller.signal)
      .then(modules => setSavedModules(modules))
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
    fetchCurriculumProgrammeDetail(convertProgrammeId, controller.signal, { visibility: 'all' })
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
    fetchCurriculumProgrammeDetail(importProgrammeId, controller.signal, { visibility: 'all', skipCache: true })
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

  const savedCourseCards = useMemo(() => groupSavedFreeCourses(savedModules), [savedModules]);

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
    if (file.size > 3 * 1024 * 1024) {
      await showCurriculumAlert({
        title: 'Image is too large',
        text: 'Please choose an image under 3 MB so it saves quickly.',
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
    setCourse(previous => ({ ...previous, id: '', title: '', subtitle: '', coverImageUrl: '', components: [] }));
    setSelectedComponentId('');
    setCompletedPreviewIds(new Set());
    setEditingCourseKey(null);
  };

  const openAddWizard = () => {
    resetDraftCourse();
    setWizardOpen(true);
  };

  const openEditWizard = (card: SavedFreeCourseCard) => {
    const components = card.weeks.flatMap((week, weekIndex) =>
      (week.components || []).map((component, componentIndex) => freeModuleComponentToCourseComponent(component, week, weekIndex + componentIndex, weekTemplates)),
    );
    setCourse(previous => ({
      ...previous,
      id: card.courseId,
      title: card.title,
      subtitle: card.description,
      coverImageUrl: card.coverImageUrl,
      components,
    }));
    setSelectedComponentId(components[0]?.id || '');
    setCompletedPreviewIds(new Set());
    setEditingCourseKey(card.key);
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
    setCompletedPreviewIds(new Set());
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

  const savedModuleInput = (module: FreeProgrammeModule): FreeProgrammeModuleInput => ({
    id: module.id,
    courseId: module.courseId,
    weekId: module.weekId,
    weekNumber: module.weekNumber,
    weekTitle: module.weekTitle,
    courseName: module.courseName || module.title,
    title: module.courseName || module.title,
    description: module.description,
    coverImageUrl: module.coverImageUrl || '',
    components: (module.components || []).map(component => ({
      id: component.id,
      weekId: component.weekId,
      displayOrder: component.displayOrder,
      type: component.type,
      title: component.title,
      description: component.description,
      expectedOtjh: component.expectedOtjh,
      points: component.points,
      reflectionRequired: component.reflectionRequired,
      workplaceEvidenceRequired: component.workplaceEvidenceRequired,
      tutorValidationRequired: component.tutorValidationRequired,
      settings: component.settings || {},
    })),
  });

  const draftWeekInputs = (courseName: string): FreeProgrammeModuleInput[] => {
    const courseId = course.id || createFreeCourseId();
    const orderedWeeks: Array<{ id: string; title: string; components: FreeCourseComponent[] }> = [];
    course.components.forEach(component => {
      const weekId = component.sourceWeekId || 'manual-week';
      let entry = orderedWeeks.find(item => item.id === weekId);
      if (!entry) {
        entry = { id: weekId, title: component.sourceWeekTitle || `Week ${orderedWeeks.length + 1}`, components: [] };
        orderedWeeks.push(entry);
      }
      entry.components.push(component);
    });
    return orderedWeeks.map((week, weekIndex): FreeProgrammeModuleInput => ({
      courseId,
      courseName,
      title: courseName,
      description: course.subtitle,
      coverImageUrl: course.coverImageUrl,
      weekId: week.id,
      weekNumber: weekIndex + 1,
      weekTitle: week.title,
      components: week.components.map((component, componentIndex): FreeProgrammeComponentInput => ({
        id: component.rawComponent.id || component.id,
        weekId: week.id,
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
          sourceWeekTemplateId: week.id,
          sourceWeekTitle: week.title,
          manualUnlock: component.manualUnlock || false,
        },
      })),
    }));
  };

  const createFreeCourse = async () => {
    const courseName = course.title.trim();
    if (!courseName || !course.components.length || savingCourse || savedCoursesLoading) return;
    setSavingCourse(true);
    try {
      const newModules = draftWeekInputs(courseName);
      const retainedModules = editingCourseKey
        ? savedModules.filter(module => (module.courseId || `${module.courseName || module.title || 'Untitled free course'}::${module.description || ''}`) !== editingCourseKey)
        : savedModules;
      const response = await saveFreeProgrammeModules('FREE-COURSES', {
        programmeName: 'Free Courses',
        modules: [...retainedModules.map(savedModuleInput), ...newModules],
      });
      setSavedModules(response.modules || []);
      resetDraftCourse();
      setWizardOpen(false);
      await showCurriculumAlert({
        title: editingCourseKey ? 'Free course updated' : 'Free course created',
        text: `${courseName} was saved with ${newModules.length} week${newModules.length === 1 ? '' : 's'}.`,
        icon: 'success',
        timer: 1800,
      });
    } catch (err) {
      await showCurriculumAlert({
        title: 'Could not create free course',
        text: err instanceof Error ? err.message : 'Please try again.',
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
        const weekIds = new Set(card.weeks.map(week => week.id));
        const retainedModules = savedModules.filter(module => !weekIds.has(module.id));
        const response = await saveFreeProgrammeModules('FREE-COURSES', {
          programmeName: 'Free Courses',
          modules: retainedModules.map(savedModuleInput),
        });
        setSavedModules(response.modules || []);
        if (editingCourseKey === card.key) resetDraftCourse();
      },
      successTitle: 'Free course deleted',
      successText: `"${card.title}" was removed.`,
    });
  };

  const openConvertWizard = (card: SavedFreeCourseCard) => {
    setConvertCard(card);
    setConvertMode('clone');
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
    const isMove = convertMode === 'move';
    const programme = convertProgrammeOptions.find(item => (item.sourceId || item.id) === convertProgrammeId);
    const groupLabel = convertGroups.find(group => group.id === groupId)?.name || 'the selected group';
    const programmeLabel = programme?.name || 'the programme';
    let result: ConvertFreeCourseResult | null = null;
    setConverting(true);
    try {
      await showCurriculumConfirm({
        title: isMove ? 'Move into this group?' : 'Add to this group?',
        text: isMove
          ? `"${card.title}" will be added to "${groupLabel}" in ${programmeLabel}, then DELETED as a free course — and removed from any learner currently assigned it.`
          : `"${card.title}" will be added as a module to "${groupLabel}" in ${programmeLabel}. The free course stays exactly as it is.`,
        icon: isMove ? 'warning' : 'question',
        confirmButtonText: isMove ? 'Move it' : 'Add module',
        cancelButtonText: 'Cancel',
        onConfirm: async () => {
          result = await injectFreeCourseIntoGroup('FREE-COURSES', {
            courseId: card.courseId,
            mode: convertMode,
            groupId,
          });
          if (isMove) {
            // The free course has gone; refresh the list from the source of truth.
            const modules = await fetchFreeProgrammeModules('FREE-COURSES');
            setSavedModules(modules);
            if (editingCourseKey === card.key) resetDraftCourse();
          }
        },
        successTitle: isMove ? 'Free course moved' : 'Module added',
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
    setImportSelectedId('');
    setImportMode('clone');
  };

  const closeImportPicker = () => {
    if (importing) return;
    setImportOpen(false);
  };

  const submitImport = async () => {
    if (!importSelectedId || importing) return;
    const module = importOptions.find(item => moduleKey(item) === importSelectedId);
    if (!module) return;
    const isMove = importMode === 'move';
    let imported = false;
    setImporting(true);
    try {
      await showCurriculumConfirm({
        title: isMove ? 'Move to a free course?' : 'Copy to a free course?',
        text: isMove
          ? `"${module.name}" will be copied into a new free course, then ARCHIVED from ${module.programme || 'its programme'}. Its KSB mappings and hours are not carried over.`
          : `"${module.name}" will be copied into a new free course. The module stays in ${module.programme || 'its programme'}. Its KSB mappings and hours are not carried over.`,
        icon: isMove ? 'warning' : 'question',
        confirmButtonText: isMove ? 'Move it' : 'Create free course',
        cancelButtonText: 'Cancel',
        onConfirm: async () => {
          const result = await importModuleToFreeCourses('FREE-COURSES', { moduleCatalogueId: moduleKey(module), mode: importMode });
          setSavedModules(result.modules || []);
          imported = true;
        },
        successTitle: isMove ? 'Module moved to free courses' : 'Free course created',
        successText: `"${module.name}" is now available under Free courses.`,
      });
    } finally {
      setImporting(false);
    }
    if (imported) {
      setImportOpen(false);
      // Drop the loaded programme so the next open refetches it: a move archives
      // the source module, and the cached list would still offer it.
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
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  </div>
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
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { value: 'clone', title: 'Clone', hint: 'Keep the free course as-is' },
                        { value: 'move', title: 'Move', hint: 'Delete the free course after' },
                      ] as const).map(option => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setConvertMode(option.value)}
                          className={`rounded-lg border px-3 py-2.5 text-left transition ${
                            convertMode === option.value
                              ? option.value === 'move'
                                ? 'border-red-300 bg-red-50 ring-1 ring-red-200'
                                : 'border-primary-300 bg-primary-50 ring-1 ring-primary-200'
                              : 'border-background-300 bg-white hover:border-background-400'
                          }`}
                        >
                          <span className={`flex items-center gap-1.5 text-sm font-bold ${convertMode === option.value && option.value === 'move' ? 'text-red-700' : 'text-foreground-900'}`}>
                            <AppIcon name={option.value === 'move' ? 'ri-scissors-cut-line' : 'ri-file-copy-line'} size={15} />
                            {option.title}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-foreground-500">{option.hint}</span>
                        </button>
                      ))}
                    </div>
                    {convertMode === 'move' && (
                      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-red-700">
                        <AppIcon name="ri-alert-line" size={14} className="mt-0.5 shrink-0" />
                        The free course will be deleted and removed from any learner currently assigned it.
                      </p>
                    )}
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
                    {convertMode === 'move' ? 'Move into group' : 'Add module'}
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
                      onChange={event => { setImportProgrammeId(event.target.value); setImportCohortId(''); setImportGroupId(''); setImportSelectedId(''); }}
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
                        onChange={event => { setImportCohortId(event.target.value); setImportGroupId(''); setImportSelectedId(''); }}
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
                        onChange={event => { setImportGroupId(event.target.value); setImportSelectedId(''); }}
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

                  <div className="flex h-10 items-center gap-2 rounded-lg border border-background-300 px-3 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-100">
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
                        const selected = key === importSelectedId;
                        const context = [module.programme, module.cohort, module.group].filter(Boolean).join(' · ');
                        const facts = [`${module.weeks || 0} ${module.weeks === 1 ? 'week' : 'weeks'}`, `${module.lessons || 0} lessons`, `${module.quizzes || 0} quizzes`].join(' · ');
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              onClick={() => setImportSelectedId(key)}
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
                              {selected && <AppIcon name="ri-checkbox-circle-fill" size={18} className="shrink-0 text-primary-600" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="border-t border-background-200 px-5 py-4">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-foreground-500">Mode</span>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'clone', title: 'Clone', hint: 'Keep the module in its programme' },
                      { value: 'move', title: 'Move', hint: 'Archive the module after' },
                    ] as const).map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setImportMode(option.value)}
                        className={`rounded-lg border px-3 py-2.5 text-left transition ${
                          importMode === option.value
                            ? option.value === 'move'
                              ? 'border-red-300 bg-red-50 ring-1 ring-red-200'
                              : 'border-primary-300 bg-primary-50 ring-1 ring-primary-200'
                            : 'border-background-300 bg-white hover:border-background-400'
                        }`}
                      >
                        <span className={`flex items-center gap-1.5 text-sm font-bold ${importMode === option.value && option.value === 'move' ? 'text-red-700' : 'text-foreground-900'}`}>
                          <AppIcon name={option.value === 'move' ? 'ri-scissors-cut-line' : 'ri-file-copy-line'} size={15} />
                          {option.title}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-foreground-500">{option.hint}</span>
                      </button>
                    ))}
                  </div>
                  {importMode === 'move' && (
                    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-red-700">
                      <AppIcon name="ri-alert-line" size={14} className="mt-0.5 shrink-0" />
                      The module will be archived from its programme (reversible). Enrolled learners’ saved training plans are not changed.
                    </p>
                  )}
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
                      disabled={importing || !importSelectedId}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 text-sm font-bold text-white transition hover:bg-primary-600 disabled:opacity-60"
                    >
                      <AppIcon name={importing ? 'ri-loader-4-line' : 'ri-download-2-line'} className={importing ? 'animate-spin' : ''} size={15} />
                      {importMode === 'move' ? 'Move to free course' : 'Convert to free course'}
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

function groupSavedFreeCourses(modules: FreeProgrammeModule[]): SavedFreeCourseCard[] {
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
      weeks: [module],
      componentCount: module.componentCount || module.components?.length || 0,
      totalOtjh: Number(module.totalOtjh || 0),
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
}: {
  component: FreeCourseComponent;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onToggleManualUnlock: () => void;
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

import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { type CurriculumGroup, type CurriculumModule, type CurriculumProgramme } from '@/lib/curriculumApi';
import {
  createEmptyComponent,
  createEmptyWeekTemplate,
  createWeekTemplate,
  deleteWeekTemplate,
  fetchComponentPointsDefaults,
  fetchWeekTemplates,
  fetchWeekTemplateDetail,
  filterQuizzesForScope,
  getComponentDefinition,
  loadCurriculumScope,
  makeAuthoringId,
  recalcWeekTemplate,
  reorderComponents,
  fetchWorkspaceQuizzes,
  toWeekTemplateInput,
  updateWeekTemplate,
  uploadWeekComponentResource,
  validateWeekComponent,
  weekPaletteGroups,
  weekPaletteTypes,
  weekTypeLabel,
  type KsbMapping,
  type ModuleComponent,
  type ModuleComponentType,
  type WeekComponentUploadResult,
  type WeekScope,
  type WeekTemplate,
  type WeekTemplateCourseType,
  type WorkspaceQuizSummary,
} from './weekTemplateData';
import { MEDIA_SOURCE_TYPES, normaliseVideoSourceType, providerForVideoSourceType, type ComponentSettingValue } from '@/pages/curriculum/module-builder/componentAuthoringModel';
import { RichTextDraft } from '@/pages/curriculum/module-builder/RichTextEditor';
import { formatDateLabel } from '@/pages/curriculum/shared/entities/model';
// Both panels are heavy and only mount when their modal opens — GuidedQuizUpload
// alone pulls in xlsx (~420 kB). Splitting them keeps that weight off the initial
// load of this page and of module-builder, which imports from this module.
const QuizEditorPanel = lazy(() => import('@/pages/curriculum/quiz-xml/edit/QuizEditorPanel').then(m => ({ default: m.QuizEditorPanel })));
const GuidedQuizUpload = lazy(() => import('./GuidedQuizUpload').then(m => ({ default: m.GuidedQuizUpload })));

export type { WeekScope };
export interface GroupOption { key: string; name: string; cohort?: string }
export type WeekComponentUploader = (componentId: string, file: File, componentType: 'reading' | 'podcast' | 'powerpoint' | 'assignment') => Promise<WeekComponentUploadResult>;

const curriculumNav = roleNavMap.curriculum;

const KSB_TYPES: KsbMapping['type'][] = ['main', 'secondary', 'possible'];

// The course type is the one structural identity signal on the page.
const COURSE: Record<WeekTemplateCourseType, { label: string; kicker: string; icon: string; text: string; bar: string; soft: string; ring: string }> = {
  paid: { label: 'Paid course', kicker: 'Scoped week', icon: 'ri-vip-crown-2-line', text: 'text-primary-600', bar: 'bg-primary-500', soft: 'bg-primary-50', ring: 'ring-primary-200' },
  free: { label: 'Free course', kicker: 'Open week', icon: 'ri-compass-3-line', text: 'text-emerald-600', bar: 'bg-emerald-500', soft: 'bg-emerald-50', ring: 'ring-emerald-200' },
};

// Categorical palette driven by each component type's own `tone` (from the
// authoring model) — colour on the page always means "kind of learning".
type ToneStyle = { dot: string; marker: string; chip: string; soft: string; border: string; text: string; grip: string };
const TONE: Record<string, ToneStyle> = {
  violet: { dot: 'bg-violet-400', marker: 'bg-violet-500', chip: 'bg-violet-100 text-violet-700', soft: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-600', grip: 'bg-violet-400/40' },
  slate: { dot: 'bg-slate-400', marker: 'bg-slate-500', chip: 'bg-slate-100 text-slate-700', soft: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', grip: 'bg-slate-400/40' },
  rose: { dot: 'bg-rose-400', marker: 'bg-rose-500', chip: 'bg-rose-100 text-rose-700', soft: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-600', grip: 'bg-rose-400/40' },
  amber: { dot: 'bg-amber-400', marker: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700', soft: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600', grip: 'bg-amber-400/40' },
  emerald: { dot: 'bg-emerald-400', marker: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700', soft: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-600', grip: 'bg-emerald-400/40' },
  orange: { dot: 'bg-orange-400', marker: 'bg-orange-500', chip: 'bg-orange-100 text-orange-700', soft: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-600', grip: 'bg-orange-400/40' },
  sky: { dot: 'bg-sky-400', marker: 'bg-sky-500', chip: 'bg-sky-100 text-sky-700', soft: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-600', grip: 'bg-sky-400/40' },
  purple: { dot: 'bg-purple-400', marker: 'bg-purple-500', chip: 'bg-purple-100 text-purple-700', soft: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-600', grip: 'bg-purple-400/40' },
  teal: { dot: 'bg-teal-400', marker: 'bg-teal-500', chip: 'bg-teal-100 text-teal-700', soft: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-600', grip: 'bg-teal-400/40' },
  blue: { dot: 'bg-blue-400', marker: 'bg-blue-500', chip: 'bg-blue-100 text-blue-700', soft: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600', grip: 'bg-blue-400/40' },
  pink: { dot: 'bg-pink-400', marker: 'bg-pink-500', chip: 'bg-pink-100 text-pink-700', soft: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-600', grip: 'bg-pink-400/40' },
};
function toneFor(type: string): ToneStyle {
  return TONE[getComponentDefinition(type).tone] || TONE.slate;
}

// ---------------------------------------------------------------------------
// Root — catalogue ⇄ editor.
// ---------------------------------------------------------------------------
export default function WeekBuilderPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [templates, setTemplates] = useState<WeekTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [working, setWorking] = useState<WeekTemplate | null>(null);
  const [workingIsNew, setWorkingIsNew] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const loadTemplates = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError('');
    try {
      const rows = await fetchWeekTemplates({}, signal);
      setTemplates(rows);
    } catch (err) {
      if (!signal?.aborted) setLoadError(err instanceof Error ? err.message : 'Unable to load week templates.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadTemplates(controller.signal);
    return () => controller.abort();
  }, [loadTemplates]);

  const openEditorForNew = useCallback((template: WeekTemplate) => {
    setWorking(template);
    setWorkingIsNew(true);
    setCreateOpen(false);
  }, []);

  const openEditorForExisting = useCallback(async (id: string) => {
    try {
      const detail = await fetchWeekTemplateDetail(id);
      setWorking(detail);
      setWorkingIsNew(false);
    } catch (err) {
      showCurriculumAlert({ title: 'Could not open template', text: err instanceof Error ? err.message : undefined, icon: 'error' });
    }
  }, []);

  useEffect(() => {
    const templateId = searchParams.get('template');
    if (!templateId || working?.id === templateId) return;
    void openEditorForExisting(templateId);
  }, [openEditorForExisting, searchParams, working?.id]);

  const closeEditor = useCallback((changed: boolean, returnToPrevious = false) => {
    setWorking(null);
    setWorkingIsNew(false);
    if (returnToPrevious) {
      navigate(-1);
      return;
    }
    setSearchParams({}, { replace: true });
    if (changed) loadTemplates();
  }, [loadTemplates, navigate, setSearchParams]);

  const handleDelete = useCallback(async (template: WeekTemplate) => {
    const confirmed = await showCurriculumConfirm({
      title: 'Delete week template?',
      text: `"${template.title || 'Untitled week'}" and its components will be permanently removed.`,
      confirmButtonText: 'Delete',
      icon: 'warning',
      onConfirm: async () => { await deleteWeekTemplate(template.id); },
    });
    if (confirmed) loadTemplates();
  }, [loadTemplates]);

  const handleDuplicate = useCallback(async (template: WeekTemplate) => {
    try {
      const detail = await fetchWeekTemplateDetail(template.id);
      await createWeekTemplate(toWeekTemplateInput({
        ...detail,
        title: `${detail.title} (copy)`,
        components: detail.components.map(component => ({ ...component, id: makeAuthoringId('component') })),
      }));
      loadTemplates();
      showCurriculumAlert({ title: 'Template duplicated', icon: 'success', timer: 1500 });
    } catch (err) {
      showCurriculumAlert({ title: 'Could not duplicate', text: err instanceof Error ? err.message : undefined, icon: 'error' });
    }
  }, [loadTemplates]);

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel={curriculumNav.label}
      navItems={curriculumNav.items}
      workspaceLabel={curriculumNav.workspaceLabel}
      pageTitle="Week Builder"
      pageSubtitle="Compose a week of learning once — reuse it across modules"
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      {working ? (
        <TemplateEditor initial={working} isNew={workingIsNew} onClose={closeEditor} returnToPrevious={searchParams.get('from') === 'free-courses'} />
      ) : (
        <TemplateListView
          templates={templates}
          loading={loading}
          error={loadError}
          onReload={() => loadTemplates()}
          onNew={() => setCreateOpen(true)}
          onOpen={openEditorForExisting}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
        />
      )}
      {createOpen && <CreateTemplateModal onClose={() => setCreateOpen(false)} onCreated={openEditorForNew} />}
    </WorkspaceShell>
  );
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
function TemplateListView({
  templates, loading, error, onReload, onNew, onOpen, onDelete, onDuplicate,
}: {
  templates: WeekTemplate[];
  loading: boolean;
  error: string;
  onReload: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (template: WeekTemplate) => void;
  onDuplicate: (template: WeekTemplate) => void;
}) {
  const [courseFilter, setCourseFilter] = useState<'all' | WeekTemplateCourseType>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return templates.filter(template => {
      if (courseFilter !== 'all' && template.courseType !== courseFilter) return false;
      if (term && !template.title.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [templates, courseFilter, search]);

  const paidCount = templates.filter(t => t.courseType === 'paid').length;
  const freeCount = templates.filter(t => t.courseType === 'free').length;
  const totalOtjh = Math.round(templates.reduce((sum, t) => sum + t.totalOtjh, 0) * 10) / 10;

  return (
    <div className="p-6 lg:p-8 max-w-[1200px] mx-auto space-y-8">
      {/* Masthead */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-primary-500">Curriculum · Week Builder</p>
          <h1 className="mt-1 font-heading text-[28px] leading-none font-black text-foreground-950">Week templates</h1>
          <p className="mt-2 text-[13px] text-foreground-500 max-w-md">A week is a sequence of learning. Build the shape once, drop it into any module.</p>
        </div>
        <button onClick={onNew} className="group inline-flex items-center gap-2 rounded-full bg-primary-600 pl-5 pr-2 py-2 text-[13px] font-bold text-background-50 hover:bg-primary-700 transition-smooth self-start sm:self-auto">
          New template
          <span className="grid place-items-center w-7 h-7 rounded-full bg-background-50 text-foreground-950 group-hover:rotate-90 transition-transform"><AppIcon className="ri-add-line"></AppIcon></span>
        </button>
      </header>

      {/* Ledger stats — quiet, tabular, no gradient tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-background-200 rounded-2xl border border-background-200 bg-background-50 overflow-hidden">
        <LedgerCell value={String(templates.length)} label="Templates" />
        <LedgerCell value={String(paidCount)} label="Paid" accent="text-primary-600" />
        <LedgerCell value={String(freeCount)} label="Free" accent="text-emerald-600" />
        <LedgerCell value={`${totalOtjh}`} label="OTJH banked" />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-0.5 rounded-full bg-background-100 p-1">
          {(['all', 'paid', 'free'] as const).map(value => (
            <button key={value} onClick={() => setCourseFilter(value)} className={`px-4 py-1.5 rounded-full text-[11px] font-bold transition-smooth ${courseFilter === value ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-800'}`}>
              {value === 'all' ? 'All' : COURSE[value].label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-[300px]">
          <AppIcon className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates" className="w-full rounded-full border border-background-200 bg-background-50 pl-9 pr-4 py-2 text-[12px]" />
        </div>
        <button onClick={onReload} title="Refresh" className="grid place-items-center w-9 h-9 rounded-full border border-background-200 bg-background-50 text-foreground-500 hover:text-foreground-800 hover:bg-background-100 transition-smooth"><AppIcon className="ri-refresh-line"></AppIcon></button>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-[12px] text-red-700"><AppIcon className="ri-error-warning-line mr-1"></AppIcon>{error}</div>}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-44 rounded-2xl border border-background-200 bg-background-100/50 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyCatalogue onNew={onNew} hasAny={templates.length > 0} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 stagger-children">
          {filtered.map(template => (
            <TemplateCard key={template.id} template={template} onOpen={() => onOpen(template.id)} onDuplicate={() => onDuplicate(template)} onDelete={() => onDelete(template)} />
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerCell({ value, label, accent = 'text-foreground-900' }: { value: string; label: string; accent?: string }) {
  return (
    <div className="p-4">
      <p className={`font-heading text-[24px] leading-none font-black tabular-nums ${accent}`}>{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-400">{label}</p>
    </div>
  );
}

function TemplateCard({ template, onOpen, onDuplicate, onDelete }: { template: WeekTemplate; onOpen: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const course = COURSE[template.courseType];
  return (
    <article className="group relative rounded-2xl border border-background-200 bg-background-50 hover:border-foreground-300 hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.18)] transition-all overflow-hidden flex flex-col">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${course.bar}`} />
      <button onClick={onOpen} className="text-left p-5 pl-6 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] ${course.text}`}><AppIcon className={course.icon}></AppIcon>{course.kicker}</span>
        </div>
        <h3 className="mt-2.5 font-heading text-[16px] font-bold text-foreground-950 leading-snug line-clamp-2 group-hover:text-primary-700 transition-smooth">{template.title || 'Untitled week'}</h3>
        <p className="mt-1 text-[11px] text-foreground-400 truncate">{template.courseType === 'paid' ? `${template.programmeName || 'Programme'} · ${template.groupName || 'Group'}` : 'Standalone open content'}</p>
        <DensityRibbon count={template.componentCount} tone={template.courseType === 'paid' ? 'bg-primary-300' : 'bg-emerald-300'} />
        <div className="mt-3 flex items-center gap-4 text-[11px] text-foreground-500">
          <span className="tabular-nums"><strong className="text-foreground-800">{template.componentCount}</strong> parts</span>
          <span className="tabular-nums"><strong className="text-foreground-800">{template.totalOtjh}</strong> OTJH</span>
          <span className="tabular-nums"><strong className="text-foreground-800">{template.points}</strong> pts</span>
        </div>
      </button>
      <div className="flex items-center gap-1 px-5 pl-6 pb-4">
        <button onClick={onOpen} className="flex-1 rounded-lg bg-primary-600 py-2 text-[11px] font-bold text-background-50 hover:bg-primary-700 transition-smooth">Open builder</button>
        <IconButton label="Duplicate" icon="ri-file-copy-line" onClick={onDuplicate} />
        <IconButton label="Delete" icon="ri-delete-bin-line" tone="danger" onClick={onDelete} />
      </div>
    </article>
  );
}

// A week's "fingerprint": segments encode length/density, not real types
// (the list endpoint returns counts only). Echoes the editor's rail motif.
function DensityRibbon({ count, tone }: { count: number; tone: string }) {
  const shown = Math.min(count, 14);
  return (
    <div className="mt-3 flex items-center gap-0.5 h-1.5">
      {count === 0 ? (
        <span className="text-[10px] text-foreground-300 italic">Empty week</span>
      ) : (
        <>
          {Array.from({ length: shown }).map((_, index) => <span key={index} className={`h-full flex-1 rounded-full ${tone}`} style={{ opacity: 0.45 + (index / shown) * 0.55 }} />)}
          {count > 14 && <span className="ml-1 text-[9px] font-bold text-foreground-400 tabular-nums">+{count - 14}</span>}
        </>
      )}
    </div>
  );
}

function EmptyCatalogue({ onNew, hasAny }: { onNew: () => void; hasAny: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-background-300 bg-background-50/60 py-16 text-center">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-primary-50 grid place-items-center text-primary-500 text-2xl"><AppIcon className="ri-route-line"></AppIcon></div>
      <p className="mt-4 font-heading text-[15px] font-bold text-foreground-800">{hasAny ? 'Nothing matches those filters' : 'No week templates yet'}</p>
      <p className="mt-1 text-[12px] text-foreground-400">{hasAny ? 'Try clearing a filter or the search box.' : 'Build a week once and reuse it everywhere.'}</p>
      {!hasAny && <button onClick={onNew} className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary-600 px-5 py-2 text-[12px] font-bold text-background-50 hover:bg-primary-700 transition-smooth"><AppIcon className="ri-add-line"></AppIcon> New template</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create flow
// ---------------------------------------------------------------------------
function CreateTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (template: WeekTemplate) => void }) {
  const [courseType, setCourseType] = useState<WeekTemplateCourseType>('paid');
  const [title, setTitle] = useState('');
  const [programmes, setProgrammes] = useState<CurriculumProgramme[]>([]);
  const [groups, setGroups] = useState<CurriculumGroup[]>([]);
  const [modules, setModules] = useState<CurriculumModule[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [programmeId, setProgrammeId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [moduleId, setModuleId] = useState('');

  useEffect(() => {
    if (courseType !== 'paid' || programmes.length) return;
    let active = true;
    setScopeLoading(true);
    loadCurriculumScope()
      .then(scope => {
        if (!active) return;
        setProgrammes(scope.programmes);
        setGroups(scope.groups);
        setModules(scope.modules);
      })
      .catch(() => { /* selectors stay empty; surfaced on confirm */ })
      .finally(() => { if (active) setScopeLoading(false); });
    return () => { active = false; };
  }, [courseType, programmes.length]);

  const programme = programmes.find(p => p.id === programmeId);
  const idMatchesProgramme = useCallback((value?: string) => {
    if (!programme) return false;
    return value === programme.id || value === programme.sourceId || value === programme.name;
  }, [programme]);

  const programmeGroups = useMemo(() => {
    if (!programme) return [] as CurriculumGroup[];
    const scoped = groups.filter(group => idMatchesProgramme(group.programmeId) || group.programme === programme.name);
    return scoped.length ? scoped : groups;
  }, [groups, programme, idMatchesProgramme]);

  const group = groups.find(g => g.id === groupId);
  const groupModules = useMemo(() => {
    if (!programme) return [] as CurriculumModule[];
    const scoped = modules.filter(module => {
      const inProgramme = idMatchesProgramme(module.programmeId) || module.programme === programme.name;
      const inGroup = !group || module.groupId === group.id || module.group === group.name;
      return inProgramme && inGroup;
    });
    return scoped.length ? scoped : modules.filter(module => idMatchesProgramme(module.programmeId) || module.programme === programme.name);
  }, [modules, programme, group, idMatchesProgramme]);

  const paidReady = Boolean(programmeId && groupId && moduleId);
  const canCreate = title.trim().length > 0 && (courseType === 'free' || paidReady);

  const handleCreate = () => {
    const base = createEmptyWeekTemplate(courseType);
    base.title = title.trim();
    if (courseType === 'paid') {
      const selectedModule = modules.find(m => (m.moduleCatalogueId || m.id) === moduleId);
      base.programmeId = programme?.id || '';
      base.programmeName = programme?.name || '';
      base.groupId = group?.id || '';
      base.groupName = group?.name || '';
      base.moduleCatalogueId = selectedModule ? (selectedModule.moduleCatalogueId || selectedModule.id) : moduleId;
    }
    onCreated(base);
  };

  return (
    <ModalShell title="New week template" onClose={onClose}>
      <div className="space-y-6">
        <div>
          <StepLabel index="1" text="Choose a course type" />
          <div className="mt-3 grid grid-cols-2 gap-3">
            {(['paid', 'free'] as const).map(value => {
              const course = COURSE[value];
              const active = courseType === value;
              return (
                <button key={value} onClick={() => setCourseType(value)} className={`relative text-left p-4 rounded-2xl border-2 transition-all ${active ? `${course.ring} ${course.soft} ring-2 border-transparent` : 'border-background-200 bg-background-50 hover:border-background-300'}`}>
                  <span className={`grid place-items-center w-9 h-9 rounded-xl ${active ? course.bar + ' text-white' : 'bg-background-100 text-foreground-500'} transition-colors`}><AppIcon className={`${course.icon} text-lg`}></AppIcon></span>
                  <p className="mt-2.5 text-[13px] font-bold text-foreground-900">{course.label}</p>
                  <p className="text-[11px] text-foreground-500 leading-snug mt-0.5">{value === 'paid' ? 'Tied to a programme, module & group' : 'Standalone — no scope required'}</p>
                  {active && <AppIcon className={`ri-checkbox-circle-fill absolute top-3 right-3 text-lg ${course.text}`}></AppIcon>}
                </button>
              );
            })}
          </div>
        </div>

        {courseType === 'paid' && (
          <div>
            <StepLabel index="2" text="Point it at a programme" hint={scopeLoading ? 'Loading…' : undefined} />
            <div className="mt-3 space-y-2.5">
              <ScopeSelect icon="ri-booklet-line" value={programmeId} placeholder="Select programme" onChange={value => { setProgrammeId(value); setGroupId(''); setModuleId(''); }} options={programmes.map(p => ({ value: p.id, label: p.name }))} />
              <ScopeSelect icon="ri-group-2-line" value={groupId} placeholder="Select group" disabled={!programmeId} onChange={value => { setGroupId(value); setModuleId(''); }} options={programmeGroups.map(g => ({ value: g.id, label: g.name }))} />
              <ScopeSelect icon="ri-stack-line" value={moduleId} placeholder="Select module" disabled={!programmeId} onChange={setModuleId} options={groupModules.map(m => ({ value: m.moduleCatalogueId || m.id, label: m.name }))} />
            </div>
          </div>
        )}

        <div>
          <StepLabel index={courseType === 'paid' ? '3' : '2'} text="Name the week" />
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Week 1 — Foundations of communication" className="mt-3 w-full rounded-xl border border-background-200 bg-background-50 px-4 py-2.5 text-[13px]" />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-full text-[12px] font-semibold text-foreground-500 hover:text-foreground-800 transition-smooth">Cancel</button>
          <button onClick={handleCreate} disabled={!canCreate} className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-primary-600 text-background-50 text-[12px] font-bold hover:bg-primary-700 transition-smooth disabled:opacity-30">Start building <AppIcon className="ri-arrow-right-line"></AppIcon></button>
        </div>
      </div>
    </ModalShell>
  );
}

function StepLabel({ index, text, hint }: { index: string; text: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid place-items-center w-5 h-5 rounded-full bg-primary-600 text-background-50 text-[10px] font-bold tabular-nums">{index}</span>
      <span className="text-[12px] font-bold text-foreground-800">{text}</span>
      {hint && <span className="text-[10px] text-foreground-400">· {hint}</span>}
    </div>
  );
}

function ScopeSelect({ icon, value, placeholder, options, onChange, disabled }: { icon: string; value: string; placeholder: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl border border-background-200 bg-background-50 px-3 ${disabled ? 'opacity-50' : ''}`}>
      <AppIcon className={`${icon} text-foreground-400`}></AppIcon>
      <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className="flex-1 bg-transparent py-2.5 text-[12px] outline-none">
        <option value="">{placeholder}</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
function TemplateEditor({ initial, isNew, onClose, returnToPrevious = false }: { initial: WeekTemplate; isNew: boolean; onClose: (changed: boolean, returnToPrevious?: boolean) => void; returnToPrevious?: boolean }) {
  const [template, setTemplate] = useState<WeekTemplate>(initial);
  const [persistedId, setPersistedId] = useState(isNew ? '' : initial.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [groupOptions, setGroupOptions] = useState<GroupOption[]>([]);
  const [pointsByType, setPointsByType] = useState<Partial<Record<ModuleComponentType, number>>>({});
  const savedChanges = useRef(false);

  // Group options for component assignment + the week's resolved module name.
  // Groups are scoped to the template's programme AND module (paid weeks):
  // CurriculumGroup.modules[] holds module *names*, and the template only
  // stores moduleCatalogueId, so we resolve the name from the overview first.
  const [moduleName, setModuleName] = useState('');
  const [scopeReady, setScopeReady] = useState(false);
  useEffect(() => {
    let active = true;
    const norm = (value?: string) => String(value ?? '').trim().toLowerCase();
    loadCurriculumScope()
      .then(({ groups, modules }) => {
        if (!active) return;
        const weekModule = modules.find(module => (module.moduleCatalogueId || module.id) === initial.moduleCatalogueId);
        const resolvedModuleName = weekModule?.name || '';
        setModuleName(resolvedModuleName);

        let scoped = initial.courseType === 'paid'
          ? groups.filter(group => group.programmeId === initial.programmeId || group.programme === initial.programmeName)
          : groups;
        // Narrow to the week's module when we can resolve it — but only if that
        // actually leaves some groups, so a naming mismatch never empties the
        // picker (fall back to the programme-scoped set).
        if (initial.courseType === 'paid' && resolvedModuleName) {
          const byModule = scoped.filter(group => (group.modules || []).some(mod => norm(mod) === norm(resolvedModuleName)));
          if (byModule.length) scoped = byModule;
        }
        setGroupOptions((scoped.length ? scoped : groups).map(group => ({ key: group.id, name: group.name, cohort: group.cohort })));
      })
      .catch(() => { /* picker stays empty */ })
      .finally(() => { if (active) setScopeReady(true); });
    return () => { active = false; };
  }, [initial.courseType, initial.programmeId, initial.programmeName, initial.moduleCatalogueId]);

  const weekScope = useMemo<WeekScope>(() => ({
    courseType: template.courseType,
    programmeId: template.programmeId,
    programmeName: template.programmeName,
    moduleName,
  }), [template.courseType, template.programmeId, template.programmeName, moduleName]);

  useEffect(() => {
    let active = true;
    fetchComponentPointsDefaults().then(map => { if (active) setPointsByType(map); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const savedSnapshot = useRef(JSON.stringify(initial));

  // Points are never hand-edited — they always mirror the Engagement points
  // rule for the component's type (e.g. a live session's points come from the
  // "attended live session" rule). Rules load asynchronously, so a
  // newly-added (or previously-saved) component can briefly hold a fallback
  // point value until this resolves. That catch-up is an enforcement step,
  // not a user edit — so it's applied to the saved snapshot too, otherwise
  // it would flash the page into a false "unsaved changes" state that
  // "discard" would revert to the stale fallback value instead of the rule.
  useEffect(() => {
    if (!Object.keys(pointsByType).length) return;
    const syncPoints = (tpl: WeekTemplate) => recalcWeekTemplate({
      ...tpl,
      components: tpl.components.map(component => {
        const rulePoints = pointsByType[component.type];
        return typeof rulePoints === 'number' && component.points !== rulePoints ? { ...component, points: rulePoints } : component;
      }),
    });
    setTemplate(prev => syncPoints(prev));
    try {
      savedSnapshot.current = JSON.stringify(syncPoints(JSON.parse(savedSnapshot.current)));
    } catch { /* snapshot stays as-is if it somehow isn't valid JSON */ }
  }, [pointsByType]);

  const dirty = JSON.stringify(template) !== savedSnapshot.current;

  const update = useCallback((updater: (prev: WeekTemplate) => WeekTemplate) => {
    setTemplate(prev => recalcWeekTemplate(updater(prev)));
  }, []);

  const selected = template.components.find(c => c.id === selectedId) || null;
  const course = COURSE[template.courseType];
  const issues = useMemo(() => template.components.reduce((count, component) => count + validateWeekComponent(component).length, 0), [template.components]);

  const patchComponent = (id: string, patch: Partial<ModuleComponent>) => {
    update(prev => ({ ...prev, components: prev.components.map(c => (c.id === id ? { ...c, ...patch } : c)) }));
  };

  const save = async () => {
    if (!template.title.trim()) {
      showCurriculumAlert({ title: 'Add a week title', text: 'A template needs a title before saving.', icon: 'warning' });
      return;
    }
    setSaving(true);
    try {
      const input = toWeekTemplateInput(template);
      const result = persistedId ? await updateWeekTemplate(persistedId, input) : await createWeekTemplate(input);
      setPersistedId(result.id);
      setTemplate(result);
      savedSnapshot.current = JSON.stringify(result);
      setSelectedId(prev => (prev && result.components.some(c => c.id === prev) ? prev : null));
      savedChanges.current = true;
      showCurriculumAlert({ title: 'Week template saved', icon: 'success', timer: 1400 });
    } catch (err) {
      showCurriculumAlert({ title: 'Save failed', text: err instanceof Error ? err.message : undefined, icon: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    const restored = JSON.parse(savedSnapshot.current) as WeekTemplate;
    setTemplate(restored);
    setSelectedId(prev => (prev && restored.components.some(c => c.id === prev) ? prev : restored.components[0]?.id ?? null));
  };

  const back = async () => {
    if (dirty) {
      const leave = await showCurriculumConfirm({ title: 'Discard unsaved changes?', text: 'Your edits to this week template will be lost.', confirmButtonText: 'Discard', cancelButtonText: 'Keep editing', onConfirm: async () => {} });
      if (!leave) return;
    }
    onClose(savedChanges.current, returnToPrevious);
  };

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (!dirty) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const jumpTo = (id: string) => {
    setSelectedId(id);
    document.getElementById(`node-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (!scopeReady) {
    return (
      <div className="px-5 lg:px-8 py-6">
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-background-200 bg-background-50 py-24 text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-background-300 border-t-primary-500" aria-hidden="true" />
          <p className="text-[13px] font-bold text-foreground-700">Preparing the week builder…</p>
          <p className="text-[11px] text-foreground-400">Loading programme, module and group data.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 lg:px-8 py-6 space-y-6">
      {/* Header band — the hero identity + at-a-glance flow */}
      <div className="relative rounded-2xl border border-background-200 bg-background-50 overflow-hidden">
        <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${course.bar}`} />
        <div className="p-5 pl-7">
          <button onClick={back} className="inline-flex items-center gap-1 text-[11px] font-bold text-foreground-400 hover:text-foreground-800 transition-smooth"><AppIcon className="ri-arrow-left-line"></AppIcon>{returnToPrevious ? 'Back' : 'All templates'}</button>
          <div className="mt-2 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className={`inline-flex items-center gap-1 font-bold uppercase tracking-[0.12em] ${course.text}`}><AppIcon className={course.icon}></AppIcon>{course.kicker}</span>
                {template.courseType === 'paid' && <span className="text-foreground-400"><Breadcrumb parts={[template.programmeName || 'Programme', template.groupName || 'Group']} /></span>}
                <SaveStatus dirty={dirty} saving={saving} isNew={!persistedId} />
              </div>
              <input value={template.title} onChange={e => update(prev => ({ ...prev, title: e.target.value }))} placeholder="Untitled week" className="mt-1 w-full max-w-[600px] bg-transparent font-heading text-[24px] font-black text-foreground-950 outline-none placeholder:text-foreground-300 border-b-2 border-transparent focus:border-primary-300 transition-colors" />
              <FlowStrip components={template.components} selectedId={selectedId} onJump={jumpTo} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={save} disabled={saving || !dirty} className="inline-flex items-center gap-1.5 rounded-full bg-primary-600 px-5 py-2 text-[12px] font-bold text-background-50 hover:bg-primary-700 transition-smooth disabled:opacity-30">
                {saving ? <><AppIcon className="ri-loader-4-line animate-spin"></AppIcon>Saving</> : <><AppIcon className="ri-save-3-line"></AppIcon>{persistedId ? 'Save' : 'Create'}</>}
              </button>
            </div>
          </div>
          {/* Quiet meter row */}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-foreground-500 border-t border-background-200 pt-3">
            <Meter icon="ri-puzzle-line" value={String(template.componentCount)} label="components" />
            <Meter icon="ri-time-line" value={String(template.totalOtjh)} label="OTJH" />
            <Meter icon="ri-medal-line" value={String(template.points)} label="points" />
            {issues > 0 && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600">
                <AppIcon className="ri-error-warning-line"></AppIcon>
                {issues} to resolve
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Workspace: rail (left, fixed) + inspector (right, fills the width) */}
      <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)] items-start">
        {/* Week rail */}
        <WeekComponentRail
          weekId={template.id}
          components={template.components}
          selectedId={selectedId}
          onSelectId={setSelectedId}
          onChange={next => update(prev => ({ ...prev, components: next }))}
          pointsByType={pointsByType}
        />

        {/* Inspector — the wide working canvas */}
        <div>
          {selected ? (
            <ComponentEditor key={selected.id} component={selected} onChange={patch => patchComponent(selected.id, patch)} onBack={() => setSelectedId(null)} groupOptions={groupOptions} rulePoints={pointsByType[selected.type]} weekScope={weekScope} />
          ) : (
            <WeekOverviewPanel
              components={template.components}
              ksbMappings={template.ksbMappings}
              summary={template.summary}
              learningOutcomes={template.learningOutcomes}
              onChangeSummary={value => update(prev => ({ ...prev, summary: value }))}
              onChangeLearningOutcomes={value => update(prev => ({ ...prev, learningOutcomes: value }))}
            />
          )}
        </div>
      </div>

      {/* Floating save bar — appears only when there is something to save */}
      {(dirty || saving) && (
        <div className="wb-savebar fixed bottom-6 left-1/2 z-40 flex items-center gap-3 rounded-full border border-background-200 bg-background-50/95 backdrop-blur px-3 py-2 shadow-2xl">
          <span className="inline-flex items-center gap-2 pl-2 text-[12px] font-semibold text-foreground-600">
            {saving ? <><AppIcon className="ri-loader-4-line animate-spin text-primary-500"></AppIcon>Saving changes…</> : <><span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />Unsaved changes</>}
          </span>
          {!saving && <button onClick={discard} className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-foreground-500 hover:text-foreground-900 hover:bg-background-100 transition-smooth">Discard</button>}
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-full bg-primary-600 px-5 py-1.5 text-[12px] font-bold text-background-50 hover:bg-primary-700 transition-smooth disabled:opacity-40">
            <AppIcon className="ri-save-3-line"></AppIcon>{persistedId ? 'Save changes' : 'Create template'}
          </button>
        </div>
      )}

      <style>{`@keyframes wbRise{from{opacity:0;transform:translate(-50%,14px)}to{opacity:1;transform:translate(-50%,0)}}.wb-savebar{transform:translate(-50%,0);animation:wbRise .2s ease-out}@media (prefers-reduced-motion:reduce){.wb-savebar{animation:none}}`}</style>
    </div>
  );
}

function Breadcrumb({ parts }: { parts: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <AppIcon className="ri-arrow-right-s-line opacity-50"></AppIcon>}
          <span className="truncate max-w-[160px]">{part}</span>
        </Fragment>
      ))}
    </span>
  );
}

function Meter({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <AppIcon className={`${icon} text-foreground-400 self-center`}></AppIcon>
      <strong className="font-heading text-[15px] font-black text-foreground-900 tabular-nums leading-none">{value}</strong>
      <span className="text-[11px] text-foreground-400">{label}</span>
    </span>
  );
}

// At-a-glance sequence — click a dot to jump to that part.
function FlowStrip({ components, selectedId, onJump }: { components: ModuleComponent[]; selectedId: string | null; onJump: (id: string) => void }) {
  if (components.length === 0) return null;
  return (
    <div className="mt-3 flex items-center gap-1 flex-wrap">
      {components.map((component, index) => {
        const tone = toneFor(component.type);
        const active = component.id === selectedId;
        return (
          <button
            key={component.id}
            onClick={() => onJump(component.id)}
            title={`${index + 1}. ${component.title || weekTypeLabel(component.type)}`}
            className={`h-2 rounded-full transition-all ${tone.marker} ${active ? 'w-7 ring-2 ring-offset-1 ring-foreground-300' : 'w-4 opacity-70 hover:opacity-100 hover:w-6'}`}
          />
        );
      })}
    </div>
  );
}

// The signature interaction: a "+" threaded into the spine that expands a
// contextual type picker exactly where the new part will land.
function InsertionZone({ index, open, onOpen, onClose, onPick, first, last }: { index: number; open: boolean; onOpen: () => void; onClose: () => void; onPick: (type: ModuleComponentType) => void; first?: boolean; last?: boolean }) {
  if (open) {
    return (
      <div className="flex gap-3">
        <SpineGutter connectTop={!first} connectBottom={!last}>
          <span className="grid place-items-center w-6 h-6 rounded-full bg-primary-500 text-white text-xs shadow ring-4 ring-primary-100"><AppIcon className="ri-add-line"></AppIcon></span>
        </SpineGutter>
        <div className="flex-1 my-1.5">
          <TypePicker onPick={onPick} onClose={onClose} atIndex={index} />
        </div>
      </div>
    );
  }
  return (
    <div className="group/insert flex gap-3">
      <SpineGutter connectTop={!first} connectBottom={!last} />
      <div className="flex-1 flex items-center">
        <button onClick={onOpen} className="relative w-full h-5 flex items-center justify-center" aria-label="Add a component here">
          <span className="absolute inset-x-0 h-px bg-primary-200 opacity-0 group-hover/insert:opacity-100 transition-opacity" />
          <span className="relative inline-flex items-center gap-1 rounded-full border border-background-200 bg-background-50 px-2 py-0.5 text-[10px] font-bold text-foreground-400 opacity-0 group-hover/insert:opacity-100 group-hover/insert:text-primary-600 group-hover/insert:border-primary-200 transition-all">
            <AppIcon className="ri-add-line"></AppIcon> Add here
          </span>
        </button>
      </div>
    </div>
  );
}

// The left "spine" gutter — a continuous line threaded through every node and
// insertion point, with a slot for the node marker.
function SpineGutter({ connectTop = true, connectBottom = true, children }: { connectTop?: boolean; connectBottom?: boolean; children?: ReactNode }) {
  return (
    <div className="relative w-7 shrink-0 flex justify-center">
      <span className={`absolute left-1/2 -translate-x-1/2 top-0 h-1/2 w-0.5 ${connectTop ? 'bg-background-200' : 'bg-transparent'}`} />
      <span className={`absolute left-1/2 -translate-x-1/2 bottom-0 h-1/2 w-0.5 ${connectBottom ? 'bg-background-200' : 'bg-transparent'}`} />
      <div className="relative z-10 flex items-center h-full">{children}</div>
    </div>
  );
}

interface RailNodeProps {
  component: ModuleComponent;
  index: number;
  selected: boolean;
  issues: number;
  weekSessionDate?: string;
  onSelect?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

// Sortable wrapper — @dnd-kit gives smooth transforms + keyboard support, and
// the drag is contained (vertical, within the rail) via modifiers on the context.
function SortableRailNode(props: RailNodeProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.component.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'opacity-40' : ''}>
      <RailNodeCard {...props} handleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function RailNodeCard({ component, index, selected, issues, weekSessionDate, dragging, onSelect, onDuplicate, onDelete, handleProps }: RailNodeProps & { dragging?: boolean; handleProps?: Record<string, unknown> }) {
  const definition = getComponentDefinition(component.type);
  const tone = toneFor(component.type);
  // A blank component-level date reads as "not yet scheduled", but the week
  // already knows when it runs -- show that instead of leaving the row silent.
  const scheduledDate = component.type === 'live-session'
    ? String(component.settings.sessionDate || weekSessionDate || '')
    : '';
  return (
    <div id={`node-${component.id}`} className="group/node flex gap-3">
      <SpineGutter>
        <span className={`grid place-items-center w-7 h-7 rounded-full text-white text-[11px] font-bold shadow-sm ${tone.marker} ${selected ? 'ring-4 ' + tone.grip : ''}`}>{index + 1}</span>
      </SpineGutter>
      <div
        onClick={onSelect}
        className={`flex-1 my-1 flex items-center gap-2 rounded-xl border px-2.5 py-2.5 transition-all cursor-pointer ${dragging ? 'border-primary-300 bg-background-50 shadow-xl ring-2 ring-primary-200' : selected ? `${tone.border} ${tone.soft} shadow-sm` : 'border-background-200 bg-background-50 hover:border-background-300 hover:shadow-sm'}`}
      >
        <button type="button" {...(handleProps || {})} onClick={e => e.stopPropagation()} aria-label="Drag to reorder" className="grid place-items-center w-5 h-8 -ml-0.5 shrink-0 text-foreground-300 hover:text-foreground-600 cursor-grab active:cursor-grabbing touch-none rounded"><AppIcon className="ri-draggable"></AppIcon></button>
        <span className={`grid place-items-center w-8 h-8 rounded-lg shrink-0 ${tone.chip}`}><AppIcon className={`${definition.icon} text-base`}></AppIcon></span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-foreground-900 truncate">{component.title || weekTypeLabel(component.type)}</span>
            {issues > 0 && <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-600"><AppIcon className="ri-error-warning-fill"></AppIcon>{issues}</span>}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-[10px] text-foreground-400">
            <span className={`font-semibold ${tone.text}`}>{weekTypeLabel(component.type)}</span>
            <span className="tabular-nums">{component.expectedOtjh}h</span>
            <span className="tabular-nums">{component.points}pts</span>
            {component.ksbMappings.length > 0 && <span className="tabular-nums">{component.ksbMappings.length} KSB</span>}
            {scheduledDate && <span className="tabular-nums">{formatDateLabel(scheduledDate)}</span>}
          </span>
        </span>
        {(onDuplicate || onDelete) && (
          <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover/node:opacity-100 transition-opacity">
            <span onClick={e => { e.stopPropagation(); onDuplicate?.(); }} className="grid place-items-center w-7 h-7 rounded-lg text-foreground-400 hover:bg-background-100 hover:text-primary-600 cursor-pointer"><AppIcon className="ri-file-copy-line text-[13px]"></AppIcon></span>
            <span onClick={e => { e.stopPropagation(); onDelete?.(); }} className="grid place-items-center w-7 h-7 rounded-lg text-foreground-400 hover:bg-red-100 hover:text-red-600 cursor-pointer"><AppIcon className="ri-delete-bin-line text-[13px]"></AppIcon></span>
          </span>
        )}
      </div>
    </div>
  );
}

function TypePicker({ onPick, onClose, atIndex }: { onPick: (type: ModuleComponentType) => void; onClose: () => void; atIndex: number }) {
  return (
    <div className="rounded-xl border border-primary-200 bg-background-50 shadow-lg ring-1 ring-primary-100 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-background-200 bg-primary-50/50">
        <span className="text-[11px] font-bold text-primary-700"><AppIcon className="ri-add-circle-line mr-1"></AppIcon>Add a part {atIndex === 0 ? 'at the start' : ''}</span>
        <button onClick={onClose} className="grid place-items-center w-6 h-6 rounded-md text-foreground-400 hover:bg-background-100 hover:text-foreground-700"><AppIcon className="ri-close-line"></AppIcon></button>
      </div>
      <div className="p-3 space-y-3 max-h-[340px] overflow-y-auto">
        {weekPaletteGroups.map(group => (
          <div key={group}>
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-foreground-400 mb-1.5">{group}</p>
            <div className="grid grid-cols-2 gap-2">
              {weekPaletteTypes.filter(type => type.group === group).map(type => {
                const tone = TONE[type.tone] || TONE.slate;
                const definition = getComponentDefinition(type.type);
                return (
                  <button key={type.type} onClick={() => onPick(type.type)} className={`group/tile flex items-center gap-2.5 rounded-lg border border-background-200 bg-background-50 p-2.5 text-left hover:border-background-300 hover:shadow-sm transition-all`}>
                    <span className={`grid place-items-center w-8 h-8 rounded-lg shrink-0 ${tone.chip} group-hover/tile:scale-105 transition-transform`}><AppIcon className={`${type.icon} text-base`}></AppIcon></span>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-bold text-foreground-800 truncate">{type.label}</span>
                      <span className="block text-[10px] text-foreground-400 tabular-nums">{definition.defaultOtjh}h · {definition.defaultPoints}pts</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Shared week rail: the sortable, insertable list of a week's components.
// Used by both the standalone week builder and the module builder's per-week
// panel, so a week looks and behaves identically in both places. Owns its own
// add/duplicate/remove/reorder UI state; the parent owns the actual component
// list (and whatever persistence — save-to-template vs save-to-module — sits
// on top of it), via a single `onChange(nextComponents)` callback.
export interface WeekComponentRailProps {
  weekId: string;
  components: ModuleComponent[];
  selectedId: string | null;
  onSelectId: (id: string | null) => void;
  onChange: (next: ModuleComponent[]) => void;
  pointsByType: Partial<Record<ModuleComponentType, number>>;
  // 'standalone' (default) is the full card used by the week builder and the
  // module builder's per-component editor view. 'nested' drops the outer
  // card/sticky chrome and the "The week, in order" header — used when the
  // rail is embedded inline under a week row (module builder's accordion),
  // where that framing/label would just repeat what the week row already says.
  variant?: 'standalone' | 'nested';
  // The week's own calendar date, for a live-session row that has not been
  // given its own date yet. Unset for a template, which has no calendar date.
  weekSessionDate?: string;
}

export function WeekComponentRail({ weekId, components, selectedId, onSelectId, onChange, pointsByType, variant = 'standalone', weekSessionDate }: WeekComponentRailProps) {
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const addComponentAt = (type: ModuleComponentType, index: number) => {
    const component = createEmptyComponent(weekId, type, components.length + 1);
    component.title = `${weekTypeLabel(type)} ${components.length + 1}`;
    const rulePoints = pointsByType[type];
    if (typeof rulePoints === 'number') component.points = rulePoints;
    const next = [...components];
    next.splice(index, 0, component);
    onChange(next);
    onSelectId(component.id);
    setPickerIndex(null);
  };

  const duplicateComponent = (component: ModuleComponent) => {
    const clone: ModuleComponent = { ...component, id: makeAuthoringId('component'), ksbMappings: component.ksbMappings.map(k => ({ ...k, id: makeAuthoringId('ksb') })) };
    const index = components.findIndex(c => c.id === component.id);
    const next = [...components];
    next.splice(index + 1, 0, clone);
    onChange(next);
    onSelectId(clone.id);
  };

  const removeComponent = (id: string) => {
    onChange(components.filter(c => c.id !== id));
    if (selectedId === id) onSelectId(null);
  };

  const onDragStart = (event: DragStartEvent) => setActiveDragId(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChange(reorderComponents(components, String(active.id), String(over.id)));
  };
  const activeComponent = components.find(c => c.id === activeDragId) || null;

  const nested = variant === 'nested';

  return (
    <div className={nested ? 'min-w-0' : 'min-w-0 lg:sticky lg:top-6 rounded-2xl border border-background-200 bg-background-50 p-4 sm:p-5'}>
      {!nested && (
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground-400">The week, in order</h4>
          <span className="text-[11px] text-foreground-400 tabular-nums">{components.length} {components.length === 1 ? 'part' : 'parts'}</span>
        </div>
      )}

      {components.length === 0 && pickerIndex === null ? (
        <button onClick={() => setPickerIndex(0)} className="mt-3 w-full rounded-xl border-2 border-dashed border-background-300 bg-background-50 py-10 text-center hover:border-primary-300 hover:bg-primary-50/40 transition-all group">
          <span className="grid place-items-center w-11 h-11 mx-auto rounded-full bg-primary-500 text-white text-xl group-hover:scale-110 transition-transform"><AppIcon className="ri-add-line"></AppIcon></span>
          <p className="mt-3 text-[13px] font-bold text-foreground-800">Add the first part</p>
          <p className="text-[11px] text-foreground-400">Live sessions, videos, readings, quizzes…</p>
        </button>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveDragId(null)} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
          <SortableContext items={components.map(c => c.id)} strategy={verticalListSortingStrategy}>
            <div className="mt-2 max-h-[calc(100vh-15rem)] overflow-y-auto overflow-x-hidden px-1.5 py-1.5">
              <InsertionZone index={0} open={pickerIndex === 0} onOpen={() => setPickerIndex(0)} onClose={() => setPickerIndex(null)} onPick={type => addComponentAt(type, 0)} first />
              {components.map((component, index) => (
                <Fragment key={component.id}>
                  <SortableRailNode
                    component={component}
                    index={index}
                    selected={component.id === selectedId}
                    onSelect={() => onSelectId(component.id)}
                    onDuplicate={() => duplicateComponent(component)}
                    onDelete={() => removeComponent(component.id)}
                    issues={validateWeekComponent(component).length}
                    weekSessionDate={weekSessionDate}
                  />
                  <InsertionZone index={index + 1} open={pickerIndex === index + 1} onOpen={() => setPickerIndex(index + 1)} onClose={() => setPickerIndex(null)} onPick={type => addComponentAt(type, index + 1)} last={index === components.length - 1} />
                </Fragment>
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeComponent ? <RailNodeCard component={activeComponent} index={components.findIndex(c => c.id === activeComponent.id)} selected dragging issues={0} weekSessionDate={weekSessionDate} /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

// Fixed tone per pedagogical group, for the composition bar.
const GROUP_TONE: Record<string, string> = {
  'Live & recorded': 'violet',
  'Learning materials': 'emerald',
  'Assessment': 'sky',
  'Monthly cycle': 'blue',
};

interface WeekStats {
  count: number;
  totalOtjh: number;
  points: number;
  byGroup: { group: string; count: number; otjh: number }[];
  ksbCodes: string[];
  partsWithKsb: number;
  reflection: number;
  evidence: number;
  tutor: number;
  assessment: number;
  cleanParts: number;
  issues: number;
}

function computeWeekStats(components: ModuleComponent[], weekKsbs: KsbMapping[]): WeekStats {
  const groups = new Map<string, { count: number; otjh: number }>();
  const codes = new Set<string>();
  weekKsbs.forEach(mapping => mapping.code && codes.add(mapping.code.toUpperCase()));
  let reflection = 0, evidence = 0, tutor = 0, assessment = 0, partsWithKsb = 0, cleanParts = 0, issues = 0;
  components.forEach(component => {
    const definition = getComponentDefinition(component.type);
    const bucket = groups.get(definition.group) || { count: 0, otjh: 0 };
    bucket.count += 1;
    bucket.otjh += Number(component.expectedOtjh) || 0;
    groups.set(definition.group, bucket);
    if (component.reflectionRequired) reflection += 1;
    if (component.workplaceEvidenceRequired) evidence += 1;
    if (component.tutorValidationRequired) tutor += 1;
    if (definition.group === 'Assessment' || definition.group === 'Monthly cycle') assessment += 1;
    if (component.ksbMappings.length) { partsWithKsb += 1; component.ksbMappings.forEach(mapping => mapping.code && codes.add(mapping.code.toUpperCase())); }
    const componentIssues = validateWeekComponent(component).length;
    issues += componentIssues;
    if (componentIssues === 0) cleanParts += 1;
  });
  return {
    count: components.length,
    totalOtjh: Math.round(components.reduce((sum, c) => sum + (Number(c.expectedOtjh) || 0), 0) * 100) / 100,
    points: components.reduce((sum, c) => sum + (Number(c.points) || 0), 0),
    byGroup: [...groups.entries()].map(([group, value]) => ({ group, ...value })),
    ksbCodes: [...codes].sort(),
    partsWithKsb, reflection, evidence, tutor, assessment, cleanParts, issues,
  };
}

export interface WeekOverviewPanelProps {
  components: ModuleComponent[];
  ksbMappings: KsbMapping[];
  summary: string;
  learningOutcomes: string[];
  onChangeSummary: (value: string) => void;
  onChangeLearningOutcomes: (value: string[]) => void;
}

export function WeekOverviewPanel({ components, ksbMappings, summary, learningOutcomes, onChangeSummary, onChangeLearningOutcomes }: WeekOverviewPanelProps) {
  const stats = useMemo(() => computeWeekStats(components, ksbMappings), [components, ksbMappings]);
  const readiness = stats.count ? Math.round((stats.cleanParts / stats.count) * 100) : 0;

  return (
    <div className="min-w-0 rounded-2xl border border-background-200 bg-background-50 overflow-hidden">
      <div className="px-6 py-4 border-b border-background-200 bg-background-100/40 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground-400">Week at a glance</p>
          <p className="mt-0.5 text-[12px] text-foreground-500">Select a part on the rail to edit it.</p>
        </div>
        <ReadinessDial value={readiness} />
      </div>

      <div className="divide-y divide-background-200">
        {/* Headline metrics */}
        <div className="grid min-w-0 grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-background-200">
          <BigStat value={String(stats.count)} label="Parts" icon="ri-puzzle-line" />
          <BigStat value={String(stats.totalOtjh)} label="OTJH" icon="ri-time-line" />
          <BigStat value={String(stats.points)} label="Points" icon="ri-medal-line" />
          <BigStat value={String(stats.ksbCodes.length)} label="KSBs" icon="ri-node-tree" accent="text-primary-600" />
        </div>

        {/* Composition — the shape/balance of the week */}
        <Section title="Composition" hint="mix of learning types">
          {stats.count === 0 ? (
            <p className="text-[12px] text-foreground-400">Add parts to see the week take shape.</p>
          ) : (
            <>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-background-100">
                {stats.byGroup.map(group => (
                  <span key={group.group} title={`${group.group}: ${group.count}`} className={(TONE[GROUP_TONE[group.group]] || TONE.slate).marker} style={{ width: `${(group.count / stats.count) * 100}%` }} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {stats.byGroup.map(group => {
                  const tone = TONE[GROUP_TONE[group.group]] || TONE.slate;
                  return (
                    <span key={group.group} className="inline-flex items-center gap-1.5 text-[11px] text-foreground-600">
                      <span className={`w-2.5 h-2.5 rounded-full ${tone.marker}`} />
                      {group.group}
                      <strong className="tabular-nums text-foreground-900">{group.count}</strong>
                      <span className="text-foreground-400 tabular-nums">· {Math.round(group.otjh * 10) / 10}h</span>
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </Section>

        {/* KSB coverage — compliance-critical */}
        <Section title="KSB coverage" hint={`${stats.partsWithKsb}/${stats.count} parts map KSBs`}>
          {stats.ksbCodes.length === 0 ? (
            <p className="text-[12px] text-foreground-400">No KSBs mapped yet. Open a part to map Knowledge, Skills & Behaviours.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {stats.ksbCodes.map(code => <span key={code} className="rounded-md bg-primary-100 px-2 py-0.5 text-[11px] font-bold text-primary-700 tabular-nums">{code}</span>)}
            </div>
          )}
        </Section>

        {/* Assurance load */}
        <Section title="Assurance" hint="what the week demands of learners">
          <div className="grid min-w-0 grid-cols-2 sm:grid-cols-4 gap-2">
            <AssureChip icon="ri-chat-quote-line" value={stats.reflection} label="Reflection" />
            <AssureChip icon="ri-briefcase-4-line" value={stats.evidence} label="Evidence" />
            <AssureChip icon="ri-user-star-line" value={stats.tutor} label="Tutor sign-off" />
            <AssureChip icon="ri-award-line" value={stats.assessment} label="Assessments" />
          </div>
        </Section>

        {/* Editable week detail */}
        <Section title="Week detail">
          <Field label="Summary"><textarea value={summary} onChange={e => onChangeSummary(e.target.value)} rows={2} placeholder="What this week is about…" className={`${inputClass} resize-none`} /></Field>
          <Field label="Learning outcomes" className="mt-4"><textarea value={learningOutcomes.join('\n')} onChange={e => onChangeLearningOutcomes(e.target.value.split('\n'))} rows={3} placeholder="One outcome per line" className={`${inputClass} resize-none`} /></Field>
          <p className="mt-3 text-[11px] text-foreground-400"><AppIcon className="ri-lightbulb-flash-line mr-1 text-amber-500"></AppIcon>Hover the spine between parts to insert exactly where you want.</p>
        </Section>
      </div>
    </div>
  );
}

function ReadinessDial({ value }: { value: number }) {
  const ready = value >= 100;
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative w-11 h-11">
        <svg viewBox="0 0 36 36" className="w-11 h-11 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="4" className="stroke-background-200" />
          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="4" strokeLinecap="round" className={ready ? 'stroke-emerald-500' : 'stroke-primary-500'} strokeDasharray={`${(value / 100) * 97.4} 97.4`} />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-[11px] font-black tabular-nums text-foreground-800">{value}%</span>
      </div>
      <span className={`text-[11px] font-bold ${ready ? 'text-emerald-600' : 'text-foreground-500'}`}>{ready ? 'Ready' : 'In progress'}</span>
    </div>
  );
}

function BigStat({ value, label, icon, accent = 'text-foreground-900' }: { value: string; label: string; icon: string; accent?: string }) {
  return (
    <div className="min-w-0 p-3 sm:p-4">
      <AppIcon className={`${icon} text-foreground-300`}></AppIcon>
      <p className={`mt-1 truncate font-heading text-[18px] sm:text-[22px] leading-none font-black tabular-nums ${accent}`}>{value}</p>
      <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-400">{label}</p>
    </div>
  );
}

function AssureChip({ icon, value, label }: { icon: string; value: number; label: string }) {
  const on = value > 0;
  return (
    <div className={`min-w-0 rounded-xl border px-3 py-2 ${on ? 'border-primary-200 bg-primary-50/60' : 'border-background-200 bg-background-50'}`}>
      <div className="flex items-center gap-1.5">
        <AppIcon className={`${icon} ${on ? 'text-primary-600' : 'text-foreground-300'}`}></AppIcon>
        <span className="font-heading text-[16px] font-black tabular-nums text-foreground-900">{value}</span>
      </div>
      <p className="mt-0.5 truncate text-[10px] font-semibold text-foreground-400">{label}</p>
    </div>
  );
}

function SaveStatus({ dirty, saving, isNew }: { dirty: boolean; saving: boolean; isNew: boolean }) {
  if (saving) return <span className="inline-flex items-center gap-1.5 text-primary-600 font-semibold"><AppIcon className="ri-loader-4-line animate-spin" />Saving…</span>;
  if (dirty) return <span className="inline-flex items-center gap-1.5 text-amber-600 font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />{isNew ? 'Not created yet' : 'Unsaved changes'}</span>;
  return <span className="inline-flex items-center gap-1.5 text-emerald-600 font-semibold"><AppIcon className="ri-checkbox-circle-fill" />All changes saved</span>;
}

// The week's fixed scope (programme + module), resolved once in the editor.
// Threaded to component bodies that need it — today the quiz body, to match
// importable quizzes and stamp newly-created ones.
export interface ComponentBodyProps {
  component: ModuleComponent;
  onChange: (patch: Partial<ModuleComponent>) => void;
  setSetting: (key: string, value: ComponentSettingValue) => void;
  groupOptions: GroupOption[];
  rulePoints?: number;
  weekScope: WeekScope;
  // The parent week's own calendar date (only set for a real module week, never
  // a reusable template) -- lets a live session default to when its week
  // actually runs instead of asking the date to be typed in again.
  weekSessionDate?: string;
  // Injected file uploader so the same bodies work in both the week builder
  // (posts to week-components/) and the module builder (module-scoped upload).
  uploadResource?: WeekComponentUploader;
  restoreTeamsMeeting?: () => Promise<void>;
  restoringTeamsMeeting?: boolean;
}

export function ComponentEditor({ component, onChange, onBack, groupOptions, rulePoints, weekScope, weekSessionDate, uploadResource, restoreTeamsMeeting, restoringTeamsMeeting = false }: { component: ModuleComponent; onChange: (patch: Partial<ModuleComponent>) => void; onBack: () => void; groupOptions: GroupOption[]; rulePoints?: number; weekScope: WeekScope; weekSessionDate?: string; uploadResource?: WeekComponentUploader; restoreTeamsMeeting?: () => Promise<void>; restoringTeamsMeeting?: boolean }) {
  const definition = getComponentDefinition(component.type);
  const tone = toneFor(component.type);
  const issues = validateWeekComponent(component);
  const setSetting = (key: string, value: ComponentSettingValue) => onChange({ settings: { ...component.settings, [key]: value } });
  const bodyProps: ComponentBodyProps = { component, onChange, setSetting, groupOptions, rulePoints, weekScope, weekSessionDate, uploadResource, restoreTeamsMeeting, restoringTeamsMeeting };

  return (
    <div className="rounded-2xl border border-background-200 bg-background-50 overflow-hidden">
      <div className={`flex items-center gap-3 px-5 py-4 border-b ${tone.border} ${tone.soft}`}>
        <button onClick={onBack} title="Back to week overview" className="grid place-items-center w-8 h-8 shrink-0 rounded-lg text-foreground-500 hover:bg-background-50 hover:text-foreground-900 transition-smooth"><AppIcon className="ri-arrow-left-line"></AppIcon></button>
        <span className={`grid place-items-center w-11 h-11 rounded-xl text-white ${tone.marker}`}><AppIcon className={`${definition.icon} text-xl`}></AppIcon></span>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-bold uppercase tracking-[0.12em] ${tone.text}`}>{definition.group}</p>
          <p className="text-[16px] font-heading font-black text-foreground-950 leading-tight truncate">{component.title || weekTypeLabel(component.type)}</p>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${issues.length ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
          <AppIcon className={issues.length ? 'ri-error-warning-fill' : 'ri-checkbox-circle-fill'}></AppIcon>{issues.length ? `${issues.length} to fix` : 'Valid'}
        </span>
      </div>

      <div className="divide-y divide-background-200">
        {component.type === 'live-session' ? <LiveSessionBody {...bodyProps} />
          : component.type === 'video' ? <VideoBody {...bodyProps} />
          : component.type === 'reading' ? <ReadingBody {...bodyProps} />
          : component.type === 'podcast' ? <PodcastBody {...bodyProps} />
          : component.type === 'powerpoint' ? <PowerPointBody {...bodyProps} />
          : component.type === 'quiz' ? <QuizBody {...bodyProps} />
          : component.type === 'assignment' ? <AssignmentBody {...bodyProps} />
          : <GenericComponentBody {...bodyProps} />}

        {/* Group assignment applies to every component type — scoped to the
            week's programme + module (resolved in the editor). */}
        <AssignedGroupsSection component={component} onChange={onChange} groupOptions={groupOptions} />

        {issues.length > 0 && (
          <Section title="To fix before publish">
            <ul className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
              {issues.map(issue => <li key={issue.path} className="text-[11px] text-amber-700 flex gap-1.5"><AppIcon className="ri-error-warning-line mt-0.5 shrink-0"></AppIcon>{issue.message}</li>)}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

// Generic body — used by types that don't yet have a bespoke editor.
function GenericComponentBody({ component, onChange, setSetting, rulePoints }: ComponentBodyProps) {
  const settingEntries = Object.entries(component.settings);
  return (
    <>
      <Section title="Basics">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]">
          <Field label="Title"><input value={component.title} onChange={e => onChange({ title: e.target.value })} className={inputClass} /></Field>
          <Field label="Expected OTJH"><input type="number" step="0.5" min="0" value={component.expectedOtjh} onChange={e => onChange({ expectedOtjh: Number(e.target.value) || 0 })} className={`${inputClass} tabular-nums`} /></Field>
          <Field label="Points"><input type="number" min="0" value={component.points} disabled readOnly title="Points are set by the Engagement points rule for this component type and can't be edited here." className={`${inputClass} tabular-nums cursor-not-allowed opacity-70`} /></Field>
        </div>
        <p className="mt-2 text-[11px] text-foreground-400"><AppIcon className="ri-flashlight-line mr-1 text-amber-500"></AppIcon>{typeof rulePoints === 'number' ? `Fixed by the Engagement points rule for ${weekTypeLabel(component.type)} (${rulePoints} pts).` : 'Points are fixed by the Engagement points rules — not editable here.'}</p>
        <Field label="Description" className="mt-4"><textarea value={component.description} onChange={e => onChange({ description: e.target.value })} rows={2} className={`${inputClass} resize-none`} /></Field>
      </Section>

      <Section title="Requirements" hint="What completing this part demands">
        <div className="flex flex-wrap gap-2">
          <Toggle label="Reflection" checked={component.reflectionRequired} onChange={value => onChange({ reflectionRequired: value })} />
          <Toggle label="Workplace evidence" checked={component.workplaceEvidenceRequired} onChange={value => onChange({ workplaceEvidenceRequired: value })} />
          <Toggle label="Tutor validation" checked={component.tutorValidationRequired} onChange={value => onChange({ tutorValidationRequired: value })} />
        </div>
      </Section>

      <Section title={`${weekTypeLabel(component.type)} settings`} hint={`${settingEntries.length} fields`}>
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          {settingEntries.map(([key, value]) => <SettingField key={key} settingKey={key} value={value} onChange={next => setSetting(key, next)} />)}
        </div>
      </Section>

    </>
  );
}

// Bespoke Live Teams Session editor. (Group assignment is rendered once for
// every component type by ComponentEditor, so it isn't repeated here.)
function LiveSessionBody({ component, onChange, setSetting, rulePoints, weekSessionDate, restoreTeamsMeeting, restoringTeamsMeeting }: ComponentBodyProps) {
  const s = (key: string) => String(component.settings[key] ?? '');
  // An explicit edit always wins; otherwise default to the date the week is
  // actually scheduled on, so the field reads correctly before anyone types
  // into it rather than sitting blank until someone repeats what the session
  // plan already worked out.
  const sessionDate = s('sessionDate') || weekSessionDate || '';

  return (
    <>
      <Section title="Session details">
        <Field label="Title"><input value={component.title} onChange={e => onChange({ title: e.target.value })} className={inputClass} /></Field>
        <Field label="Description" className="mt-4"><textarea value={component.description} onChange={e => onChange({ description: e.target.value })} rows={2} placeholder="What this session is about…" className={`${inputClass} resize-none`} /></Field>

        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Microsoft Teams link"><input value={s('liveSessionUrl')} onChange={e => setSetting('liveSessionUrl', e.target.value)} placeholder="https://teams.microsoft.com/…" className={inputClass} /></Field>
          <Field label="Session date"><input type="date" value={sessionDate} onChange={e => setSetting('sessionDate', e.target.value)} className={`${inputClass} tabular-nums`} /></Field>
          <Field label="Start time"><input type="time" value={s('sessionTime')} onChange={e => setSetting('sessionTime', e.target.value)} className={`${inputClass} tabular-nums`} /></Field>
        </div>
        {restoreTeamsMeeting && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => { void restoreTeamsMeeting(); }}
              disabled={restoringTeamsMeeting}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[11px] font-bold text-primary-700 transition-smooth hover:border-primary-300 hover:bg-primary-100 disabled:cursor-wait disabled:opacity-70"
            >
              <i className={restoringTeamsMeeting ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'}></i>
              {restoringTeamsMeeting ? 'Restoring Teams data...' : 'Restore saved Teams data'}
            </button>
          </div>
        )}

        <Field label="Session outline" className="mt-4"><textarea value={s('sessionPurpose')} onChange={e => setSetting('sessionPurpose', e.target.value)} rows={3} placeholder="A short summary of what this session covers…" className={`${inputClass} resize-none`} /></Field>
      </Section>

      <Section title="Effort & reward">
        <div className="grid gap-4 sm:grid-cols-2 max-w-md">
          <Field label="Expected OTJH hours"><input type="number" step="0.5" min="0" value={component.expectedOtjh} onChange={e => onChange({ expectedOtjh: Number(e.target.value) || 0 })} className={`${inputClass} tabular-nums`} /></Field>
          <Field label="Points"><input type="number" min="0" value={component.points} disabled readOnly title="Points are set by the Engagement points rule for this component type and can't be edited here." className={`${inputClass} tabular-nums cursor-not-allowed opacity-70`} /></Field>
        </div>
        <p className="mt-2 text-[11px] text-foreground-400"><AppIcon className="ri-flashlight-line mr-1 text-amber-500"></AppIcon>{typeof rulePoints === 'number' ? `Fixed by the "Attendance" points rule for live sessions (${rulePoints} pts).` : 'Points are fixed by the Engagement points rules — not editable here.'}</p>
      </Section>

      <Section title="Assurance">
        <div className="flex flex-wrap gap-2">
          <Toggle label="Reflection required" checked={component.reflectionRequired} onChange={value => onChange({ reflectionRequired: value })} />
          <Toggle label="Tutor validation" checked={component.tutorValidationRequired} onChange={value => onChange({ tutorValidationRequired: value })} />
        </div>
        {component.reflectionRequired && (
          <Field label="Reflection prompt" className="mt-4"><textarea value={s('reflectionPrompt')} onChange={e => setSetting('reflectionPrompt', e.target.value)} rows={2} placeholder="What should the learner reflect on after this session?" className={`${inputClass} resize-none`} /></Field>
        )}
      </Section>

      <Section title="Publishing">
        <div className="grid gap-4 max-w-md">
          <Field label="Version"><input value={s('version') || '0.1'} onChange={e => setSetting('version', e.target.value)} placeholder="0.1" className={inputClass} /></Field>
        </div>
      </Section>

    </>
  );
}

// Bespoke Video editor — mirrors the Live Teams Session layout (details →
// effort & reward → assurance → publishing → KSBs), swapping the session
// details for a source-type-driven video field, matching the Module
// Builder's video authoring fields (source type, URL/embed, duration,
// required progress, component content).
function VideoBody({ component, onChange, setSetting, rulePoints }: ComponentBodyProps) {
  const s = (key: string) => String(component.settings[key] ?? '');
  const sourceType = normaliseVideoSourceType(s('sourceType') || s('provider'));
  const updateSourceType = (value: string) => onChange({
    settings: { ...component.settings, sourceType: value, provider: providerForVideoSourceType(value) },
  });

  return (
    <>
      <Section title="Video details">
        <Field label="Title"><input value={component.title} onChange={e => onChange({ title: e.target.value })} className={inputClass} /></Field>
        <Field label="Description" className="mt-4"><textarea value={component.description} onChange={e => onChange({ description: e.target.value })} rows={2} placeholder="What this video is about…" className={`${inputClass} resize-none`} /></Field>

        <div className="mt-4 grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
          <Field label="Source type">
            <select value={sourceType} onChange={e => updateSourceType(e.target.value)} className={inputClass}>
              {MEDIA_SOURCE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
          </Field>
          {sourceType === 'Embed' ? (
            <Field label="Embed iframe content"><textarea value={s('embedCode')} onChange={e => setSetting('embedCode', e.target.value)} rows={4} className={`${inputClass} resize-none`} /></Field>
          ) : (
            <Field label={sourceType === 'HTML (MP4)' ? 'MP4 file URL' : 'Video URL'}><input value={s('videoUrl')} onChange={e => setSetting('videoUrl', e.target.value)} placeholder="https://…" className={inputClass} /></Field>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 max-w-md">
          <Field label="Component duration (minutes)"><input type="number" min="0" value={Number(component.settings.durationMinutes) || 0} onChange={e => setSetting('durationMinutes', Number(e.target.value) || 0)} className={`${inputClass} tabular-nums`} /></Field>
          <Field label="Required progress (%)"><input type="number" min="0" max="100" value={Number(component.settings.requiredProgressPercentage) || 0} onChange={e => setSetting('requiredProgressPercentage', Number(e.target.value) || 0)} className={`${inputClass} tabular-nums`} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Toggle label="Free preview" checked={Boolean(component.settings.lessonPreview)} onChange={value => setSetting('lessonPreview', value)} />
          <Toggle label="Captions available" checked={Boolean(component.settings.captionsAvailable)} onChange={value => setSetting('captionsAvailable', value)} />
        </div>

        <Field label="Component content" className="mt-4"><textarea value={s('lessonContent')} onChange={e => setSetting('lessonContent', e.target.value)} rows={6} placeholder="What the learner sees alongside the video…" className={`${inputClass} resize-none`} /></Field>
      </Section>

      <Section title="Effort & reward">
        <div className="grid gap-4 sm:grid-cols-2 max-w-md">
          <Field label="Expected OTJH hours"><input type="number" step="0.5" min="0" value={component.expectedOtjh} onChange={e => onChange({ expectedOtjh: Number(e.target.value) || 0 })} className={`${inputClass} tabular-nums`} /></Field>
          <Field label="Points"><input type="number" min="0" value={component.points} disabled readOnly title="Points are set by the Engagement points rule for this component type and can't be edited here." className={`${inputClass} tabular-nums cursor-not-allowed opacity-70`} /></Field>
        </div>
        <p className="mt-2 text-[11px] text-foreground-400"><AppIcon className="ri-flashlight-line mr-1 text-amber-500"></AppIcon>{typeof rulePoints === 'number' ? `Fixed by the Engagement points rule for videos (${rulePoints} pts).` : 'Points are fixed by the Engagement points rules — not editable here.'}</p>
      </Section>

      <Section title="Assurance">
        <div className="flex flex-wrap gap-2">
          <Toggle label="Reflection required" checked={component.reflectionRequired} onChange={value => onChange({ reflectionRequired: value })} />
          <Toggle label="Tutor validation" checked={component.tutorValidationRequired} onChange={value => onChange({ tutorValidationRequired: value })} />
        </div>
        {component.reflectionRequired && (
          <Field label="Reflection prompt" className="mt-4"><textarea value={s('reflectionPrompt')} onChange={e => setSetting('reflectionPrompt', e.target.value)} rows={2} placeholder="What should the learner reflect on after this video?" className={`${inputClass} resize-none`} /></Field>
        )}
      </Section>

      <Section title="Publishing">
        <div className="grid gap-4 max-w-md">
          <Field label="Version"><input value={s('version') || '0.1'} onChange={e => setSetting('version', e.target.value)} placeholder="0.1" className={inputClass} /></Field>
        </div>
      </Section>

    </>
  );
}

const READING_UPLOAD_ACCEPT = '.txt,.doc,.docx,.pdf,.rtf,.odt,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,application/vnd.oasis.opendocument.text';
const PODCAST_UPLOAD_ACCEPT = '.mp3,.ogg,.oga,.wav,.m4a,.aac,.webm,audio/*';
const POWERPOINT_UPLOAD_ACCEPT = '.ppt,.pptx,.pps,.ppsx,.pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/pdf';

// Bespoke Reading Material editor — the source has just two shapes: written
// text (a plain content field, matching the Module Builder's text editor
// intent) or an uploaded document (Word/PDF/text/RTF/OpenDocument), each with
// its own field beneath the toggle.
function ReadingBody({ component, onChange, setSetting, rulePoints, uploadResource }: ComponentBodyProps) {
  const s = (key: string) => String(component.settings[key] ?? '');
  const sourceMode = ['File', 'LMS resource'].includes(s('readingSource')) ? 'File' : 'Text';

  return (
    <>
      <Section title="Reading details">
        <Field label="Title"><input value={component.title} onChange={e => onChange({ title: e.target.value })} className={inputClass} /></Field>
        <Field label="Description" className="mt-4"><textarea value={component.description} onChange={e => onChange({ description: e.target.value })} rows={2} placeholder="What this reading covers…" className={`${inputClass} resize-none`} /></Field>

        <div className="mt-4">
          <span className="block text-[11px] font-semibold text-foreground-500 mb-1.5">Source</span>
          <div className="inline-flex items-center gap-0.5 rounded-full bg-background-100 p-1">
            {(['Text', 'File'] as const).map(mode => (
              <button key={mode} type="button" onClick={() => setSetting('readingSource', mode)} className={`px-4 py-1.5 rounded-full text-[11px] font-bold transition-smooth ${sourceMode === mode ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-800'}`}>
                {mode === 'Text' ? 'Written text' : 'Uploaded file'}
              </button>
            ))}
          </div>
        </div>

        {sourceMode === 'Text' ? (
          <div className="mt-4">
            <RichTextDraft label="Component content" value={s('readingContent')} onChange={value => setSetting('readingContent', value)} rows={14} htmlOnly />
          </div>
        ) : (
          <div className="mt-4">
            <span className="block text-[11px] font-semibold text-foreground-500 mb-1.5">File</span>
            <WeekComponentFileUpload
              componentId={component.id}
              componentType="reading"
              onUpload={uploadResource}
              accept={READING_UPLOAD_ACCEPT}
              uploadedName={s('uploadedFileName')}
              uploadedUrl={s('uploadedFileUrl') || s('resourceUrl')}
              uploadedSize={Number(component.settings.uploadedFileSize) || 0}
              onUploaded={file => onChange({
                settings: {
                  ...component.settings,
                  readingSource: 'File',
                  resourceUrl: file.url,
                  uploadedFileName: file.fileName,
                  uploadedFileUrl: file.url,
                  uploadedFileSize: file.size,
                  uploadedFileContentType: file.contentType,
                  uploadSource: 'Device upload',
                },
              })}
            />
            <p className="mt-2 text-[11px] text-foreground-400">Accepted formats: Word (.doc, .docx), PDF, plain text (.txt), RTF, OpenDocument (.odt).</p>
          </div>
        )}
      </Section>

      <Section title="Effort & reward">
        <div className="grid gap-4 sm:grid-cols-2 max-w-md">
          <Field label="Expected OTJH hours"><input type="number" step="0.5" min="0" value={component.expectedOtjh} onChange={e => onChange({ expectedOtjh: Number(e.target.value) || 0 })} className={`${inputClass} tabular-nums`} /></Field>
          <Field label="Points"><input type="number" min="0" value={component.points} disabled readOnly title="Points are set by the Engagement points rule for this component type and can't be edited here." className={`${inputClass} tabular-nums cursor-not-allowed opacity-70`} /></Field>
        </div>
        <p className="mt-2 text-[11px] text-foreground-400"><AppIcon className="ri-flashlight-line mr-1 text-amber-500"></AppIcon>{typeof rulePoints === 'number' ? `Fixed by the Engagement points rule for reading materials (${rulePoints} pts).` : 'Points are fixed by the Engagement points rules — not editable here.'}</p>
      </Section>

      <Section title="Assurance">
        <div className="flex flex-wrap gap-2">
          <Toggle label="Reflection required" checked={component.reflectionRequired} onChange={value => onChange({ reflectionRequired: value })} />
          <Toggle label="Tutor validation" checked={component.tutorValidationRequired} onChange={value => onChange({ tutorValidationRequired: value })} />
        </div>
        {component.reflectionRequired && (
          <Field label="Reflection prompt" className="mt-4"><textarea value={s('reflectionPrompt')} onChange={e => setSetting('reflectionPrompt', e.target.value)} rows={2} placeholder="What should the learner reflect on after this reading?" className={`${inputClass} resize-none`} /></Field>
        )}
      </Section>

      <Section title="Publishing">
        <div className="grid gap-4 max-w-md">
          <Field label="Version"><input value={s('version') || '0.1'} onChange={e => setSetting('version', e.target.value)} placeholder="0.1" className={inputClass} /></Field>
        </div>
      </Section>

    </>
  );
}

const PODCAST_SOURCE_TYPES_WEEK = ['Audio File', 'External Link', 'Embed', 'Shortcode'] as const;

// Bespoke Podcast editor — four source shapes: an uploaded audio file, an
// external link, an embed snippet (Apple Podcasts / SoundCloud / Deezer /
// Spotify), or a shortcode — each with its own field beneath the selector.
function PodcastBody({ component, onChange, setSetting, rulePoints, uploadResource }: ComponentBodyProps) {
  const s = (key: string) => String(component.settings[key] ?? '');
  const rawSourceType = s('podcastSource');
  const sourceType = rawSourceType === 'Device upload'
    ? 'Audio File'
    : rawSourceType === 'External URL'
      ? 'External Link'
      : (PODCAST_SOURCE_TYPES_WEEK as readonly string[]).includes(rawSourceType)
        ? rawSourceType
        : 'Audio File';

  return (
    <>
      <Section title="Podcast details">
        <Field label="Title"><input value={component.title} onChange={e => onChange({ title: e.target.value })} className={inputClass} /></Field>
        <Field label="Description" className="mt-4"><textarea value={component.description} onChange={e => onChange({ description: e.target.value })} rows={2} placeholder="What this podcast is about…" className={`${inputClass} resize-none`} /></Field>

        <Field label="Source type" className="mt-4">
          <select value={sourceType} onChange={e => setSetting('podcastSource', e.target.value)} className={inputClass}>
            {PODCAST_SOURCE_TYPES_WEEK.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </Field>

        {sourceType === 'Audio File' ? (
          <div className="mt-4">
            <WeekComponentFileUpload
              componentId={component.id}
              componentType="podcast"
              onUpload={uploadResource}
              accept={PODCAST_UPLOAD_ACCEPT}
              uploadedName={s('uploadedFileName')}
              uploadedUrl={s('uploadedFileUrl') || s('podcastUrl')}
              uploadedSize={Number(component.settings.uploadedFileSize) || 0}
              onUploaded={file => onChange({
                settings: {
                  ...component.settings,
                  podcastSource: 'Audio File',
                  podcastUrl: file.url,
                  uploadedFileName: file.fileName,
                  uploadedFileUrl: file.url,
                  uploadedFileSize: file.size,
                  uploadedFileContentType: file.contentType,
                  uploadSource: 'Device upload',
                },
              })}
            />
            <p className="mt-2 text-[11px] text-foreground-400">Accepted formats: MP3, OGG, WAV (plus M4A, AAC, WEBM).</p>
            {(s('uploadedFileUrl') || s('podcastUrl')) && (
              <div className="mt-3">
                <span className="block text-[11px] font-semibold text-foreground-500 mb-1.5">Preview</span>
                <audio controls src={s('uploadedFileUrl') || s('podcastUrl')} className="w-full" />
              </div>
            )}
          </div>
        ) : sourceType === 'External Link' ? (
          <Field label="Podcast URL" className="mt-4"><input value={s('podcastUrl')} onChange={e => setSetting('podcastUrl', e.target.value)} placeholder="https://…" className={inputClass} /></Field>
        ) : sourceType === 'Embed' ? (
          <div className="mt-4">
            <Field label="Embed code"><textarea value={s('podcastEmbedCode')} onChange={e => setSetting('podcastEmbedCode', e.target.value)} rows={4} placeholder="Paste the Apple Podcasts / SoundCloud / Deezer / Spotify embed snippet…" className={`${inputClass} resize-none`} /></Field>
            {s('podcastEmbedCode') && (
              <div className="mt-3">
                <span className="block text-[11px] font-semibold text-foreground-500 mb-1.5">Preview</span>
                <div className="rich-text-surface rounded-lg border border-background-200 bg-background-50 p-3" dangerouslySetInnerHTML={{ __html: s('podcastEmbedCode') }} />
              </div>
            )}
          </div>
        ) : (
          <Field label="Shortcode" className="mt-4"><input value={s('podcastShortcode')} onChange={e => setSetting('podcastShortcode', e.target.value)} placeholder='[podcast id="123"]' className={inputClass} /></Field>
        )}
      </Section>

      <Section title="Listening settings">
        <div className="grid gap-4 sm:grid-cols-2 max-w-md">
          <Field label="Duration (minutes)"><input type="number" min="0" value={Number(component.settings.durationMinutes) || 0} onChange={e => setSetting('durationMinutes', Number(e.target.value) || 0)} className={`${inputClass} tabular-nums`} /></Field>
          <Field label="Required progress (%)"><input type="number" min="0" max="100" value={Number(component.settings.requiredProgressPercentage) || 0} onChange={e => setSetting('requiredProgressPercentage', Number(e.target.value) || 0)} className={`${inputClass} tabular-nums`} /></Field>
        </div>
      </Section>

      <Section title="Effort & reward">
        <div className="grid gap-4 sm:grid-cols-2 max-w-md">
          <Field label="Expected OTJH hours"><input type="number" step="0.5" min="0" value={component.expectedOtjh} onChange={e => onChange({ expectedOtjh: Number(e.target.value) || 0 })} className={`${inputClass} tabular-nums`} /></Field>
          <Field label="Points"><input type="number" min="0" value={component.points} disabled readOnly title="Points are set by the Engagement points rule for this component type and can't be edited here." className={`${inputClass} tabular-nums cursor-not-allowed opacity-70`} /></Field>
        </div>
        <p className="mt-2 text-[11px] text-foreground-400"><AppIcon className="ri-flashlight-line mr-1 text-amber-500"></AppIcon>{typeof rulePoints === 'number' ? `Fixed by the Engagement points rule for podcasts (${rulePoints} pts).` : 'Points are fixed by the Engagement points rules — not editable here.'}</p>
      </Section>

      <Section title="Assurance">
        <div className="flex flex-wrap gap-2">
          <Toggle label="Reflection required" checked={component.reflectionRequired} onChange={value => onChange({ reflectionRequired: value })} />
          <Toggle label="Tutor validation" checked={component.tutorValidationRequired} onChange={value => onChange({ tutorValidationRequired: value })} />
        </div>
        {component.reflectionRequired && (
          <Field label="Reflection prompt" className="mt-4"><textarea value={s('reflectionPrompt')} onChange={e => setSetting('reflectionPrompt', e.target.value)} rows={2} placeholder="What should the learner reflect on after this podcast?" className={`${inputClass} resize-none`} /></Field>
        )}
      </Section>

      <Section title="Publishing">
        <div className="grid gap-4 max-w-md">
          <Field label="Version"><input value={s('version') || '0.1'} onChange={e => setSetting('version', e.target.value)} placeholder="0.1" className={inputClass} /></Field>
        </div>
      </Section>

    </>
  );
}

const POWERPOINT_SOURCE_TYPES_WEEK = ['External Link', 'Uploaded File'] as const;

// Bespoke PowerPoint editor — a link to an online deck (with a best-effort
// Office Online preview, which only renders once the link is reachable over
// the public internet) or an uploaded file (no live preview — there's no
// in-house slide renderer, so it's a "slide range" hint field instead of
// real slicing).
function PowerPointBody({ component, onChange, setSetting, rulePoints, uploadResource }: ComponentBodyProps) {
  const s = (key: string) => String(component.settings[key] ?? '');
  const sourceType = (POWERPOINT_SOURCE_TYPES_WEEK as readonly string[]).includes(s('powerpointSource')) ? s('powerpointSource') : 'External Link';

  return (
    <>
      <Section title="PowerPoint details">
        <Field label="Title"><input value={component.title} onChange={e => onChange({ title: e.target.value })} className={inputClass} /></Field>
        <Field label="Description" className="mt-4"><textarea value={component.description} onChange={e => onChange({ description: e.target.value })} rows={2} placeholder="What this presentation covers…" className={`${inputClass} resize-none`} /></Field>

        <Field label="Source type" className="mt-4">
          <select value={sourceType} onChange={e => setSetting('powerpointSource', e.target.value)} className={inputClass}>
            {POWERPOINT_SOURCE_TYPES_WEEK.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </Field>

        {sourceType === 'External Link' ? (
          <div className="mt-4">
            <Field label="Presentation URL"><input value={s('presentationUrl')} onChange={e => setSetting('presentationUrl', e.target.value)} placeholder="https://…" className={inputClass} /></Field>
            {s('presentationUrl') && (
              <div className="mt-3">
                <span className="block text-[11px] font-semibold text-foreground-500 mb-1.5">Preview</span>
                <iframe
                  src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(s('presentationUrl'))}`}
                  className="aspect-video w-full rounded-lg border border-background-200"
                  title="PowerPoint preview"
                />
                <p className="mt-1 text-[11px] text-foreground-400">Uses Microsoft's Office Online viewer — it only renders once this link is reachable over the public internet, so it won't load from a local dev URL.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <WeekComponentFileUpload
              componentId={component.id}
              componentType="powerpoint"
              onUpload={uploadResource}
              accept={POWERPOINT_UPLOAD_ACCEPT}
              uploadedName={s('uploadedFileName') || s('fileName')}
              uploadedUrl={s('uploadedFileUrl')}
              uploadedSize={Number(component.settings.uploadedFileSize) || 0}
              onUploaded={file => onChange({
                settings: { ...component.settings, uploadedFileName: file.fileName, uploadedFileUrl: file.url, uploadedFileSize: file.size, uploadedFileContentType: file.contentType },
              })}
            />
            <p className="mt-2 text-[11px] text-foreground-400">Accepted formats: PowerPoint (.ppt, .pptx, .pps, .ppsx) or PDF. No preview for uploaded files — there's no in-house slide renderer.</p>
          </div>
        )}

        <Field label="Slide range or deck section" className="mt-4"><input value={s('slideRange')} onChange={e => setSetting('slideRange', e.target.value)} placeholder="e.g. Slides 3–10" className={inputClass} /></Field>
        <Field label="Speaker notes" className="mt-4"><textarea value={s('speakerNotes')} onChange={e => setSetting('speakerNotes', e.target.value)} rows={3} placeholder="Notes for whoever presents or reviews this deck…" className={`${inputClass} resize-none`} /></Field>
        <div className="mt-3">
          <Toggle label="Download allowed" checked={component.settings.downloadAllowed !== false} onChange={value => setSetting('downloadAllowed', value)} />
        </div>
      </Section>

      <Section title="Effort & reward">
        <div className="grid gap-4 sm:grid-cols-2 max-w-md">
          <Field label="Expected OTJH hours"><input type="number" step="0.5" min="0" value={component.expectedOtjh} onChange={e => onChange({ expectedOtjh: Number(e.target.value) || 0 })} className={`${inputClass} tabular-nums`} /></Field>
          <Field label="Points"><input type="number" min="0" value={component.points} disabled readOnly title="Points are set by the Engagement points rule for this component type and can't be edited here." className={`${inputClass} tabular-nums cursor-not-allowed opacity-70`} /></Field>
        </div>
        <p className="mt-2 text-[11px] text-foreground-400"><AppIcon className="ri-flashlight-line mr-1 text-amber-500"></AppIcon>{typeof rulePoints === 'number' ? `Fixed by the Engagement points rule for PowerPoint decks (${rulePoints} pts).` : 'Points are fixed by the Engagement points rules — not editable here.'}</p>
      </Section>

      <Section title="Assurance">
        <div className="flex flex-wrap gap-2">
          <Toggle label="Reflection required" checked={component.reflectionRequired} onChange={value => onChange({ reflectionRequired: value })} />
          <Toggle label="Tutor validation" checked={component.tutorValidationRequired} onChange={value => onChange({ tutorValidationRequired: value })} />
        </div>
        {component.reflectionRequired && (
          <Field label="Reflection prompt" className="mt-4"><textarea value={s('reflectionPrompt')} onChange={e => setSetting('reflectionPrompt', e.target.value)} rows={2} placeholder="What should the learner reflect on after this presentation?" className={`${inputClass} resize-none`} /></Field>
        )}
      </Section>

      <Section title="Publishing">
        <div className="grid gap-4 max-w-md">
          <Field label="Version"><input value={s('version') || '0.1'} onChange={e => setSetting('version', e.target.value)} placeholder="0.1" className={inputClass} /></Field>
        </div>
      </Section>

    </>
  );
}

// Bespoke Quiz editor. A week's quiz is a real Quiz Workspace record: the
// author either imports an existing quiz (matched to the week's programme +
// module — group is irrelevant, a week is reused across groups and quizzes
// carry no group) or creates a new draft here, which is saved straight into
// the workspace via quiz_api. Question authoring happens in the workspace's
// full editor, opened in a new tab so week-builder edits aren't lost.
function QuizBody({ component, onChange, setSetting, rulePoints, weekScope }: ComponentBodyProps) {
  const s = (key: string) => String(component.settings[key] ?? '');
  const linkedQuizId = s('linkedQuizId');

  const [quizzes, setQuizzes] = useState<WorkspaceQuizSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [togglingCheckpoint, setTogglingCheckpoint] = useState(false);

  const loadQuizzes = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError('');
    try {
      setQuizzes(await fetchWorkspaceQuizzes(signal));
    } catch (err) {
      if (!signal?.aborted) setLoadError(err instanceof Error ? err.message : 'Unable to load quizzes.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadQuizzes(controller.signal);
    return () => controller.abort();
  }, [loadQuizzes]);

  const norm = (value?: string | number | null) => String(value ?? '').trim().toLowerCase();
  const matchingQuizzes = useMemo(() => filterQuizzesForScope(quizzes, weekScope), [quizzes, weekScope]);

  const linkedQuiz = quizzes.find(quiz => String(quiz.id) === linkedQuizId) || null;
  const linkedQuestions = linkedQuiz ? Number(linkedQuiz.questions || 0) : Number(s('numberOfQuestions') || 0);
  const linkedTitle = linkedQuiz?.title || s('linkedActivity');
  // A checkpoint quiz is intentionally excluded from the workspace quiz list
  // (that list is assessmentType=quiz), so track the type from the linked quiz
  // when it's present and fall back to what we stored on the component.
  const linkedAssessmentType = norm(linkedQuiz?.assessmentType) || norm(s('quizAssessmentType')) || 'quiz';
  const isCheckpoint = linkedAssessmentType === 'checkpoint';

  const link = (quiz: WorkspaceQuizSummary | null) => {
    const patch: Partial<ModuleComponent> = {
      settings: {
        ...component.settings,
        linkedQuizId: quiz ? String(quiz.id) : '',
        linkedActivity: quiz?.title || '',
        quizProgramme: quiz?.programme || weekScope.programmeName || '',
        quizModule: quiz?.module || weekScope.moduleName || '',
        quizWeekId: quiz?.weekId || '',
        numberOfQuestions: Number(quiz?.questions || 0),
        passMarkPercentage: Number(quiz?.passingGrade || 0),
        quizDuration: Number(quiz?.duration || 0),
        quizStatus: quiz?.status || '',
        quizAssessmentType: quiz?.assessmentType || (quiz ? 'quiz' : ''),
      },
    };
    // Adopt the quiz's title only when the component hasn't been named yet.
    if (quiz && !component.title.trim()) patch.title = quiz.title;
    onChange(patch);
  };

  // Mark/unmark the linked quiz as a checkpoint assessment. This flips the
  // quiz's assessment type in quiz_api (PATCH), so it moves in/out of the
  // Checkpoints page's list — the quiz stays linked to this week either way.
  const toggleCheckpoint = async (checked: boolean) => {
    if (!linkedQuizId || togglingCheckpoint) return;
    const nextType = checked ? 'checkpoint' : 'quiz';
    setTogglingCheckpoint(true);
    try {
      const response = await fetch(`/quiz_api/quizzes/${linkedQuizId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessmentType: nextType }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Could not update the quiz.');
      }
      setSetting('quizAssessmentType', nextType);
      setQuizzes(prev => prev.map(quiz => (String(quiz.id) === linkedQuizId ? { ...quiz, assessmentType: nextType } : quiz)));
    } catch (err) {
      showCurriculumAlert({ title: 'Could not update checkpoint', text: err instanceof Error ? err.message : undefined, icon: 'error' });
    } finally {
      setTogglingCheckpoint(false);
    }
  };

  const closeEditor = () => { setEditorOpen(false); void loadQuizzes(); };

  return (
    <>
      {editorOpen && linkedQuizId && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-foreground-950/50 backdrop-blur-sm" onClick={closeEditor}>
          <div className="mx-auto my-6 w-full max-w-[1140px] overflow-hidden rounded-2xl bg-background-50 shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Local boundary: the route-level one would blank the whole page while
                this chunk downloads. */}
            <Suspense fallback={<div className="p-10 text-center text-[13px] text-foreground-400">Loading quiz editor…</div>}>
              <QuizEditorPanel quizId={linkedQuizId} onClose={closeEditor} onSaved={() => void loadQuizzes()} />
            </Suspense>
          </div>
        </div>
      )}

      {wizardOpen && (
        <Suspense fallback={null}>
          <GuidedQuizUpload
            open={wizardOpen}
            onClose={() => setWizardOpen(false)}
            scope={{ programmeId: weekScope.programmeId, programmeName: weekScope.programmeName, moduleName: weekScope.moduleName }}
            onUploaded={quiz => {
              setQuizzes(prev => [quiz as WorkspaceQuizSummary, ...prev.filter(item => String(item.id) !== String(quiz.id))]);
              link(quiz as WorkspaceQuizSummary);
              void loadQuizzes();
            }}
          />
        </Suspense>
      )}

      <Section title="Quiz source">
        <Field label="Title"><input value={component.title} onChange={e => onChange({ title: e.target.value })} placeholder="e.g. Week 1 knowledge check" className={inputClass} /></Field>

        {weekScope.courseType === 'paid' && (
          <p className="mt-2 text-[11px] text-foreground-400">
            <AppIcon className="ri-filter-3-line mr-1"></AppIcon>
            Matched to <strong className="text-foreground-600">{weekScope.programmeName || 'this programme'}</strong>
            {weekScope.moduleName ? <> · <strong className="text-foreground-600">{weekScope.moduleName}</strong></> : ''} — group isn't matched, since a week is reused across groups.
          </p>
        )}

        {linkedQuizId ? (
          <div className="mt-4 rounded-xl border border-primary-200 bg-primary-50/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary-600">Linked workspace quiz</p>
                <p className="mt-0.5 text-[15px] font-heading font-black text-foreground-950 truncate">{linkedTitle || 'Untitled quiz'}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-500">
                  <span className="tabular-nums"><strong className="text-foreground-800">{linkedQuestions}</strong> question{linkedQuestions === 1 ? '' : 's'}</span>
                  {isCheckpoint && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700"><AppIcon className="ri-flag-2-line"></AppIcon>Checkpoint</span>}
                  {!linkedQuiz && !loading && !isCheckpoint && <span className="text-amber-600"><AppIcon className="ri-error-warning-line mr-0.5"></AppIcon>Not found in workspace</span>}
                </p>
              </div>
              <span className="grid place-items-center w-10 h-10 shrink-0 rounded-xl bg-primary-500 text-white"><AppIcon className="ri-questionnaire-line text-lg"></AppIcon></span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setEditorOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary-600 px-4 py-1.5 text-[12px] font-bold text-background-50 hover:bg-primary-700 transition-smooth">
                <AppIcon className="ri-edit-2-line"></AppIcon>Edit questions
              </button>
              <button type="button" onClick={() => loadQuizzes()} className="inline-flex items-center gap-1.5 rounded-full border border-background-200 bg-background-50 px-3 py-1.5 text-[12px] font-semibold text-foreground-600 hover:bg-background-100 transition-smooth"><AppIcon className={loading ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'}></AppIcon>Refresh</button>
              <button type="button" onClick={() => link(null)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-foreground-500 hover:text-red-600 transition-smooth"><AppIcon className="ri-link-unlink"></AppIcon>Unlink</button>
            </div>
            <label className="mt-3 flex cursor-pointer select-none items-center gap-2">
              <input type="checkbox" checked={isCheckpoint} disabled={togglingCheckpoint} onChange={e => void toggleCheckpoint(e.target.checked)} className="h-4 w-4 rounded border-background-300 accent-primary-600 disabled:cursor-not-allowed" />
              <span className="text-[12px] font-semibold text-foreground-700">Mark as checkpoint assessment</span>
              {togglingCheckpoint && <AppIcon className="ri-loader-4-line animate-spin text-foreground-400"></AppIcon>}
            </label>
            <p className="mt-1 text-[11px] text-foreground-400">{isCheckpoint ? 'Listed on the Checkpoints assessment page. It stays linked to this week.' : 'Tick to also list this quiz on the Checkpoints assessment page. Edits still save to the Quiz Workspace.'}</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <span className="block text-[11px] font-semibold text-foreground-500 mb-1.5">Import an existing quiz</span>
              <div className="flex items-center gap-2">
                <select value="" onChange={e => { const quiz = quizzes.find(item => String(item.id) === e.target.value); if (quiz) link(quiz); }} className={inputClass} disabled={loading || !matchingQuizzes.length}>
                  <option value="">{loading ? 'Loading quizzes…' : matchingQuizzes.length ? 'Choose a quiz to import' : 'No matching quizzes'}</option>
                  {matchingQuizzes.map(quiz => <option key={quiz.id} value={quiz.id}>{quiz.title} · {Number(quiz.questions || 0)} q</option>)}
                </select>
                <button type="button" onClick={() => loadQuizzes()} title="Refresh" className="grid place-items-center w-9 h-9 shrink-0 rounded-lg border border-background-200 bg-background-50 text-foreground-500 hover:bg-background-100 transition-smooth"><AppIcon className={loading ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'}></AppIcon></button>
              </div>
              {!loading && !matchingQuizzes.length && <p className="mt-2 text-[11px] text-foreground-400">No workspace quizzes match this programme{weekScope.moduleName ? ' + module' : ''} yet — upload one below, or build it in the Quiz Workspace.</p>}
              {loadError && <p className="mt-2 text-[11px] text-red-600">{loadError}</p>}
            </div>

            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-background-200"></span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">or</span>
              <span className="h-px flex-1 bg-background-200"></span>
            </div>

            <button type="button" onClick={() => setWizardOpen(true)} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-primary-300 bg-primary-50/50 px-4 py-3 text-left transition-smooth hover:border-primary-400 hover:bg-primary-50">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-500 text-white"><AppIcon className="ri-upload-cloud-2-line"></AppIcon></span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-foreground-900">Upload a new quiz file</span>
                <span className="block text-[11px] text-foreground-500">CSV, Excel, XML or SCORM — guided, with structure checks. Links to this week automatically.</span>
              </span>
            </button>
          </div>
        )}
      </Section>

      <Section title="Effort & reward">
        <div className="grid gap-4 sm:grid-cols-2 max-w-md">
          <Field label="Expected OTJH hours"><input type="number" step="0.5" min="0" value={component.expectedOtjh} onChange={e => onChange({ expectedOtjh: Number(e.target.value) || 0 })} className={`${inputClass} tabular-nums`} /></Field>
          <Field label="Points"><input type="number" min="0" value={component.points} disabled readOnly title="Points are set by the Engagement points rule for this component type and can't be edited here." className={`${inputClass} tabular-nums cursor-not-allowed opacity-70`} /></Field>
        </div>
        <p className="mt-2 text-[11px] text-foreground-400"><AppIcon className="ri-flashlight-line mr-1 text-amber-500"></AppIcon>{typeof rulePoints === 'number' ? `Fixed by the Engagement points rule for a passed quiz (${rulePoints} pts).` : 'Points are fixed by the Engagement points rules — not editable here.'}</p>
      </Section>

      <Section title="Assurance">
        <div className="flex flex-wrap gap-2">
          <Toggle label="Reflection required" checked={component.reflectionRequired} onChange={value => onChange({ reflectionRequired: value })} />
          <Toggle label="Tutor validation" checked={component.tutorValidationRequired} onChange={value => onChange({ tutorValidationRequired: value })} />
        </div>
        {component.reflectionRequired && (
          <Field label="Reflection prompt" className="mt-4"><textarea value={s('reflectionPrompt')} onChange={e => setSetting('reflectionPrompt', e.target.value)} rows={2} placeholder="What should the learner reflect on after this quiz?" className={`${inputClass} resize-none`} /></Field>
        )}
      </Section>

    </>
  );
}

const ASSIGNMENT_UPLOAD_ACCEPT = '.txt,.doc,.docx,.pdf,.rtf,.odt,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,application/vnd.oasis.opendocument.text';

// Assignment editor — authored exactly like Reading material for now: a written
// brief (rich text) or an uploaded document. The learner-facing delivery is
// handled separately later; on the authoring side an assignment is just
// learning material with a brief attached.
function AssignmentBody({ component, onChange, setSetting, rulePoints, uploadResource }: ComponentBodyProps) {
  const s = (key: string) => String(component.settings[key] ?? '');
  const sourceMode = s('assignmentSource') === 'File' ? 'File' : 'Text';

  return (
    <>
      <Section title="Assignment details">
        <Field label="Title"><input value={component.title} onChange={e => onChange({ title: e.target.value })} className={inputClass} /></Field>
        <Field label="Description" className="mt-4"><textarea value={component.description} onChange={e => onChange({ description: e.target.value })} rows={2} placeholder="What this assignment asks the learner to do…" className={`${inputClass} resize-none`} /></Field>

        <div className="mt-4">
          <span className="block text-[11px] font-semibold text-foreground-500 mb-1.5">Brief</span>
          <div className="inline-flex items-center gap-0.5 rounded-full bg-background-100 p-1">
            {(['Text', 'File'] as const).map(mode => (
              <button key={mode} type="button" onClick={() => setSetting('assignmentSource', mode)} className={`px-4 py-1.5 rounded-full text-[11px] font-bold transition-smooth ${sourceMode === mode ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-800'}`}>
                {mode === 'Text' ? 'Written brief' : 'Uploaded file'}
              </button>
            ))}
          </div>
        </div>

        {sourceMode === 'Text' ? (
          <div className="mt-4">
            <RichTextDraft label="Assignment brief" value={s('assignmentContent')} onChange={value => setSetting('assignmentContent', value)} rows={14} />
          </div>
        ) : (
          <div className="mt-4">
            <span className="block text-[11px] font-semibold text-foreground-500 mb-1.5">File</span>
            <WeekComponentFileUpload
              componentId={component.id}
              componentType="assignment"
              onUpload={uploadResource}
              accept={ASSIGNMENT_UPLOAD_ACCEPT}
              uploadedName={s('uploadedFileName')}
              uploadedUrl={s('uploadedFileUrl')}
              uploadedSize={Number(component.settings.uploadedFileSize) || 0}
              onUploaded={file => onChange({
                settings: { ...component.settings, uploadedFileName: file.fileName, uploadedFileUrl: file.url, uploadedFileSize: file.size, uploadedFileContentType: file.contentType },
              })}
            />
            <p className="mt-2 text-[11px] text-foreground-400">Accepted formats: Word (.doc, .docx), PDF, plain text (.txt), RTF, OpenDocument (.odt).</p>
          </div>
        )}
      </Section>

      <Section title="Effort & reward">
        <div className="grid gap-4 sm:grid-cols-2 max-w-md">
          <Field label="Expected OTJH hours"><input type="number" step="0.5" min="0" value={component.expectedOtjh} onChange={e => onChange({ expectedOtjh: Number(e.target.value) || 0 })} className={`${inputClass} tabular-nums`} /></Field>
          <Field label="Points"><input type="number" min="0" value={component.points} disabled readOnly title="Points are set by the Engagement points rule for this component type and can't be edited here." className={`${inputClass} tabular-nums cursor-not-allowed opacity-70`} /></Field>
        </div>
        <p className="mt-2 text-[11px] text-foreground-400"><AppIcon className="ri-flashlight-line mr-1 text-amber-500"></AppIcon>{typeof rulePoints === 'number' ? `Fixed by the Engagement points rule for assignments (${rulePoints} pts).` : 'Points are fixed by the Engagement points rules — not editable here.'}</p>
      </Section>

      <Section title="Assurance">
        <div className="flex flex-wrap gap-2">
          <Toggle label="Reflection required" checked={component.reflectionRequired} onChange={value => onChange({ reflectionRequired: value })} />
          <Toggle label="Tutor validation" checked={component.tutorValidationRequired} onChange={value => onChange({ tutorValidationRequired: value })} />
        </div>
        {component.reflectionRequired && (
          <Field label="Reflection prompt" className="mt-4"><textarea value={s('reflectionPrompt')} onChange={e => setSetting('reflectionPrompt', e.target.value)} rows={2} placeholder="What should the learner reflect on after this assignment?" className={`${inputClass} resize-none`} /></Field>
        )}
      </Section>

      <Section title="Publishing">
        <div className="grid gap-4 max-w-md">
          <Field label="Version"><input value={s('version') || '0.1'} onChange={e => setSetting('version', e.target.value)} placeholder="0.1" className={inputClass} /></Field>
        </div>
      </Section>

    </>
  );
}

function WeekComponentFileUpload({ componentId, componentType, accept, uploadedName, uploadedUrl, uploadedSize, onUploaded, onUpload = uploadWeekComponentResource }: {
  componentId: string;
  componentType: 'reading' | 'podcast' | 'powerpoint' | 'assignment';
  accept: string;
  uploadedName: string;
  uploadedUrl: string;
  uploadedSize: number;
  onUploaded: (file: WeekComponentUploadResult['file']) => void;
  onUpload?: WeekComponentUploader;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputId = useMemo(() => `week-component-upload-${Math.random().toString(36).slice(2)}`, []);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const result = await onUpload(componentId, file, componentType);
      onUploaded(result.file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload file.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-xl border border-background-200 bg-background-50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-bold text-foreground-800">
            {uploadedName || 'No file uploaded yet'}
            {uploadedSize > 0 && <span className="ml-2 font-normal tabular-nums text-foreground-400">{formatFileSize(uploadedSize)}</span>}
          </p>
          {uploadedUrl && (
            <a href={uploadedUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-primary-600 hover:text-primary-700">
              <AppIcon className="ri-external-link-line"></AppIcon> Open uploaded file
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
              if (file) void handleFile(file);
            }}
          />
          <label htmlFor={inputId} className={`inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-bold text-white transition-smooth ${uploading ? 'bg-foreground-300' : 'bg-primary-500 hover:bg-primary-600'}`}>
            <AppIcon className={uploading ? 'ri-loader-4-line animate-spin' : 'ri-upload-cloud-2-line'}></AppIcon>
            {uploading ? 'Uploading…' : 'Upload file'}
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

// Group assignment, shown for every component type. A week is reused across
// groups, so this is a multi-select scoped to the week's programme + module
// (the option list is prepared by the editor). Stored as parallel key/name
// arrays so a saved template keeps readable names even if a group is later
// renamed or removed from the picker.
function AssignedGroupsSection({ component, onChange, groupOptions }: Pick<ComponentBodyProps, 'component' | 'onChange' | 'groupOptions'>) {
  const selectedKeys = (component.settings.selectedGroupKeys as string[] | undefined) ?? [];
  const setGroups = (keys: string[]) => onChange({
    settings: { ...component.settings, selectedGroupKeys: keys, selectedGroupNames: groupOptions.filter(option => keys.includes(option.key)).map(option => option.name) },
  });
  return (
    <Section title="Assigned groups" hint="Which delivery groups this part is for">
      <GroupMultiSelect options={groupOptions} selectedKeys={selectedKeys} onChange={setGroups} />
    </Section>
  );
}

function GroupMultiSelect({ options, selectedKeys, onChange }: { options: GroupOption[]; selectedKeys: string[]; onChange: (keys: string[]) => void }) {
  const selectedSet = new Set(selectedKeys);
  const toggle = (key: string) => {
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(options.map(option => option.key).filter(optionKey => next.has(optionKey)));
  };
  return (
    <div className="rounded-xl border border-background-200 bg-background-100/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-foreground-500 tabular-nums">{selectedKeys.length} of {options.length} selected</span>
        {options.length > 0 && (
          <div className="flex items-center gap-1">
            <button onClick={() => onChange(options.map(option => option.key))} className="rounded-md px-2 py-0.5 text-[10px] font-bold text-primary-600 hover:bg-primary-50 transition-smooth">Select all</button>
            <button onClick={() => onChange([])} className="rounded-md px-2 py-0.5 text-[10px] font-bold text-foreground-400 hover:bg-background-100 transition-smooth">Clear</button>
          </div>
        )}
      </div>
      {options.length === 0 ? (
        <p className="text-[11px] text-foreground-400">No delivery groups are linked to this programme yet.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map(option => {
            const on = selectedSet.has(option.key);
            return (
              <label key={option.key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${on ? 'border-primary-300 bg-primary-50' : 'border-background-200 bg-background-50 hover:border-background-300'}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(option.key)} className="mt-0.5 accent-primary-600" />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-bold text-foreground-800">{option.name}</span>
                  {option.cohort && <span className="block truncate text-[10px] text-foreground-400">{option.cohort}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

const inputClass = 'w-full rounded-xl border border-background-200 bg-background-50 px-3 py-2 text-[12px] focus:border-primary-300 focus:ring-2 focus:ring-primary-100 outline-none transition-shadow';

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="px-6 py-5">
      <div className="flex items-baseline gap-2 mb-3">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground-500">{title}</h4>
        {hint && <span className="text-[10px] text-foreground-400">· {hint}</span>}
      </div>
      {children}
    </section>
  );
}

function SettingField({ settingKey, value, onChange }: { settingKey: string; value: ComponentSettingValue; onChange: (value: ComponentSettingValue) => void }) {
  const label = settingKey.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
  if (typeof value === 'boolean') {
    return (
      <label className="flex items-center gap-2 self-end rounded-xl border border-background-200 bg-background-50 px-3 py-2.5 text-[12px] font-medium text-foreground-700 cursor-pointer hover:border-background-300 transition-colors">
        <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} className="accent-primary-600" />{label}
      </label>
    );
  }
  if (typeof value === 'number') {
    return <Field label={label}><input type="number" value={value} onChange={e => onChange(Number(e.target.value) || 0)} className={`${inputClass} tabular-nums`} /></Field>;
  }
  if (Array.isArray(value)) {
    return <Field label={label} className="sm:col-span-2 xl:col-span-3"><input value={value.join(', ')} onChange={e => onChange(e.target.value.split(',').map(item => item.trim()).filter(Boolean))} placeholder="Comma-separated" className={inputClass} /></Field>;
  }
  const isLong = /content|prompt|instruction|brief|notes|transcript|questions|guidance|description|outcomes|rationale|focus/i.test(settingKey);
  return (
    <Field label={label} className={isLong ? 'sm:col-span-2 xl:col-span-3' : ''}>
      {isLong
        ? <textarea value={String(value)} onChange={e => onChange(e.target.value)} rows={2} className={`${inputClass} resize-none`} />
        : <input value={String(value)} onChange={e => onChange(e.target.value)} className={inputClass} />}
    </Field>
  );
}

function KsbMappingEditor({ mappings, onChange }: { mappings: KsbMapping[]; onChange: (mappings: KsbMapping[]) => void }) {
  const [code, setCode] = useState('');
  const add = () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    onChange([...mappings, { id: makeAuthoringId('ksb'), ksbId: '', code: trimmed, description: '', type: 'main', classification: 'main', weight: 40, weightClass: 'hard' }]);
    setCode('');
  };
  const patch = (id: string, next: Partial<KsbMapping>) => onChange(mappings.map(m => (m.id === id ? { ...m, ...next } : m)));
  const remove = (id: string) => onChange(mappings.filter(m => m.id !== id));

  return (
    <div className="rounded-xl bg-background-100/40 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-foreground-500">Add codes and weight their emphasis</p>
        <div className="flex items-center gap-1">
          <input value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="K1" className="w-16 rounded-lg border border-background-200 bg-background-50 px-2 py-1 text-[11px] uppercase" />
          <button onClick={add} className="rounded-lg bg-primary-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-primary-600 transition-smooth">Add</button>
        </div>
      </div>
      {mappings.length === 0 ? (
        <p className="text-[11px] text-foreground-400">No KSBs mapped yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {mappings.map(mapping => (
            <li key={mapping.id} className="flex items-center gap-2">
              <span className="grid place-items-center min-w-[44px] px-2 py-1 rounded-lg bg-primary-100 text-primary-700 text-[11px] font-bold tabular-nums">{mapping.code}</span>
              <select value={mapping.type} onChange={e => patch(mapping.id, { type: e.target.value as KsbMapping['type'], classification: e.target.value as KsbMapping['type'] })} className="rounded-lg border border-background-200 bg-background-50 px-2 py-1 text-[11px]">
                {KSB_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
              <div className="flex items-center gap-1 ml-auto">
                <input type="number" min="0" max="100" value={mapping.weight} onChange={e => patch(mapping.id, { weight: Number(e.target.value) || 0 })} className="w-14 rounded-lg border border-background-200 bg-background-50 px-2 py-1 text-[11px] tabular-nums" />
                <span className="text-[10px] text-foreground-400">wt</span>
                <button onClick={() => remove(mapping.id)} className="grid place-items-center w-6 h-6 rounded-md text-foreground-400 hover:bg-red-100 hover:text-red-600"><AppIcon className="ri-close-line text-[13px]"></AppIcon></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
function IconButton({ label, icon, tone = 'default', onClick }: { label: string; icon: string; tone?: 'default' | 'danger'; onClick: () => void }) {
  return (
    <button title={label} aria-label={label} onClick={onClick} className={`grid place-items-center w-9 h-9 rounded-lg border border-background-200 bg-background-50 transition-smooth ${tone === 'danger' ? 'text-foreground-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200' : 'text-foreground-500 hover:bg-background-100 hover:text-foreground-800'}`}>
      <AppIcon className={icon}></AppIcon>
    </button>
  );
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] font-semibold text-foreground-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-all ${checked ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-background-200 bg-background-50 text-foreground-500 hover:border-background-300'}`}>
      <AppIcon className={checked ? 'ri-checkbox-circle-fill' : 'ri-circle-line'}></AppIcon>{label}
    </button>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground-950/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl bg-background-50 shadow-2xl border border-background-200 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-background-200 sticky top-0 bg-background-50 z-10">
          <h3 className="font-heading text-[16px] font-black text-foreground-950">{title}</h3>
          <button onClick={onClose} className="grid place-items-center w-8 h-8 rounded-lg text-foreground-400 hover:bg-background-100 hover:text-foreground-800"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

import { type FormEvent, useEffect, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCurriculumKsbSets } from '@/hooks/useCurriculumKsbSets';
import { useCurriculumModules } from '@/hooks/useCurriculumModules';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import {
  createCurriculumComponent,
  deleteCurriculumComponent,
  fetchCurriculumComponents,
  updateCurriculumComponent,
  type CurriculumComponent,
  type CurriculumKsbEntry,
  type CurriculumKsbSet,
  type CurriculumModule,
} from '@/lib/curriculumApi';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;
const COMPONENT_STORE_KEY = 'lms.component-builder.components.v2';

type Component = CurriculumComponent;

type WeekOption = {
  id: string;
  label: string;
  value: string;
  weekNumber: number;
  synthetic?: boolean;
};

type ModuleOption = {
  id: string;
  aliases: string[];
  name: string;
  programme: string;
  programmeId: string;
  weeks: WeekOption[];
  ksbCodes: string[];
};

const typeOptions = ['Live Session', 'Recording Placeholder', 'Workshop', 'Video', 'Podcast', 'Reading', 'PowerPoint', 'Assignment', 'Workplace Evidence', 'Reflection', 'Quiz', 'Checkpoint', 'Coaching Preparation', 'Self-study'];
const typeFilters = ['all', ...typeOptions];

export default function ComponentBuilderPage() {
  const { programmes: curriculumProgrammes, loading: programmesLoading, error: programmesError } = useCurriculumProgrammes();
  const { modules: curriculumModules, loading: modulesLoading, error: modulesError } = useCurriculumModules();
  const { ksbSets, loading: ksbSetsLoading, error: ksbSetsError } = useCurriculumKsbSets();
  const [components, setComponents] = useState<Component[]>([]);
  const [loadingComponents, setLoadingComponents] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedComp, setSelectedComp] = useState<Component | null>(null);
  const [editingComp, setEditingComp] = useState<Component | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterProgramme, setFilterProgramme] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    setLoadingComponents(true);
    fetchCurriculumComponents()
      .then(rows => {
        if (cancelled) return;
        const next = rows.length ? rows : [];
        setComponents(next);
        saveComponents(next);
        setSyncError(rows.length ? null : 'No database components yet. Create one from the builder to publish it into a module week.');
      })
      .catch(error => {
        if (cancelled) return;
        setComponents(loadComponents());
        setSyncError(error instanceof Error ? error.message : 'Component API is unavailable. Using local fallback.');
      })
      .finally(() => {
        if (!cancelled) setLoadingComponents(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const moduleChoices = mergeModuleOptions(buildModuleOptions(curriculumModules), buildComponentModuleOptions(components));
  const fallbackProgrammeNames = Array.from(new Set([
    ...moduleChoices.map(module => module.programme),
    ...components.map(component => component.programme),
  ].filter(Boolean))).sort();
  const databaseProgrammeNames = Array.from(new Set(curriculumProgrammes.map(programme => programme.name).filter(Boolean))).sort();
  const programmeNames = databaseProgrammeNames.length ? databaseProgrammeNames : fallbackProgrammeNames;
  const programmes = ['all', ...programmeNames];
  const canCreateComponent = moduleChoices.length > 0;

  const filtered = components.filter(component => {
    const query = search.trim().toLowerCase();
    const searchable = [
      component.title,
      component.type,
      component.module,
      component.programme,
      component.week,
      component.status,
      ...component.ksbRefs,
    ].join(' ').toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (filterType !== 'all' && component.type !== filterType) return false;
    if (filterProgramme !== 'all' && component.programme !== filterProgramme) return false;
    return true;
  });

  const published = components.filter(component => component.status === 'published').length;
  const draft = components.filter(component => component.status === 'draft').length;
  const totalKSBs = [...new Set(components.flatMap(component => component.ksbRefs))].length;

  const typeColors: Record<string, string> = {
    'Live Session': 'bg-primary-100 text-primary-700',
    'Recording Placeholder': 'bg-slate-100 text-slate-700',
    Workshop: 'bg-accent-100 text-accent-700',
    Video: 'bg-rose-100 text-rose-700',
    Podcast: 'bg-amber-100 text-amber-700',
    Reading: 'bg-emerald-100 text-emerald-700',
    PowerPoint: 'bg-orange-100 text-orange-700',
    Assignment: 'bg-amber-100 text-amber-700',
    'Workplace Evidence': 'bg-lime-100 text-lime-700',
    Reflection: 'bg-teal-100 text-teal-700',
    'Self-study': 'bg-secondary-100 text-secondary-700',
    Quiz: 'bg-rose-100 text-rose-700',
    Checkpoint: 'bg-blue-100 text-blue-700',
    'Coaching Preparation': 'bg-pink-100 text-pink-700',
  };

  const commitComponents = (next: Component[], selected?: Component | null) => {
    setComponents(next);
    saveComponents(next);
    if (selected !== undefined) setSelectedComp(selected);
  };

  const saveComponent = async (component: Component) => {
    const clean = {
      ...component,
      title: component.title.trim(),
      module: component.module.trim(),
      programme: component.programme.trim(),
      week: component.week.trim(),
      ksbRefs: (component.ksbRefs || []).map(ksb => ksb.trim().toUpperCase()).filter(Boolean),
      lastEdited: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    };
    setSavingId(clean.id);
    setSyncError(null);
    try {
      let saved: Component;
      if (components.some(item => item.id === clean.id)) {
        try {
          saved = (await updateCurriculumComponent(clean.id, clean)).component;
        } catch {
          saved = (await createCurriculumComponent(clean)).component;
        }
      } else {
        saved = (await createCurriculumComponent(clean)).component;
      }
      const next = components.some(item => item.id === saved.id)
        ? components.map(item => item.id === saved.id ? saved : item)
        : [saved, ...components];
      commitComponents(next, saved);
      setEditingComp(null);
    } catch (error) {
      const next = components.some(item => item.id === clean.id)
        ? components.map(item => item.id === clean.id ? clean : item)
        : [clean, ...components];
      commitComponents(next, clean);
      setEditingComp(null);
      setSyncError(error instanceof Error ? `${error.message}. Saved locally.` : 'Component API is unavailable. Saved locally.');
    } finally {
      setSavingId(null);
    }
  };

  const duplicateComponent = async (component: Component) => {
    const copy = { ...component, id: `comp-${Date.now().toString(36)}`, title: `${component.title} copy`, status: 'draft' as const };
    await saveComponent(copy);
  };

  const removeComponent = async (component: Component) => {
    setDeletingId(component.id);
    setSyncError(null);
    try {
      await deleteCurriculumComponent(component.id);
    } catch (error) {
      setSyncError(error instanceof Error ? `${error.message}. Removed locally.` : 'Component API is unavailable. Removed locally.');
    } finally {
      const next = components.filter(item => item.id !== component.id);
      commitComponents(next, selectedComp?.id === component.id ? null : selectedComp);
      if (editingComp?.id === component.id) setEditingComp(null);
      setDeletingId(null);
    }
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Component Builder" pageSubtitle="Create and manage learning components - lessons, workshops, assignments, quizzes and self-study resources" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-puzzle-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Component Builder</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{components.length} components</strong> - {published} published, {draft} in draft. Covers {totalKSBs} unique KSBs across {Math.max(0, programmeNames.length)} programmes.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <MetricCard value={components.length} label="Components" />
              <MetricCard value={published} label="Published" />
              <MetricCard value={totalKSBs} label="KSBs" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-foreground-200/60 bg-background-50 p-3 shadow-sm">
          <div className="flex flex-col xl:flex-row xl:items-center gap-3">
            <label className="relative flex-1 min-w-[240px]">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300"></i>
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search components, modules, KSBs..." className="w-full h-10 pl-9 pr-3 rounded-lg border border-foreground-200/70 bg-background-50 text-[13px] text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100" />
            </label>
            <div className="flex flex-col sm:flex-row gap-3 xl:items-center">
              <SegmentedFilter values={typeFilters} selected={filterType} allLabel="All Types" onSelect={setFilterType} />
              <label className="relative min-w-[210px]">
                <select value={filterProgramme} onChange={event => setFilterProgramme(event.target.value)} disabled={programmesLoading && !databaseProgrammeNames.length} className="w-full h-10 appearance-none rounded-lg border border-foreground-200/70 bg-background-50 px-3 pr-9 text-[12px] font-semibold text-foreground-700 focus:outline-none focus:border-primary-300 disabled:opacity-60">
                  {programmes.map(programme => <option key={programme} value={programme}>{programme === 'all' ? 'All Programmes' : programme}</option>)}
                </select>
                <i className="ri-arrow-down-s-line pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400"></i>
              </label>
              <button onClick={() => setEditingComp(createBlankComponent(moduleChoices, filterProgramme))} disabled={!canCreateComponent} className="h-10 px-4 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap shadow-sm disabled:cursor-not-allowed disabled:opacity-60"><i className="ri-add-line mr-1"></i> New Component</button>
            </div>
          </div>
          {(programmesError || modulesError || ksbSetsError || syncError || (!modulesLoading && !moduleChoices.length)) && (
            <p className="mt-2 text-[11px] text-amber-600">
              {syncError || modulesError || programmesError || ksbSetsError || 'No modules are available yet. Create or import a module before adding reusable components.'}
            </p>
          )}
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-foreground-200/60 bg-background-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-heading font-bold text-foreground-900">Component catalogue</h3>
              <p className="text-[11px] text-foreground-400">{loadingComponents ? 'Loading editable components...' : `Showing ${filtered.length} of ${components.length} editable components`}</p>
            </div>
            {(search || filterType !== 'all' || filterProgramme !== 'all') && (
              <button onClick={() => { setSearch(''); setFilterType('all'); setFilterProgramme('all'); }} className="w-fit px-3 py-1.5 rounded-lg border border-background-200 text-[11px] font-semibold text-foreground-600 hover:bg-background-100 transition-smooth">Clear filters</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse">
              <thead>
                <tr className="bg-background-100/65 border-b border-foreground-200/60">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Component</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Type</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Module / Programme</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-foreground-400">KSBs</th>
                  <th className="px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Duration</th>
                  <th className="px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Status</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/60">
                {loadingComponents ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[12px] font-semibold text-foreground-400">Loading components...</td>
                  </tr>
                ) : filtered.map(component => (
                  <tr key={component.id} onClick={() => setSelectedComp(component)} className={`cursor-pointer transition-smooth ${selectedComp?.id === component.id ? 'bg-primary-50/60 shadow-[inset_3px_0_0_0_oklch(var(--primary-500))]' : 'hover:bg-background-100/45'}`}>
                    <td className="px-4 py-4 align-middle">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><i className={`${componentTypeIcon(component.type)} text-base`}></i></span>
                        <div className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-foreground-900">{component.title || 'Untitled component'}</span>
                          <span className="mt-1 block text-[11px] text-foreground-400">{component.week} - {component.contentSections} sections</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${typeColors[component.type] || 'bg-foreground-100 text-foreground-500'}`}>{component.type}</span>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <span className="block max-w-[260px] truncate text-[12px] font-medium text-foreground-800">{component.module || 'No module set'}</span>
                      <span className="mt-1 block max-w-[260px] truncate text-[10px] text-foreground-400">{component.programme || 'No programme set'}</span>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <div className="flex max-w-[220px] flex-wrap gap-1.5">
                        {component.ksbRefs.length ? component.ksbRefs.map(ksb => <span key={ksb} className="rounded bg-secondary-100 px-1.5 py-0.5 text-[9px] font-semibold text-secondary-700">{ksb}</span>) : <span className="text-[11px] text-foreground-300">No KSBs</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center align-middle">
                      <span className="text-[12px] font-medium text-foreground-700">{component.duration} min</span>
                    </td>
                    <td className="px-4 py-4 text-center align-middle">
                      <StatusBadge status={component.status} />
                    </td>
                    <td className="px-4 py-4 text-right align-middle">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={event => { event.stopPropagation(); setEditingComp(component); }} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 hover:bg-primary-200 transition-smooth cursor-pointer" title="Edit component" aria-label="Edit component"><i className="ri-edit-line text-sm"></i></button>
                        <button onClick={event => { event.stopPropagation(); void removeComponent(component); }} disabled={deletingId === component.id} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-smooth cursor-pointer disabled:opacity-60" title="Delete component" aria-label="Delete component"><i className={`${deletingId === component.id ? 'ri-loader-4-line animate-spin' : 'ri-delete-bin-line'} text-sm`}></i></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loadingComponents && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center">
                      <p className="text-[13px] font-semibold text-foreground-700">No components found</p>
                      <p className="mt-1 text-[11px] text-foreground-400">Try clearing filters or creating a new component.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedComp && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-heading font-bold text-foreground-900">{selectedComp.title}</h3>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeColors[selectedComp.type]}`}>{selectedComp.type}</span>
                </div>
                <p className="text-[11px] text-foreground-400">{selectedComp.module} - {selectedComp.programme} - {selectedComp.week}</p>
              </div>
              <StatusBadge status={selectedComp.status} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Duration', value: `${selectedComp.duration} min`, icon: 'ri-time-line' },
                { label: 'Content Sections', value: String(selectedComp.contentSections), icon: 'ri-stack-line' },
                { label: 'Resources', value: selectedComp.hasResources ? 'Attached' : 'None', icon: 'ri-attachment-2' },
                { label: 'Last Edited', value: selectedComp.lastEdited || 'Not saved yet', icon: 'ri-edit-line' },
              ].map(stat => (
                <div key={stat.label} className="bg-background-100/50 rounded-lg p-3 text-center">
                  <i className={`${stat.icon} text-foreground-300 text-sm mb-1 block`}></i>
                  <p className="text-lg font-bold text-foreground-900">{stat.value}</p>
                  <p className="text-[10px] text-foreground-400">{stat.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setEditingComp(selectedComp)} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-edit-line mr-1"></i> Edit Component</button>
              <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-eye-line mr-1"></i> Preview</button>
              <button onClick={() => duplicateComponent(selectedComp)} disabled={savingId !== null} className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-60"><i className="ri-file-copy-line mr-1"></i> Duplicate</button>
              <button onClick={() => removeComponent(selectedComp)} disabled={deletingId === selectedComp.id} className="px-3 py-1.5 bg-red-50 border border-red-100 rounded-lg text-[11px] font-semibold text-red-600 hover:bg-red-100 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-60"><i className="ri-delete-bin-line mr-1"></i> {deletingId === selectedComp.id ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        )}

        {editingComp && (
          <ComponentEditModal
            component={editingComp}
            programmeOptions={programmeNames}
            moduleOptions={moduleChoices}
            ksbSets={ksbSets}
            loadingContext={programmesLoading || modulesLoading || ksbSetsLoading}
            saving={savingId === editingComp.id}
            onDelete={removeComponent}
            onCancel={() => setEditingComp(null)}
            onSave={saveComponent}
          />
        )}
      </div>
    </WorkspaceShell>
  );
}

function ComponentEditModal({ component, programmeOptions, moduleOptions, ksbSets, loadingContext, saving, onDelete, onCancel, onSave }: {
  component: Component;
  programmeOptions: string[];
  moduleOptions: ModuleOption[];
  ksbSets: CurriculumKsbSet[];
  loadingContext: boolean;
  saving: boolean;
  onDelete: (component: Component) => void;
  onCancel: () => void;
  onSave: (component: Component) => Promise<void> | void;
}) {
  const initialModule = resolveModuleOption(component, moduleOptions);
  const initialWeek = resolveWeekOption(component, initialModule);
  const moduleProgrammeOptions = Array.from(new Set(moduleOptions.map(module => module.programme).filter(Boolean))).sort();
  const [form, setForm] = useState({
    title: component.title,
    type: component.type,
    moduleId: initialModule?.id || component.moduleCatalogueId || component.moduleId || '',
    module: initialModule?.name || component.module,
    programme: initialModule?.programme || component.programme || moduleProgrammeOptions[0] || programmeOptions[0] || '',
    weekId: initialWeek?.id || component.weekId || '',
    week: initialWeek?.value || component.week || 'Week 1',
    duration: String(component.duration),
    ksbRefs: component.ksbRefs || [],
    status: component.status,
    contentSections: String(component.contentSections),
    quizQuestions: String(component.quizQuestions || ''),
    hasResources: component.hasResources,
  });

  const availableProgrammes = moduleProgrammeOptions.length ? moduleProgrammeOptions : programmeOptions;
  const availableModules = form.programme
    ? moduleOptions.filter(module => module.programme === form.programme)
    : moduleOptions;
  const selectedModule = moduleOptions.find(module => module.id === form.moduleId) || availableModules[0] || null;
  const availableWeeks = selectedModule?.weeks || [];
  const selectedWeek = availableWeeks.find(week => week.id === form.weekId) || availableWeeks.find(week => week.value === form.week) || availableWeeks[0] || null;
  const ksbOptions = buildKsbOptions({ programme: form.programme, moduleId: selectedModule?.id || form.moduleId, ksbRefs: form.ksbRefs }, ksbSets, moduleOptions);
  const isQuiz = form.type === 'Quiz';

  const changeProgramme = (programme: string) => {
    const nextModule = moduleOptions.find(module => module.programme === programme) || null;
    const nextWeek = nextModule?.weeks[0] || null;
    setForm(prev => ({
      ...prev,
      programme,
      moduleId: nextModule?.id || '',
      module: nextModule?.name || '',
      weekId: nextWeek?.id || '',
      week: nextWeek?.value || 'Week 1',
      ksbRefs: [],
    }));
  };

  const changeModule = (moduleId: string) => {
    const nextModule = moduleOptions.find(module => module.id === moduleId) || null;
    const nextWeek = nextModule?.weeks[0] || null;
    setForm(prev => ({
      ...prev,
      moduleId,
      module: nextModule?.name || '',
      programme: nextModule?.programme || prev.programme,
      weekId: nextWeek?.id || '',
      week: nextWeek?.value || 'Week 1',
      ksbRefs: [],
    }));
  };

  const changeWeek = (weekId: string) => {
    const nextWeek = availableWeeks.find(week => week.id === weekId) || null;
    setForm(prev => ({
      ...prev,
      weekId,
      week: nextWeek?.value || prev.week,
    }));
  };

  const toggleKsb = (code: string) => {
    setForm(prev => ({
      ...prev,
      ksbRefs: prev.ksbRefs.includes(code)
        ? prev.ksbRefs.filter(item => item !== code)
        : [...prev.ksbRefs, code],
    }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const module = moduleOptions.find(item => item.id === form.moduleId);
    const week = module?.weeks.find(item => item.id === form.weekId) || selectedWeek;
    void onSave({
      ...component,
      title: form.title,
      type: form.type,
      moduleCatalogueId: module?.id || form.moduleId,
      moduleId: module?.id || form.moduleId,
      weekId: week?.synthetic ? '' : (week?.id || form.weekId),
      module: module?.name || form.module,
      programme: module?.programme || form.programme,
      week: week?.value || form.week,
      duration: Number(form.duration) || 0,
      ksbRefs: form.ksbRefs,
      status: form.status as Component['status'],
      contentSections: Number(form.contentSections) || 0,
      quizQuestions: isQuiz && form.quizQuestions ? Number(form.quizQuestions) || 0 : null,
      hasResources: form.hasResources,
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onCancel}>
      <form onSubmit={submit} className="w-full max-w-4xl max-h-[92vh] rounded-2xl bg-background-50 shadow-2xl overflow-hidden flex flex-col" onClick={event => event.stopPropagation()}>
        <div className="px-5 py-4 bg-primary-950 text-white flex items-center justify-between">
          <div>
            <h3 className="text-sm font-heading font-bold text-white">{component.title ? 'Edit component' : 'Create component'}</h3>
            <p className="text-[11px] text-white/70 mt-1">Attach it to a programme module and week so it can be reused in the curriculum structure.</p>
          </div>
          <button type="button" onClick={onCancel} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="ri-close-line"></i></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5">
          <div className="rounded-xl border border-primary-100 bg-primary-50/50 p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <EditableSelect label="Programme" value={form.programme} options={availableProgrammes} onChange={changeProgramme} disabled={loadingContext || availableProgrammes.length === 0} />
              <EditableSelect label="Module" value={form.moduleId} options={availableModules.map(module => ({ value: module.id, label: module.name }))} onChange={changeModule} disabled={loadingContext || availableModules.length === 0} />
              <EditableSelect label="Week" value={form.weekId} options={availableWeeks.map(week => ({ value: week.id, label: week.label }))} onChange={changeWeek} disabled={!selectedModule || availableWeeks.length === 0} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-foreground-500">
              <span className="inline-flex items-center gap-1 rounded-full bg-background-50 px-2.5 py-1 font-semibold text-foreground-700"><i className="ri-database-2-line text-primary-500"></i>{selectedModule?.name || 'No module selected'}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-background-50 px-2.5 py-1 font-semibold text-foreground-700"><i className="ri-calendar-line text-primary-500"></i>{selectedWeek?.label || form.week}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-background-50 px-2.5 py-1 font-semibold text-foreground-700"><i className="ri-node-tree text-primary-500"></i>{form.ksbRefs.length} KSBs mapped</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField label="Component title" value={form.title} onChange={value => setForm(prev => ({ ...prev, title: value }))} required />
            <EditableSelect label="Type" value={form.type} options={typeOptions} onChange={value => setForm(prev => ({ ...prev, type: value, quizQuestions: value === 'Quiz' ? prev.quizQuestions || '10' : '' }))} />
            <EditableField label="Duration minutes" type="number" value={form.duration} onChange={value => setForm(prev => ({ ...prev, duration: value }))} required />
            <EditableField label="Content sections" type="number" value={form.contentSections} onChange={value => setForm(prev => ({ ...prev, contentSections: value }))} required />
            {isQuiz && <EditableField label="Quiz questions" type="number" value={form.quizQuestions} onChange={value => setForm(prev => ({ ...prev, quizQuestions: value }))} />}
            <EditableSelect label="Status" value={form.status} options={['draft', 'review', 'published']} onChange={value => setForm(prev => ({ ...prev, status: value as Component['status'] }))} />
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-foreground-200/60 bg-background-50 p-3">
            <input type="checkbox" checked={form.hasResources} onChange={event => setForm(prev => ({ ...prev, hasResources: event.target.checked }))} className="h-4 w-4 rounded border-foreground-300 accent-primary-500" />
            <span>
              <span className="block text-[12px] font-semibold text-foreground-800">Resources attached</span>
              <span className="block text-[11px] text-foreground-400">Use this when the component already has files, links or learning assets ready.</span>
            </span>
          </label>

          <div className="rounded-xl border border-foreground-200/60 bg-background-50 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h4 className="text-[12px] font-heading font-bold text-foreground-900">KSB mapping</h4>
                <p className="text-[11px] text-foreground-400">Choose from the selected programme/module KSBs.</p>
              </div>
              {form.ksbRefs.length > 0 && <button type="button" onClick={() => setForm(prev => ({ ...prev, ksbRefs: [] }))} className="px-2.5 py-1 rounded-lg border border-background-200 text-[10px] font-semibold text-foreground-500 hover:bg-background-100">Clear</button>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
              {ksbOptions.map(ksb => (
                <label key={ksb.code} className={`flex items-start gap-2 rounded-lg border p-2.5 transition-smooth cursor-pointer ${form.ksbRefs.includes(ksb.code) ? 'border-primary-200 bg-primary-50 text-primary-800' : 'border-background-200 bg-background-50 hover:bg-background-100'}`}>
                  <input type="checkbox" checked={form.ksbRefs.includes(ksb.code)} onChange={() => toggleKsb(ksb.code)} className="mt-0.5 h-4 w-4 rounded border-foreground-300 accent-primary-500" />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold">{ksb.code}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[10px] text-foreground-500">{ksb.description || 'Mapped KSB'}</span>
                  </span>
                </label>
              ))}
              {ksbOptions.length === 0 && (
                <div className="sm:col-span-2 rounded-lg border border-dashed border-foreground-200 p-4 text-center text-[11px] text-foreground-400">
                  No KSBs found for this module yet.
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-background-200/60 flex justify-end gap-2">
          <button type="button" onClick={() => onDelete(component)} className="mr-auto px-4 py-2 rounded-lg border border-red-100 bg-red-50 text-[12px] font-semibold text-red-600 hover:bg-red-100">Delete</button>
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-background-200 text-[12px] font-semibold text-foreground-700 hover:bg-background-100">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-primary-500 text-white text-[12px] font-semibold hover:bg-primary-600 disabled:opacity-60">{saving ? 'Saving...' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
}

function MetricCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-[10px] text-white/70 uppercase tracking-wide">{label}</p>
    </div>
  );
}

function SegmentedFilter({ values, selected, allLabel, onSelect }: { values: string[]; selected: string; allLabel: string; onSelect: (value: string) => void }) {
  return (
    <div className="flex max-w-full items-center gap-1 overflow-x-auto bg-background-100 rounded-xl p-1">
      {values.map(value => (
        <button key={value} onClick={() => onSelect(value)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${selected === value ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{value === 'all' ? allLabel : value}</button>
      ))}
    </div>
  );
}

function EditableField({ label, value, onChange, type = 'text', required, options = [] }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; options?: string[] }) {
  const listId = `${label.toLowerCase().replace(/\s+/g, '-')}-options`;
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}{required ? ' *' : ''}</span>
      <input list={options.length ? listId : undefined} type={type} value={value} required={required} min={type === 'number' ? 0 : undefined} onChange={event => onChange(event.target.value)} className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-300" />
      {options.length > 0 && <datalist id={listId}>{options.map(option => <option key={option} value={option} />)}</datalist>}
    </label>
  );
}

function EditableSelect({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: Array<string | { value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} disabled={disabled || options.length === 0} className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-300 disabled:cursor-not-allowed disabled:opacity-60">
        {options.length === 0 && <option value="">No options available</option>}
        {options.map(option => {
          const value = typeof option === 'string' ? option : option.value;
          const label = typeof option === 'string' ? option : option.label;
          return <option key={value} value={value}>{label}</option>;
        })}
      </select>
    </label>
  );
}

function componentTypeIcon(type: string) {
  switch (type) {
    case 'Live Session':
      return 'ri-video-chat-line';
    case 'Recording Placeholder':
      return 'ri-play-circle-line';
    case 'Workshop':
      return 'ri-team-line';
    case 'Video':
      return 'ri-video-line';
    case 'Podcast':
      return 'ri-mic-line';
    case 'Reading':
      return 'ri-book-open-line';
    case 'PowerPoint':
      return 'ri-file-ppt-2-line';
    case 'Assignment':
      return 'ri-file-list-3-line';
    case 'Workplace Evidence':
      return 'ri-upload-cloud-2-line';
    case 'Reflection':
      return 'ri-chat-quote-line';
    case 'Self-study':
      return 'ri-book-open-line';
    case 'Quiz':
      return 'ri-questionnaire-line';
    case 'Checkpoint':
      return 'ri-checkbox-circle-line';
    case 'Coaching Preparation':
      return 'ri-user-heart-line';
    default:
      return 'ri-puzzle-line';
  }
}

function StatusBadge({ status }: { status: Component['status'] }) {
  const className = status === 'published' ? 'bg-emerald-100 text-emerald-700' : status === 'review' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-500';
  return <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${className}`}>{status}</span>;
}

function buildModuleOptions(modules: CurriculumModule[]): ModuleOption[] {
  const byId = new Map<string, ModuleOption>();
  modules.forEach(module => {
    const id = String(module.catalogueId || module.sourceId || module.id || '').trim();
    const name = String(module.name || '').trim();
    if (!id || !name) return;
    const aliases = uniqueModuleAliases([
      id,
      module.catalogueId,
      module.sourceId,
      module.id,
      ...(module.relatedCatalogueIds || []),
    ]);
    const weekCount = Math.max(1, Number(module.weeks || module.sessionsNumber || module.sessionNames?.length || 1));
    const weeks = Array.from({ length: weekCount }, (_, index) => {
      const sessionName = module.sessionNames?.[index] || '';
      return {
        id: `week-${index + 1}`,
        label: sessionName ? `Week ${index + 1} - ${sessionName}` : `Week ${index + 1}`,
        value: `Week ${index + 1}`,
        weekNumber: index + 1,
        synthetic: true,
      };
    });
    const existing = byId.get(id);
    const option = {
      id,
      aliases,
      name,
      programme: module.programme || 'Unassigned programme',
      programmeId: String(module.programmeId || module.programme || ''),
      weeks,
      ksbCodes: module.ksbCodes || [],
    };
    if (!existing || option.weeks.length > existing.weeks.length) {
      byId.set(id, option);
    } else {
      existing.aliases = uniqueModuleAliases([...existing.aliases, ...option.aliases]);
      existing.ksbCodes = Array.from(new Set([...existing.ksbCodes, ...option.ksbCodes]));
    }
  });
  return Array.from(byId.values()).sort((a, b) => `${a.programme} ${a.name}`.localeCompare(`${b.programme} ${b.name}`));
}

function buildComponentModuleOptions(components: Component[]): ModuleOption[] {
  const byKey = new Map<string, ModuleOption>();
  components.forEach(component => {
    const id = String(component.moduleCatalogueId || component.moduleId || '').trim();
    const name = String(component.module || '').trim();
    if (!name) return;
    const key = id || `${component.programme}::${name}`;
    const existing = byKey.get(key);
    const weekNumber = parseWeekNumber(component.week);
    const weekOption = {
      id: component.weekId || `week-${weekNumber}`,
      label: component.week || `Week ${weekNumber}`,
      value: component.week || `Week ${weekNumber}`,
      weekNumber,
      synthetic: !component.weekId,
    };
    if (existing) {
      if (!existing.weeks.some(week => week.value === weekOption.value || week.id === weekOption.id)) {
        existing.weeks.push(weekOption);
        existing.weeks.sort((a, b) => a.weekNumber - b.weekNumber);
      }
      existing.ksbCodes = Array.from(new Set([...existing.ksbCodes, ...(component.ksbRefs || [])]));
      return;
    }
    byKey.set(key, {
      id: id || key,
      aliases: uniqueModuleAliases([id, key]),
      name,
      programme: component.programme || 'Unassigned programme',
      programmeId: component.programme || '',
      weeks: [weekOption],
      ksbCodes: component.ksbRefs || [],
    });
  });
  return Array.from(byKey.values());
}

function mergeModuleOptions(primary: ModuleOption[], fallback: ModuleOption[]) {
  const byId = new Map<string, ModuleOption>();
  [...fallback, ...primary].forEach(option => {
    const key = option.id || `${option.programme}::${option.name}`;
    const existingEntry = Array.from(byId.entries()).find(([, existing]) => moduleOptionsOverlap(existing, option));
    const existingKey = existingEntry?.[0] || key;
    const existing = existingEntry?.[1] || byId.get(key);
    if (!existing) {
      byId.set(key, { ...option, aliases: uniqueModuleAliases([option.id, ...option.aliases]), weeks: [...option.weeks], ksbCodes: [...option.ksbCodes] });
      return;
    }
    const weeks = [...existing.weeks];
    option.weeks.forEach(week => {
      if (!weeks.some(item => item.value === week.value || item.id === week.id)) weeks.push(week);
    });
    byId.set(existingKey, {
      ...existing,
      ...option,
      aliases: uniqueModuleAliases([...existing.aliases, option.id, ...option.aliases]),
      weeks: weeks.sort((a, b) => a.weekNumber - b.weekNumber),
      ksbCodes: Array.from(new Set([...existing.ksbCodes, ...option.ksbCodes])),
    });
  });
  return Array.from(byId.values()).sort((a, b) => `${a.programme} ${a.name}`.localeCompare(`${b.programme} ${b.name}`));
}

function resolveModuleOption(component: Component, moduleOptions: ModuleOption[]) {
  const moduleIdentifier = component.moduleCatalogueId || component.moduleId;
  return (
    moduleOptions.find(module => moduleOptionMatchesId(module, moduleIdentifier)) ||
    moduleOptions.find(module => module.name === component.module && module.programme === component.programme) ||
    moduleOptions.find(module => module.name === component.module) ||
    null
  );
}

function resolveWeekOption(component: Component, module: ModuleOption | null) {
  if (!module) return null;
  return (
    module.weeks.find(week => week.id === component.weekId) ||
    module.weeks.find(week => week.value === component.week) ||
    module.weeks.find(week => week.weekNumber === parseWeekNumber(component.week)) ||
    module.weeks[0] ||
    null
  );
}

function parseWeekNumber(value: string) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) || 1 : 1;
}

function normaliseModuleIdentifier(value: unknown) {
  return String(value || '').trim();
}

function uniqueModuleAliases(values: unknown[]) {
  return Array.from(new Set(values.map(normaliseModuleIdentifier).filter(Boolean)));
}

function moduleOptionMatchesId(option: ModuleOption, id: unknown) {
  const normalised = normaliseModuleIdentifier(id);
  return Boolean(normalised && (option.id === normalised || option.aliases.includes(normalised)));
}

function moduleOptionsOverlap(left: ModuleOption, right: ModuleOption) {
  const leftAliases = uniqueModuleAliases([left.id, ...left.aliases]);
  const rightAliases = uniqueModuleAliases([right.id, ...right.aliases]);
  const rightAliasSet = new Set(rightAliases);
  if (leftAliases.some(alias => rightAliasSet.has(alias))) return true;
  return Boolean(left.name && right.name && left.programme && right.programme && left.name === right.name && left.programme === right.programme);
}

function buildKsbOptions(context: { programme: string; moduleId?: string; ksbRefs: string[] }, ksbSets: CurriculumKsbSet[], moduleOptions: ModuleOption[]) {
  const selectedModule = moduleOptions.find(module => moduleOptionMatchesId(module, context.moduleId));
  const selectedSets = ksbSets.filter(set => set.programmeName === context.programme || set.programmeId === selectedModule?.programmeId);
  const byCode = new Map<string, { code: string; description: string; type?: string }>();

  const addEntry = (entry: Pick<CurriculumKsbEntry, 'code' | 'description' | 'type'> | { code: string; description?: string; type?: string }) => {
    const code = String(entry.code || '').trim().toUpperCase();
    if (!code || byCode.has(code)) return;
    byCode.set(code, { code, description: entry.description || '', type: entry.type });
  };

  selectedSets.flatMap(set => set.ksbs || []).forEach(addEntry);
  (selectedModule?.ksbCodes || []).forEach(code => addEntry({ code, description: `Mapped KSB ${code}` }));
  context.ksbRefs.forEach(code => addEntry({ code, description: `Mapped KSB ${code}` }));

  return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

function createBlankComponent(moduleOptions: ModuleOption[], programmeFilter = 'all'): Component {
  const module = moduleOptions.find(option => programmeFilter !== 'all' && option.programme === programmeFilter) || moduleOptions[0];
  const week = module?.weeks[0];
  return {
    id: `comp-${Date.now().toString(36)}`,
    title: '',
    type: 'Live Session',
    moduleCatalogueId: module?.id || '',
    moduleId: module?.id || '',
    weekId: week && !week.synthetic ? week.id : '',
    module: module?.name || '',
    programme: module?.programme || '',
    week: week?.value || 'Week 1',
    duration: 60,
    ksbRefs: [],
    status: 'draft',
    lastEdited: '',
    contentSections: 1,
    hasResources: false,
  };
}

function loadComponents() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(COMPONENT_STORE_KEY);
    return raw ? JSON.parse(raw) as Component[] : [];
  } catch {
    return [];
  }
}

function saveComponents(components: Component[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(COMPONENT_STORE_KEY, JSON.stringify(components));
}

import { type FormEvent, useEffect, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import {
  createCurriculumComponent,
  deleteCurriculumComponent,
  fetchCurriculumComponents,
  updateCurriculumComponent,
  type CurriculumComponent,
} from '@/lib/curriculumApi';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;
const COMPONENT_STORE_KEY = 'lms.component-builder.components.v1';

type Component = CurriculumComponent;

const DEFAULT_COMPONENTS: Component[] = [
  { id: 'comp-001', title: 'Welcome & Icebreaker - Cohort Induction', type: 'Live Session', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 1', duration: 60, ksbRefs: ['B1', 'B2'], status: 'published', lastEdited: '2 Jun 2026', contentSections: 4, hasResources: true },
  { id: 'comp-002', title: 'Communication Models: Shannon-Weaver & Berlo', type: 'Workshop', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 1', duration: 90, ksbRefs: ['K1', 'K2'], status: 'published', lastEdited: '1 Jun 2026', contentSections: 6, hasResources: true },
  { id: 'comp-003', title: 'Email Etiquette & Professional Standards', type: 'Live Session', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 2', duration: 60, ksbRefs: ['K4', 'S3'], status: 'published', lastEdited: '28 May 2026', contentSections: 5, hasResources: true },
  { id: 'comp-004', title: 'Business Report Structure & Drafting', type: 'Assignment', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 2', duration: 60, ksbRefs: ['K4', 'S3', 'S4'], status: 'published', lastEdited: '27 May 2026', contentSections: 8, hasResources: false },
  { id: 'comp-005', title: 'Active Listening & Non-Verbal Communication', type: 'Workshop', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 3', duration: 90, ksbRefs: ['K6', 'K7', 'S5'], status: 'draft', lastEdited: '25 May 2026', contentSections: 3, hasResources: false },
  { id: 'comp-006', title: 'Chart Selection & Data Storytelling', type: 'Live Session', module: 'Data Visualisation', programme: 'Data Analyst L4', week: 'Week 4', duration: 60, ksbRefs: ['K10', 'S9'], status: 'published', lastEdited: '3 Jun 2026', contentSections: 5, hasResources: true },
  { id: 'comp-007', title: 'Tableau Dashboard - Hands-on Workshop', type: 'Workshop', module: 'Data Visualisation', programme: 'Data Analyst L4', week: 'Week 4', duration: 120, ksbRefs: ['S9', 'S10'], status: 'published', lastEdited: '2 Jun 2026', contentSections: 7, hasResources: true },
  { id: 'comp-008', title: 'Data Cleaning & Transformation in Python', type: 'Workshop', module: 'Statistical Analysis', programme: 'Data Analyst L4', week: 'Week 5', duration: 120, ksbRefs: ['S11', 'S12'], status: 'draft', lastEdited: '20 May 2026', contentSections: 2, hasResources: false },
  { id: 'comp-009', title: 'Segmentation Principles & Application', type: 'Live Session', module: 'Marketing Planning', programme: 'Marketing Exec L4', week: 'Week 6', duration: 60, ksbRefs: ['K5', 'S8'], status: 'published', lastEdited: '4 Jun 2026', contentSections: 5, quizQuestions: 12, hasResources: true },
  { id: 'comp-010', title: 'Campaign Segmentation Worksheet', type: 'Assignment', module: 'Marketing Planning', programme: 'Marketing Exec L4', week: 'Week 6', duration: 90, ksbRefs: ['K5', 'S8', 'S9'], status: 'published', lastEdited: '3 Jun 2026', contentSections: 6, quizQuestions: 8, hasResources: false },
];

const typeOptions = ['Live Session', 'Workshop', 'Assignment', 'Self-study', 'Quiz'];
const typeFilters = ['all', ...typeOptions];

export default function ComponentBuilderPage() {
  const { programmes: curriculumProgrammes, loading: programmesLoading, error: programmesError } = useCurriculumProgrammes();
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
        const next = rows.length ? rows : loadComponents();
        setComponents(next);
        saveComponents(next);
        setSyncError(rows.length ? null : 'No database components yet. Showing local starter components until you save.');
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

  const fallbackProgrammeNames = Array.from(new Set(components.map(component => component.programme).filter(Boolean))).sort();
  const databaseProgrammeNames = Array.from(new Set(curriculumProgrammes.map(programme => programme.name).filter(Boolean))).sort();
  const programmeNames = databaseProgrammeNames.length ? databaseProgrammeNames : fallbackProgrammeNames;
  const programmes = ['all', ...programmeNames];
  const moduleOptions = Array.from(new Set(components.map(component => component.module).filter(Boolean))).sort();

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
    Workshop: 'bg-accent-100 text-accent-700',
    Assignment: 'bg-amber-100 text-amber-700',
    'Self-study': 'bg-secondary-100 text-secondary-700',
    Quiz: 'bg-rose-100 text-rose-700',
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
      ksbRefs: component.ksbRefs.map(ksb => ksb.trim().toUpperCase()).filter(Boolean),
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
              <button onClick={() => setEditingComp(createBlankComponent(programmeNames[0] || 'Business Admin L3'))} className="h-10 px-4 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap shadow-sm"><i className="ri-add-line mr-1"></i> New Component</button>
            </div>
          </div>
          {(programmesError || syncError) && <p className="mt-2 text-[11px] text-amber-600">{syncError || 'Programme list is using local fallback because the database is unavailable.'}</p>}
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
            moduleOptions={moduleOptions}
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

function ComponentEditModal({ component, programmeOptions, moduleOptions, saving, onDelete, onCancel, onSave }: {
  component: Component;
  programmeOptions: string[];
  moduleOptions: string[];
  saving: boolean;
  onDelete: (component: Component) => void;
  onCancel: () => void;
  onSave: (component: Component) => Promise<void> | void;
}) {
  const [form, setForm] = useState({
    title: component.title,
    type: component.type,
    module: component.module,
    programme: component.programme,
    week: component.week,
    duration: String(component.duration),
    ksbRefs: component.ksbRefs.join(', '),
    status: component.status,
    contentSections: String(component.contentSections),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave({
      ...component,
      title: form.title,
      type: form.type,
      module: form.module,
      programme: form.programme,
      week: form.week,
      duration: Number(form.duration) || 0,
      ksbRefs: form.ksbRefs.split(',').map(item => item.trim()).filter(Boolean),
      status: form.status as Component['status'],
      contentSections: Number(form.contentSections) || 0,
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onCancel}>
      <form onSubmit={submit} className="w-full max-w-3xl rounded-2xl bg-background-50 shadow-2xl overflow-hidden" onClick={event => event.stopPropagation()}>
        <div className="px-5 py-4 bg-primary-950 text-white flex items-center justify-between">
          <div>
            <h3 className="text-sm font-heading font-bold text-white">Edit component</h3>
            <p className="text-[11px] text-white/70 mt-1">Update the same fields shown in the table.</p>
          </div>
          <button type="button" onClick={onCancel} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="ri-close-line"></i></button>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <EditableField label="Component" value={form.title} onChange={value => setForm(prev => ({ ...prev, title: value }))} required />
          <EditableSelect label="Type" value={form.type} options={typeOptions} onChange={value => setForm(prev => ({ ...prev, type: value }))} />
          <EditableField label="Module" value={form.module} options={moduleOptions} onChange={value => setForm(prev => ({ ...prev, module: value }))} required />
          <EditableSelect label="Programme" value={form.programme} options={programmeOptions.length ? programmeOptions : ['Business Admin L3']} onChange={value => setForm(prev => ({ ...prev, programme: value }))} />
          <EditableField label="Week" value={form.week} onChange={value => setForm(prev => ({ ...prev, week: value }))} required />
          <EditableField label="Content sections" type="number" value={form.contentSections} onChange={value => setForm(prev => ({ ...prev, contentSections: value }))} required />
          <EditableField label="KSBs" value={form.ksbRefs} onChange={value => setForm(prev => ({ ...prev, ksbRefs: value }))} required />
          <EditableField label="Duration minutes" type="number" value={form.duration} onChange={value => setForm(prev => ({ ...prev, duration: value }))} required />
          <EditableSelect label="Status" value={form.status} options={['published', 'draft', 'review']} onChange={value => setForm(prev => ({ ...prev, status: value as Component['status'] }))} />
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

function EditableSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-300">
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function componentTypeIcon(type: string) {
  switch (type) {
    case 'Live Session':
      return 'ri-video-chat-line';
    case 'Workshop':
      return 'ri-team-line';
    case 'Assignment':
      return 'ri-file-list-3-line';
    case 'Self-study':
      return 'ri-book-open-line';
    case 'Quiz':
      return 'ri-questionnaire-line';
    default:
      return 'ri-puzzle-line';
  }
}

function StatusBadge({ status }: { status: Component['status'] }) {
  const className = status === 'published' ? 'bg-emerald-100 text-emerald-700' : status === 'review' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-500';
  return <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${className}`}>{status}</span>;
}

function createBlankComponent(programme: string): Component {
  return {
    id: `comp-${Date.now().toString(36)}`,
    title: '',
    type: 'Live Session',
    module: '',
    programme,
    week: 'Week 1',
    duration: 60,
    ksbRefs: [],
    status: 'draft',
    lastEdited: '',
    contentSections: 1,
    hasResources: false,
  };
}

function loadComponents() {
  if (typeof window === 'undefined') return DEFAULT_COMPONENTS;
  try {
    const raw = window.localStorage.getItem(COMPONENT_STORE_KEY);
    return raw ? JSON.parse(raw) as Component[] : DEFAULT_COMPONENTS;
  } catch {
    return DEFAULT_COMPONENTS;
  }
}

function saveComponents(components: Component[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(COMPONENT_STORE_KEY, JSON.stringify(components));
}

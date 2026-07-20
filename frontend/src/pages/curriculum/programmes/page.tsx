import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { CardGridSkeleton } from '@/components/feature/CurriculumSkeletons';
import { AddCurriculumStructureWizard } from '@/components/feature/AddCurriculumStructureWizard';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  archiveCurriculumCohort,
  archiveCurriculumGroup,
  archiveCurriculumModule,
  deleteCurriculumProgramme,
  updateCurriculumCohort,
  updateCurriculumGroup,
  updateCurriculumModule,
  updateCurriculumProgramme,
  type CurriculumCohort,
  type CurriculumGroup,
  type CurriculumModule,
  type CurriculumProgramme,
  type CurriculumProgrammeInput,
  type CurriculumSession,
  type CurriculumStaffProfile,
} from '@/lib/curriculumApi';

type ProgrammeFormState = Required<Pick<CurriculumProgrammeInput, 'name' | 'standard' | 'level' | 'color' | 'description'>>;

const COLOR_PRESETS = ['#6d28d9', '#2563eb', '#0f766e', '#16a34a', '#ea580c', '#dc2626', '#be123c', '#334155'];
const WEEKDAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type SelectOption = { value: string; label: string; meta?: string; color?: string };

function showProgrammeSwalToast(title: string, text: string, icon: 'success' | 'error' | 'info' = 'success') {
  return showCurriculumAlert({
    title,
    text,
    icon,
    timer: icon === 'error' ? undefined : 1800,
    confirmButtonText: icon === 'error' ? 'Close' : 'Done',
  });
}

export default function CurriculumProgrammes() {
  const [search, setSearch] = useState('');
  const [editingProgramme, setEditingProgramme] = useState<CurriculumProgramme | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardProgrammeId, setWizardProgrammeId] = useState<string | undefined>();
  const [wizardProgramme, setWizardProgramme] = useState<CurriculumProgramme | undefined>();
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingProgrammeId, setDeletingProgrammeId] = useState<string | null>(null);
  const { programmes, loading, error, reload } = useCurriculumProgrammes();

  const filtered = programmes.filter(p => {
    const needle = search.toLowerCase();
    if (needle && !p.name.toLowerCase().includes(needle) && !p.standard.toLowerCase().includes(needle)) return false;
    return true;
  });

  const totalProgrammes = programmes.length;
  const totalLearners = programmes.reduce((a, b) => a + (b.learners || 0), 0);
  const totalCohorts = programmes.reduce((a, b) => a + (b.cohorts || 0), 0);
  const totalModules = programmes.reduce((a, b) => a + (b.modules || 0), 0);
  const totalSessions = programmes.reduce((a, b) => a + (b.weeks || 0), 0);
  const programmesWithKsb = programmes.filter(programme => programme.ksbTotal > 0);
  const averageKsbCoverage = programmesWithKsb.length
    ? Math.round(programmesWithKsb.reduce((sum, programme) => sum + ((programme.ksbMapped / programme.ksbTotal) * 100), 0) / programmesWithKsb.length)
    : 0;
  const pageSubtitle = `${totalProgrammes} programmes - ${totalCohorts} cohorts - ${totalModules} modules - ${totalLearners} learners`;
  const heroSummary = <><strong>{totalProgrammes} programmes</strong> - {totalCohorts} cohorts - {totalModules} modules</>;

  const openEdit = (programme: CurriculumProgramme) => {
    setActionError(null);
    setWizardProgrammeId(programme.sourceId || programme.id);
    setWizardProgramme(programme);
    setWizardOpen(true);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setWizardProgrammeId(undefined);
    setWizardProgramme(undefined);
  };

  const deleteProgramme = async (programme: CurriculumProgramme) => {
    const programmeId = programme.sourceId || programme.id;
    setActionError(null);
    await showCurriculumConfirm({
      title: 'Delete programme?',
      text: `Delete "${programme.name}" from the curriculum programme list? Related curriculum records will be kept for audit and reporting.`,
      icon: 'warning',
      confirmButtonText: 'Delete Programme',
      cancelButtonText: 'Cancel',
      successTitle: 'Programme deleted',
      successText: `${programme.name} was removed from the active programme list.`,
      onConfirm: async () => {
        setDeletingProgrammeId(programmeId);
        try {
          await deleteCurriculumProgramme(programmeId);
          await reload();
        } catch (err) {
          setActionError(err instanceof Error ? err.message : 'Unable to delete programme.');
          throw err;
        } finally {
          setDeletingProgrammeId(null);
        }
      },
    });
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Programmes" pageSubtitle={pageSubtitle} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-4 sm:p-6 space-y-5">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-primary-950 text-white shadow-xl">
          <div className="relative p-5 sm:p-7">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.18),transparent_34%),linear-gradient(135deg,rgba(109,40,217,0.35),rgba(15,23,42,0))]" />
            <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">Curriculum Studio</p>
                <h2 className="mt-2 text-2xl font-heading font-bold text-white sm:text-3xl">Programme planning workspace</h2>
                <p className="mt-2 max-w-2xl text-[13px] leading-6 text-white/75">
                  Build programme structures, manage cohorts and groups, and keep module delivery plans connected to live LMS records.
                </p>
                <p className="mt-2 text-[12px] font-semibold text-white/70">{loading ? 'Loading live LMS programmes...' : heroSummary}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => { setWizardProgrammeId(undefined); setWizardProgramme(undefined); setWizardOpen(true); }}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-[12px] font-bold text-primary-900 shadow-lg shadow-black/10 transition-smooth hover:bg-primary-50"
                >
                  <i className="ri-add-line text-base"></i>
                  Create Programme Structure
                </button>
                <button
                  type="button"
                  onClick={() => reload()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-white/15"
                >
                  <i className="ri-refresh-line text-base"></i>
                  Refresh
                </button>
              </div>
            </div>
            <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <DashboardStat icon="ri-layout-masonry-line" label="Actual programmes" value={String(totalProgrammes)} detail={`${totalModules} modules connected`} />
              <DashboardStat icon="ri-calendar-event-line" label="Cohorts" value={String(totalCohorts)} detail={`${totalLearners} learners allocated`} />
              <DashboardStat icon="ri-stack-line" label="Modules" value={String(totalModules)} detail={`${totalSessions} planned sessions`} />
              <DashboardStat icon="ri-node-tree" label="KSB coverage" value={`${averageKsbCoverage}%`} detail={programmesWithKsb.length ? 'Average mapped coverage' : 'No mapped KSBs yet'} />
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            Curriculum API error: {error}. Start the Django backend on port 8000 and refresh.
          </div>
        )}

        {actionError && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            {actionError}
          </div>
        )}

        <section className="rounded-2xl border border-foreground-200/70 bg-background-50 p-3 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative flex-1">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by programme or standard..."
                className="h-11 w-full rounded-xl border border-foreground-200/70 bg-background-50 pl-10 pr-10 text-[13px] font-medium text-foreground-900 placeholder:text-foreground-400 outline-none transition-smooth focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 hover:text-foreground-700" aria-label="Clear search">
                  <i className="ri-close-line"></i>
                </button>
              )}
            </div>
          </div>
        </section>

        {loading ? (
          <CardGridSkeleton count={6} />
        ) : filtered.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {filtered.map(prog => {
            const coverage = prog.ksbTotal > 0 ? Math.round((prog.ksbMapped / prog.ksbTotal) * 100) : 0;
            return (
              <article key={prog.id} className="group relative overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 p-5 shadow-sm transition-smooth hover:-translate-y-0.5 hover:border-primary-200/80 hover:shadow-lg">
                <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: prog.color || '#6941c6' }} />
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: prog.color || '#6941c6' }}>
                      <i className="ri-book-2-line text-base"></i>
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-heading font-bold text-foreground-950">{prog.name}</p>
                      <p className="text-[11px] text-foreground-400">{prog.standard} - {prog.level || 'Level not set'}</p>
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                        <i className="ri-calendar-event-line text-[10px]"></i>
                        Programme
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-background-200/70 bg-background-100/60 p-3 sm:grid-cols-5">
                  <Metric label="Cohorts" value={String(prog.cohorts)} />
                  <Metric label="Groups" value={String(prog.groups || 0)} />
                  <Metric label="Modules" value={String(prog.modules)} />
                  <Metric label="Sessions" value={`${prog.weeks}`} />
                  <Metric label="Learners" value={String(prog.learners)} />
                  <div className="col-span-2 sm:col-span-5">
                    <p className="text-[9px] text-foreground-400 uppercase">KSB Mapping</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="flex-1 h-1.5 bg-background-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${coverage >= 100 ? 'bg-emerald-500' : coverage >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${coverage}%` }}></div>
                      </div>
                      <span className="text-[10px] font-semibold">{coverage}%</span>
                    </div>
                  </div>
                </div>
                {prog.description && <p className="mb-4 line-clamp-2 text-[12px] leading-5 text-foreground-500">{prog.description}</p>}
                <div className="flex flex-wrap items-center gap-2 border-t border-background-200/70 pt-4">
                  <button className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700" onClick={e => { e.stopPropagation(); window.REACT_APP_NAVIGATE(`/curriculum/programmes/${prog.id}`); }}>
                    <i className="ri-eye-line"></i>
                    Open
                  </button>
                  <button className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[11px] font-bold text-foreground-700 transition-smooth hover:bg-background-100" onClick={e => { e.stopPropagation(); openEdit(prog); }}>
                    <i className="ri-pencil-line text-sm"></i>Edit
                  </button>
                  <button
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600 transition-smooth hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={deletingProgrammeId === (prog.sourceId || prog.id)}
                    onClick={e => { e.stopPropagation(); void deleteProgramme(prog); }}
                  >
                    <i className={deletingProgrammeId === (prog.sourceId || prog.id) ? 'ri-loader-4-line animate-spin text-sm' : 'ri-delete-bin-6-line text-sm'}></i>
                    Delete
                  </button>
                </div>
              </article>
            );
            })}
          </div>
        ) : (
          <ProgrammesEmptyState
            hasSearch={Boolean(search.trim())}
            onClear={() => setSearch('')}
            onCreate={() => { setWizardProgrammeId(undefined); setWizardProgramme(undefined); setWizardOpen(true); }}
          />
        )}

        {editingProgramme && (
          <ProgrammeStructureEditor
            programme={editingProgramme}
            onClose={() => setEditingProgramme(null)}
            onSaved={reload}
            onOpenAddStructure={() => {
              setWizardProgrammeId(editingProgramme.sourceId || editingProgramme.id);
              setWizardProgramme(editingProgramme);
              setEditingProgramme(null);
              setWizardOpen(true);
            }}
          />
        )}
        <AddCurriculumStructureWizard
          isOpen={wizardOpen}
          onClose={closeWizard}
          onSaved={reload}
          initialProgrammeId={wizardProgrammeId}
          initialProgramme={wizardProgramme}
          startStep="programme"
        />
      </div>
    </WorkspaceShell>
  );
}

function DashboardStat({ icon, label, value, detail }: { icon: string; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/10 p-3 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-white/70">
        <i className={`${icon} text-sm`}></i>
        <span className="truncate text-[10px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-heading font-bold text-white">{value}</p>
      <p className="mt-0.5 truncate text-[11px] font-semibold text-white/60">{detail}</p>
    </div>
  );
}

function ProgrammesEmptyState({
  hasSearch,
  onClear,
  onCreate,
}: {
  hasSearch: boolean;
  onClear: () => void;
  onCreate: () => void;
}) {
  const title = hasSearch ? 'No programmes match your search' : 'No programmes created yet';
  const message = hasSearch
    ? 'Try a different programme name or standard.'
    : 'Create the first programme structure to add cohorts, groups, modules and weekly components.';

  return (
    <div className="rounded-2xl border border-dashed border-foreground-200 bg-background-50 px-6 py-14 text-center shadow-sm">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 ring-1 ring-primary-100">
        <i className={`${hasSearch ? 'ri-search-line' : 'ri-stack-line'} text-2xl`}></i>
      </span>
      <h3 className="mt-4 text-base font-heading font-bold text-foreground-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-foreground-500">{message}</p>
      <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
        {hasSearch && (
          <button type="button" onClick={onClear} className="inline-flex h-10 items-center gap-2 rounded-lg border border-background-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100">
            <i className="ri-filter-off-line"></i>
            Clear search
          </button>
        )}
        <button type="button" onClick={onCreate} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700">
          <i className="ri-add-line"></i>
          Create programme
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, required, type = 'text', placeholder, disabled }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string; placeholder?: string; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-foreground-500 uppercase tracking-wide">{label}{required ? ' *' : ''}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required} placeholder={placeholder} disabled={disabled} className="mt-1.5 w-full h-10 px-3 bg-background-50 border border-foreground-200/70 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-background-100 disabled:text-foreground-400 transition-smooth" />
    </label>
  );
}

function TextAreaField({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-foreground-500 uppercase tracking-wide">{label}</span>
      <textarea value={value} onChange={event => onChange(event.target.value)} rows={rows} className="mt-1.5 w-full px-3 py-2 bg-background-50 border border-foreground-200/70 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-smooth resize-y" />
    </label>
  );
}

function ChoiceSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select...',
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 280, maxHeight: 300 });
  const selectRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hasCurrentValue = value && !options.some(option => option.value === value);
  const visibleOptions = useMemo(
    () => hasCurrentValue ? [{ value, label: value, meta: 'Current value' }, ...options] : options,
    [hasCurrentValue, options, value],
  );
  const selectedOption = visibleOptions.find(option => option.value === value);
  const filteredOptions = useMemo(() => {
    const search = normalise(query);
    if (!search) return visibleOptions;
    return visibleOptions.filter(option => (
      normalise(option.label).includes(search)
      || normalise(option.meta).includes(search)
      || normalise(option.value).includes(search)
    ));
  }, [query, visibleOptions]);

  useEffect(() => {
    if (!open || !selectRef.current) return;

    const updatePosition = () => {
      if (!selectRef.current) return;
      const rect = selectRef.current.getBoundingClientRect();
      const width = Math.max(280, rect.width);
      const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const preferredHeight = Math.min(340, Math.max(220, Math.max(spaceBelow, spaceAbove)));
      const opensBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
      const top = opensBelow
        ? Math.min(rect.bottom + 8, window.innerHeight - preferredHeight - 12)
        : Math.max(12, rect.top - preferredHeight - 8);
      setMenuPosition({ left, top, width, maxHeight: preferredHeight });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!selectRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={selectRef} className="block">
      <span className="text-[10px] font-bold text-foreground-500 uppercase tracking-wide">{label}{required ? ' *' : ''}</span>
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className={`mt-1.5 h-10 w-full rounded-xl border px-3 text-left shadow-sm transition-smooth ${open ? 'border-primary-400 bg-background-50 ring-2 ring-primary-100' : 'border-foreground-200/70 bg-background-50 hover:border-primary-200 hover:bg-background-100/50'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex h-full items-center gap-2.5">
          {selectedOption?.color ? <span className="h-3.5 w-3.5 shrink-0 rounded-[4px] ring-1 ring-black/10" style={{ backgroundColor: selectedOption.color }} /> : null}
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[13px] font-semibold ${selectedOption ? 'text-foreground-900' : 'text-foreground-400'}`} title={selectedOption?.label || placeholder}>
              {selectedOption?.label || placeholder}
            </span>
          </span>
          <i className={`ri-arrow-down-s-line shrink-0 text-lg text-foreground-400 transition-transform ${open ? 'rotate-180 text-primary-500' : ''}`}></i>
        </span>
      </button>
      {selectedOption?.meta ? <p className="mt-1 text-[11px] font-medium text-foreground-400 truncate">{selectedOption.meta}</p> : null}
      {open && createPortal((
        <div
          ref={menuRef}
          className="fixed z-[10020] overflow-hidden rounded-2xl border border-background-200 bg-background-50 p-2 shadow-2xl"
          style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width, maxHeight: menuPosition.maxHeight }}
          role="listbox"
        >
          <div className="relative mb-2">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              autoFocus
              placeholder={`Search ${label.toLowerCase()}...`}
              className="h-10 w-full rounded-xl border border-background-200 bg-background-50 pl-9 pr-3 text-[13px] font-medium text-foreground-900 outline-none transition-smooth placeholder:text-foreground-300 focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div className="space-y-1 overflow-y-auto overflow-x-hidden pr-1" style={{ maxHeight: Math.max(150, menuPosition.maxHeight - 58) }}>
            {!required ? (
              <button
                type="button"
                onClick={() => choose('')}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-smooth ${!value ? 'bg-primary-50 text-primary-700' : 'hover:bg-background-100 text-foreground-700'}`}
                role="option"
                aria-selected={!value}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-400">
                  <i className="ri-close-circle-line text-sm"></i>
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{placeholder}</span>
                {!value ? <i className="ri-check-line shrink-0 text-primary-600"></i> : null}
              </button>
            ) : null}
            {filteredOptions.map(option => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => choose(option.value)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-smooth ${selected ? 'bg-primary-50 text-primary-700' : 'hover:bg-background-100 text-foreground-700'}`}
                  role="option"
                  aria-selected={selected}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-500">
                    {option.color ? <span className="h-4 w-4 rounded-[5px] ring-1 ring-black/10" style={{ backgroundColor: option.color }} /> : <i className="ri-arrow-right-up-line text-sm"></i>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold" title={option.label}>{option.label}</span>
                    {option.meta ? <span className="mt-0.5 block truncate text-[11px] font-medium text-foreground-400" title={option.meta}>{option.meta}</span> : null}
                  </span>
                  {selected ? <i className="ri-check-line shrink-0 text-primary-600"></i> : null}
                </button>
              );
            })}
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-5 text-center text-[12px] font-medium text-foreground-500">
                No matching options found.
              </div>
            ) : null}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

function WeekdayMultiSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = selectedWeekDays(value);
  const toggle = (day: string) => {
    const exists = selected.some(item => normalise(item) === normalise(day));
    const next = exists ? selected.filter(item => normalise(item) !== normalise(day)) : [...selected, day];
    onChange(next.join(', '));
  };

  return (
    <fieldset className="block">
      <legend className="text-[10px] font-bold text-foreground-500 uppercase tracking-wide">Week days</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5 rounded-xl border border-foreground-200/70 bg-background-50 p-1.5 shadow-sm">
        {WEEKDAY_OPTIONS.map(day => {
          const checked = selected.some(item => normalise(item) === normalise(day));
          return (
            <button
              key={day}
              type="button"
              aria-pressed={checked}
              onClick={() => toggle(day)}
              className={`h-8 min-w-12 rounded-lg border px-2.5 text-[11px] font-bold transition-smooth ${checked ? 'border-primary-300 bg-primary-500 text-white shadow-sm' : 'border-transparent bg-background-100 text-foreground-600 hover:bg-background-200'}`}
            >
              {day.slice(0, 3)}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-foreground-400">{selected.length ? `${selected.join(', ')} selected` : 'No delivery days selected'}</p>
    </fieldset>
  );
}

function normaliseHex(value: string, fallback = '#6941c6') {
  const candidate = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate;
  if (/^[0-9a-f]{6}$/i.test(candidate)) return `#${candidate}`;
  return fallback;
}

function ColorField({ label, value, onChange, compact = false }: { label: string; value: string; onChange: (value: string) => void; compact?: boolean }) {
  const color = normaliseHex(value);
  const swatchSize = compact ? 'w-9 h-9 rounded-lg' : 'w-11 h-11 rounded-xl';
  return (
    <div>
      <span className="text-[10px] font-bold text-foreground-500 uppercase tracking-wide">{label}</span>
      <div className={`mt-1.5 rounded-xl border border-foreground-200/70 bg-background-50 shadow-sm ${compact ? 'p-1.5' : 'p-2'}`}>
        <div className="flex items-center gap-2.5">
          <label className={`relative border border-black/10 shadow-sm cursor-pointer overflow-hidden shrink-0 ring-1 ring-white ${swatchSize}`} style={{ backgroundColor: color }} title="Pick colour">
            <input type="color" value={color} onChange={event => onChange(event.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
          </label>
          <div className="flex-1 min-w-0">
            <input
              value={(value || color).toUpperCase()}
              onChange={event => onChange(normaliseHex(event.target.value, event.target.value))}
              onBlur={event => onChange(normaliseHex(event.target.value))}
              className={`${compact ? 'h-9' : 'h-10'} w-full px-3 rounded-lg border border-background-200 bg-background-100 text-[12px] font-bold text-foreground-800 font-mono focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-smooth`}
              placeholder="#6941C6"
            />
          </div>
        </div>
        <div className={`${compact ? 'mt-1.5' : 'mt-2'} flex items-center gap-1.5 flex-wrap`}>
          {COLOR_PRESETS.map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              className={`${compact ? 'w-5 h-5 rounded-md' : 'w-6 h-6 rounded-lg'} border transition-smooth ${normaliseHex(value).toLowerCase() === preset ? 'border-foreground-950 ring-2 ring-primary-200 scale-105' : 'border-black/10 hover:scale-105 hover:ring-2 hover:ring-background-200'}`}
              style={{ backgroundColor: preset }}
              aria-label={`Use colour ${preset}`}
              title={preset.toUpperCase()}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function normalise(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function staffName(profile: CurriculumStaffProfile) {
  return String(profile.name || profile.Tutor_name || profile.Coach_name || profile.email || '').trim();
}

function uniqueStaffNames(profiles: CurriculumStaffProfile[] = []) {
  const names = new Map<string, string>();
  profiles.forEach(profile => {
    const name = staffName(profile);
    const key = normalise(name);
    if (!key || key === 'unassigned' || names.has(key)) return;
    names.set(key, name);
  });
  return Array.from(names.values()).sort((left, right) => left.localeCompare(right));
}

function staffOptions(names: string[]): SelectOption[] {
  return names.map(name => ({ value: name, label: name }));
}

function moduleOptions(items: CurriculumModule[] = []): SelectOption[] {
  const options = new Map<string, SelectOption>();
  items.forEach(item => {
    const name = String(item.name || '').trim();
    const key = normalise(name);
    if (!key || options.has(key)) return;
    const meta = [item.programme, item.cohort, item.weeks ? `${item.weeks} sessions` : ''].filter(Boolean).join(' - ');
    options.set(key, { value: name, label: name, meta, color: item.color });
  });
  return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function selectedWeekDays(value: string) {
  const source = String(value || '').toLowerCase();
  return WEEKDAY_OPTIONS.filter(day => source.includes(day.toLowerCase()));
}

function matchesProgramme(programme: CurriculumProgramme, value: unknown) {
  const key = normalise(value);
  return [programme.id, programme.sourceId, programme.name, programme.standard].some(candidate => normalise(candidate) === key);
}

function cleanEditorNotes(value: unknown) {
  return String(value || '')
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('__'))
    .join('\n')
    .trim();
}

function ProgrammeStructureEditor({
  programme,
  onClose,
  onSaved,
  onOpenAddStructure,
}: {
  programme: CurriculumProgramme;
  onClose: () => void;
  onSaved: () => void;
  onOpenAddStructure: () => void;
}) {
  const { data, loading, error, reload } = useCurriculumData();
  const [tab, setTab] = useState<'programme' | 'cohorts' | 'groups' | 'modules'>('programme');
  const [notice, setNotice] = useState<string | null>(null);

  const liveProgramme = data?.programmes.find(item => matchesProgramme(programme, item.id) || matchesProgramme(programme, item.sourceId) || matchesProgramme(programme, item.name)) ?? programme;
  const cohorts = useMemo(() => (data?.cohorts ?? []).filter(cohort => matchesProgramme(liveProgramme, cohort.programmeId) || matchesProgramme(liveProgramme, cohort.programme)), [data?.cohorts, liveProgramme]);
  const cohortIds = useMemo(() => new Set(cohorts.map(cohort => cohort.id)), [cohorts]);
  const groups = useMemo(() => (data?.groups ?? []).filter(group => cohortIds.has(group.cohortId) || matchesProgramme(liveProgramme, group.programme)), [cohortIds, data?.groups, liveProgramme]);
  const modules = useMemo(() => (data?.modules ?? []).filter(module => matchesProgramme(liveProgramme, module.programme)), [data?.modules, liveProgramme]);
  const sessions = data?.sessions ?? [];
  const tutorOptions = useMemo(() => staffOptions(uniqueStaffNames(data?.tutors ?? [])), [data?.tutors]);
  const coachOptions = useMemo(() => staffOptions(uniqueStaffNames(data?.coaches ?? [])), [data?.coaches]);
  const catalogueModuleOptions = useMemo(() => moduleOptions(data?.modules ?? []), [data?.modules]);

  const refresh = async (message: string) => {
    await reload();
    onSaved();
    setNotice(message);
    showProgrammeSwalToast('Saved', message);
  };

  const tabs = [
    { key: 'programme' as const, label: 'Programme', count: 1 },
    { key: 'cohorts' as const, label: 'Cohorts', count: cohorts.length },
    { key: 'groups' as const, label: 'Groups', count: groups.length },
    { key: 'modules' as const, label: 'Modules', count: modules.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md p-4" onClick={onClose}>
      <div className="bg-background-50 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col border border-white/70" onClick={event => event.stopPropagation()}>
        <div className="px-6 py-5 border-b border-foreground-200/70 flex items-center justify-between gap-4 bg-gradient-to-r from-background-50 via-background-50 to-primary-50/50">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Curriculum Structure Editor</p>
            <h3 className="text-xl font-heading font-bold text-foreground-950 mt-1">{liveProgramme.name}</h3>
            <p className="text-[12px] text-foreground-500 mt-1">Manage programme details, cohorts, groups, modules, dates, staff and delivery settings.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <SummaryPill icon="ri-group-line" label={`${cohorts.length} cohorts`} />
              <SummaryPill icon="ri-team-line" label={`${groups.length} groups`} />
              <SummaryPill icon="ri-stack-line" label={`${modules.length} modules`} />
              <SummaryPill icon="ri-database-2-line" label="Live LMS data" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onOpenAddStructure} className="px-4 py-2.5 rounded-lg bg-emerald-500 text-white text-[12px] font-bold hover:bg-emerald-600 transition-smooth shadow-sm">
              <i className="ri-add-line mr-1"></i>Add Structure
            </button>
            <button onClick={onClose} className="w-9 h-9 rounded-lg bg-background-100 border border-background-200 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer">
              <i className="ri-close-line text-foreground-500"></i>
            </button>
          </div>
        </div>

        <div className="px-6 py-3 border-b border-foreground-200/60 flex items-center gap-2 overflow-x-auto bg-background-100/60">
          {tabs.map(item => (
            <button key={item.key} onClick={() => setTab(item.key)} className={`px-3.5 py-2 rounded-lg text-[12px] font-bold transition-smooth whitespace-nowrap border ${tab === item.key ? 'bg-primary-500 text-white border-primary-500 shadow-sm' : 'bg-background-50 text-foreground-600 border-background-200 hover:border-primary-200 hover:text-primary-700'}`}>
              {item.label} <span className="opacity-70">({item.count})</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading && <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-[12px] font-medium text-primary-700">Loading live curriculum structure...</div>}
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">{error}</div>}
          {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] font-medium text-emerald-700">{notice}</div>}

          {tab === 'programme' && <ProgrammeEditorForm programme={liveProgramme} onSaved={() => refresh('Programme details saved.')} />}

          {tab === 'cohorts' && (
            <div className="space-y-3">
              {cohorts.map(cohort => <CohortEditorRow key={cohort.id} cohort={cohort} onSaved={() => refresh('Cohort saved.')} />)}
              {!cohorts.length && <EmptyStructure label="No cohorts linked to this programme yet." />}
            </div>
          )}

          {tab === 'groups' && (
            <div className="space-y-3">
              {groups.map(group => <GroupEditorRow key={group.id} group={group} tutors={tutorOptions} coaches={coachOptions} onSaved={() => refresh('Group saved.')} />)}
              {!groups.length && <EmptyStructure label="No groups linked to this programme yet." />}
            </div>
          )}

          {tab === 'modules' && (
            <div className="space-y-3">
              {modules.map(module => (
                <ModuleEditorRow
                  key={module.id}
                  module={module}
                  sessions={sessions.filter(session => normalise(session.module) === normalise(module.name) && matchesProgramme(liveProgramme, session.programme))}
                  moduleOptions={catalogueModuleOptions}
                  tutors={tutorOptions}
                  coaches={coachOptions}
                  onSaved={() => refresh('Module saved.')}
                />
              ))}
              {!modules.length && <EmptyStructure label="No modules linked to this programme yet." />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyStructure({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-foreground-200 bg-background-100/70 px-4 py-10 text-center">
      <span className="mx-auto mb-3 flex w-11 h-11 items-center justify-center rounded-xl bg-background-50 border border-background-200 text-primary-600 shadow-sm">
        <i className="ri-stack-line text-lg"></i>
      </span>
      <p className="text-[13px] font-semibold text-foreground-700">{label}</p>
    </div>
  );
}

function EditorCardHeader({
  icon,
  title,
  meta,
  color,
  actions,
}: {
  icon: string;
  title: string;
  meta: string;
  color?: string;
  actions: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-background-200/70 bg-background-100/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: normaliseHex(color || '#6941c6') }}>
          <i className={`${icon} text-base`}></i>
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-heading font-bold text-foreground-950">{title || 'Untitled'}</p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-foreground-500">{meta || 'No schedule details yet'}</p>
        </div>
      </div>
      {actions}
    </div>
  );
}

function SummaryPill({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-background-200 bg-background-50 px-2.5 text-[11px] font-bold text-foreground-600 shadow-sm">
      <i className={`${icon} text-[13px] text-primary-600`}></i>
      {label}
    </span>
  );
}

function ProgrammeEditorForm({ programme, onSaved }: { programme: CurriculumProgramme; onSaved: () => Promise<void> | void }) {
  const [form, setForm] = useState<ProgrammeFormState>({
    name: programme.name,
    standard: programme.standard,
    level: programme.level || '',
    color: programme.color || '#6941c6',
    description: programme.description || '',
  });
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await updateCurriculumProgramme(programme.sourceId || programme.id, form);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="rounded-2xl border border-foreground-200/70 bg-background-50 p-5 space-y-5 shadow-sm">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Programme name" value={form.name} onChange={value => setForm(prev => ({ ...prev, name: value }))} required />
        <Field label="Standard" value={form.standard} onChange={value => setForm(prev => ({ ...prev, standard: value }))} />
        <Field label="Level" value={form.level} onChange={value => setForm(prev => ({ ...prev, level: value }))} placeholder="Example: L4" />
        <div>
          <ColorField label="Colour" value={form.color} onChange={value => setForm(prev => ({ ...prev, color: value }))} />
        </div>
      </div>
      <TextAreaField label="Description" value={form.description} onChange={value => setForm(prev => ({ ...prev, description: value }))} rows={4} />
      <div className="flex justify-end pt-1">
        <button type="submit" disabled={saving || !form.name.trim()} className="px-5 py-2.5 rounded-lg bg-primary-500 text-white text-[12px] font-bold hover:bg-primary-600 disabled:opacity-50 shadow-sm transition-smooth">{saving ? 'Saving...' : 'Save Programme'}</button>
      </div>
    </form>
  );
}

function CohortEditorRow({ cohort, onSaved }: { cohort: CurriculumCohort; onSaved: () => Promise<void> | void }) {
  const [form, setForm] = useState({ name: cohort.name, startDate: cohort.startDate || '', endDate: cohort.endDate || '', color: cohort.color || '#6941c6' });
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await updateCurriculumCohort(cohort.id, form);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await archiveCurriculumCohort(cohort.id);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form onSubmit={save} className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
        <EditorCardHeader
          icon="ri-calendar-event-line"
          title={form.name || cohort.name}
          meta={[form.startDate || 'No start date', form.endDate || 'No end date', cohort.status].filter(Boolean).join(' - ')}
          color={form.color}
          actions={<RowActions saving={saving} onDelete={() => setConfirmArchive(true)} />}
        />
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[1.4fr_1fr_1fr_240px] md:items-start">
          <Field label="Cohort name" value={form.name} onChange={value => setForm(prev => ({ ...prev, name: value }))} required />
          <Field label="Start date" type="date" value={form.startDate} onChange={value => setForm(prev => ({ ...prev, startDate: value }))} />
          <Field label="End date" type="date" value={form.endDate} onChange={value => setForm(prev => ({ ...prev, endDate: value }))} />
          <ColorField label="Colour" value={form.color} onChange={value => setForm(prev => ({ ...prev, color: value }))} compact />
        </div>
      </form>
      <ArchiveConfirmDialog
        open={confirmArchive}
        title="Archive cohort?"
        body="This will hide the cohort from active planning. Its groups, modules and KSB mappings will remain stored for history and reporting."
        confirmLabel="Archive Cohort"
        onCancel={() => setConfirmArchive(false)}
        onConfirm={async () => {
          await remove();
          setConfirmArchive(false);
        }}
      />
    </>
  );
}

function GroupEditorRow({ group, tutors, coaches, onSaved }: { group: CurriculumGroup; tutors: SelectOption[]; coaches: SelectOption[]; onSaved: () => Promise<void> | void }) {
  const [form, setForm] = useState({
    name: group.name,
    tutor: group.tutor === 'Unassigned' ? '' : group.tutor || '',
    coach: group.coach === 'Unassigned' ? '' : group.coach || '',
    weekDays: group.schedule || '',
    startTime: '',
    endTime: '',
  });
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await updateCurriculumGroup(group.id, form);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await archiveCurriculumGroup(group.id);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form onSubmit={save} className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
        <EditorCardHeader
          icon="ri-team-line"
          title={form.name || group.name}
          meta={[form.coach ? `Coach: ${form.coach}` : 'No coach', form.tutor ? `Tutor: ${form.tutor}` : 'No tutor', selectedWeekDays(form.weekDays).join(', ') || 'No days'].join(' - ')}
          color="#1f2a44"
          actions={<RowActions saving={saving} onDelete={() => setConfirmArchive(true)} />}
        />
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
          <Field label="Group name" value={form.name} onChange={value => setForm(prev => ({ ...prev, name: value }))} required />
          <ChoiceSelect label="Coach" value={form.coach} onChange={value => setForm(prev => ({ ...prev, coach: value }))} options={coaches} placeholder="Select coach..." />
          <ChoiceSelect label="Tutor" value={form.tutor} onChange={value => setForm(prev => ({ ...prev, tutor: value }))} options={tutors} placeholder="Select tutor..." />
          <WeekdayMultiSelect value={form.weekDays} onChange={value => setForm(prev => ({ ...prev, weekDays: value }))} />
          <Field label="Start time" type="time" value={form.startTime} onChange={value => setForm(prev => ({ ...prev, startTime: value }))} />
          <Field label="End time" type="time" value={form.endTime} onChange={value => setForm(prev => ({ ...prev, endTime: value }))} />
        </div>
      </form>
      <ArchiveConfirmDialog
        open={confirmArchive}
        title="Archive group?"
        body="Archiving this group will hide its module schedule from active planning. Existing module records will remain stored."
        confirmLabel="Archive Group"
        onCancel={() => setConfirmArchive(false)}
        onConfirm={async () => {
          await remove();
          setConfirmArchive(false);
        }}
      />
    </>
  );
}

function ModuleEditorRow({
  module,
  sessions,
  moduleOptions: availableModules,
  tutors,
  coaches,
  onSaved,
}: {
  module: CurriculumModule;
  sessions: CurriculumSession[];
  moduleOptions: SelectOption[];
  tutors: SelectOption[];
  coaches: SelectOption[];
  onSaved: () => Promise<void> | void;
}) {
  const sortedSessions = [...sessions].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const firstSession = sortedSessions[0];
  const lastSession = sortedSessions[sortedSessions.length - 1];
  const [form, setForm] = useState({
    name: module.name,
    weeks: String(module.weeks || 1),
    color: module.color || '#6941c6',
    notes: cleanEditorNotes(module.notes),
    startDate: firstSession?.date || '',
    endDate: lastSession?.date || '',
    tutor: firstSession?.tutor || '',
    coach: '',
    weekDays: firstSession?.day || '',
    startTime: firstSession?.startTime || '',
    endTime: firstSession?.endTime || '',
  });
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const selectModule = (value: string) => {
    const selected = availableModules.find(option => option.value === value);
    setForm(prev => ({
      ...prev,
      name: value,
      color: selected?.color || prev.color,
      weeks: selected?.meta?.match(/(\d+)\s+sessions/)?.[1] || prev.weeks,
    }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await updateCurriculumModule(module.id, {
        ...form,
        weeks: Number(form.weeks) || 1,
        notes: cleanEditorNotes(form.notes),
      });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await archiveCurriculumModule(module.id);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form onSubmit={save} className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
        <EditorCardHeader
          icon="ri-book-open-line"
          title={form.name || module.name}
          meta={[`${form.weeks || 0} sessions`, form.startDate || 'No start', form.endDate || 'No end', form.tutor ? `Tutor: ${form.tutor}` : 'No tutor'].join(' - ')}
          color={form.color}
          actions={<RowActions saving={saving} onDelete={() => setConfirmArchive(true)} />}
        />
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4 md:items-start">
          <div className="md:col-span-2"><ChoiceSelect label="Module" value={form.name} onChange={selectModule} options={availableModules} placeholder="Select module..." required /></div>
          <Field label="Sessions / weeks" type="number" value={form.weeks} onChange={value => setForm(prev => ({ ...prev, weeks: value }))} />
          <ColorField label="Colour" value={form.color} onChange={value => setForm(prev => ({ ...prev, color: value }))} compact />
          <ChoiceSelect label="Tutor" value={form.tutor} onChange={value => setForm(prev => ({ ...prev, tutor: value }))} options={tutors} placeholder="Select tutor..." />
          <ChoiceSelect label="Coach" value={form.coach} onChange={value => setForm(prev => ({ ...prev, coach: value }))} options={coaches} placeholder="Select coach..." />
          <Field label="Start date" type="date" value={form.startDate} onChange={value => setForm(prev => ({ ...prev, startDate: value }))} />
          <Field label="End date" type="date" value={form.endDate} onChange={value => setForm(prev => ({ ...prev, endDate: value }))} />
          <WeekdayMultiSelect value={form.weekDays} onChange={value => setForm(prev => ({ ...prev, weekDays: value }))} />
          <Field label="Start time" type="time" value={form.startTime} onChange={value => setForm(prev => ({ ...prev, startTime: value }))} />
          <Field label="End time" type="time" value={form.endTime} onChange={value => setForm(prev => ({ ...prev, endTime: value }))} />
          <div className="md:col-span-4">
            <TextAreaField label="Notes" value={form.notes} onChange={value => setForm(prev => ({ ...prev, notes: value }))} rows={2} />
          </div>
        </div>
      </form>
      <ArchiveConfirmDialog
        open={confirmArchive}
        title="Archive module?"
        body="This removes the module from active planning for this group only. The module catalogue item will not be deleted."
        confirmLabel="Archive Module"
        onCancel={() => setConfirmArchive(false)}
        onConfirm={async () => {
          await remove();
          setConfirmArchive(false);
        }}
      />
    </>
  );
}

function RowActions({ saving, onDelete, align = 'end' }: { saving: boolean; onDelete: () => void; align?: 'end' | 'right' }) {
  return (
    <div className={`flex items-end gap-2 ${align === 'right' ? 'justify-end' : ''}`}>
      <button type="submit" disabled={saving} className="h-10 px-4 rounded-lg bg-primary-500 text-white text-[12px] font-bold hover:bg-primary-600 disabled:opacity-50 shadow-sm transition-smooth">
        {saving ? 'Saving...' : <><i className="ri-save-3-line mr-1"></i>Save</>}
      </button>
      <button type="button" onClick={onDelete} disabled={saving} className="h-10 px-4 rounded-lg bg-red-50 text-red-600 border border-red-200/70 text-[12px] font-bold hover:bg-red-100 disabled:opacity-50 transition-smooth">
        <i className="ri-archive-line mr-1"></i>Archive
      </button>
    </div>
  );
}

function ArchiveConfirmDialog({
  open,
  title,
  body,
  warning,
  confirmLabel,
  successTitle,
  successText,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  warning?: string;
  confirmLabel: string;
  successTitle?: string;
  successText?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const activeAlertRef = useRef(false);
  const configRef = useRef({ title, body, warning, confirmLabel, successTitle, successText, onCancel, onConfirm });
  configRef.current = { title, body, warning, confirmLabel, successTitle, successText, onCancel, onConfirm };

  useEffect(() => {
    if (!open || activeAlertRef.current) return;

    activeAlertRef.current = true;
    const config = configRef.current;
    const permanent = config.title.toLowerCase().includes('permanent') || config.confirmLabel.toLowerCase().includes('permanent');
    const helperText = config.warning
      ? `${config.body} ${config.warning}`
      : permanent
        ? `${config.body} This cannot be undone.`
        : `${config.body} This is not a permanent delete.`;

    showCurriculumConfirm({
      title: config.title,
      text: helperText,
      icon: 'warning',
      confirmButtonText: config.confirmLabel,
      cancelButtonText: 'Cancel',
      successTitle: config.successTitle,
      successText: config.successText,
      onConfirm: configRef.current.onConfirm,
    }).finally(() => {
      activeAlertRef.current = false;
      configRef.current.onCancel();
    });
  }, [open]);

  return null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] text-foreground-400 uppercase">{label}</p>
      <p className="text-sm font-semibold text-foreground-900">{value}</p>
    </div>
  );
}

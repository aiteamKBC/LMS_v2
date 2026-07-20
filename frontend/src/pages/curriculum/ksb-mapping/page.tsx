import { useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ListSkeleton } from '@/components/feature/CurriculumSkeletons';
import { useCurriculumKsbFrameworks } from '@/hooks/useCurriculumKsbFrameworks';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  fetchCurriculumKsbCoverage,
  type CurriculumKsbCoverageItem,
  type CurriculumKsbCoverageResponse,
  type CurriculumKsbCoverageStatus,
  type CurriculumKsbCoverageSummaryBucket,
} from '@/lib/curriculumApi';

type KsbGroupKey = 'knowledge' | 'skill' | 'behaviour';

const groupConfig: Record<KsbGroupKey, { label: string; icon: string; bg: string; text: string }> = {
  knowledge: { label: 'Knowledge', icon: 'ri-book-open-line', bg: 'bg-primary-100', text: 'text-primary-700' },
  skill: { label: 'Skills', icon: 'ri-tools-line', bg: 'bg-amber-100', text: 'text-amber-700' },
  behaviour: { label: 'Behaviours', icon: 'ri-user-heart-line', bg: 'bg-emerald-100', text: 'text-emerald-700' },
};

const statusLabels: Record<CurriculumKsbCoverageStatus, string> = {
  missing: 'Missing',
  partial: 'Partial',
  fully_covered: 'Fully covered',
  over_allocated: 'Over-allocated',
};

function statusClass(status: CurriculumKsbCoverageStatus) {
  if (status === 'fully_covered') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'over_allocated') return 'bg-red-100 text-red-700 border-red-200';
  if (status === 'partial') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-foreground-100 text-foreground-600 border-foreground-200';
}

function numberText(value: number) {
  return new Intl.NumberFormat('en-GB').format(value || 0);
}

function filterMatches(item: CurriculumKsbCoverageItem, search: string, type: string, status: string, moduleFilter: string, weekFilter: string, classification: string, source: string) {
  const query = search.trim().toLowerCase();
  const haystack = `${item.code} ${item.title} ${item.description}`.toLowerCase();
  const mappings = item.mappings || [];
  if (query && !haystack.includes(query)) return false;
  if (type !== 'all' && item.ksb_type !== type) return false;
  if (status !== 'all' && item.status !== status) return false;
  if (moduleFilter !== 'all' && !mappings.some(mapping => mapping.module_id === moduleFilter || mapping.module_name === moduleFilter)) return false;
  if (weekFilter !== 'all' && !mappings.some(mapping => mapping.week_id === weekFilter || mapping.week_name === weekFilter)) return false;
  if (classification !== 'all' && !mappings.some(mapping => mapping.classification === classification)) return false;
  if (source !== 'all' && `${item.source_type}:${item.source_id}` !== source) return false;
  return true;
}

export default function KSBMapping() {
  const { frameworks, loading: frameworksLoading, error: frameworksError } = useCurriculumKsbFrameworks();
  const [selectedFrameworkId, setSelectedFrameworkId] = useState('');
  const [coverage, setCoverage] = useState<CurriculumKsbCoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [weekFilter, setWeekFilter] = useState('all');
  const [classificationFilter, setClassificationFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');

  const activeFrameworks = useMemo(() => frameworks.filter(framework => framework.status !== 'archived'), [frameworks]);
  const selectedFramework = useMemo(() => frameworks.find(framework => framework.id === selectedFrameworkId), [frameworks, selectedFrameworkId]);

  useEffect(() => {
    if (!selectedFrameworkId && activeFrameworks.length > 0) setSelectedFrameworkId(activeFrameworks[0].id);
  }, [activeFrameworks, selectedFrameworkId]);

  useEffect(() => {
    const controller = new AbortController();
    setCoverageLoading(true);
    setCoverageError(null);
    const sourceParams = selectedFrameworkId ? { sourceType: 'framework', sourceId: selectedFrameworkId } : {};
    fetchCurriculumKsbCoverage(sourceParams, controller.signal)
      .then(result => setCoverage(result))
      .catch(error => {
        if (controller.signal.aborted) return;
        setCoverageError(error instanceof Error ? error.message : 'Unable to load KSB coverage');
        setCoverage(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCoverageLoading(false);
      });
    return () => controller.abort();
  }, [selectedFrameworkId]);

  const items = coverage?.items || [];
  const filtered = useMemo(() => items.filter(item => filterMatches(item, search, typeFilter, statusFilter, moduleFilter, weekFilter, classificationFilter, sourceFilter)), [classificationFilter, items, moduleFilter, search, sourceFilter, statusFilter, typeFilter, weekFilter]);
  const grouped = useMemo(() => ({
    knowledge: filtered.filter(item => item.ksb_type === 'knowledge'),
    skill: filtered.filter(item => item.ksb_type === 'skill'),
    behaviour: filtered.filter(item => item.ksb_type === 'behaviour'),
  }), [filtered]);
  const moduleOptions = useMemo(() => uniqueOptions(items.flatMap(item => item.mappings.map(mapping => ({ value: mapping.module_id, label: mapping.module_name || mapping.module_id })))), [items]);
  const weekOptions = useMemo(() => uniqueOptions(items.flatMap(item => item.mappings.map(mapping => ({ value: mapping.week_id, label: mapping.week_name || mapping.week_id })))), [items]);
  const sourceOptions = useMemo(() => uniqueOptions(items.map(item => ({ value: `${item.source_type}:${item.source_id}`, label: `${item.source_type || 'legacy'}:${item.source_id || 'unknown'}` }))), [items]);
  const loading = frameworksLoading || coverageLoading;
  const error = frameworksError || coverageError;

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="KSB Coverage"
      pageSubtitle="Weighted curriculum coverage and traceability from planned component mappings."
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="p-6 space-y-5">
        <section className="overflow-hidden rounded-2xl border border-primary-900/20 bg-primary-950 text-white">
          <div className="p-6 sm:p-7">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="font-heading text-xl font-bold">Planned KSB coverage</h2>
                <p className="mt-1 text-[13px] font-medium text-white/80">
                  {selectedFramework ? `${selectedFramework.name} - ${items.length} required KSBs` : 'Select a KSB framework to compare required KSBs against planned curriculum mappings.'}
                </p>
              </div>
              <select value={selectedFrameworkId} onChange={event => setSelectedFrameworkId(event.target.value)} className="h-10 rounded-lg border border-white/20 bg-white/10 px-3 text-[12px] font-bold text-white outline-none">
                <option value="" className="text-foreground-900">All mapped KSBs</option>
                {activeFrameworks.map(framework => (
                  <option key={framework.id} value={framework.id} className="text-foreground-900">{framework.name}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">Curriculum API error: {error}</div>}

        {coverage?.summary && <SummaryPanel summary={coverage.summary.overall} />}

        <section className="rounded-xl border border-background-200 bg-background-50 p-4">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(14rem,1fr)_9rem_10rem_12rem_12rem_10rem_12rem]">
            <label className="relative block">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search code, title or description..." className="h-10 w-full rounded-lg border border-foreground-200/70 bg-white pl-9 pr-3 text-[13px] outline-none focus:border-primary-300" />
            </label>
            <Select value={typeFilter} onChange={setTypeFilter} options={[['all', 'All types'], ['knowledge', 'Knowledge'], ['skill', 'Skills'], ['behaviour', 'Behaviours']]} />
            <Select value={statusFilter} onChange={setStatusFilter} options={[['all', 'All statuses'], ['missing', 'Missing'], ['partial', 'Partial'], ['fully_covered', 'Full'], ['over_allocated', 'Over']]} />
            <Select value={moduleFilter} onChange={setModuleFilter} options={[['all', 'All modules'], ...moduleOptions]} />
            <Select value={weekFilter} onChange={setWeekFilter} options={[['all', 'All weeks'], ...weekOptions]} />
            <Select value={classificationFilter} onChange={setClassificationFilter} options={[['all', 'All classes'], ['main', 'Main'], ['secondary', 'Secondary'], ['possible', 'Possible']]} />
            <Select value={sourceFilter} onChange={setSourceFilter} options={[['all', 'All sources'], ...sourceOptions]} />
          </div>
        </section>

        {loading ? (
          <ListSkeleton count={6} />
        ) : !items.length ? (
          <EmptyState title="No KSB coverage yet" message="Add component KSB mappings in Module Builder, or select a framework with required KSB definitions." />
        ) : filtered.length === 0 ? (
          <EmptyState title="No KSBs match" message="Adjust the filters to see more planned coverage." />
        ) : (
          <div className="space-y-4">
            {(Object.keys(grouped) as KsbGroupKey[]).map(group => (
              <CoverageGroup key={group} group={group} items={grouped[group]} />
            ))}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function SummaryPanel({ summary }: { summary: CurriculumKsbCoverageSummaryBucket }) {
  const cards = [
    ['Required', summary.required, 'ri-list-check-3'],
    ['Fully covered', summary.fully_covered, 'ri-checkbox-circle-line'],
    ['Partial', summary.partial, 'ri-pie-chart-line'],
    ['Missing', summary.missing, 'ri-error-warning-line'],
    ['Over-allocated', summary.over_allocated, 'ri-alert-line'],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {cards.map(([label, value, icon]) => (
        <div key={label} className="rounded-xl border border-background-200 bg-background-50 p-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-100 text-primary-700"><i className={icon}></i></span>
            <p className="text-[10px] font-bold uppercase text-foreground-400">{label}</p>
          </div>
          <p className="mt-2 text-2xl font-black text-foreground-950">{numberText(value)}</p>
        </div>
      ))}
    </div>
  );
}

function CoverageGroup({ group, items }: { group: KsbGroupKey; items: CurriculumKsbCoverageItem[] }) {
  const [open, setOpen] = useState(true);
  const config = groupConfig[group];
  if (!items.length) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-background-200 bg-background-50">
      <button onClick={() => setOpen(prev => !prev)} className="flex w-full items-center gap-3 bg-background-100/70 px-4 py-3 text-left">
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${config.bg} ${config.text}`}><i className={config.icon}></i></span>
        <div className="flex-1">
          <h3 className="text-sm font-heading font-bold text-foreground-900">{config.label}</h3>
          <p className="text-[11px] text-foreground-400">{items.length} KSBs</p>
        </div>
        <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>
      {open && <div className="space-y-3 p-4">{items.map(item => <KsbCoverageCard key={`${item.source_id}-${item.code}`} item={item} />)}</div>}
    </section>
  );
}

function KsbCoverageCard({ item }: { item: CurriculumKsbCoverageItem }) {
  const status = item.status;
  const progress = Math.min(Math.max(Number(item.raw_total_weight || 0), 0), 100);
  return (
    <article className="rounded-xl border border-background-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-background-100 px-2 py-1 font-mono text-[11px] font-black text-foreground-900">{item.code}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusClass(status)}`}>{statusLabels[status] || status}</span>
            <span className="rounded-full bg-background-100 px-2 py-0.5 text-[9px] font-bold capitalize text-foreground-600">{item.ksb_type}</span>
          </div>
          <h4 className="mt-2 text-sm font-bold text-foreground-950">{item.title || item.code}</h4>
          {item.description && <p className="mt-1 text-[12px] leading-relaxed text-foreground-600">{item.description}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[28rem]">
          <Mini label="Weight" value={`${item.raw_total_weight}%`} danger={status === 'over_allocated'} />
          <Mini label="Occurrences" value={numberText(item.occurrence_count)} />
          <Mini label="Components" value={numberText(item.component_count)} />
          <Mini label="Modules" value={numberText(item.module_count)} />
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-background-200">
        <div className={`h-full rounded-full ${status === 'over_allocated' ? 'bg-red-500' : status === 'fully_covered' ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${progress}%` }} />
      </div>
      {status === 'over_allocated' && <p className="mt-2 text-[11px] font-bold text-red-700">{item.code} is over-allocated at {item.raw_total_weight}%.</p>}
      {status === 'missing' ? (
        <p className="mt-3 rounded-lg border border-dashed border-background-300 bg-background-50 px-3 py-2 text-[11px] font-semibold text-foreground-500">Missing - 0% planned coverage and 0 occurrences.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {item.mappings.map(mapping => (
            <div key={mapping.mapping_id} className="grid gap-2 rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[11px] text-foreground-700 lg:grid-cols-[1fr_1fr_1fr_auto_auto]">
              <span className="font-bold text-foreground-900">{mapping.module_name || mapping.module_id}</span>
              <span>{mapping.week_name || mapping.week_id}</span>
              <span>{mapping.component_name || mapping.component_id} <span className="text-foreground-400">({mapping.component_type})</span></span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold capitalize">{mapping.classification}</span>
              <span className="font-black text-foreground-950">{mapping.weight}%</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function Mini({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${danger ? 'bg-red-50 text-red-700' : 'bg-background-100 text-foreground-900'}`}>
      <p className="text-[9px] font-bold uppercase opacity-70">{label}</p>
      <p className="text-sm font-black">{value}</p>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[][] }) {
  return (
    <select value={value} onChange={event => onChange(event.target.value)} className="h-10 rounded-lg border border-foreground-200/70 bg-white px-3 text-[12px] font-bold text-foreground-700 outline-none focus:border-primary-300">
      {options.map(([optionValue, label]) => <option key={`${optionValue}-${label}`} value={optionValue}>{label}</option>)}
    </select>
  );
}

function uniqueOptions(options: Array<{ value: string; label: string }>) {
  const seen = new Set<string>();
  return options
    .filter(option => option.value && option.label)
    .filter(option => {
      if (seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    })
    .map(option => [option.value, option.label]);
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-background-300 bg-background-50 px-6 py-14 text-center">
      <i className="ri-search-eye-line text-3xl text-foreground-300"></i>
      <h3 className="mt-3 text-sm font-heading font-bold text-foreground-800">{title}</h3>
      <p className="mt-1 text-sm text-foreground-500">{message}</p>
    </div>
  );
}

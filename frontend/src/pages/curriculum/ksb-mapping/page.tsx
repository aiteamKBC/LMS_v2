import { Fragment, useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ListSkeleton, TableRowsSkeleton } from '@/components/feature/CurriculumSkeletons';
import { useCurriculumKsbFrameworks } from '@/hooks/useCurriculumKsbFrameworks';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  fetchCurriculumKsbCoverage,
  fetchCurriculumStandards,
  type CurriculumKsbCoverageItem,
  type CurriculumKsbCoverageResponse,
  type CurriculumKsbCoverageStatus,
  type CurriculumKsbTraceMapping,
  type CurriculumStandard,
} from '@/lib/curriculumApi';

type KsbType = 'knowledge' | 'skill' | 'behaviour' | string;
type SourceKind = 'framework' | 'standard';
type ViewKey = 'attention' | 'missing' | 'applied' | 'partial' | 'fully_covered' | 'over_allocated' | 'all';
type SortKey = 'status' | 'code' | 'weight' | 'occurrences';

interface KsbSummary {
  required: number;
  applied: number;
  missing: number;
  occurrences: number;
  components: number;
  modules: number;
  overAllocated: number;
}

const PAGE_SIZE = 15;

const viewTabs: Array<{ id: ViewKey; label: string; statuses?: CurriculumKsbCoverageStatus[] }> = [
  { id: 'attention', label: 'Needs Attention', statuses: ['missing', 'partial', 'over_allocated'] },
  { id: 'missing', label: 'Missing', statuses: ['missing'] },
  { id: 'applied', label: 'Applied' },
  { id: 'partial', label: 'Partial', statuses: ['partial'] },
  { id: 'fully_covered', label: 'Fully Covered', statuses: ['fully_covered'] },
  { id: 'over_allocated', label: 'Overallocated', statuses: ['over_allocated'] },
  { id: 'all', label: 'All KSBs' },
];

const statusLabels: Record<CurriculumKsbCoverageStatus, string> = {
  missing: 'Not mapped',
  partial: 'Partially covered',
  fully_covered: 'Fully covered',
  over_allocated: 'Overallocated',
};

const typeLabels: Record<string, string> = {
  knowledge: 'Knowledge',
  skill: 'Skill',
  behaviour: 'Behaviour',
};

function numberText(value: number) {
  return new Intl.NumberFormat('en-GB').format(value || 0);
}

function itemKey(item: CurriculumKsbCoverageItem) {
  return item.coverage_key || item.coverageKey || item.ksb_id || item.ksbId || `${item.source_id || item.sourceId}-${item.code}`;
}

function itemType(item: CurriculumKsbCoverageItem): KsbType {
  return String(item.ksb_type || item.ksbType || '').toLowerCase();
}

function itemWeight(item: CurriculumKsbCoverageItem) {
  return Number(item.raw_total_weight ?? item.rawTotalWeight ?? 0);
}

function itemOccurrences(item: CurriculumKsbCoverageItem) {
  return Number(item.occurrence_count ?? item.occurrenceCount ?? 0);
}

function itemComponents(item: CurriculumKsbCoverageItem) {
  return Number(item.component_count ?? item.componentCount ?? 0);
}

function itemModules(item: CurriculumKsbCoverageItem) {
  return Number(item.module_count ?? item.moduleCount ?? 0);
}

function mappingValue(mapping: CurriculumKsbTraceMapping, snakeKey: keyof CurriculumKsbTraceMapping, camelKey: keyof CurriculumKsbTraceMapping) {
  return String(mapping[snakeKey] || mapping[camelKey] || '');
}

function mappingLocation(mapping: CurriculumKsbTraceMapping) {
  return {
    moduleId: mappingValue(mapping, 'module_id', 'moduleId'),
    module: mappingValue(mapping, 'module_name', 'moduleName') || mappingValue(mapping, 'module_id', 'moduleId'),
    weekId: mappingValue(mapping, 'week_id', 'weekId'),
    week: mappingValue(mapping, 'week_name', 'weekName') || mappingValue(mapping, 'week_id', 'weekId'),
    componentId: mappingValue(mapping, 'component_id', 'componentId'),
    component: mappingValue(mapping, 'component_name', 'componentName') || mappingValue(mapping, 'component_id', 'componentId'),
    type: mappingValue(mapping, 'component_type', 'componentType'),
    level: mapping.mapping_level || mapping.mappingLevel || 'component',
  };
}

function itemMatches(
  item: CurriculumKsbCoverageItem,
  search: string,
  type: string,
  status: string,
  moduleFilter: string,
  weekFilter: string,
  classFilter: string,
) {
  const query = search.trim().toLowerCase();
  const mappingHaystack = item.mappings.map(mapping => {
    const location = mappingLocation(mapping);
    return `${location.moduleId} ${location.module} ${location.weekId} ${location.week} ${location.componentId} ${location.component} ${location.type} ${mapping.classification}`;
  }).join(' ');
  const haystack = `${item.code} ${item.title} ${item.description} ${mappingHaystack}`.toLowerCase();
  if (query && !haystack.includes(query)) return false;
  if (type !== 'all' && itemType(item) !== type) return false;
  if (status !== 'all' && item.status !== status) return false;
  if (moduleFilter !== 'all' && !item.mappings.some(mapping => mappingValue(mapping, 'module_id', 'moduleId') === moduleFilter)) return false;
  if (weekFilter !== 'all' && !item.mappings.some(mapping => mappingValue(mapping, 'week_id', 'weekId') === weekFilter)) return false;
  if (classFilter !== 'all' && !item.mappings.some(mapping => mapping.classification === classFilter)) return false;
  return true;
}

export default function KSBMapping() {
  const { frameworks, loading: frameworksLoading, error: frameworksError } = useCurriculumKsbFrameworks();
  const [standards, setStandards] = useState<CurriculumStandard[]>([]);
  const [standardsLoading, setStandardsLoading] = useState(true);
  const [standardsError, setStandardsError] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<SourceKind>('framework');
  const [selectedFrameworkId, setSelectedFrameworkId] = useState('');
  const [selectedStandardId, setSelectedStandardId] = useState('');
  const [coverage, setCoverage] = useState<CurriculumKsbCoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>('attention');
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [page, setPage] = useState(1);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [weekFilter, setWeekFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');

  const activeFrameworks = useMemo(() => frameworks.filter(framework => framework.status !== 'archived'), [frameworks]);
  const selectedFramework = useMemo(
    () => activeFrameworks.find(framework => framework.id === selectedFrameworkId),
    [activeFrameworks, selectedFrameworkId],
  );
  const selectedStandard = useMemo(
    () => standards.find(standard => standard.id === selectedStandardId),
    [selectedStandardId, standards],
  );
  const sourceTitle = sourceKind === 'framework'
    ? selectedFramework?.name || 'KSB Frameworks / all framework KSBs'
    : selectedStandard?.name || 'Standard KSBs / all standard KSBs';
  const sourceDetail = sourceKind === 'framework'
    ? `${activeFrameworks.length} frameworks`
    : `${standards.length} standards`;

  useEffect(() => {
    const controller = new AbortController();
    setStandardsLoading(true);
    setStandardsError(null);
    fetchCurriculumStandards(controller.signal)
      .then(result => setStandards(result))
      .catch(error => {
        if (controller.signal.aborted) return;
        setStandardsError(error instanceof Error ? error.message : 'Unable to load standard KSBs');
        setStandards([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setStandardsLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setCoverageLoading(true);
    setCoverageError(null);
    const sourceParams = sourceKind === 'framework'
      ? { sourceType: 'framework', sourceId: selectedFrameworkId || undefined }
      : { sourceType: 'standard', sourceId: selectedStandardId || undefined };
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
  }, [selectedFrameworkId, selectedStandardId, sourceKind]);

  useEffect(() => {
    setPage(1);
    setExpandedKey(null);
  }, [activeView, classFilter, moduleFilter, search, sortKey, sourceKind, statusFilter, typeFilter, weekFilter]);

  const items = useMemo(() => coverage?.items || [], [coverage?.items]);
  const summary = useMemo(() => buildSummary(items), [items]);
  const moduleOptions = useMemo(
    () => uniqueOptions(items.flatMap(item => item.mappings.map(mapping => ({
      value: mappingLocation(mapping).moduleId,
      label: mappingLocation(mapping).module,
    })))),
    [items],
  );
  const weekOptions = useMemo(
    () => uniqueOptions(items.flatMap(item => item.mappings.map(mapping => ({
      value: mappingLocation(mapping).weekId,
      label: mappingLocation(mapping).week || 'Module level',
    })))),
    [items],
  );

  const filtered = useMemo(() => {
    const view = viewTabs.find(tab => tab.id === activeView);
    return items
      .filter(item => {
        if (activeView === 'applied' && itemOccurrences(item) === 0) return false;
        if (view?.statuses?.length && !view.statuses.includes(item.status)) return false;
        return itemMatches(item, search, typeFilter, statusFilter, moduleFilter, weekFilter, classFilter);
      })
      .sort((a, b) => sortItems(a, b, sortKey));
  }, [activeView, classFilter, items, moduleFilter, search, sortKey, statusFilter, typeFilter, weekFilter]);

  const topApplied = useMemo(
    () => [...items].filter(item => itemOccurrences(item) > 0).sort((a, b) => itemOccurrences(b) - itemOccurrences(a) || itemWeight(b) - itemWeight(a)).slice(0, 5),
    [items],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const loading = frameworksLoading || standardsLoading || coverageLoading;
  const error = frameworksError || standardsError || coverageError;
  const filtersActive = Boolean(search || typeFilter !== 'all' || statusFilter !== 'all' || moduleFilter !== 'all' || weekFilter !== 'all' || classFilter !== 'all');

  const clearFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setStatusFilter('all');
    setModuleFilter('all');
    setWeekFilter('all');
    setClassFilter('all');
  };

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="KSB Mapping"
      pageSubtitle="Find missing, partial and overallocated KSB coverage."
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="space-y-4 p-4 md:p-6">
        <section className="rounded-lg border border-foreground-200 bg-background-50 p-4 shadow-sm">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase text-foreground-500">KSB Mapping</p>
              <h1 className="mt-1 truncate font-heading text-2xl font-bold text-foreground-950">
                {sourceTitle}
              </h1>
              <p className="mt-1 text-sm leading-6 text-foreground-500">
                Choose a KSB source, then review mapping status, weights and exact module placements without opening every record.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryMetric label="Required KSBs" value={summary.required} />
                <SummaryMetric label="Applied KSBs" value={summary.applied} />
                <SummaryMetric label="Missing KSBs" value={summary.missing} tone="warning" />
                <SummaryMetric label="Placements" value={summary.occurrences} detail={`${summary.components} components`} />
              </div>
            </div>
            <div className="grid content-start gap-3">
              <div>
                <span className="text-[10px] font-bold uppercase text-foreground-500">KSB category</span>
                <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg bg-background-100 p-1">
                  {([
                    ['framework', 'Framework KSBs'],
                    ['standard', 'Standard KSBs'],
                  ] as Array<[SourceKind, string]>).map(([kind, label]) => (
                    <button
                      key={kind}
                      onClick={() => setSourceKind(kind)}
                      className={`h-9 rounded-md px-3 text-xs font-bold transition-smooth focus:outline-none focus:ring-2 focus:ring-primary-300 ${
                        sourceKind === kind ? 'bg-background-50 text-foreground-950 shadow-sm' : 'text-foreground-500 hover:text-foreground-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-foreground-500">KSB source</span>
                {sourceKind === 'framework' ? (
                  <select
                    value={selectedFrameworkId}
                    onChange={event => setSelectedFrameworkId(event.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-bold text-foreground-800 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                  >
                    <option value="">All KSB frameworks</option>
                    {activeFrameworks.map(framework => <option key={framework.id} value={framework.id}>{framework.name}</option>)}
                  </select>
                ) : (
                  <select
                    value={selectedStandardId}
                    onChange={event => setSelectedStandardId(event.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-bold text-foreground-800 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                  >
                    <option value="">All standard KSBs</option>
                    {standards.map(standard => (
                      <option key={standard.id} value={standard.id}>
                        {standard.name}{standard.code ? ` (${standard.code})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <p className="text-xs text-foreground-500">
                Source: {sourceTitle} - {sourceDetail}, {summary.modules} distinct modules.
              </p>
            </div>
          </div>
        </section>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">Curriculum API error: {error}</div>}

        <section className="rounded-lg border border-foreground-200 bg-background-50 shadow-sm">
          <div className="border-b border-foreground-200 p-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-sm font-bold text-foreground-950">Coverage Worklist</h2>
                <p className="mt-1 text-xs text-foreground-500">
                  Showing {loading ? '-' : numberText(filtered.length)} of {numberText(items.length)} KSBs. Default view highlights records needing action.
                </p>
              </div>
              <div className="flex gap-1 overflow-x-auto rounded-lg bg-background-100 p-1">
                {viewTabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveView(tab.id)}
                    className={`h-8 shrink-0 rounded-md px-3 text-xs font-bold transition-smooth focus:outline-none focus:ring-2 focus:ring-primary-300 ${
                      activeView === tab.id ? 'bg-background-50 text-foreground-950 shadow-sm' : 'text-foreground-500 hover:text-foreground-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="sticky top-0 z-10 border-b border-foreground-200 bg-background-50/95 p-3 backdrop-blur">
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(16rem,1fr)_9rem_11rem_12rem_12rem_10rem_9rem_auto]">
              <label className="relative block">
                <span className="sr-only">Search KSBs</span>
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search code, description, module, week, component or ID"
                  className="h-9 w-full rounded-lg border border-foreground-200 bg-white pl-9 pr-3 text-xs font-semibold text-foreground-800 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                />
              </label>
              <Select value={typeFilter} onChange={setTypeFilter} options={[['all', 'All types'], ['knowledge', 'Knowledge'], ['skill', 'Skill'], ['behaviour', 'Behaviour']]} />
              <Select value={statusFilter} onChange={setStatusFilter} options={[['all', 'All statuses'], ['missing', 'Not mapped'], ['partial', 'Partial'], ['fully_covered', 'Full'], ['over_allocated', 'Overallocated']]} />
              <Select value={moduleFilter} onChange={setModuleFilter} options={[['all', 'All modules'], ...moduleOptions]} />
              <Select value={weekFilter} onChange={setWeekFilter} options={[['all', 'All weeks'], ...weekOptions]} />
              <Select value={classFilter} onChange={setClassFilter} options={[['all', 'All classes'], ['main', 'Hard'], ['secondary', 'Soft'], ['possible', 'Possible']]} />
              <Select value={sortKey} onChange={value => setSortKey(value as SortKey)} options={[['status', 'Sort status'], ['code', 'Sort code'], ['weight', 'Sort weight'], ['occurrences', 'Sort uses']]} />
              <button
                onClick={clearFilters}
                disabled={!filtersActive}
                className="h-9 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-bold text-foreground-700 transition-smooth hover:bg-background-100 focus:outline-none focus:ring-2 focus:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Clear filters
              </button>
            </div>
          </div>

          {loading ? (
            <TableRowsSkeleton rows={8} columns={9} gridClass="grid grid-cols-9" />
          ) : !items.length ? (
            <EmptyState title="No applicable framework or KSB profile" message="Select another programme or KSB source, or add a profile before mapping KSBs." />
          ) : !filtered.length ? (
            <EmptyState title="No KSBs match this view" message="Adjust the tab, search term or filters to widen the worklist." />
          ) : (
            <>
              <KsbTable items={pageItems} expandedKey={expandedKey} onToggle={setExpandedKey} />
              <Pagination page={page} totalPages={totalPages} totalResults={filtered.length} onPage={setPage} />
            </>
          )}
        </section>

        <section className="rounded-lg border border-foreground-200 bg-background-50 shadow-sm">
          <div className="flex flex-col gap-3 border-b border-foreground-200 p-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-bold text-foreground-950">Most Applied KSBs</h2>
              <p className="mt-1 text-xs text-foreground-500">Top repeated KSBs only. Use View to jump to the row details.</p>
            </div>
            <button onClick={() => setActiveView('applied')} className="inline-flex h-8 w-fit items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-bold text-foreground-700 hover:bg-background-100 focus:outline-none focus:ring-2 focus:ring-primary-300">
              Show applied
              <i className="ri-arrow-right-line" />
            </button>
          </div>
          <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-5">
            {loading ? <ListSkeleton count={5} /> : topApplied.length ? topApplied.map(item => (
              <button
                key={itemKey(item)}
                onClick={() => {
                  setActiveView('all');
                  setSearch(item.code);
                  setExpandedKey(itemKey(item));
                }}
                className="rounded-lg border border-foreground-200 bg-background-100/60 p-3 text-left transition-smooth hover:border-primary-200 hover:bg-background-50 focus:outline-none focus:ring-2 focus:ring-primary-300"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-black text-primary-700">{item.code}</span>
                  <span className="text-[10px] font-bold text-foreground-500">{itemWeight(item)}%</span>
                </div>
                <p className="mt-2 line-clamp-2 min-h-8 text-xs font-semibold text-foreground-800">{item.title || item.description || item.code}</p>
                <p className="mt-2 text-xl font-black text-foreground-950">{numberText(itemOccurrences(item))}</p>
                <p className="text-[10px] font-semibold uppercase text-foreground-400">occurrences</p>
              </button>
            )) : <EmptyState title="No applied KSBs yet" message="Mapped KSBs will appear here after module or component mappings exist." compact />}
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}

function buildSummary(items: CurriculumKsbCoverageItem[]): KsbSummary {
  const moduleIds = new Set<string>();
  items.forEach(item => {
    item.mappings.forEach(mapping => {
      const moduleId = mappingLocation(mapping).moduleId;
      if (moduleId) moduleIds.add(moduleId);
    });
  });
  return {
    required: items.length,
    applied: items.filter(item => itemOccurrences(item) > 0).length,
    missing: items.filter(item => item.status === 'missing').length,
    occurrences: items.reduce((sum, item) => sum + itemOccurrences(item), 0),
    components: items.reduce((sum, item) => sum + itemComponents(item), 0),
    modules: moduleIds.size,
    overAllocated: items.filter(item => item.status === 'over_allocated').length,
  };
}

function sortItems(a: CurriculumKsbCoverageItem, b: CurriculumKsbCoverageItem, sortKey: SortKey) {
  if (sortKey === 'code') return naturalCode(a.code).localeCompare(naturalCode(b.code), undefined, { numeric: true });
  if (sortKey === 'weight') return itemWeight(b) - itemWeight(a);
  if (sortKey === 'occurrences') return itemOccurrences(b) - itemOccurrences(a);
  return statusPriority(a.status) - statusPriority(b.status) || naturalCode(a.code).localeCompare(naturalCode(b.code), undefined, { numeric: true });
}

function statusPriority(status: CurriculumKsbCoverageStatus) {
  return { missing: 0, partial: 1, over_allocated: 2, fully_covered: 3 }[status] ?? 4;
}

function naturalCode(code: string) {
  return String(code || '').replace(/^([A-Z]+)(\d+)$/i, '$1-$2');
}

function KsbTable({ items, expandedKey, onToggle }: { items: CurriculumKsbCoverageItem[]; expandedKey: string | null; onToggle: (key: string | null) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1180px] w-full border-collapse text-left">
        <thead className="bg-background-100/80 text-[10px] font-bold uppercase text-foreground-500">
          <tr>
            {['KSB code', 'Description', 'Category', 'Mapping status', 'Total weight', 'Occurrences', 'Components', 'Modules', 'Action'].map(header => (
              <th key={header} className="border-b border-foreground-200 px-3 py-3 first:pl-4 last:pr-4">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground-100">
          {items.map(item => {
            const key = itemKey(item);
            const expanded = expandedKey === key;
            return (
              <Fragment key={key}>
                <tr key={key} className="h-16 align-middle hover:bg-background-100/50">
                  <td className="px-3 py-3 pl-4"><span className="rounded-md bg-background-100 px-2 py-1 font-mono text-xs font-black text-foreground-950">{item.code}</span></td>
                  <td className="max-w-[380px] px-3 py-3">
                    <p className="line-clamp-2 text-xs font-semibold leading-5 text-foreground-800">{item.title || item.description || item.code}</p>
                    {item.description && item.title && <p className="mt-0.5 truncate text-[10px] text-foreground-500">{item.description}</p>}
                  </td>
                  <td className="px-3 py-3"><TypeBadge type={itemType(item)} /></td>
                  <td className="px-3 py-3"><StatusBadge status={item.status} /></td>
                  <td className="px-3 py-3 text-xs font-bold text-foreground-900">{itemWeight(item)}%</td>
                  <td className="px-3 py-3 text-center text-xs font-bold text-foreground-900">{numberText(itemOccurrences(item))}</td>
                  <td className="px-3 py-3 text-center text-xs font-bold text-foreground-900">{numberText(itemComponents(item))}</td>
                  <td className="px-3 py-3 text-center text-xs font-bold text-foreground-900">{numberText(itemModules(item))}</td>
                  <td className="px-3 py-3 pr-4">
                    {itemOccurrences(item) > 0 ? (
                      <button onClick={() => onToggle(expanded ? null : key)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-bold text-foreground-700 hover:bg-background-100 focus:outline-none focus:ring-2 focus:ring-primary-300">
                        {expanded ? 'Hide' : 'View placements'}
                        <i className={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                      </button>
                    ) : (
                      <button onClick={() => window.REACT_APP_NAVIGATE('/curriculum/module-builder')} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-bold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300">
                        Map KSB
                        <i className="ri-arrow-right-line" />
                      </button>
                    )}
                  </td>
                </tr>
                {expanded && (
                  <tr key={`${key}-details`} className="bg-background-100/40">
                    <td colSpan={9} className="px-4 py-3">
                      <PlacementDetails item={item} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlacementDetails({ item }: { item: CurriculumKsbCoverageItem }) {
  return (
    <div className="rounded-lg border border-foreground-200 bg-background-50">
      <div className="flex flex-col gap-1 border-b border-foreground-200 px-3 py-2 md:flex-row md:items-center md:justify-between">
        <p className="text-xs font-bold text-foreground-900">{item.code} placements</p>
        <p className="text-[10px] font-semibold text-foreground-500">Uses canonical module, week, component and KSB IDs from the coverage response.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full border-collapse text-left">
          <thead className="bg-background-100 text-[10px] font-bold uppercase text-foreground-500">
            <tr>
              {['Module', 'Week / session', 'Component', 'Level', 'Class', 'Weight', 'Action'].map(header => <th key={header} className="px-3 py-2">{header}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground-100">
            {item.mappings.map(mapping => {
              const location = mappingLocation(mapping);
              return (
                <tr key={mapping.mapping_id || mapping.mappingId} className="h-12 text-xs text-foreground-600">
                  <td className="max-w-[190px] px-3 py-2">
                    <p className="truncate font-bold text-foreground-900">{location.module}</p>
                    <p className="truncate text-[10px] text-foreground-400">ID: {location.moduleId || 'Not supplied'}</p>
                  </td>
                  <td className="max-w-[180px] px-3 py-2">
                    <p className="truncate">{location.week || 'Module level'}</p>
                    <p className="truncate text-[10px] text-foreground-400">ID: {location.weekId || 'Not supplied'}</p>
                  </td>
                  <td className="max-w-[220px] px-3 py-2">
                    <p className="truncate font-semibold text-foreground-800">{location.component}</p>
                    <p className="truncate text-[10px] text-foreground-400">ID: {location.componentId || 'Not supplied'}</p>
                  </td>
                  <td className="px-3 py-2 capitalize">{location.level}</td>
                  <td className="px-3 py-2"><ClassificationBadge value={mapping.classification} /></td>
                  <td className="px-3 py-2 font-bold text-foreground-900">{mapping.weight}%</td>
                  <td className="px-3 py-2">
                    <button onClick={() => openModuleBuilder(location.moduleId, item.ksb_id || item.ksbId)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-bold text-foreground-700 hover:bg-background-100 focus:outline-none focus:ring-2 focus:ring-primary-300">
                      Open module
                      <i className="ri-arrow-right-line" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function openModuleBuilder(moduleId: string, ksbId: string) {
  const query = new URLSearchParams();
  if (moduleId) query.set('module', moduleId);
  if (ksbId) query.set('ksb', ksbId);
  window.REACT_APP_NAVIGATE(`/curriculum/module-builder${query.toString() ? `?${query.toString()}` : ''}`);
}

function SummaryMetric({ label, value, detail, tone = 'default' }: { label: string; value: number; detail?: string; tone?: 'default' | 'warning' }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-foreground-200 bg-background-100/70'}`}>
      <p className="text-[10px] font-bold uppercase text-foreground-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-foreground-950">{numberText(value)}</p>
      {detail && <p className="text-[10px] font-semibold text-foreground-500">{detail}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: CurriculumKsbCoverageStatus }) {
  const className = status === 'fully_covered'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'over_allocated'
      ? 'bg-red-50 text-red-700 border-red-200'
      : status === 'partial'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-foreground-100 text-foreground-700 border-foreground-200';
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${className}`}>{statusLabels[status] || status}</span>;
}

function TypeBadge({ type }: { type: string }) {
  const className = type === 'knowledge' ? 'bg-primary-50 text-primary-700' : type === 'skill' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${className}`}>{typeLabels[type] || type || 'KSB'}</span>;
}

function ClassificationBadge({ value }: { value: string }) {
  const label = value === 'main' ? 'Hard' : value === 'secondary' ? 'Soft' : value === 'possible' ? 'Possible' : value || 'Mapped';
  const className = value === 'main' ? 'bg-primary-100 text-primary-700' : value === 'secondary' ? 'bg-amber-100 text-amber-700' : 'bg-background-100 text-foreground-600';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${className}`}>{label}</span>;
}

function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[][] }) {
  return (
    <select value={value} onChange={event => onChange(event.target.value)} className="h-9 rounded-lg border border-foreground-200 bg-white px-3 text-xs font-bold text-foreground-700 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100">
      {options.map(([optionValue, label]) => <option key={`${optionValue}-${label}`} value={optionValue}>{label}</option>)}
    </select>
  );
}

function Pagination({ page, totalPages, totalResults, onPage }: { page: number; totalPages: number; totalResults: number; onPage: (page: number) => void }) {
  const start = totalResults ? (page - 1) * PAGE_SIZE + 1 : 0;
  const end = Math.min(page * PAGE_SIZE, totalResults);
  return (
    <div className="flex flex-col gap-2 border-t border-foreground-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
      <p className="text-xs font-semibold text-foreground-500">Showing {numberText(start)}-{numberText(end)} of {numberText(totalResults)} KSBs</p>
      <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="h-8 rounded-lg border border-foreground-200 px-3 text-xs font-bold text-foreground-700 disabled:opacity-45">Previous</button>
        <span className="text-xs font-bold text-foreground-700">Page {page} of {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="h-8 rounded-lg border border-foreground-200 px-3 text-xs font-bold text-foreground-700 disabled:opacity-45">Next</button>
      </div>
    </div>
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

function EmptyState({ title, message, compact = false }: { title: string; message: string; compact?: boolean }) {
  return (
    <div className={`${compact ? 'col-span-full rounded-lg' : 'rounded-lg'} border border-dashed border-background-300 bg-background-50 px-6 py-10 text-center`}>
      <i className="ri-route-line text-3xl text-foreground-300" />
      <h3 className="mt-3 text-sm font-heading font-black text-foreground-800">{title}</h3>
      <p className="mt-1 text-sm text-foreground-500">{message}</p>
    </div>
  );
}

/**
 * KSB Mapping - a single question answered directly: where is each KSB taught?
 *
 * One row per KSB, expandable into its placements (module > week > component)
 * with the weight and OTJH each placement carries. Everything that belongs to
 * authoring (editing, deleting, coverage triage) lives in Module Builder, so it
 * is deliberately absent here.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { TableRowsSkeleton } from '@/components/feature/Skeletons';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  fetchCurriculumProgrammeKsbCoverage,
  fetchCurriculumProgrammes,
  type CurriculumKsbCoverageItem,
  type CurriculumKsbCoverageSource,
  type CurriculumKsbTraceMapping,
  type CurriculumProgramme,
} from '@/lib/curriculumApi';

interface Placement {
  key: string;
  module: string;
  week: string;
  component: string;
  componentType: string;
  level: string;
  weight: number;
  otjh: number;
}

interface KsbRow {
  key: string;
  code: string;
  type: string;
  title: string;
  placements: Placement[];
  totalWeight: number;
  totalOtjh: number;
}

const typeLabels: Record<string, string> = {
  knowledge: 'Knowledge',
  skill: 'Skill',
  behaviour: 'Behaviour',
};

// Each KSB type keeps one hue across the badge, the code chip and the type
// filter, so the eye can group rows by type without reading the label.
const typeTones: Record<string, { badge: string; chip: string; dot: string }> = {
  knowledge: {
    badge: 'bg-sky-100 text-sky-700 border-sky-200/70',
    chip: 'bg-sky-50 text-sky-700 border-sky-200',
    dot: 'bg-sky-500',
  },
  skill: {
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200/70',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  behaviour: {
    badge: 'bg-violet-100 text-violet-700 border-violet-200/70',
    chip: 'bg-violet-50 text-violet-700 border-violet-200',
    dot: 'bg-violet-500',
  },
};

const fallbackTone = {
  badge: 'bg-background-200 text-foreground-600 border-background-300',
  chip: 'bg-background-100 text-foreground-700 border-background-200',
  dot: 'bg-foreground-300',
};

// Archived programmes stay out of the picker: a mapping view for a retired
// programme is not something you can act on.
function programmeIsActive(programme: CurriculumProgramme) {
  if (programme.isArchived) return false;
  return String(programme.status || '').toLowerCase() !== 'archived';
}

function toneFor(type: string) {
  return typeTones[type] || fallbackTone;
}

// Component types are shown as a quiet chip rather than parenthesised text so
// the component name stays the thing you read first.
const componentTypeIcons: Record<string, string> = {
  reading: 'ri-book-open-line',
  video: 'ri-play-circle-line',
  quiz: 'ri-question-line',
  assignment: 'ri-file-edit-line',
  session: 'ri-presentation-line',
  reflection: 'ri-quill-pen-line',
};

function componentTypeIcon(componentType: string) {
  return componentTypeIcons[componentType.toLowerCase()] || 'ri-shapes-line';
}

function text(mapping: CurriculumKsbTraceMapping, snakeKey: keyof CurriculumKsbTraceMapping, camelKey: keyof CurriculumKsbTraceMapping) {
  return String(mapping[snakeKey] || mapping[camelKey] || '');
}

function numberText(value: number) {
  if (!Number.isFinite(value) || value === 0) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

// Sorts K1, K2, K10 in human order rather than lexicographically (K1, K10, K2).
function ksbSortKey(code: string): [string, number, string] {
  const match = /^([A-Za-z]*)(\d+)(.*)$/.exec(code.trim());
  if (!match) return [code.toUpperCase(), 0, ''];
  return [match[1].toUpperCase(), Number(match[2]), match[3]];
}

function compareCodes(a: string, b: string) {
  const [prefixA, numberA, restA] = ksbSortKey(a);
  const [prefixB, numberB, restB] = ksbSortKey(b);
  if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);
  if (numberA !== numberB) return numberA - numberB;
  return restA.localeCompare(restB);
}

// The coverage endpoint puts the KSB's code in `title` and its wording in
// `description`, so the wording is what this column reads. When a KSB genuinely
// has none, `description` comes back as the code -- showing "K15" twice on one
// row is noise, so it falls back to an explicit placeholder instead.
function descriptionOf(title: string, code: string) {
  const trimmed = title.trim();
  if (!trimmed || trimmed.toLowerCase() === code.trim().toLowerCase()) return '';
  return trimmed;
}

function buildRows(items: CurriculumKsbCoverageItem[]): KsbRow[] {
  return items
    .map(item => {
      const mappings = Array.isArray(item.mappings) ? item.mappings : [];
      const placements: Placement[] = mappings.map((mapping, index) => {
        const otjh = Number(mapping.component_otjh ?? mapping.componentOtjh ?? 0);
        return {
          key: text(mapping, 'mapping_id', 'mappingId') || `${item.code}-${index}`,
          module: text(mapping, 'module_name', 'moduleName'),
          week: text(mapping, 'week_name', 'weekName'),
          component: text(mapping, 'component_name', 'componentName'),
          componentType: text(mapping, 'component_type', 'componentType'),
          level: String(mapping.mapping_level || mapping.mappingLevel || ''),
          weight: Number(mapping.weight ?? 0),
          otjh: Number.isFinite(otjh) ? otjh : 0,
        };
      });
      const code = String(item.code || '');
      return {
        key: item.coverage_key || item.coverageKey || item.ksb_id || item.ksbId || code,
        code,
        type: String(item.ksb_type || item.ksbType || '').toLowerCase(),
        title: String(item.description || item.title || ''),
        placements,
        totalWeight: placements.reduce((sum, placement) => sum + placement.weight, 0),
        // Only component-level placements carry OTJH, so this is the teaching
        // time actually attached to the KSB rather than a module-wide figure.
        totalOtjh: placements.reduce((sum, placement) => sum + placement.otjh, 0),
      };
    })
    .sort((a, b) => compareCodes(a.code, b.code));
}

// The required set has to come from somewhere, and which somewhere decides
// every figure on this page. When no source is set for the programme the backend
// stands the union of every profile in, which looks like a working page listing
// KSBs the programme does not teach -- so that case is named, not implied.
function KsbSourceNotice({ source }: { source: CurriculumKsbCoverageSource }) {
  const name = String(source.source_name || source.sourceName || source.id || '');
  const count = Number(source.required_count ?? source.requiredCount ?? 0);
  if (source.origin === 'all-profiles') {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        <AppIcon className="ri-error-warning-line mt-0.5 shrink-0 text-sm" />
        <p>
          <span className="font-bold">No KSB source is set for this programme.</span>{' '}
          These {count} KSBs are every active profile&apos;s put together, so they are not the
          programme&apos;s required set. Set its KSB source on the Programmes page.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-foreground-100 pt-3 text-[11px] text-foreground-500">
      <AppIcon className="ri-file-list-3-line text-sm text-foreground-400" />
      <span>
        Required set from{' '}
        <span className="font-bold text-foreground-800">{name || 'an unnamed source'}</span>
        {source.origin === 'programme-name' && ' (matched by programme name)'}
        {source.origin === 'module' && ' (set on this programme\u2019s modules)'}
        {' '}&middot; {count} KSB{count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function SummaryStat({ icon, label, value, detail, tone = 'default' }: {
  icon: string;
  label: string;
  value: string;
  detail: string;
  tone?: 'default' | 'primary' | 'warning';
}) {
  const tones = {
    default: 'bg-background-100 text-foreground-600',
    primary: 'bg-primary-100 text-primary-700',
    warning: 'bg-amber-100 text-amber-700',
  };
  return (
    <div className="coach-metric-card flex items-center gap-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
        <AppIcon className={`${icon} text-base`} />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-bold leading-none text-foreground-950">{value}</p>
        <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-wide text-foreground-500">{label}</p>
        <p className="truncate text-[10px] text-foreground-400">{detail}</p>
      </div>
    </div>
  );
}

// A single bar comparing this KSB's weight to the heaviest one in the
// programme, so relative emphasis is visible without reading every number.
function WeightBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-background-200 lg:block">
        <div className="h-full rounded-full bg-primary-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-xs font-bold tabular-nums text-foreground-800">{numberText(value)}</span>
    </div>
  );
}

export default function KSBMapping() {
  // The selected programme lives in the URL so a mapping view can be linked to.
  const [searchParams, setSearchParams] = useSearchParams();
  const [programmes, setProgrammes] = useState<CurriculumProgramme[]>([]);
  const [programmeId, setProgrammeId] = useState(searchParams.get('programme') || '');
  const [rows, setRows] = useState<KsbRow[]>([]);
  // Which KSB source these rows are the required set of. Named on screen so a
  // programme with no source set reads as that, rather than as a long list of
  // KSBs from every profile in the system.
  const [source, setSource] = useState<CurriculumKsbCoverageSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [mappedFilter, setMappedFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');

  useEffect(() => {
    const controller = new AbortController();
    fetchCurriculumProgrammes(controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        const active = result.filter(programmeIsActive);
        setProgrammes(active);
        const fallback = String(active[0]?.sourceId || active[0]?.id || '');
        setProgrammeId(previous => {
          // A ?programme= id for an archived programme is no longer selectable,
          // so fall back rather than leaving the select showing nothing.
          const stillActive = previous && active.some(programme => String(programme.sourceId || programme.id) === previous);
          return stillActive ? previous : fallback;
        });
        if (!active.length) setLoading(false);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to load programmes');
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!programmeId) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    // The full required set is fetched, not just what is already mapped, so the
    // coverage figures have a real denominator. Asking for actual mappings only
    // would return the mapped KSBs alone and make every programme look 100%
    // covered. Unmapped KSBs are kept in the table and flagged as such.
    fetchCurriculumProgrammeKsbCoverage(programmeId, {}, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setRows(buildRows(result?.items || []));
        setSource(result?.source || null);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to load KSB mappings');
        setRows([]);
        setSource(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [programmeId]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(row => {
      if (typeFilter !== 'all' && row.type !== typeFilter) return false;
      if (mappedFilter === 'mapped' && !row.placements.length) return false;
      if (mappedFilter === 'unmapped' && row.placements.length) return false;
      if (!query) return true;
      return (
        row.code.toLowerCase().includes(query)
        || row.title.toLowerCase().includes(query)
        || row.placements.some(placement => (
          placement.module.toLowerCase().includes(query)
          || placement.component.toLowerCase().includes(query)
        ))
      );
    });
  }, [mappedFilter, rows, search, typeFilter]);

  // Type counts drive the filter chips, so only types actually present appear.
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach(row => {
      if (!row.type) return;
      counts.set(row.type, (counts.get(row.type) || 0) + 1);
    });
    return ['knowledge', 'skill', 'behaviour']
      .filter(type => counts.has(type))
      .map(type => ({ type, count: counts.get(type) || 0 }))
      .concat(
        [...counts.keys()]
          .filter(type => !['knowledge', 'skill', 'behaviour'].includes(type))
          .map(type => ({ type, count: counts.get(type) || 0 })),
      );
  }, [rows]);

  const mappedCount = rows.filter(row => row.placements.length > 0).length;
  const unmappedCount = rows.length - mappedCount;
  const placementCount = rows.reduce((sum, row) => sum + row.placements.length, 0);
  const totalOtjh = rows.reduce((sum, row) => sum + row.totalOtjh, 0);
  const maxWeight = rows.reduce((max, row) => Math.max(max, row.totalWeight), 0);
  const coveragePct = rows.length ? Math.round((mappedCount / rows.length) * 100) : 0;
  const selectedProgramme = programmes.find(programme => String(programme.sourceId || programme.id) === programmeId);

  const GRID = 'grid-cols-[132px_minmax(0,1fr)_104px_104px_84px]';

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="KSB Mapping"
      pageSubtitle="Where each KSB is taught."
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-4 bg-background-100 p-4 sm:p-5 lg:p-6">
        {/* Filters */}
        <section className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <label className="block min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wide text-foreground-500">Programme</span>
              <div className="relative mt-1">
                <AppIcon className="ri-graduation-cap-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400" />
                <select
                  value={programmeId}
                  onChange={event => {
                    setProgrammeId(event.target.value);
                    setExpanded(null);
                    setTypeFilter('all');
                    setMappedFilter('all');
                    setSearchParams(event.target.value ? { programme: event.target.value } : {}, { replace: true });
                  }}
                  className="h-10 w-full cursor-pointer appearance-none rounded-lg border border-foreground-200 bg-background-50 pl-9 pr-8 text-xs font-bold text-foreground-800 outline-none transition-smooth focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                >
                  {!programmes.length && <option value="">No programmes available</option>}
                  {programmes.map(programme => {
                    const id = String(programme.sourceId || programme.id);
                    return <option key={id} value={id}>{programme.name}</option>;
                  })}
                </select>
                <AppIcon className="ri-arrow-down-s-line pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400" />
              </div>
            </label>

            <label className="block min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wide text-foreground-500">Search</span>
              <div className="relative mt-1">
                <AppIcon className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="KSB code, module or component"
                  className="h-10 w-full rounded-lg border border-foreground-200 bg-background-50 pl-9 pr-9 text-xs font-semibold text-foreground-800 outline-none transition-smooth placeholder:font-medium placeholder:text-foreground-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-foreground-400 transition-smooth hover:bg-background-200 hover:text-foreground-700"
                  >
                    <AppIcon className="ri-close-line text-xs" />
                  </button>
                )}
              </div>
            </label>
          </div>

          {/* Type filters double as a legend for the row colours. */}
          {!!rows.length && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-foreground-100 pt-3">
              <button
                type="button"
                onClick={() => setTypeFilter('all')}
                className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-smooth ${typeFilter === 'all' ? 'border-primary-300 bg-primary-100 text-primary-700' : 'border-background-200 bg-background-50 text-foreground-500 hover:bg-background-100'}`}
              >
                All {rows.length}
              </button>
              {typeCounts.map(({ type, count }) => {
                const tone = toneFor(type);
                const active = typeFilter === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTypeFilter(active ? 'all' : type)}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-smooth ${active ? tone.chip : 'border-background-200 bg-background-50 text-foreground-500 hover:bg-background-100'}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                    {typeLabels[type] || type} {count}
                  </button>
                );
              })}

              {/* Most programmes have far more required KSBs than mapped ones,
                  so both halves of that split need to be reachable in one click. */}
              {!!unmappedCount && (
                <>
                  <span className="mx-1 h-4 w-px bg-background-200" />
                  <button
                    type="button"
                    onClick={() => setMappedFilter(mappedFilter === 'mapped' ? 'all' : 'mapped')}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-smooth ${mappedFilter === 'mapped' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-background-200 bg-background-50 text-foreground-500 hover:bg-background-100'}`}
                  >
                    Mapped {mappedCount}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMappedFilter(mappedFilter === 'unmapped' ? 'all' : 'unmapped')}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-smooth ${mappedFilter === 'unmapped' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-background-200 bg-background-50 text-foreground-500 hover:bg-background-100'}`}
                  >
                    Unmapped {unmappedCount}
                  </button>
                </>
              )}
            </div>
          )}

          {source && !loading && <KsbSourceNotice source={source} />}
        </section>

        {/* Summary */}
        {!loading && !!rows.length && (
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryStat icon="ri-checkbox-circle-line" label="KSBs mapped" value={`${mappedCount}/${rows.length}`} detail={`${coveragePct}% of required KSBs`} tone="primary" />
            <SummaryStat icon="ri-node-tree" label="Placements" value={String(placementCount)} detail="Component-level mappings" />
            <SummaryStat icon="ri-time-line" label="Total OTJH" value={numberText(totalOtjh)} detail="Hours attached to KSBs" />
            <SummaryStat
              icon={unmappedCount ? 'ri-error-warning-line' : 'ri-shield-check-line'}
              label="Unmapped"
              value={String(unmappedCount)}
              detail={unmappedCount ? 'Not taught anywhere yet' : 'Every KSB is taught'}
              tone={unmappedCount ? 'warning' : 'default'}
            />
          </section>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <AppIcon className="ri-error-warning-line mt-px shrink-0 text-sm" />
            <span>{error}</span>
          </div>
        )}

        {/* Table */}
        <section className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
          <div className={`grid ${GRID} gap-3 border-b border-foreground-200 bg-background-100/60 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-foreground-500`}>
            <span>KSB</span>
            <span>Description</span>
            <span className="text-right">Placements</span>
            <span className="text-right">Weight</span>
            <span className="text-right">OTJH</span>
          </div>

          {loading ? (
            <TableRowsSkeleton rows={8} columns={5} gridClass={`grid ${GRID}`} />
          ) : !visibleRows.length ? (
            <div className="px-4 py-14 text-center">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-background-100">
                <AppIcon className={`${rows.length ? 'ri-search-line' : 'ri-node-tree'} text-xl text-foreground-300`} />
              </span>
              <p className="text-sm font-bold text-foreground-800">
                {rows.length ? 'No KSBs match your filters' : 'No KSB mappings yet'}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-foreground-500">
                {rows.length
                  ? 'Try a different code, module or component, or clear the filters.'
                  : `Nothing has been mapped for ${selectedProgramme?.name || 'this programme'}. Map KSBs to components in Module Builder.`}
              </p>
              {rows.length > 0 && (search || typeFilter !== 'all' || mappedFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setTypeFilter('all'); setMappedFilter('all'); }}
                  className="mt-3 rounded-lg border border-background-200 bg-background-50 px-3 py-1.5 text-[11px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            visibleRows.map(row => {
              const isOpen = expanded === row.key;
              const tone = toneFor(row.type);
              const description = descriptionOf(row.title, row.code);
              const unmapped = !row.placements.length;
              return (
                <Fragment key={row.key}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : row.key)}
                    aria-expanded={isOpen}
                    className={`grid w-full ${GRID} items-center gap-3 border-b border-foreground-100 px-4 py-2.5 text-left transition-smooth hover:bg-background-100/70 ${isOpen ? 'bg-background-100' : ''}`}
                  >
                    <span className="flex items-center gap-2">
                      <AppIcon className={`ri-arrow-right-s-line shrink-0 text-foreground-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${tone.chip}`}>{row.code}</span>
                    </span>

                    <span className="flex min-w-0 items-center gap-2">
                      {row.type && (
                        <span className={`hidden shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide sm:inline-block ${tone.badge}`}>
                          {typeLabels[row.type] || row.type}
                        </span>
                      )}
                      <span className={`block truncate text-xs ${description ? 'text-foreground-700' : 'italic text-foreground-400'}`}>
                        {description || 'No description provided'}
                      </span>
                    </span>

                    <span className="text-right">
                      {unmapped ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                          <AppIcon className="ri-error-warning-line text-[10px]" />
                          Not mapped
                        </span>
                      ) : (
                        <span className="text-xs font-bold tabular-nums text-foreground-950">{row.placements.length}</span>
                      )}
                    </span>

                    <WeightBar value={row.totalWeight} max={maxWeight} />

                    <span className="text-right text-xs font-semibold tabular-nums text-foreground-700">
                      {row.totalOtjh ? `${numberText(row.totalOtjh)}h` : <span className="text-foreground-300">&mdash;</span>}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-b border-foreground-100 bg-background-100/40 px-4 py-3">
                      {unmapped ? (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2.5">
                          <AppIcon className="ri-error-warning-line mt-px shrink-0 text-sm text-amber-600" />
                          <div>
                            <p className="text-xs font-bold text-amber-800">Not taught anywhere yet</p>
                            <p className="mt-0.5 text-[11px] text-amber-700">Map {row.code} to a component in Module Builder so it is covered.</p>
                          </div>
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-background-200 bg-background-50">
                          <div className="grid min-w-[680px] grid-cols-[minmax(0,1fr)_140px_minmax(0,1.2fr)_80px_80px] gap-3 border-b border-background-200 bg-background-100/60 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-foreground-500">
                            <span>Module</span>
                            <span>Week</span>
                            <span>Component</span>
                            <span className="text-right">Weight</span>
                            <span className="text-right">OTJH</span>
                          </div>
                          {row.placements.map(placement => (
                            <div
                              key={placement.key}
                              className="grid min-w-[680px] grid-cols-[minmax(0,1fr)_140px_minmax(0,1.2fr)_80px_80px] items-center gap-3 border-b border-foreground-100 px-3 py-2 text-xs transition-smooth last:border-0 hover:bg-background-100/50"
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <AppIcon className="ri-stack-line shrink-0 text-[11px] text-foreground-400" />
                                <span className="truncate font-semibold text-foreground-800">{placement.module || '—'}</span>
                              </span>
                              <span className="truncate text-foreground-600">{placement.week || '—'}</span>
                              <span className="flex min-w-0 items-center gap-1.5">
                                {placement.component ? (
                                  <>
                                    <AppIcon className={`${componentTypeIcon(placement.componentType)} shrink-0 text-[11px] text-foreground-400`} />
                                    <span className="truncate text-foreground-700">{placement.component}</span>
                                    {placement.componentType && (
                                      <span className="shrink-0 rounded bg-background-200/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground-500">
                                        {placement.componentType}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="truncate italic text-foreground-400">
                                    {placement.level ? `${placement.level}-level mapping` : '—'}
                                  </span>
                                )}
                              </span>
                              <span className="text-right font-semibold tabular-nums text-foreground-700">{numberText(placement.weight)}</span>
                              <span className="text-right font-semibold tabular-nums text-foreground-700">
                                {placement.otjh ? `${numberText(placement.otjh)}h` : <span className="text-foreground-300">&mdash;</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Fragment>
              );
            })
          )}

          {!loading && !!visibleRows.length && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[11px] font-semibold text-foreground-500">
              <span>Showing {visibleRows.length} of {rows.length} KSBs</span>
              <span className="tabular-nums">{placementCount} placements &middot; {numberText(totalOtjh)}h OTJH</span>
            </div>
          )}
        </section>
      </div>
    </WorkspaceShell>
  );
}

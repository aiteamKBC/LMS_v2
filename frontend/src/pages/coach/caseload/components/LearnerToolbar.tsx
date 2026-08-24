// ============================================================================
// Coach caseload — search, filters and sort.
//
// One row instead of a five-column grid of permanently open dropdowns. The three
// filters coaches reach for stay visible; the rest sit behind More filters, and
// whatever is applied is restated underneath as removable chips so a surprising
// result count is always explainable.
//
// Employer is rendered only when the data has more than one real employer value:
// the caseload serializer currently returns "--" for every learner, and a filter
// with one meaningless option is worse than no filter.
// ============================================================================
import { memo, useEffect, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { MenuSelect } from './MenuSelect';
import { FilterChip } from './primitives';
import type { FilterOption, SortDirection, SortKey } from '../types';

export interface CaseloadFilterState {
  search: string;
  cohort: string;
  group: string;
  coachRag: string;
  programStatus: string;
  employer: string;
}

export interface CaseloadFilterOptions {
  cohort: FilterOption[];
  group: FilterOption[];
  coachRag: FilterOption[];
  programStatus: FilterOption[];
  employer: FilterOption[];
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'risk', label: 'Most urgent first' },
  { value: 'name', label: 'Learner name' },
  { value: 'progress', label: 'OTJH progress' },
  { value: 'otjh', label: 'OTJH hours' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'components', label: 'Components' },
  { value: 'ksb', label: 'KSB progress' },
  { value: 'gateway', label: 'Gateway review date' },
];

function withAllOption(label: string, options: FilterOption[]): FilterOption[] {
  return [{ value: 'all', label }, ...options];
}

function optionLabel(options: FilterOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export const LearnerToolbar = memo(function LearnerToolbar({
  filters,
  options,
  sortKey,
  sortDir,
  resultCount,
  onFilterChange,
  onSortKeyChange,
  onSortDirToggle,
  onClearAll,
}: {
  filters: CaseloadFilterState;
  options: CaseloadFilterOptions;
  sortKey: SortKey;
  sortDir: SortDirection;
  resultCount: number;
  onFilterChange: (patch: Partial<CaseloadFilterState>) => void;
  onSortKeyChange: (next: SortKey) => void;
  onSortDirToggle: () => void;
  onClearAll: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  const hasEmployerData = options.employer.length > 1;
  const advancedActive = (filters.programStatus !== 'all' ? 1 : 0) + (filters.employer !== 'all' ? 1 : 0);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen]);

  const chips: { key: keyof CaseloadFilterState; label: string; value: string }[] = [];
  if (filters.cohort !== 'all') chips.push({ key: 'cohort', label: 'Cohort', value: optionLabel(options.cohort, filters.cohort) });
  if (filters.group !== 'all') chips.push({ key: 'group', label: 'Group', value: optionLabel(options.group, filters.group) });
  if (filters.coachRag !== 'all') chips.push({ key: 'coachRag', label: 'Coach RAG', value: filters.coachRag });
  if (filters.programStatus !== 'all') chips.push({ key: 'programStatus', label: 'Enrolment', value: filters.programStatus });
  if (filters.employer !== 'all') chips.push({ key: 'employer', label: 'Employer', value: filters.employer });
  if (filters.search.trim()) chips.push({ key: 'search', label: 'Search', value: filters.search.trim() });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 lg:max-w-[340px]">
          <AppIcon className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-foreground-400"></AppIcon>
          <input
            type="search"
            value={filters.search}
            onChange={(event) => onFilterChange({ search: event.target.value })}
            placeholder="Search by learner name or email…"
            aria-label="Search learners by name or email"
            className="h-9 w-full rounded-md border border-foreground-200 bg-white pl-8 pr-2.5 text-[12px] text-foreground-900 outline-none transition placeholder:text-foreground-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          />
        </div>

        <MenuSelect
          value={filters.cohort}
          onChange={(value) => onFilterChange({ cohort: value })}
          options={withAllOption('All cohorts', options.cohort)}
          widthClass="w-[150px]"
          tone={filters.cohort !== 'all' ? 'active' : 'default'}
        />
        <MenuSelect
          value={filters.group}
          onChange={(value) => onFilterChange({ group: value })}
          options={withAllOption('All groups', options.group)}
          widthClass="w-[140px]"
          tone={filters.group !== 'all' ? 'active' : 'default'}
        />
        <MenuSelect
          value={filters.coachRag}
          onChange={(value) => onFilterChange({ coachRag: value })}
          options={withAllOption('Any Coach RAG', options.coachRag)}
          widthClass="w-[145px]"
          tone={filters.coachRag !== 'all' ? 'active' : 'default'}
        />

        <div ref={moreRef} className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen((current) => !current)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition ${
              advancedActive > 0
                ? 'border-primary-300 bg-primary-50 text-primary-800'
                : 'border-foreground-200 bg-white text-foreground-700 hover:border-foreground-300'
            }`}
          >
            <AppIcon className="ri-equalizer-line text-[13px]"></AppIcon>
            More filters
            {advancedActive > 0 ? (
              <span className="inline-flex min-w-[16px] justify-center rounded bg-primary-600 px-1 text-[12px] font-bold text-white">
                {advancedActive}
              </span>
            ) : null}
          </button>

          {moreOpen ? (
            <div
              role="dialog"
              aria-label="More filters"
              className="absolute left-0 top-[calc(100%+4px)] z-50 w-64 space-y-3 rounded-md border border-foreground-200 bg-white p-3 shadow-panel"
            >
              <div>
                <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground-400">
                  Enrolment status
                </p>
                <MenuSelect
                  value={filters.programStatus}
                  onChange={(value) => onFilterChange({ programStatus: value })}
                  options={withAllOption('Any enrolment status', options.programStatus)}
                  widthClass="w-full"
                  tone={filters.programStatus !== 'all' ? 'active' : 'default'}
                />
              </div>

              {hasEmployerData ? (
                <div>
                  <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground-400">
                    Employer
                  </p>
                  <MenuSelect
                    value={filters.employer}
                    onChange={(value) => onFilterChange({ employer: value })}
                    options={withAllOption('Any employer', options.employer)}
                    widthClass="w-full"
                    tone={filters.employer !== 'all' ? 'active' : 'default'}
                  />
                </div>
              ) : (
                <p className="text-[12px] leading-snug text-foreground-400">
                  Employer is not recorded against learners in this caseload yet, so there is nothing to filter by.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[12px] text-foreground-400 tabular-nums sm:inline">
            {resultCount} shown
          </span>
          <MenuSelect
            value={sortKey}
            onChange={(value) => onSortKeyChange(value as SortKey)}
            options={SORT_OPTIONS}
            label="Sort"
            align="right"
            widthClass="w-[210px]"
          />
          <button
            type="button"
            onClick={onSortDirToggle}
            title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
            aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-foreground-200 bg-white text-foreground-500 transition hover:border-foreground-300 hover:text-foreground-800"
          >
            <AppIcon className={sortDir === 'asc' ? 'ri-sort-asc' : 'ri-sort-desc'}></AppIcon>
          </button>
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              value={chip.value}
              onRemove={() => onFilterChange({ [chip.key]: chip.key === 'search' ? '' : 'all' } as Partial<CaseloadFilterState>)}
            />
          ))}
          <button
            type="button"
            onClick={onClearAll}
            className="ml-0.5 text-[12px] font-semibold text-foreground-500 underline-offset-2 transition hover:text-foreground-900 hover:underline"
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
});

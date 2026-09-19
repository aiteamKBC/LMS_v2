// ============================================================================
// Coach caseload — search and primary filters.
// Active values are restated underneath as removable chips.
// ============================================================================
import { memo } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { MenuSelect } from './MenuSelect';
import { FilterChip } from './primitives';
import type { FilterOption, StatusFilter } from '../types';

export interface CaseloadFilterState {
  search: string;
  cohort: string;
  group: string;
  programStatus: string;
  employer: string;
}

export interface CaseloadFilterOptions {
  cohort: FilterOption[];
  group: FilterOption[];
  programStatus: FilterOption[];
  employer: FilterOption[];
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Status' },
  { value: 'on-track', label: 'On track' },
  { value: 'need-attention', label: 'Need attention' },
  { value: 'at-risk', label: 'At risk' },
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
  statusFilter,
  onFilterChange,
  onStatusFilterChange,
  onClearAll,
}: {
  filters: CaseloadFilterState;
  options: CaseloadFilterOptions;
  statusFilter: StatusFilter;
  onFilterChange: (patch: Partial<CaseloadFilterState>) => void;
  onStatusFilterChange: (next: StatusFilter) => void;
  onClearAll: () => void;
}) {
  const chips: { key: keyof CaseloadFilterState; label: string; value: string }[] = [];
  if (filters.cohort !== 'all') chips.push({ key: 'cohort', label: 'Cohort', value: optionLabel(options.cohort, filters.cohort) });
  if (filters.group !== 'all') chips.push({ key: 'group', label: 'Group', value: optionLabel(options.group, filters.group) });
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
          value={statusFilter}
          onChange={(value) => onStatusFilterChange(value as StatusFilter)}
          options={STATUS_OPTIONS}
          widthClass="w-[150px]"
          tone={statusFilter !== 'all' ? 'active' : 'default'}
        />

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

// ============================================================================
// Coach caseload — status filters.
//
// One row, one purpose: which slice of the caseload am I looking at. The counts
// come from the same risk model the attention queue uses, so the pill and the
// queue tile can never quote different numbers for the same thing.
//
// Enrolment states other than On Break (Active, Withdrawn, Ready to enrol) live
// in the toolbar's Enrolment status filter instead of here — they answer a
// different question and repeating them would double the row for no gain.
// ============================================================================
import { memo } from 'react';
import type { CaseloadCounts } from '../lib/attention';
import type { StatusFilter } from '../types';

interface TabDefinition {
  value: StatusFilter;
  label: string;
  count: number;
  dot?: string;
  /** Hidden when the count is zero — an empty state needs no filter. */
  hideWhenEmpty?: boolean;
}

const ACTIVE_CLASS = 'border-primary-600 bg-primary-600 text-white';
const IDLE_CLASS = 'border-foreground-200 bg-white text-foreground-600 hover:border-foreground-300 hover:text-foreground-900';

export const LearnerStatusTabs = memo(function LearnerStatusTabs({
  value,
  counts,
  onChange,
}: {
  value: StatusFilter;
  counts: CaseloadCounts;
  onChange: (next: StatusFilter) => void;
}) {
  const tabs: TabDefinition[] = [
    { value: 'all', label: 'All', count: counts.total },
    { value: 'at-risk', label: 'At Risk', count: counts.critical, dot: 'bg-red-500' },
    { value: 'need-attention', label: 'Need Attention', count: counts.attention, dot: 'bg-amber-500' },
    { value: 'upcoming', label: 'Upcoming', count: counts.upcoming, dot: 'bg-accent-500', hideWhenEmpty: true },
    { value: 'on-track', label: 'On Track', count: counts.onTrack, dot: 'bg-emerald-500' },
    { value: 'break', label: 'On Break', count: counts.onBreak, dot: 'bg-foreground-300', hideWhenEmpty: true },
  ];

  return (
    <nav aria-label="Filter learners by status" className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
      {tabs
        .filter((tab) => !tab.hideWhenEmpty || tab.count > 0)
        .map((tab) => {
          const active = value === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange(tab.value)}
              aria-pressed={active}
              className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-md border px-2.5 text-[12px] font-semibold transition ${active ? ACTIVE_CLASS : IDLE_CLASS}`}
            >
              {tab.dot ? <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-white/70' : tab.dot}`}></span> : null}
              {tab.label}
              <span
                className={`inline-flex min-w-[20px] justify-center rounded px-1 py-0.5 text-[12px] font-bold tabular-nums ${
                  active ? 'bg-white/20 text-white' : 'bg-background-100 text-foreground-500'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
    </nav>
  );
});

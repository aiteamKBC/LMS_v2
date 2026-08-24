// ============================================================================
// Learner month timeline — the expanded, day-by-day detail behind a learner
// month card.
//
// Filtering by activity category and free text is this page's own structure
// and stays; the filter chips, search box and each day's activity cards now
// compose `SearchInput`, `EmptyState`, `ActionRow` and `StatusBadge` instead of
// drawing their own borders, badges and shadows.
// ============================================================================
import { useMemo } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchInput } from '@/components/ui/FilterToolbar';
import { cn } from '@/lib/cn';
import { INLINE_FILTERS } from '../lib/constants';
import { groupActivitiesByDate, inlineActivityCategory, normalizeSearch } from '../lib/monthly';
import type { InlineActivityFilter, MonthlyLearnerActivity } from '../types';
import { ActivityRow } from './ActivityRow';

export function LearnerMonthTimeline({
  learner,
  monthLabel,
  filter,
  query,
  onFilterChange,
  onQueryChange,
}: {
  learner: MonthlyLearnerActivity;
  monthLabel: string;
  filter: InlineActivityFilter;
  query: string;
  onFilterChange: (value: InlineActivityFilter) => void;
  onQueryChange: (value: string) => void;
}) {
  const filteredActivities = useMemo(() => {
    const needle = normalizeSearch(query);
    return learner.activities.filter((activity) => {
      const category = inlineActivityCategory(activity.type);
      if (filter !== 'all' && category !== filter) return false;
      if (!needle) return true;
      return [activity.type, activity.title, activity.detail, activity.source]
        .some((value) => normalizeSearch(String(value || '')).includes(needle));
    });
  }, [filter, learner.activities, query]);
  const groupedActivities = useMemo(() => groupActivitiesByDate(filteredActivities), [filteredActivities]);
  const filterCounts = useMemo(() => {
    const counts = INLINE_FILTERS.reduce((acc, item) => ({ ...acc, [item.key]: 0 }), {} as Record<InlineActivityFilter, number>);
    learner.activities.forEach((activity) => {
      counts.all += 1;
      counts[inlineActivityCategory(activity.type)] += 1;
    });
    return counts;
  }, [learner.activities]);

  return (
    <div className="p-5">
      <section className="rounded-2xl border border-foreground-200/70 bg-background-50 p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1 xl:pb-0">
            {INLINE_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onFilterChange(item.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[12px] font-semibold transition-smooth cursor-pointer',
                  filter === item.key ? 'bg-primary-600 text-white shadow-sm' : 'bg-background-100 text-foreground-600 hover:bg-primary-50 hover:text-primary-700',
                )}
              >
                <AppIcon className={cn(item.icon, 'text-sm')}></AppIcon>
                {item.label}
                <span className={filter === item.key ? 'text-white/70' : 'text-foreground-400'}>{filterCounts[item.key]}</span>
              </button>
            ))}
          </div>
          <SearchInput
            value={query}
            onChange={onQueryChange}
            placeholder="Search this month..."
            ariaLabel="Search this month's activity"
            className="w-full xl:w-72"
          />
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-primary-50/70 px-3 py-2 text-[12px] text-primary-800">
          <AppIcon className="ri-information-line mt-0.5 shrink-0 text-primary-600"></AppIcon>
          <p><span className="font-semibold">{filter === 'all' ? 'All activity' : INLINE_FILTERS.find((item) => item.key === filter)?.label}:</span> {filteredActivities.length} matching item{filteredActivities.length === 1 ? '' : 's'} in {monthLabel}.</p>
        </div>
      </section>

      <section className="mt-5">
        {groupedActivities.length === 0 ? (
          <EmptyState
            variant="no-matches"
            icon="ri-calendar-line"
            title="No matching activity"
            description="Try another filter or search."
          />
        ) : (
          <div className="space-y-5">
            {groupedActivities.map(([day, activities]) => (
              <div key={day} className="grid gap-3 lg:grid-cols-[150px_1fr]">
                <div className="lg:pt-1">
                  <div className="inline-flex items-center gap-3 rounded-2xl border border-foreground-200/60 bg-background-50 px-3 py-2 shadow-sm">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-lg font-bold text-primary-700">{new Date(`${day}T12:00:00`).getDate()}</span>
                    <div>
                      <p className="text-[12px] font-semibold text-foreground-800">{new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' })}</p>
                      <p className="mt-0.5 text-[12px] text-foreground-400">{new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} - {activities.length} item{activities.length === 1 ? '' : 's'}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  {activities.map((activity) => (
                    <ActivityRow key={activity.id} activity={activity} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ============================================================================
// Coach caseload — the work queue.
//
// Three tiles, each a filter. The names inside each tile are the point: a count
// tells a coach how much work there is, a name tells them where to start. Each
// name opens the quick view directly, so the first click of the day can be the
// useful one.
//
// Deliberately not a dashboard: no charts, fixed height, and it collapses to a
// single reassuring line when there is genuinely nothing to do.
// ============================================================================
import { memo } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import type { CaseloadCounts, InsightMap } from '../lib/attention';
import type { Learner, StatusFilter } from '../types';

interface QueueTile {
  filter: Extract<StatusFilter, 'at-risk' | 'need-attention' | 'upcoming'>;
  title: string;
  count: number;
  description: string;
  dot: string;
  activeClass: string;
  idleClass: string;
}

const NAMES_PER_TILE = 3;

export const AttentionQueue = memo(function AttentionQueue({
  learners,
  insights,
  counts,
  activeFilter,
  onFilterChange,
  onOpenLearner,
}: {
  /** Already sorted by urgency, so the first names are the right names. */
  learners: Learner[];
  insights: InsightMap;
  counts: CaseloadCounts;
  activeFilter: StatusFilter;
  onFilterChange: (next: StatusFilter) => void;
  onOpenLearner: (learner: Learner) => void;
}) {
  const tiles: QueueTile[] = [
    {
      filter: 'at-risk',
      title: 'Critical',
      count: counts.critical,
      description: 'Overdue gateway, red RAG or serious learner risk.',
      dot: 'bg-red-500',
      activeClass: 'border-red-300 bg-red-50/70 ring-1 ring-red-200',
      idleClass: 'border-foreground-200/70 bg-white hover:border-red-200',
    },
    {
      filter: 'need-attention',
      title: 'Need Attention',
      count: counts.attention,
      description: 'Attendance, OTJH or progress concerns.',
      dot: 'bg-amber-500',
      activeClass: 'border-amber-300 bg-amber-50/70 ring-1 ring-amber-200',
      idleClass: 'border-foreground-200/70 bg-white hover:border-amber-200',
    },
    {
      filter: 'upcoming',
      title: 'Upcoming',
      count: counts.upcoming,
      description: 'Gateway reviews and deadlines approaching.',
      dot: 'bg-accent-500',
      activeClass: 'border-accent-300 bg-accent-50/70 ring-1 ring-accent-200',
      idleClass: 'border-foreground-200/70 bg-white hover:border-accent-300',
    },
  ];

  const namesByFilter = new Map<StatusFilter, Learner[]>();
  for (const tile of tiles) {
    const tier = tile.filter === 'at-risk' ? 'critical' : tile.filter === 'need-attention' ? 'attention' : 'upcoming';
    namesByFilter.set(
      tile.filter,
      learners.filter((learner) => insights.get(learner.id)?.tier === tier).slice(0, NAMES_PER_TILE),
    );
  }

  if (counts.needsAction === 0) {
    return (
      <section className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5">
        <AppIcon className="ri-check-double-line text-[15px] text-emerald-600"></AppIcon>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-emerald-900">Nothing needs your attention</p>
          <p className="text-[12px] text-emerald-700/80">
            No learner is currently flagged for hours, attendance, KSBs or an approaching gateway review.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Needs your attention">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground-900">
          <AppIcon className="ri-error-warning-line text-[14px] text-amber-600"></AppIcon>
          Needs your attention
        </h2>
        <button
          type="button"
          onClick={() => onFilterChange(activeFilter === 'needs-action' ? 'all' : 'needs-action')}
          className={`inline-flex items-center gap-1 text-[12px] font-semibold transition ${
            activeFilter === 'needs-action' ? 'text-primary-800' : 'text-primary-600 hover:text-primary-800'
          }`}
        >
          {activeFilter === 'needs-action' ? `Showing all ${counts.needsAction} actions` : `View all ${counts.needsAction} actions`}
          <AppIcon className="ri-arrow-right-line text-[13px]"></AppIcon>
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => {
          const active = activeFilter === tile.filter;
          const names = namesByFilter.get(tile.filter) || [];
          const remaining = tile.count - names.length;

          return (
            <div
              key={tile.filter}
              className={`rounded-lg border px-3 py-2.5 transition ${active ? tile.activeClass : tile.idleClass}`}
            >
              <button
                type="button"
                onClick={() => onFilterChange(active ? 'all' : tile.filter)}
                aria-pressed={active}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${tile.dot}`}></span>
                <span className="text-[15px] font-bold tabular-nums text-foreground-900">{tile.count}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground-800">{tile.title}</span>
                <AppIcon
                  className={`ri-filter-line shrink-0 text-[12px] ${active ? 'text-primary-600' : 'text-foreground-300'}`}
                ></AppIcon>
              </button>

              <p className="mt-1 text-[12px] leading-tight text-foreground-500">{tile.description}</p>

              {names.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {names.map((learner) => (
                    <button
                      key={learner.id}
                      type="button"
                      onClick={() => onOpenLearner(learner)}
                      title={`Quick view: ${learner.name}`}
                      className="max-w-full truncate rounded border border-foreground-200 bg-white px-1.5 py-0.5 text-[12px] font-medium text-foreground-700 transition hover:border-primary-300 hover:text-primary-700"
                    >
                      {learner.name}
                    </button>
                  ))}
                  {remaining > 0 ? (
                    <button
                      type="button"
                      onClick={() => onFilterChange(tile.filter)}
                      className="rounded px-1 py-0.5 text-[12px] font-semibold text-primary-600 transition hover:text-primary-800"
                    >
                      +{remaining} more
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
});

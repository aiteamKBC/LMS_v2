// ============================================================================
// Top Learner Actions — the five learners with the most captured activity
// this month, as a ranked bar list.
// ============================================================================
import { Link } from 'react-router-dom';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatNumber } from '../lib/monthly';

export interface LearnerActionCount {
  id: string;
  name: string;
  initials: string;
  actionCount: number;
}

export function TopLearnerActionsPanel({
  learners,
  onOpenLearner,
}: {
  learners: LearnerActionCount[];
  onOpenLearner: (learnerId: string) => void;
}) {
  const top = learners
    .filter((learner) => learner.actionCount > 0)
    .sort((a, b) => b.actionCount - a.actionCount)
    .slice(0, 5);
  const max = top[0]?.actionCount || 1;

  return (
    <Panel>
      <SectionHeader
        title="Top Learner Actions This Month"
        actions={<Link to="#learner-month-log" className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">View all</Link>}
      />

      {top.length === 0 ? (
        <EmptyState size="sm" variant="empty" icon="ri-bar-chart-line" title="No learner activity captured yet this month." />
      ) : (
        <ol className="mt-4 space-y-3">
          {top.map((learner, index) => (
            <li key={learner.id} className="flex items-center gap-3">
              <span className="w-4 shrink-0 text-[12px] font-semibold text-foreground-400 tabular-nums">{index + 1}</span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[11px] font-bold text-primary-700">
                {learner.initials}
              </span>
              <button
                type="button"
                onClick={() => onOpenLearner(learner.id)}
                className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold text-foreground-800 hover:text-primary-700"
              >
                {learner.name}
              </button>
              <div className="hidden flex-1 sm:block">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-200">
                  <div
                    className="h-full rounded-full bg-primary-500"
                    style={{ width: `${Math.max(6, Math.round((learner.actionCount / max) * 100))}%` }}
                  />
                </div>
              </div>
              <span className="w-16 shrink-0 text-right text-[12px] text-foreground-500 tabular-nums">
                {formatNumber(learner.actionCount)} actions
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

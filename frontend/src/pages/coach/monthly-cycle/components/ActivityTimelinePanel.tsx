// ============================================================================
// Activity Timeline — the latest captured activities across every learner
// this month, each behind a coloured icon circle keyed to its type.
//
// The API only carries a calendar date per activity (no time-of-day), so
// "how long ago" is expressed in days ("Today", "Yesterday", "3 days ago")
// rather than hours — the coarsest unit the data actually supports.
// ============================================================================
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { toneStyle } from '@/lib/statusTone';
import { activityIcon } from '../lib/monthly';
import { activityStatusTone } from '../lib/tone';
import type { ActivityTone } from '../types';

function relativeDayLabel(dateValue: string): string {
  const parsed = new Date(`${dateValue.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateValue;

  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOfDay(new Date()).getTime() - startOfDay(parsed).getTime()) / 86_400_000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return `${days} days ago`;
  if (days < 0) return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(parsed);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(parsed);
}

export function ActivityTimelinePanel({
  activities,
  onOpenLearner,
}: {
  activities: Array<{ id: string; learnerId: string; learnerName: string; title: string; detail: string; date: string; type: string; tone: ActivityTone }>;
  onOpenLearner: (learnerId: string) => void;
}) {
  return (
    <Panel>
      <SectionHeader
        title="Activity Timeline"
        actions={<Link to="#learner-month-log" className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">View all</Link>}
      />

      {activities.length === 0 ? (
        <EmptyState size="sm" variant="empty" icon="ri-pulse-line" title="No captured activity yet this month." />
      ) : (
        <ul className="mt-4 space-y-4">
          {activities.map((activity) => {
            const style = toneStyle(activityStatusTone(activity.tone));
            return (
              <li key={activity.id}>
                <button
                  type="button"
                  onClick={() => onOpenLearner(activity.learnerId)}
                  className="flex w-full min-w-0 items-start gap-3 rounded-lg text-left transition hover:bg-background-100 -m-1.5 p-1.5"
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${style.bg} ${style.text}`}>
                    <AppIcon className={activityIcon(activity.type)}></AppIcon>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-foreground-900">
                      {activity.learnerName} <span className="font-normal text-foreground-500">{activity.title}</span>
                    </p>
                    <p className="truncate text-[12px] text-foreground-500">{activity.detail}</p>
                    <p className="text-[11px] text-foreground-400">{relativeDayLabel(activity.date)}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

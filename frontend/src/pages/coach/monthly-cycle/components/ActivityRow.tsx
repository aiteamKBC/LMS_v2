// ============================================================================
// A single captured activity — shared between the expanded learner timeline
// and the learner overview drawer, which used to draw two near-identical
// versions of the same card.
// ============================================================================
import { AppIcon } from '@/components/feature/AppIcon';
import { ActionRow } from '@/components/ui/ActionRow';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';
import { toneStyle } from '@/lib/statusTone';
import { formatDateLabel } from '@/pages/coach/shared/calendarEvents';
import { activityIcon, formatSourceLabel } from '../lib/monthly';
import { activityStatusTone } from '../lib/tone';
import type { MonthlyActivityItem } from '../types';

export function ActivityRow({ activity }: { activity: MonthlyActivityItem }) {
  const tone = activityStatusTone(activity.tone);
  const style = toneStyle(tone);

  return (
    <ActionRow
      tone={tone}
      leading={(
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', style.bg, style.text)}>
          <AppIcon className={cn(activityIcon(activity.type), 'text-base')}></AppIcon>
        </span>
      )}
      title={activity.title}
      subtitle={activity.detail || undefined}
      status={<StatusBadge tone={tone} label={activity.type} />}
      meta={(
        <>
          <span className="text-[12px] text-foreground-400">{formatSourceLabel(activity.source)}</span>
          <span className="text-[12px] font-medium text-foreground-500">{formatDateLabel(activity.date)}</span>
        </>
      )}
    />
  );
}

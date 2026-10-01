import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import { MEETING_STATUS_COLORS, type MeetingStatusKey, getStatusCounts } from '../meetingsView';

const STAT_ROWS: { key: MeetingStatusKey; label: string }[] = [
  { key: 'completed', label: 'Completed' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'awaiting-signature', label: 'Awaiting signature' },
];

// Workflow order, ending with Completed.
const ALL_STAT_ROWS: { key: MeetingStatusKey; label: string }[] = [
  { key: 'not-scheduled', label: 'Not scheduled' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'awaiting-signature', label: 'Awaiting signature' },
  { key: 'completed', label: 'Completed' },
];

export function MonthlyStatsCard({ counts, monthLabel, title = 'This month', totalLabel = 'Total meetings', showAllStatuses = false, statuses }: {
  counts: ReturnType<typeof getStatusCounts>;
  /** Period caption under the total, e.g. the selected month. */
  monthLabel: string;
  title?: string;
  totalLabel?: string;
  /** Adds the Not scheduled row so every status bucket is shown. */
  showAllStatuses?: boolean;
  /** Only these buckets (kept in workflow order), for pages whose events use fewer statuses. */
  statuses?: MeetingStatusKey[];
}) {
  const share = (value: number) => counts.total ? Math.round(value / counts.total * 100) : 0;
  const rows = (statuses ? ALL_STAT_ROWS.filter(row => statuses.includes(row.key)) : showAllStatuses ? ALL_STAT_ROWS : STAT_ROWS)
    .map(({ key, label }) => ({ key, label, value: counts[key], colors: MEETING_STATUS_COLORS[key] }));

  return (
    <section aria-label={title} className="rounded-[20px] border border-primary-100 bg-white p-4 shadow-[0_10px_30px_-18px_rgb(76_29_149/0.35)]">
      <h3 className="mb-4 flex items-center gap-2 text-[14px] font-bold text-primary-900"><AppIcon className="ri-bar-chart-2-fill text-primary-600" />{title}</h3>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-[18px] font-bold text-primary-800">{counts.total}</span>
        <span><strong className="block text-[13px] font-bold text-primary-900">{totalLabel}</strong><span className="text-[11px] text-foreground-500">{monthLabel}</span></span>
      </div>
      <ul className="space-y-3.5">
        {rows.map(({ key, label, value, colors }) => (
          <li key={key} className="flex items-center gap-3">
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold', colors.badge)}>{value}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between text-[12px]"><span className="font-semibold text-primary-900">{label}</span><span className="font-bold text-foreground-600">{share(value)}%</span></span>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-primary-50" role="meter" aria-label={`${label} share`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share(value)}>
                <span className={cn('block h-full rounded-full', colors.bar)} style={{ width: `${share(value)}%` }} />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

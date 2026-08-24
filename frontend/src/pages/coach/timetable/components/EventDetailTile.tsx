// ============================================================================
// A small stat tile inside the event-detail panel's header card — date, time,
// duration. Extracted from the timetable page so the page file stays a
// manageable size; this component owns no state and no calendar logic.
// ============================================================================
import type { ReactNode } from 'react';

export function EventDetailTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-background-200 bg-background-50 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-foreground-400">
        <AppIcon className={`${icon} text-[12px]`}></AppIcon>
        {label}
      </div>
      <div className="truncate text-[12px] font-bold text-foreground-950">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[12px] font-medium text-foreground-500">{sub}</div>}
    </div>
  );
}

// ============================================================================
// A single labelled fact row in the event-detail panel (target date, scheduled
// time, tutor, platform, cohort...). Extracted alongside EventDetailTile for
// the same reason — presentational only, no calendar logic.
// ============================================================================
import type { ReactNode } from 'react';

export function EventDetailLine({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-background-100 bg-white px-3 py-2 text-[12px] font-medium text-foreground-600">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
        <AppIcon className={icon}></AppIcon>
      </span>
      <div className="min-w-0 flex-1 truncate">{children}</div>
    </div>
  );
}

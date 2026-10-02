import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';
import { statusTone } from '@/lib/statusTone';
import { type CoachCalendarEvent, statusLabel } from '../../shared/calendarEvents';
import { MEETING_STATUS_COLORS, type MeetingStatusKey, getStatusKey } from '../meetingsView';

export interface StatusTabItem {
  value: string;
  label: string;
  count: number;
  /** Omit for the neutral "All" tab. */
  status?: MeetingStatusKey;
}

/** Meetings-page status filter; each tab carries its own status colour. */
export function StatusTabs({ items, value, onChange, label }: {
  items: StatusTabItem[];
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 py-1">
      {items.map(item => {
        const active = value === item.value;
        const colors = item.status ? MEETING_STATUS_COLORS[item.status] : null;
        return (
          <button key={item.value} type="button" aria-pressed={active} onClick={() => onChange(item.value)}
            className={cn('inline-flex h-10 shrink-0 items-center gap-2.5 rounded-xl border px-3.5 text-[13px] font-semibold transition hover:-translate-y-px hover:shadow-sm',
              colors ? colors.pill : 'border-primary-200 bg-primary-50 text-primary-700',
              active && (colors ? colors.active : 'border-primary-700 bg-primary-700 text-white'))}>
            {colors ? <span aria-hidden="true" className={cn('h-2.5 w-2.5 shrink-0 rounded-full', colors.dot)} /> : null}
            {item.label}
            <span className={cn('min-w-6 rounded-md px-1.5 py-0.5 text-center text-[12px] font-bold',
              colors ? colors.count : active ? 'bg-white/20 text-white' : 'bg-primary-100 text-primary-700')}>{item.count}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Row/card status pill in the same colours as the tabs. */
export function MeetingStatusPill({ event }: { event: CoachCalendarEvent }) {
  const key = getStatusKey(event);
  if (!key) return <StatusBadge tone={statusTone(event.status)} label={statusLabel(event.status)} size="sm" />;
  const colors = MEETING_STATUS_COLORS[key];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold', colors.pill)}>
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', colors.dot)} />{statusLabel(event.status)}
    </span>
  );
}

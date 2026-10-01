import { AppIcon } from '@/components/feature/AppIcon';
import { formatDateLabel } from '../shared/entities/model';
import type { LiveSessionScopeRow } from './useTeamsMeetingsWorkspace';

// ============================================================================
// "Which calendar runs each week" -- one live session, one calendar.
//
// A week delivered by both the module's own series and an additional meeting is
// the failure this prevents: the series books the same date, and its next
// Update writes its link over the additional meeting's. So every live session
// nobody has booked yet is put to the author here, and the answer is final for
// both doors: a week given to the module calendar is refused an additional
// meeting, and one given to an additional meeting is left out of every date
// the module calendar sends.
//
// Only unbooked live sessions are listed. A booking is changed by cancelling
// it -- on the calendar that holds it -- never by a toggle here.
// ============================================================================

const CHOICES = [
  { scope: 'main' as const, label: 'Module calendar', icon: 'ri-calendar-schedule-line' },
  { scope: 'additional' as const, label: 'Additional meeting', icon: 'ri-calendar-2-line' },
];

export function MeetingScopePanel({ rows, busy, disabled, onChoose }: {
  rows: LiveSessionScopeRow[];
  /** The workspace's busy key; a choice in flight reads `<module>:scope:<component>:<scope>`. */
  busy: string;
  disabled: boolean;
  onChoose: (componentId: string, scope: 'main' | 'additional') => void;
}) {
  const open = rows.filter(row => row.open);
  if (!open.length) return null;
  const pending = open.filter(row => row.scope === 'pending');
  return (
    <details open={pending.length > 0} className="mb-4 rounded-xl border border-background-200 bg-background-50 px-4 py-3">
      <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wider text-foreground-500">
        Which calendar runs each week
        {pending.length > 0 && (
          <span className="ml-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">
            {pending.length} to choose
          </span>
        )}
      </summary>
      <p className="mt-2 text-[11px] font-semibold leading-relaxed text-foreground-500">
        Each week&rsquo;s live session runs on one calendar only. A week on the module calendar cannot take an
        additional meeting, and a week given to an additional meeting is left out of the dates sent to Teams.
        Choosing saves the choice only &mdash; nothing is sent to Microsoft.
      </p>
      {pending.length > 0 && (
        <p role="status" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-900">
          <AppIcon className="ri-error-warning-line mt-0.5 shrink-0 text-sm text-amber-700"></AppIcon>
          {pending.length === 1
            ? 'One week was added after this calendar was created and is not on either calendar yet. Until you choose, it is not sent to Teams.'
            : `${pending.length} weeks were added after this calendar was created and are not on either calendar yet. Until you choose, they are not sent to Teams.`}
        </p>
      )}
      <ul className="mt-3 divide-y divide-background-200">
        {open.map(row => {
          return (
            <li key={row.componentId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-bold text-foreground-700">
                  Week {row.weekNumber} &mdash; {row.title}
                </p>
                <p className="text-[11px] font-semibold text-foreground-500">
                  {row.date ? formatDateLabel(row.date) : 'No date yet'}
                  {row.scope === 'pending' && <span className="ml-1.5 text-amber-700">&middot; Not chosen yet</span>}
                </p>
              </div>
              <div role="group" aria-label={`Calendar for week ${row.weekNumber}`} className="flex gap-1">
                {CHOICES.map(choice => {
                  const chosen = row.scope === choice.scope;
                  const saving = busy.endsWith(`:scope:${row.componentId}:${choice.scope}`);
                  return (
                    <button
                      key={choice.scope}
                      type="button"
                      aria-pressed={chosen}
                      disabled={disabled || Boolean(busy) || chosen}
                      onClick={() => onChoose(row.componentId, choice.scope)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition-smooth disabled:cursor-not-allowed ${
                        chosen
                          ? 'border-primary-600 bg-primary-600 text-white'
                          : 'border-background-200 bg-white text-foreground-600 hover:bg-background-100 disabled:opacity-50'
                      }`}
                    >
                      <AppIcon className={`${saving ? 'ri-loader-4-line animate-spin' : choice.icon} text-sm`}></AppIcon>
                      {choice.label}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

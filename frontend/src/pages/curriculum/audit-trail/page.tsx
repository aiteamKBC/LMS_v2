import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  fetchCurriculumAuditTrail,
  type CurriculumAuditEvent,
  type CurriculumAuditTrail,
} from '@/lib/curriculumApi';
import { EntityEmptyState, EntityFilterBar, EntityHero, InlineError } from '../shared/entities/ui';

/**
 * What changed in the curriculum, and when.
 *
 * The trail is derived, not logged: `created_at`, `updated_at` and `deleted_at`
 * on the authoring records are the whole source. That buys an accurate history
 * of *what* moved with no new table to keep in step — and it cannot answer
 * *who* moved it, because no authoring table records an author. The page says
 * that outright rather than filling the column with a plausible name; the only
 * attribution that exists is the reason code an archive writes, which names the
 * handler that ran ("component-delete"), not a person.
 */

const WINDOW_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
];

const ENTITY_OPTIONS = [
  { value: 'programme', label: 'Programmes' },
  { value: 'module', label: 'Modules' },
  { value: 'week', label: 'Weeks' },
  { value: 'component', label: 'Components' },
  { value: 'cohort', label: 'Cohorts' },
  { value: 'group', label: 'Groups' },
];

const ACTION_OPTIONS = [
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Edited' },
  { value: 'archived', label: 'Archived' },
];

const ACTION_STYLE: Record<string, { label: string; icon: string; dot: string; chip: string }> = {
  created: { label: 'Created', icon: 'ri-add-circle-line', dot: 'bg-emerald-500', chip: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  updated: { label: 'Edited', icon: 'ri-edit-2-line', dot: 'bg-sky-500', chip: 'border-sky-200 bg-sky-50 text-sky-700' },
  archived: { label: 'Archived', icon: 'ri-archive-line', dot: 'bg-amber-500', chip: 'border-amber-200 bg-amber-50 text-amber-700' },
};

export default function CurriculumAuditTrail() {
  const [windowDays, setWindowDays] = useState('30');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');

  const [trail, setTrail] = useState<CurriculumAuditTrail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // The window and the two selects are answered by the backend, so they refetch.
  // Search is not: it is applied to the events already on screen so typing does
  // not fire a request per keystroke against a query the page can answer itself.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchCurriculumAuditTrail({
      days: Number(windowDays),
      entity: entity || undefined,
      action: action || undefined,
      signal: controller.signal,
      skipCache: reloadToken > 0,
    })
      .then(result => {
        if (controller.signal.aborted) return;
        setTrail(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to read the curriculum audit trail');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [windowDays, entity, action, reloadToken]);

  const events = useMemo(() => {
    const rows = trail?.events ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(event => (
      event.title.toLowerCase().includes(query)
      || event.context.toLowerCase().includes(query)
      || event.entityId.toLowerCase().includes(query)
    ));
  }, [trail?.events, search]);

  const days = useMemo(() => groupByDay(events), [events]);
  const counts = trail?.actionCounts;

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Audit Trail"
      pageSubtitle="What changed across programmes, modules, weeks, components, cohorts and groups"
    >
      <div className="min-h-full space-y-4 bg-background-100 p-4 sm:p-5 lg:p-6">
        <EntityHero
          eyebrow="Record activity"
          title="Audit Trail"
          description="Read from the timestamps on the curriculum records themselves, so it shows exactly what the database holds — every create, edit and archive inside the window, newest first."
          stats={[
            { icon: 'ri-add-circle-line', label: 'Created', value: counts?.created ?? 0, detail: 'New records' },
            { icon: 'ri-edit-2-line', label: 'Edited', value: counts?.updated ?? 0, detail: 'Saved again after creation' },
            { icon: 'ri-archive-line', label: 'Archived', value: counts?.archived ?? 0, detail: 'Soft-deleted, still restorable' },
            { icon: 'ri-time-line', label: 'Window', value: `${trail?.windowDays ?? windowDays}d`, detail: 'Period being read' },
          ]}
          loading={loading}
          secondaryActions={(
            <button
              type="button"
              onClick={() => setReloadToken(token => token + 1)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-white/20"
            >
              <AppIcon className="ri-refresh-line text-base"></AppIcon>
              Refresh
            </button>
          )}
        />

        {error && <InlineError message={error} onRetry={() => setReloadToken(token => token + 1)} />}

        {trail && !trail.authorRecorded && (
          <div className="flex items-start gap-3 rounded-2xl border border-background-200 bg-background-50 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-400">
              <AppIcon className="ri-user-unfollow-line text-base"></AppIcon>
            </span>
            <p className="min-w-0 text-[11px] leading-5 text-foreground-500">
              <span className="font-bold text-foreground-700">No author is recorded against these changes.</span>{' '}
              The curriculum tables carry created, updated and deleted timestamps but no author column, so this trail
              reports what changed and when — not who. An archive shows the reason code the write handler used, which
              names the operation, not a person.
            </p>
          </div>
        )}

        {trail?.unreadable?.length ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-semibold text-amber-800">
            These records could not be read, so their changes are missing from the trail below:{' '}
            {trail.unreadable.join(', ')}.
          </div>
        ) : null}

        <EntityFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search by record name, parent or id..."
          selects={[
            { label: 'Period', value: windowDays, onChange: setWindowDays, options: WINDOW_OPTIONS },
            { label: 'Record type', value: entity, onChange: setEntity, options: ENTITY_OPTIONS },
            { label: 'Change', value: action, onChange: setAction, options: ACTION_OPTIONS },
          ]}
          onReset={() => { setSearch(''); setEntity(''); setAction(''); setWindowDays('30'); }}
          isDirty={Boolean(search || entity || action) || windowDays !== '30'}
          summary={
            loading
              ? 'Reading record timestamps...'
              : trail?.truncated
                ? `Showing the ${trail.events.length} most recent of ${trail.total} changes in this window. Narrow the period or the record type to see the rest.`
                : `${events.length} ${events.length === 1 ? 'change' : 'changes'} in this window`
          }
        />

        {loading ? (
          <div className="space-y-2 rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-xl bg-background-200/70" />
            ))}
          </div>
        ) : !events.length ? (
          <div className="rounded-2xl border border-foreground-200/60 bg-background-50">
            <EntityEmptyState
              icon="ri-history-line"
              title="No changes in this window"
              message={
                search || entity || action
                  ? 'Nothing matches these filters. Widen the period or clear the filters above.'
                  : 'Nothing in the curriculum was created, edited or archived over this period.'
              }
            />
          </div>
        ) : (
          <div className="space-y-4">
            {days.map(day => (
              <section key={day.key} className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50">
                <div className="flex items-center justify-between gap-3 border-b border-background-200 px-4 py-2.5">
                  <h2 className="font-heading text-[13px] font-bold text-foreground-900">{day.label}</h2>
                  <span className="text-[11px] font-semibold text-foreground-400">
                    {day.events.length} {day.events.length === 1 ? 'change' : 'changes'}
                  </span>
                </div>
                <ol>
                  {day.events.map(event => <AuditRow key={event.id} event={event} />)}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function AuditRow({ event }: { event: CurriculumAuditEvent }) {
  const style = ACTION_STYLE[event.action] || ACTION_STYLE.updated;
  return (
    <li className="flex items-start gap-3 border-b border-background-200/60 px-4 py-3 last:border-0 hover:bg-background-100/40">
      <span className="mt-1 flex w-14 shrink-0 justify-end text-[11px] font-semibold tabular-nums text-foreground-400">
        {timeLabel(event.at)}
      </span>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.chip}`}>
            <AppIcon className={`${style.icon} text-[11px]`}></AppIcon>
            {style.label}
          </span>
          <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">
            {event.entityLabel}
          </span>
          <Link
            to={event.href}
            className="min-w-0 truncate text-[12px] font-bold text-foreground-900 hover:text-primary-700 hover:underline"
          >
            {event.title}
          </Link>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-foreground-400">
          {event.context && <span className="truncate">{event.context}</span>}
          {event.context && <span aria-hidden="true">·</span>}
          <span className="truncate font-mono text-[10px]">{event.entityId}</span>
          {event.reason && (
            <>
              <span aria-hidden="true">·</span>
              {/* Named as a reason, never as a person — see the file header. */}
              <span className="rounded bg-background-100 px-1.5 py-0.5 font-mono text-[10px] text-foreground-500">
                reason: {event.reason}
              </span>
            </>
          )}
          {event.viaParent && (
            <>
              <span aria-hidden="true">·</span>
              <span>archived with its parent {event.viaParent}</span>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

interface AuditDay {
  key: string;
  label: string;
  events: CurriculumAuditEvent[];
}

/**
 * The backend writes UTC. Whether the driver hands back a bare
 * `2026-09-09T10:00:00` or an offset-bearing `...+00:00` depends on the column
 * type, so the marker is only added when the string carries no zone of its own
 * — appending one unconditionally turns every offset stamp into an invalid
 * date, and the whole time column silently blanks.
 */
function parseStamp(value: string): Date | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const parsed = new Date(zoned ? text : `${text}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Days are the viewer's days, matching the local times shown against each row. */
function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function groupByDay(events: CurriculumAuditEvent[]): AuditDay[] {
  const days = new Map<string, AuditDay>();
  for (const event of events) {
    const parsed = parseStamp(event.at);
    const key = parsed ? localDayKey(parsed) : 'undated';
    let day = days.get(key);
    if (!day) {
      day = { key, label: parsed ? dayLabel(parsed) : 'No date recorded', events: [] };
      days.set(key, day);
    }
    day.events.push(event);
  }
  return [...days.values()];
}

function dayLabel(parsed: Date): string {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfDay.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return parsed.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
}

function timeLabel(value: string): string {
  const parsed = parseStamp(value);
  return parsed ? parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
}

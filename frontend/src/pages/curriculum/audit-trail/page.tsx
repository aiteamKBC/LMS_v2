// Imported explicitly rather than left to unplugin-auto-import: the Vitest
// config deliberately does not load that plugin, so a page that relies on it
// cannot be rendered in a test at all. Every page with tests spells these out.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  fetchCurriculumAuditTrail,
  type CurriculumAuditEvent,
  type CurriculumAuditTrail,
} from '@/lib/curriculumApi';
import { EntityEmptyState, EntityFilterBar, EntityHero, HeroSecondaryButton, InlineError } from '../shared/entities/ui';

/**
 * What changed in the curriculum: who, when, and from what to what.
 *
 * Read from the revision log the write helpers fill, so every row names the
 * signed-in account that saved and carries the fields that actually moved. Where
 * that log has nothing — records changed before it existed — the backend falls
 * back to reading the authoring tables' own timestamps, which can say what moved
 * and when but can never say who. `authorRecorded` tells the page which of the
 * two it is showing, and it says so rather than leaving a column mysteriously
 * blank or filling it with a plausible name.
 *
 * Two things are deliberately NOT actions here. Auto-save is a *source*: the row
 * still reads "Edited", tagged with how the save was sent, because a module left
 * open all afternoon should produce one entry per real edit and not one per
 * timer tick. And a write with no signed-in account behind it is marked `system`
 * — a scheduled job or a management command — never attributed to a person who
 * happened to be nearby.
 */

const WINDOW_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
];

const ENTITY_OPTIONS = [
  { value: 'programme', label: 'Programmes' },
  { value: 'cohort', label: 'Cohorts' },
  { value: 'group', label: 'Groups' },
  { value: 'module', label: 'Modules' },
  { value: 'week', label: 'Weeks' },
  { value: 'component', label: 'Components' },
  { value: 'ksb_mapping', label: 'KSB mappings' },
  { value: 'live_session', label: 'Live sessions' },
  { value: 'holiday', label: 'Holidays' },
  { value: 'week_template', label: 'Week templates' },
];

const ACTION_OPTIONS = [
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Edited' },
  { value: 'moved', label: 'Moved' },
  { value: 'reordered', label: 'Reordered' },
  { value: 'archived', label: 'Archived' },
  { value: 'restored', label: 'Restored' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'file_uploaded', label: 'Uploaded file' },
  { value: 'file_replaced', label: 'Replaced file' },
  { value: 'file_removed', label: 'Removed file' },
  { value: 'recalculated', label: 'Recalculated' },
  { value: 'imported', label: 'Imported' },
  { value: 'recorded', label: 'First recorded' },
];

/**
 * How a save arrived. Not a change type: an auto-saved edit is still an edit,
 * and the two are separate filters here for exactly that reason.
 */
const SOURCE_OPTIONS = [
  { value: 'manual', label: 'Manual save' },
  { value: 'auto-save', label: 'Auto-save' },
  { value: 'module-builder', label: 'Module builder' },
  { value: 'tree-save', label: 'Programme tree save' },
  { value: 'import', label: 'Import' },
  { value: 'upload', label: 'File upload' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'wizard', label: 'Wizard' },
  { value: 'recalculation', label: 'Recalculation' },
  { value: 'scheduled-job', label: 'Scheduled job' },
];

const ACTOR_TYPE_OPTIONS = [
  { value: 'user', label: 'People only' },
  { value: 'system', label: 'System actions' },
  { value: 'job', label: 'Scheduled jobs' },
  { value: 'integration', label: 'Integrations' },
];

const ACTION_STYLE: Record<string, { label: string; icon: string; dot: string; chip: string }> = {
  created: { label: 'Created', icon: 'ri-add-circle-line', dot: 'bg-emerald-500', chip: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  updated: { label: 'Edited', icon: 'ri-edit-2-line', dot: 'bg-sky-500', chip: 'border-sky-200 bg-sky-50 text-sky-700' },
  moved: { label: 'Moved', icon: 'ri-drag-move-2-line', dot: 'bg-violet-500', chip: 'border-violet-200 bg-violet-50 text-violet-700' },
  reordered: { label: 'Reordered', icon: 'ri-sort-desc', dot: 'bg-indigo-500', chip: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  archived: { label: 'Archived', icon: 'ri-archive-line', dot: 'bg-amber-500', chip: 'border-amber-200 bg-amber-50 text-amber-700' },
  restored: { label: 'Restored', icon: 'ri-arrow-go-back-line', dot: 'bg-teal-500', chip: 'border-teal-200 bg-teal-50 text-teal-700' },
  deleted: { label: 'Deleted', icon: 'ri-delete-bin-line', dot: 'bg-rose-500', chip: 'border-rose-200 bg-rose-50 text-rose-700' },
  recorded: { label: 'First recorded', icon: 'ri-history-line', dot: 'bg-background-400', chip: 'border-background-200 bg-background-100 text-foreground-500' },
  file_uploaded: { label: 'Uploaded file', icon: 'ri-upload-2-line', dot: 'bg-cyan-500', chip: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
  file_replaced: { label: 'Replaced file', icon: 'ri-file-transfer-line', dot: 'bg-cyan-600', chip: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
  file_removed: { label: 'Removed file', icon: 'ri-delete-bin-6-line', dot: 'bg-orange-500', chip: 'border-orange-200 bg-orange-50 text-orange-700' },
  // Grey on purpose: nobody edited anything, so it should not read like an edit.
  recalculated: { label: 'Recalculated', icon: 'ri-calculator-line', dot: 'bg-slate-400', chip: 'border-slate-200 bg-slate-50 text-slate-600' },
  imported: { label: 'Imported', icon: 'ri-download-cloud-line', dot: 'bg-fuchsia-500', chip: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' },
};

/** A metadata key as words: `file_name` -> `File name`. */
function metadataLabel(key: string): string {
  const spaced = key.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A stored value as one readable line. `''` is shown as "empty", never as nothing. */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.trim() ? text : '(empty)';
}

export default function CurriculumAuditTrail() {
  const [windowDays, setWindowDays] = useState('30');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [source, setSource] = useState('');
  const [actorType, setActorType] = useState('');
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
      actor: actor || undefined,
      source: source || undefined,
      actorType: actorType || undefined,
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
  }, [windowDays, entity, action, actor, source, actorType, reloadToken]);

  const events = useMemo(() => {
    const rows = trail?.events ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(event => (
      event.title.toLowerCase().includes(query)
      || event.context.toLowerCase().includes(query)
      || event.entityId.toLowerCase().includes(query)
      || event.actorName.toLowerCase().includes(query)
    ));
  }, [trail?.events, search]);

  // Offered only when the trail can actually name people. On the timestamp
  // fallback there is nobody to filter by, and an empty select would imply the
  // data exists and nobody matched.
  const actorOptions = useMemo(
    () => (trail?.actors ?? []).map(person => ({
      value: person.email,
      label: `${person.name || person.email} (${person.changes})`,
    })),
    [trail?.actors],
  );

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
          description={
            trail?.source === 'timestamps'
              ? 'Read from the timestamps on the curriculum records themselves — every create, edit and archive inside the window, newest first. This reading cannot name who made a change.'
              : 'Every recorded change to programmes, cohorts, groups, modules, weeks and components — who made it, when, and exactly which fields moved. Newest first.'
          }
          stats={[
            { icon: 'ri-add-circle-line', label: 'Created', value: counts?.created ?? 0, detail: 'New records' },
            { icon: 'ri-edit-2-line', label: 'Edited', value: counts?.updated ?? 0, detail: 'Saved again after creation' },
            { icon: 'ri-archive-line', label: 'Archived', value: counts?.archived ?? 0, detail: 'Soft-deleted, still restorable' },
            { icon: 'ri-time-line', label: 'Window', value: `${trail?.windowDays ?? windowDays}d`, detail: 'Period being read' },
          ]}
          loading={loading}
          secondaryActions={(
            <HeroSecondaryButton
              icon="ri-refresh-line"
              label="Refresh"
              onClick={() => setReloadToken(token => token + 1)}
            />
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
              The revision log is not switched on for this database, so the trail falls back to the curriculum tables'
              own created, updated and deleted timestamps. Those record what changed and when, never who. An archive
              shows the reason code the write handler used, which names the operation, not a person.
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
            ...(actorOptions.length
              ? [{ label: 'Who', value: actor, onChange: setActor, options: actorOptions }]
              : []),
            // Offered only once the audit metadata lives in its own columns.
            // Before that there is nothing to filter on, and a select that
            // silently matched nothing would imply the data exists.
            ...(trail?.structuredMetadata
              ? [
                  { label: 'Made by', value: actorType, onChange: setActorType, options: ACTOR_TYPE_OPTIONS },
                  { label: 'How', value: source, onChange: setSource, options: SOURCE_OPTIONS },
                ]
              : []),
          ]}
          onReset={() => {
            setSearch(''); setEntity(''); setAction(''); setActor('');
            setSource(''); setActorType(''); setWindowDays('30');
          }}
          isDirty={Boolean(search || entity || action || actor || source || actorType) || windowDays !== '30'}
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
  const [open, setOpen] = useState(false);
  const style = ACTION_STYLE[event.action] || ACTION_STYLE.updated;
  // A create has no diff (nothing moved, it arrived) and a delete has no after,
  // so both are explained by the snapshot instead. Everything else is explained
  // by the fields that moved.
  const snapshotEntries = event.snapshot
    ? Object.entries(event.snapshot).filter(([, value]) => value !== null && value !== '')
    : [];
  const metadataEntries = Object.entries(event.metadata || {})
    .filter(([, value]) => value !== null && value !== '');
  const expandable = event.changes.length > 0 || snapshotEntries.length > 0 || metadataEntries.length > 0;

  return (
    <li className="border-b border-background-200/60 last:border-0">
      <div className="flex items-start gap-3 px-4 py-3 hover:bg-background-100/40">
        <span className="mt-1 flex w-14 shrink-0 justify-end text-[11px] font-semibold tabular-nums text-foreground-400">
          {timeLabel(event.at)}
        </span>
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.chip}`}>
              <AppIcon className={`${style.icon} text-[11px]`}></AppIcon>
              {event.actionLabel || style.label}
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
            {/* Who, said plainly. A write no person directly made is marked as
                the system rather than credited to anybody -- and where a person
                caused it, they are named as the cause, not as the author. */}
            {event.actorType && event.actorType !== 'user' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-background-200 bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">
                <AppIcon className="ri-settings-3-line text-[11px]"></AppIcon>
                {event.actorName || event.actorTypeLabel || 'System'}
              </span>
            ) : event.actorName ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground-600">
                <AppIcon className="ri-user-line text-[11px] text-foreground-400"></AppIcon>
                {event.actorName}
              </span>
            ) : null}
            {event.triggeredByName && (
              <span className="inline-flex items-center gap-1 text-[11px] text-foreground-500">
                <AppIcon className="ri-arrow-right-up-line text-[11px] text-foreground-400"></AppIcon>
                Triggered by <span className="font-semibold">{event.triggeredByName}</span>
              </span>
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-foreground-400">
            {event.context && <span className="truncate">{event.context}</span>}
            {event.context && <span aria-hidden="true">·</span>}
            <span className="truncate font-mono text-[10px]">{event.entityId}</span>
            {/* Auto-save is how the save arrived, not what happened. */}
            {event.source && (
              <>
                <span aria-hidden="true">·</span>
                <span className="rounded bg-background-100 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-500">
                  via {event.sourceLabel || event.source}
                </span>
              </>
            )}
            {event.viaParent && (
              <>
                <span aria-hidden="true">·</span>
                <span>archived with its parent {event.viaParent}</span>
              </>
            )}
            {expandable && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setOpen(current => !current)}
                  aria-expanded={open}
                  className="inline-flex items-center gap-1 rounded text-[11px] font-bold text-primary-700 hover:underline"
                >
                  <AppIcon className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-[12px]`}></AppIcon>
                  {event.changes.length
                    ? `${event.changes.length} changed ${event.changes.length === 1 ? 'field' : 'fields'}`
                    : event.action === 'deleted' ? 'What was deleted'
                    : snapshotEntries.length ? 'What was created'
                    : 'Details'}
                </button>
              </>
            )}
          </p>
        </div>
      </div>
      {open && (
        <div className="border-t border-background-200/60 bg-background-100/40 px-4 py-3 pl-[4.75rem]">
          {event.changes.length > 0 && (
            <dl className="space-y-2">
              {event.changes.map(change => (
                <div key={change.field} className="rounded-lg border border-background-200 bg-background-50 px-3 py-2">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-foreground-500">
                    {change.label}
                  </dt>
                  <dd className="mt-1 grid gap-1 sm:grid-cols-2">
                    <span className="min-w-0 break-words rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-800">
                      <span className="font-bold">Before:</span> {displayValue(change.before)}
                    </span>
                    <span className="min-w-0 break-words rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
                      <span className="font-bold">After:</span> {displayValue(change.after)}
                    </span>
                  </dd>
                  {change.truncated && (
                    <p className="mt-1 text-[10px] text-foreground-400">
                      Shortened for display. The full value is kept in the record's own history.
                    </p>
                  )}
                </div>
              ))}
            </dl>
          )}
          {/* The stored record. For a delete this is the only copy that still
              exists anywhere, which is the whole reason it is captured before
              the row goes rather than looked up afterwards. */}
          {!event.changes.length && snapshotEntries.length > 0 && (
            <dl className="grid gap-1 sm:grid-cols-2">
              {snapshotEntries.map(([key, value]) => (
                <div key={key} className="flex min-w-0 gap-2 rounded bg-background-50 px-2 py-1">
                  <dt className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-foreground-500">{key}</dt>
                  <dd className="min-w-0 break-words text-[11px] text-foreground-700">{displayValue(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          {/* What the write itself carried: the file an upload attached, the
              batch an import belonged to. Allowlisted server-side, so it is
              never content and never a credential. */}
          {metadataEntries.length > 0 && (
            <dl className="mt-2 flex flex-wrap gap-2">
              {metadataEntries.map(([key, value]) => (
                <div key={key} className="flex min-w-0 items-baseline gap-1.5 rounded-lg border border-background-200 bg-background-50 px-2 py-1">
                  <dt className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-foreground-500">
                    {metadataLabel(key)}
                  </dt>
                  <dd className="min-w-0 break-words text-[11px] text-foreground-700">{displayValue(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-2 text-[10px] text-foreground-400">
            Event <span className="font-mono">{event.action}</span>
            {event.revisionNo > 0 && <> · revision {event.revisionNo}</>}
            {event.actorTypeLabel && <> · {event.actorTypeLabel}</>}
            {event.sourceLabel && <> · via {event.sourceLabel}</>}
            {event.reason && <> · handler <span className="font-mono">{event.reason}</span></>}
            {event.actorEmail && <> · {event.actorEmail}</>}
            {event.triggeredByEmail && <> · triggered by {event.triggeredByEmail}</>}
          </p>
        </div>
      )}
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

// Imported explicitly rather than left to unplugin-auto-import: the Vitest
// config deliberately does not load that plugin, so a page that relies on it
// cannot be rendered in a test at all. Every page with tests spells these out.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import {
  fetchPersonActivity,
  type CurriculumActivityPage,
  type CurriculumActivityVisit,
  type CurriculumAuditEvent,
  type CurriculumPersonActivity,
} from '@/lib/curriculumApi';
import {
  EntityEmptyState,
  EntityFilterBar,
  EntityHero,
  HeroSecondaryButton,
  InlineError,
} from '@/pages/curriculum/shared/entities/ui';
import { auditEventHref, auditFieldValueLabel, auditValueLabel, auditValueTitle, clockLabel, durationLabel, parseActivityStamp, spanLabel, stampLabel, timeMetaLabel } from './activityTime';
import { useAuditRecordNames } from './auditNames';
import { DEFAULT_WINDOW_DAYS, type AuditTrailScope } from './scope';

/**
 * One person's time in the workspace this door is scoped to: every visit, the
 * pages opened in it, and what happened on each page.
 *
 * The nesting is the point. "What did this person do?" is not answerable by a
 * flat list of events — a search means something different depending on which
 * page it was typed on, and a save means something different depending on what
 * was open at the time. So a visit holds its pages in order, and a page holds
 * the read actions taken on it and the saves recorded while it was open.
 *
 * Two honesty rules run through this page:
 *
 * * Every saved change is shown in the activity log. Changes without a linked
 *   page remain clearly labelled rather than being attached to a guessed page.
 * * Account sign-ins are intentionally left out of this focused change log:
 *   the page answers what this person changed, and signing in changes nothing.
 */

const WINDOW_OPTIONS = [
  { value: '1', label: 'Today (last 24 hours)' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
];

const ACTION_ICON: Record<string, string> = {
  search: 'ri-search-line',
  filter: 'ri-filter-3-line',
  sort: 'ri-sort-desc',
  export: 'ri-file-download-line',
  download: 'ri-download-2-line',
  record_view: 'ri-file-search-line',
  tab: 'ri-layout-column-line',
  print: 'ri-printer-line',
};

export default function AuditTrailPersonView({ scope }: { scope: AuditTrailScope }) {
  const params = useParams();
  const email = decodeURIComponent(params.email || '');
  // Taken from the link rather than defaulted, so opening somebody from a
  // 90-day list does not land on their page showing 30 days -- and so the
  // request the list already made on their behalf is the one this page asks
  // for, which is what makes the page appear rather than load.
  const [searchParams] = useSearchParams();
  const linkedDays = Number(searchParams.get('days'));
  const [windowDays, setWindowDays] = useState(
    String(Number.isFinite(linkedDays) && linkedDays > 0 ? linkedDays : DEFAULT_WINDOW_DAYS),
  );
  const [search, setSearch] = useState('');
  const [timeFilter, setTimeFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
  const [recordFilter, setRecordFilter] = useState('all');
  const [detailFilter, setDetailFilter] = useState('all');
  const [reloadToken, setReloadToken] = useState(0);

  const [activity, setActivity] = useState<CurriculumPersonActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return undefined;
    const controller = new AbortController();
    setLoading(true);
    fetchPersonActivity(email, {
      days: Number(windowDays),
      workspace: scope.workspace,
      signal: controller.signal,
      revalidate: reloadToken > 0,
    })
      .then(result => {
        if (controller.signal.aborted) return;
        setActivity(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to read this person’s activity');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [email, windowDays, reloadToken]);

  // Search is applied to every saved change shown in the log. Page visits remain
  // available in the API for the People view, while this page answers what changed.
  const changes = useMemo(() => activity?.changes ?? [], [activity?.changes]);
  // Names for the ids a save refers to, so a link field reads as the records it
  // points at rather than as a count of them.
  const names = useAuditRecordNames(changes);
  const filterOptions = useMemo(() => ({
    activities: [...new Map(changes.map(change => [change.action, change.actionLabel || change.action])).entries()],
    records: [...new Map(changes.map(change => [change.entity, change.entityLabel || change.entity])).entries()],
    details: [...new Set(changes.flatMap(change => change.changes?.map(field => field.label) || []))].sort(),
  }), [changes]);

  const logChanges = useMemo(() => {
    const rows = changes;
    const query = search.trim().toLowerCase();
    return rows.filter(change => (
      (!query
        || change.title.toLowerCase().includes(query)
        || change.entityLabel.toLowerCase().includes(query)
        || change.context.toLowerCase().includes(query)
        || change.entityId.toLowerCase().includes(query))
      && (timeFilter === 'all' || activityTimeBucket(change.at) === timeFilter)
      && (activityFilter === 'all' || change.action === activityFilter)
      && (recordFilter === 'all' || change.entity === recordFilter)
      && (detailFilter === 'all'
        || (detailFilter === 'none' ? !change.changes?.length : change.changes?.some(field => field.label === detailFilter)))
    ));
  }, [changes, search, timeFilter, activityFilter, recordFilter, detailFilter]);

  const person = activity?.person;
  const counts = activity?.counts;

  return (
    <WorkspaceShell
      role={scope.role}
      roleLabel={scope.roleLabel}
      navItems={scope.navItems}
      workspaceLabel={scope.workspaceLabel}
      pageTitle={person?.name || email || 'Person'}
      pageSubtitle="Changes saved by this person"
      showBackButton
      backFallbackHref={scope.basePath}
      breadcrumbCurrentLabel={person?.name || email}
    >
      <div className="min-h-full space-y-4 bg-background-100 p-4 sm:p-5 lg:p-6">
        <EntityHero
          eyebrow="Audit trail"
          title={person?.name || email || 'Person'}
          description={
            person?.email
              ? `${person.email}${person.role ? ` · ${person.role}` : ''}`
              : 'Reading this person’s activity'
          }
          stats={[{ icon: 'ri-edit-2-line', label: 'Changes', value: counts?.changes ?? 0, detail: 'Saves recorded against them' }]}
          loading={loading && !activity}
          secondaryActions={(
            <HeroSecondaryButton
              icon="ri-refresh-line"
              label="Refresh"
              onClick={() => setReloadToken(token => token + 1)}
            />
          )}
        />

        {error && <InlineError message={error} onRetry={() => setReloadToken(token => token + 1)} />}

        <EntityFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search saved changes..."
          selects={[{ label: 'Period', value: windowDays, onChange: setWindowDays, options: WINDOW_OPTIONS }]}
          onReset={() => { setSearch(''); setWindowDays('30'); setTimeFilter('all'); setActivityFilter('all'); setRecordFilter('all'); setDetailFilter('all'); }}
          isDirty={Boolean(search) || windowDays !== '30' || timeFilter !== 'all' || activityFilter !== 'all' || recordFilter !== 'all' || detailFilter !== 'all'}
          summary={
            loading
              ? 'Reading this person’s activity...'
              : `${logChanges.length} ${logChanges.length === 1 ? 'change' : 'changes'} in this period`
          }
        />

        <p className="flex items-center gap-2 text-[11px] text-foreground-500">
          <AppIcon className="ri-time-line text-foreground-400" />
          Times are shown in your local time. Hover a time to see the full date and timezone.
        </p>

        {loading && !activity ? (
          <div className="space-y-2 rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-xl bg-background-200/70" />
            ))}
          </div>
        ) : (
          <>
            {logChanges.length > 0 && (
              <section className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50">
                <div className="border-b border-background-200 px-4 py-2.5">
                  <h2 className="font-heading text-[13px] font-bold text-foreground-900">
                    Activity log
                  </h2>
                  <p className="mt-0.5 text-[11px] text-foreground-400">
                    Every saved change made by this person in the selected period. Changes without a linked page are
                    kept here with the same clear record details instead of being assigned to a page by guesswork.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[720px] w-full text-left">
                    <caption className="sr-only">Activity log with filters for time, activity, record, and details</caption>
                    <thead className="border-b border-background-200 bg-background-100/60">
                      <tr className="text-[10px] font-extrabold uppercase tracking-wide text-foreground-500">
                        <th scope="col" className="w-44 px-4 py-2.5">
                          <TableFilter label="Time" value={timeFilter} onChange={setTimeFilter} options={[['all', 'All times'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['earlier', 'Earlier']]} />
                        </th>
                        <th scope="col" className="w-40 px-4 py-2.5">
                          <TableFilter label="Activity" value={activityFilter} onChange={setActivityFilter} options={[['all', 'All activity'], ...filterOptions.activities]} />
                        </th>
                        <th scope="col" className="px-4 py-2.5">
                          <TableFilter label="Record" value={recordFilter} onChange={setRecordFilter} options={[['all', 'All records'], ...filterOptions.records]} />
                        </th>
                        <th scope="col" className="px-4 py-2.5">
                          <TableFilter label="Details" value={detailFilter} onChange={setDetailFilter} options={[['all', 'All details'], ['none', 'No field details'], ...filterOptions.details.map(label => [label, label] as [string, string])]} />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-background-200/70">
                      {groupChanges(logChanges).map(({ change, count }) => (
                        <ChangeTableRow key={change.id} change={change} count={count} names={names} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {!logChanges.length && (
              <div className="rounded-2xl border border-foreground-200/60 bg-background-50">
                <EntityEmptyState
                  icon="ri-edit-2-line"
                  title={search ? 'No saved changes match this search' : 'No activity recorded in this period'}
                  message={search ? 'Clear the search or widen the period above.' : 'This person has no saved changes in the selected period.'}
                />
              </div>
            )}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

/** One sitting, newest first, with its pages in the order they were opened. */
function VisitCard({ visit }: { visit: CurriculumActivityVisit }) {
  const span = spanLabel(visit.startedAt, visit.endedAt);
  return (
    <section className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-background-200 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="font-heading text-[13px] font-bold text-foreground-900">
            {stampLabel(visit.startedAt)}
          </h2>
          <p className="mt-0.5 text-[11px] text-foreground-400">
            {visit.pageCount} {visit.pageCount === 1 ? 'page' : 'pages'}
            {' · '}{visit.actionCount} {visit.actionCount === 1 ? 'action' : 'actions'}
            {visit.changeCount > 0 && <>{' · '}{visit.changeCount} {visit.changeCount === 1 ? 'change' : 'changes'}</>}
            {span && <>{' · '}lasted {span}</>}
          </p>
        </div>
        {visit.ip && <span className="font-mono text-[10px] text-foreground-400">{visit.ip}</span>}
      </div>
      <ol className="divide-y divide-background-200/70">
        {visit.pages.map(page => <PageRow key={page.id} page={page} />)}
      </ol>
    </section>
  );
}

/** One page opened: when, for how long, and everything done on it. */
function PageRow({ page }: { page: CurriculumActivityPage }) {
  const [open, setOpen] = useState(false);
  const duration = durationLabel(page.durationMs);
  const activity = page.actions.length + page.changes.length;

  return (
    <li>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="mt-0.5 flex w-14 shrink-0 justify-end text-[11px] font-semibold tabular-nums text-foreground-400">
          <span title={timeMetaLabel(page.at)} aria-label={timeMetaLabel(page.at)}>{clockLabel(page.at)}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={page.path}
              className="truncate text-[12px] font-bold text-foreground-900 hover:text-primary-700 hover:underline"
            >
              {page.pageLabel || page.path}
            </Link>
            {page.targetLabel && (
              <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">
                {page.targetLabel}
              </span>
            )}
            {/* A missing duration is said, not shown as zero: the tab was
                closed before it could be reported, which is not "0s here". */}
            <span className="text-[11px] text-foreground-400">
              {duration ? `open ${duration}` : 'time open not recorded'}
            </span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-foreground-400">
            <span className="truncate font-mono text-[10px]">{page.path}</span>
            {activity > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setOpen(current => !current)}
                  aria-expanded={open}
                  className="inline-flex items-center gap-1 rounded text-[11px] font-bold text-primary-700 hover:underline"
                >
                  <AppIcon className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-[12px]`}></AppIcon>
                  {page.actions.length > 0 && `${page.actions.length} ${page.actions.length === 1 ? 'action' : 'actions'}`}
                  {page.actions.length > 0 && page.changes.length > 0 && ', '}
                  {page.changes.length > 0 && `${page.changes.length} ${page.changes.length === 1 ? 'change' : 'changes'}`}
                </button>
              </>
            )}
            {activity === 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>opened, nothing else recorded</span>
              </>
            )}
          </p>
        </div>
      </div>
      {open && (
        <div className="border-t border-background-200/60 bg-background-100/40 px-4 py-3 pl-[4.75rem]">
          {page.actions.length > 0 && (
            <ol className="space-y-1.5">
              {page.actions.map(action => (
                <li key={action.id} className="flex flex-wrap items-baseline gap-2 rounded-lg border border-background-200 bg-background-50 px-3 py-1.5">
                  <span className="text-[11px] font-semibold tabular-nums text-foreground-400" title={timeMetaLabel(action.at)} aria-label={timeMetaLabel(action.at)}>{clockLabel(action.at)}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-foreground-700">
                    <AppIcon className={`${ACTION_ICON[action.kind] || 'ri-cursor-line'} text-[12px] text-foreground-400`}></AppIcon>
                    {action.label}
                  </span>
                  {Object.entries(action.detail || {}).map(([key, value]) => (
                    <span key={key} className="rounded bg-background-100 px-1.5 py-0.5 text-[10px] text-foreground-600">
                      {activityDetailLabel(key)}: {value}
                    </span>
                  ))}
                  {action.targetLabel && (
                    <span className="text-[11px] text-foreground-500">{action.targetLabel}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {page.changes.length > 0 && (
            <ol className={page.actions.length ? 'mt-2 space-y-1.5' : 'space-y-1.5'}>
              {page.changes.map(change => (
                <li key={change.id} className="rounded-lg border border-background-200 bg-background-50 px-3 py-1.5">
                  <ChangeLine change={change} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

/** A recorded save, said in one line: when, what happened, and to what. */
function ChangeLine({ change, count = 1 }: { change: CurriculumAuditEvent; count?: number }) {
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <span className="text-[11px] font-semibold tabular-nums text-foreground-400" title={timeMetaLabel(change.at)} aria-label={timeMetaLabel(change.at)}>{clockLabel(change.at)}</span>
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700">
        {change.actionLabel || change.action}
      </span>
      <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">
        {change.entityLabel}
      </span>
      <Link to={auditEventHref(change)} className="truncate text-[12px] font-bold text-foreground-900 hover:text-primary-700 hover:underline">
        {change.title}
      </Link>
      {count > 1 && (
        <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">
          {count} identical records
        </span>
      )}
      {change.changes?.length ? (
        <span className="text-[11px] text-foreground-400">
          {change.changes.length} {change.changes.length === 1 ? 'field' : 'fields'}:{' '}
          {change.changes.map(field => field.label).join(', ')}
        </span>
      ) : null}
    </span>
  );
}

function ChangeTableRow({ change, count, names }: { change: CurriculumAuditEvent; count: number; names: ReadonlyMap<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  const fieldCount = change.changes?.length || 0;
  return (
    <>
      <tr className="align-top hover:bg-background-100/40">
        <td className="px-4 py-3">
          <span className="block text-[12px] font-semibold tabular-nums text-foreground-800" title={timeMetaLabel(change.at)}>
            {clockLabel(change.at)}
          </span>
          <span className="mt-0.5 block text-[10px] leading-4 text-foreground-400">
            {timeMetaLabel(change.at)}
          </span>
        </td>
        <td className="px-4 py-3">
          <ActivityBadge change={change} />
        </td>
        <td className="max-w-[260px] px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">
              {change.entityLabel}
            </span>
            <Link to={auditEventHref(change)} className="truncate text-[12px] font-bold text-foreground-900 hover:text-primary-700 hover:underline">
              {change.title}
            </Link>
          </div>
        </td>
        <td className="px-4 py-3 text-[11px] text-foreground-500">
          {count > 1 && <span className="mr-2 rounded-full bg-background-100 px-2 py-0.5 font-bold text-foreground-500">{count} identical records</span>}
          {fieldCount ? (
            <button
              type="button"
              onClick={() => setExpanded(value => !value)}
              aria-expanded={expanded}
              className="font-semibold text-primary-700 underline decoration-primary-200 underline-offset-2 hover:text-primary-900"
            >
              {fieldCount} {fieldCount === 1 ? 'field' : 'fields'} changed
            </button>
          ) : 'No field details recorded'}
        </td>
      </tr>
      {expanded && fieldCount > 0 && (
        <tr className="bg-primary-50/40">
          <td colSpan={4} className="px-4 py-3">
            <div className="rounded-lg border border-primary-100 bg-background-50 p-3">
              <p className="mb-2 text-[11px] font-bold text-foreground-700">What changed in this save</p>
              <dl className="grid gap-2">
                {change.changes.map(field => (
                  <div key={field.field} className="rounded-lg border border-background-200 bg-background-50 px-3 py-2.5">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-foreground-600">{field.label}</dt>
                    <dd className="mt-2 grid gap-2 sm:grid-cols-2">
                      <AuditValue label="Before" value={field.before} tone="muted" field={field} fields={change.changes} side="before" names={names} />
                      <AuditValue label="After" value={field.after} tone="changed" field={field} fields={change.changes} side="after" names={names} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function auditValue(value: unknown): string {
  return auditValueLabel(value);
}

function AuditValue({ label, value, tone, field, fields, side, names }: {
  label: string;
  value: unknown;
  tone: 'muted' | 'changed';
  field?: { label: string };
  fields?: Array<{ label: string; before?: unknown; after?: unknown }>;
  side?: 'before' | 'after';
  names?: ReadonlyMap<string, string>;
}) {
  const [copied, setCopied] = useState(false);
  const text = field && fields && side
    ? auditFieldValueLabel(field.label, value, fields, side, names)
    : auditValue(value);
  const copy = async () => {
    if (text === 'Empty') return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { setCopied(false); }
  };
  return (
    <div className={`min-w-0 rounded-md border px-2.5 py-2 ${tone === 'changed' ? 'border-emerald-200 bg-emerald-50/60' : 'border-background-200 bg-background-100/50'}`}>
      <span className="block text-[9px] font-bold uppercase tracking-wide text-foreground-400">{label}</span>
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate text-[11px] text-foreground-700" title={auditValueTitle(value)}>{text}</code>
        {text !== 'Empty' && (
          <button type="button" onClick={() => void copy()} className="shrink-0 rounded p-1 text-foreground-400 hover:bg-background-200 hover:text-primary-700" aria-label={`Copy ${label.toLowerCase()} value`} title={copied ? 'Copied' : `Copy ${label.toLowerCase()} value`}>
            <AppIcon className={copied ? 'ri-check-line text-emerald-600' : 'ri-file-copy-line'} />
          </button>
        )}
      </div>
    </div>
  );
}

function TableFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[10px] font-extrabold uppercase tracking-wide text-foreground-500">
      <span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} className="h-7 min-w-0 rounded-md border border-background-200 bg-background-50 px-1.5 text-[10px] font-semibold normal-case tracking-normal text-foreground-700 outline-none focus:border-primary-300">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function ActivityBadge({ change }: { change: CurriculumAuditEvent }) {
  const label = change.actionLabel || change.action;
  return (
    <span
      className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700"
      title={activityDescription(change)}
      aria-label={`${label}: ${activityDescription(change)}`}
    >
      {label}
    </span>
  );
}

function activityDescription(change: CurriculumAuditEvent): string {
  if (change.action === 'recorded') return 'The first activity for this record was captured in the audit history; it does not mean someone edited it just now.';
  if (change.action === 'created') return 'This record was created.';
  if (change.action === 'updated') return 'A saved change was made to this record.';
  // Not "removed from active curriculum": the same page now shows learner,
  // staff, employer and coaching records, and none of those are curriculum.
  if (change.action === 'archived') return 'This record was archived. It is withdrawn from use and still restorable.';
  if (change.action === 'deleted') return 'This record was deleted.';
  return `${change.actionLabel || change.action} activity was recorded for this record.`;
}

function activityTimeBucket(value: string): string {
  const parsed = parseActivityStamp(value);
  if (!parsed) return 'earlier';
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const parsedDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
  const days = Math.round((dayStart - parsedDay) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return 'earlier';
}

function groupChanges(changes: CurriculumAuditEvent[]): Array<{ change: CurriculumAuditEvent; count: number }> {
  const groups = new Map<string, { change: CurriculumAuditEvent; count: number }>();
  for (const change of changes) {
    const key = [change.at, change.action, change.entity, change.entityId, change.title, change.href].join('|');
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { change, count: 1 });
  }
  return [...groups.values()];
}

function activityDetailLabel(key: string): string {
  const labels: Record<string, string> = {
    query: 'Search term',
    scope: 'Area',
    filter: 'Filter',
    sort: 'Sorted by',
    export: 'Export',
  };
  return labels[key] || key.replace(/_/g, ' ').replace(/^./, value => value.toUpperCase());
}

function pageMatches(page: CurriculumActivityPage, query: string): boolean {
  return (
    page.pageLabel.toLowerCase().includes(query)
    || page.path.toLowerCase().includes(query)
    || page.targetLabel.toLowerCase().includes(query)
    || page.actions.some(action => (
      action.label.toLowerCase().includes(query)
      || Object.values(action.detail || {}).some(value => String(value).toLowerCase().includes(query))
    ))
    || page.changes.some(change => change.title.toLowerCase().includes(query))
  );
}

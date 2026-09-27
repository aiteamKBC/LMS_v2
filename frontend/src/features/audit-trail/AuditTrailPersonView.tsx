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
  EntityPagination,
  HeroSecondaryButton,
  InlineError,
} from '@/pages/curriculum/shared/entities/ui';
import { auditEventHref, auditFieldValueLabel, auditValueLabel, auditValueTitle, clockLabel, durationLabel, parseActivityStamp, spanLabel, stampLabel, timeMetaLabel } from './activityTime';
import { actionMeaning, changeStory, snapshotEntries, type ChangeTone } from './changeStory';
import { useAuditRecordNames } from './auditNames';
import { DEFAULT_WINDOW_DAYS, windowLimitFor, windowOptionsFor, type AuditTrailScope } from './scope';

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
 * * Account access is shown separately because login/logout is account-wide,
 *   not evidence that a person entered a particular workspace.
 */


/** Rows per page of the activity log. Matches the people list's own page size,
 *  so the two tables in this door feel like the same size of page. */
const CHANGES_PAGE_SIZE = 50;

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

type AccountEvent = { id: number; at: string; event: 'login' | 'logout'; succeeded: boolean };

function eventKind(e: AccountEvent): 'in' | 'out' | 'fail' {
  if (e.event === 'logout') return 'out';
  return e.succeeded ? 'in' : 'fail';
}

const EVENT_META = {
  in:   { label: 'Signed in',      dot: 'bg-emerald-500', text: 'text-emerald-700',  icon: 'ri-login-circle-line' },
  out:  { label: 'Signed out',     dot: 'bg-foreground-300', text: 'text-foreground-500', icon: 'ri-logout-circle-r-line' },
  fail: { label: 'Sign-in failed', dot: 'bg-red-500',     text: 'text-red-600',      icon: 'ri-error-warning-line' },
};

function accountEventDayLabel(isoStamp: string): string {
  const d = new Date(isoStamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

function groupByDay(events: AccountEvent[]): { day: string; events: AccountEvent[] }[] {
  const groups: { day: string; events: AccountEvent[] }[] = [];
  for (const e of events) {
    const day = accountEventDayLabel(e.at);
    if (!groups.length || groups[groups.length - 1].day !== day) {
      groups.push({ day, events: [e] });
    } else {
      groups[groups.length - 1].events.push(e);
    }
  }
  return groups;
}

function AccountAccessButton({ events, truncated }: { events: AccountEvent[]; truncated: boolean }) {
  const [open, setOpen] = useState(false);

  const signIns  = events.filter(e => eventKind(e) === 'in').length;
  const signOuts = events.filter(e => eventKind(e) === 'out').length;
  const failures = events.filter(e => eventKind(e) === 'fail').length;
  const groups   = useMemo(() => groupByDay(events), [events]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-3 rounded-xl border border-foreground-200/60 bg-background-50 px-4 py-3 text-sm font-semibold hover:bg-background-100 transition-colors w-full text-left"
      >
        <i className="ri-shield-keyhole-line text-base text-foreground-400 shrink-0" aria-hidden="true" />
        <span className="flex-1">Account access history</span>
        <span className="flex items-center gap-2 text-xs font-normal">
          {failures > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-red-700">
              <i className="ri-error-warning-line" aria-hidden="true" />{failures} failed
            </span>
          )}
          <span className="rounded-full bg-foreground-100 px-2 py-0.5 text-foreground-600">
            {events.length}{truncated ? '+' : ''} events
          </span>
          <i className="ri-arrow-right-s-line text-foreground-400" aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Account access history"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-6"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="flex w-full sm:max-w-2xl flex-col rounded-t-2xl sm:rounded-2xl bg-background-50 shadow-2xl max-h-[90vh] sm:max-h-[80vh]">

            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-background-200 shrink-0">
              <div>
                <h2 className="font-bold text-foreground-900">Account access</h2>
                <p className="mt-0.5 text-xs text-foreground-500">Sign-ins and sign-outs across the LMS, independent of workspace.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-foreground-400 hover:bg-background-100 hover:text-foreground-700 transition-colors ml-4 shrink-0"
              >
                <i className="ri-close-line text-lg" aria-hidden="true" />
              </button>
            </div>

            {/* Summary chips */}
            <div className="flex gap-3 px-5 py-3 border-b border-background-200/60 shrink-0 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="font-semibold text-foreground-700">{signIns}</span>
                <span className="text-foreground-500">signed in</span>
              </span>
              <span className="text-foreground-300 text-xs">·</span>
              <span className="flex items-center gap-1.5 text-xs">
                <span className="h-2 w-2 rounded-full bg-foreground-300 shrink-0" />
                <span className="font-semibold text-foreground-700">{signOuts}</span>
                <span className="text-foreground-500">signed out</span>
              </span>
              {failures > 0 && (
                <>
                  <span className="text-foreground-300 text-xs">·</span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                    <span className="font-semibold text-red-700">{failures}</span>
                    <span className="text-red-600">failed attempt{failures !== 1 ? 's' : ''}</span>
                  </span>
                </>
              )}
              {truncated && (
                <span role="status" className="ml-auto text-xs text-amber-700 flex items-center gap-1">
                  <i className="ri-information-line" aria-hidden="true" />Latest 200 shown
                </span>
              )}
            </div>

            {/* Event list grouped by day */}
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-4">
              {groups.map(group => (
                <div key={group.day}>
                  <p className="sticky top-0 bg-background-50 pb-1.5 pt-0.5 text-[11px] font-bold uppercase tracking-wider text-foreground-400">
                    {group.day}
                  </p>
                  <ul className="space-y-1">
                    {group.events.map(event => {
                      const kind = eventKind(event);
                      const meta = EVENT_META[kind];
                      return (
                        <li key={event.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-background-100 transition-colors">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dot}`} aria-hidden="true" />
                          <span className={`flex-1 text-xs font-medium ${meta.text}`}>{meta.label}</span>
                          <time
                            dateTime={event.at}
                            title={timeMetaLabel(event.at)}
                            className="text-[11px] text-foreground-400 tabular-nums shrink-0"
                          >
                            {new Date(event.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </time>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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
    // Capped: an older link asking for more than is kept opens on what is kept.
    String(Number.isFinite(linkedDays) && linkedDays > 0 ? Math.min(linkedDays, windowLimitFor(scope.workspace)) : DEFAULT_WINDOW_DAYS),
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
  }, [email, windowDays, reloadToken, scope.workspace]);

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

  // Grouped once here rather than inside the render, because the grouped list
  // -- not the raw one -- is what gets paged: a page boundary has to land
  // between two rows the reader actually sees, not partway through a run of
  // duplicates that render as one row further down.
  const groupedChanges = useMemo(() => groupChanges(logChanges), [logChanges]);
  const [page, setPage] = useState(1);
  // Any change to what is being asked for puts the reader back on page one.
  // Staying on page nine of a search that just changed would show whatever
  // happens to be ninth in a different answer, or nothing at all.
  useEffect(() => {
    setPage(1);
  }, [search, timeFilter, activityFilter, recordFilter, detailFilter, windowDays]);
  const totalPages = Math.max(1, Math.ceil(groupedChanges.length / CHANGES_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageChanges = useMemo(
    () => groupedChanges.slice((currentPage - 1) * CHANGES_PAGE_SIZE, currentPage * CHANGES_PAGE_SIZE),
    [groupedChanges, currentPage],
  );

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
          selects={[{ label: 'Period', value: windowDays, onChange: setWindowDays, options: windowOptionsFor(scope.workspace) }]}
          onReset={() => { setSearch(''); setWindowDays(String(DEFAULT_WINDOW_DAYS)); setTimeFilter('all'); setActivityFilter('all'); setRecordFilter('all'); setDetailFilter('all'); }}
          isDirty={Boolean(search) || windowDays !== String(DEFAULT_WINDOW_DAYS) || timeFilter !== 'all' || activityFilter !== 'all' || recordFilter !== 'all' || detailFilter !== 'all'}
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
            {activity?.accountEventsRecorded === false && (
              <p role="status" className="text-sm text-amber-700">Account access history could not be read.</p>
            )}
            {!!activity?.accountEvents?.length && (
              <AccountAccessButton events={activity.accountEvents} truncated={!!activity.accountEventsTruncated} />
            )}
            {logChanges.length > 0 && (
              <section className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50">
                <div className="border-b border-background-200 px-4 py-2.5">
                  <h2 className="font-heading text-[13px] font-bold text-foreground-900">
                    Activity log
                  </h2>
                  <p className="mt-0.5 text-[11px] text-foreground-400">
                    Every saved change made by this person in the selected period, said in plain words. A change the
                    system made on its own says so, rather than reading as this person’s edit.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3 border-b border-background-200 bg-background-100/60 px-4 py-2.5">
                  <TableFilter label="Time" value={timeFilter} onChange={setTimeFilter} options={[['all', 'All times'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['earlier', 'Earlier']]} />
                  <TableFilter label="Activity" value={activityFilter} onChange={setActivityFilter} options={[['all', 'All activity'], ...filterOptions.activities]} />
                  <TableFilter label="Record" value={recordFilter} onChange={setRecordFilter} options={[['all', 'All records'], ...filterOptions.records]} />
                  <TableFilter label="Details" value={detailFilter} onChange={setDetailFilter} options={[['all', 'All details'], ['none', 'No field details'], ...filterOptions.details.map(label => [label, label] as [string, string])]} />
                </div>
                <ul className="divide-y divide-background-200/70">
                  {pageChanges.map(({ change, count }) => (
                    <ChangeTableRow key={change.id} change={change} count={count} names={names} />
                  ))}
                </ul>
              </section>
            )}
            {logChanges.length > 0 && (
              <EntityPagination
                page={currentPage}
                pages={totalPages}
                total={groupedChanges.length}
                pageSize={CHANGES_PAGE_SIZE}
                noun="changes"
                onPage={setPage}
              />
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
      <span className="text-[11px] text-foreground-500">Page: {String(change.metadata?.page_path || 'Not recorded')}</span>
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

const TONE_STYLES: Record<ChangeTone, { dot: string; chip: string }> = {
  created:  { dot: 'bg-emerald-500', chip: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  edited:   { dot: 'bg-sky-500',     chip: 'border-sky-200 bg-sky-50 text-sky-700' },
  removed:  { dot: 'bg-red-500',     chip: 'border-red-200 bg-red-50 text-red-700' },
  restored: { dot: 'bg-violet-500',  chip: 'border-violet-200 bg-violet-50 text-violet-700' },
  neutral:  { dot: 'bg-foreground-300', chip: 'border-background-200 bg-background-100 text-foreground-600' },
};

function ChangeTableRow({ change, count, names }: { change: CurriculumAuditEvent; count: number; names: ReadonlyMap<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  const fieldCount = change.changes?.length || 0;
  const story = changeStory(change);
  const tone = TONE_STYLES[story.tone];
  // A create and a delete carry the stored record instead of a diff, so they
  // have something to show even though `changes` is empty.
  const snapshot = snapshotEntries(change.snapshot);
  const hasDetail = fieldCount > 0 || snapshot.length > 0;

  return (
    <li className="px-4 py-3 hover:bg-background-100/40">
      <div className="flex gap-3">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">

          {/* The sentence. Only the record's own name is the link, so it stays
              scannable and keeps an accessible name a reader can search for. */}
          <p className="text-[13px] leading-5 text-foreground-800">
            {/* The action carries its own explanation, so "First recorded" can
                be understood without expanding a row that may have nothing to
                expand. */}
            <span className="font-semibold text-foreground-700" title={actionMeaning(change)}>{story.verb}</span>
            <span className="text-foreground-600"> {story.subject}</span>
            {story.named && (
              <>
                {' '}
                <Link to={auditEventHref(change)} className="font-semibold text-foreground-900 hover:text-primary-700 hover:underline">
                  {change.title}
                </Link>
              </>
            )}
            {story.cause && <span className="text-foreground-500"> {story.cause}</span>}
            <span className="text-foreground-400">.</span>
            {count > 1 && (
              <span className="ml-2 rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">
                {count} identical records
              </span>
            )}
          </p>

          {/* Why no person is named */}
          {story.systemNote && (
            <p className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-700">
              <AppIcon className="ri-robot-2-line mt-0.5 shrink-0" />
              <span>{story.systemNote}</span>
            </p>
          )}

          {/* Where and when */}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-400">
            <span title={timeMetaLabel(change.at)} className="tabular-nums font-medium text-foreground-500">
              {clockLabel(change.at)}
            </span>
            {change.context && <span className="truncate">in {change.context}</span>}
            {story.page
              ? <span>on {story.page}</span>
              : <span className="italic">no page recorded</span>}
            {hasDetail ? (
              <button
                type="button"
                onClick={() => setExpanded(value => !value)}
                aria-expanded={expanded}
                className="font-semibold text-primary-700 hover:underline"
              >
                {fieldCount
                  ? `${fieldCount} ${fieldCount === 1 ? 'field' : 'fields'} changed`
                  : `What it held (${snapshot.length} ${snapshot.length === 1 ? 'field' : 'fields'})`}
              </button>
            ) : <span>No field details recorded</span>}
          </p>

          {expanded && (
            <div className="mt-2 rounded-lg border border-primary-100 bg-primary-50/40 p-3">
              <p className="text-[11px] font-bold text-foreground-700">
                {fieldCount > 0 ? 'What changed in this save' : 'What this record held'}
              </p>
              <p className="mb-2 mt-0.5 text-[11px] text-foreground-600">{actionMeaning(change)}</p>

              {fieldCount > 0 ? (
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
              ) : (
                <dl className="grid gap-1.5 sm:grid-cols-2">
                  {snapshot.map(([key, value]) => (
                    <div key={key} className="min-w-0 rounded-md border border-background-200 bg-background-50 px-2.5 py-2">
                      <dt className="text-[9px] font-bold uppercase tracking-wide text-foreground-400">{key.replace(/_/g, ' ')}</dt>
                      <dd className="mt-0.5 truncate text-[11px] text-foreground-700" title={auditValueTitle(value)}>
                        {auditValueLabel(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
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
    const key = JSON.stringify([change.at, change.action, change.entity, change.entityId, change.title,
      change.href, change.changes, change.snapshot, change.metadata, change.actorEmail, change.revisionNo]);
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

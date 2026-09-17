// Imported explicitly rather than left to unplugin-auto-import: the Vitest
// config deliberately does not load that plugin, so a page that relies on it
// cannot be rendered in a test at all. Every page with tests spells these out.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  fetchCurriculumPersonActivity,
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
} from '../../shared/entities/ui';
import { clockLabel, durationLabel, spanLabel, stampLabel } from '../activityTime';

/**
 * One person's time in Curriculum Studio: every visit, the pages opened in it,
 * and what happened on each page.
 *
 * The nesting is the point. "What did this person do?" is not answerable by a
 * flat list of events — a search means something different depending on which
 * page it was typed on, and a save means something different depending on what
 * was open at the time. So a visit holds its pages in order, and a page holds
 * the read actions taken on it and the saves recorded while it was open.
 *
 * Two honesty rules run through this page:
 *
 * * A save is placed on a page only when the person was recorded as having that
 *   page open at the time. Anything that cannot be placed is listed separately
 *   under "Changes we could not place on a page" rather than being attached to
 *   the nearest plausible one — a guessed association in an audit trail is
 *   worse than an admitted gap.
 * * Sign-ins are account-wide. They say the person entered the LMS, not that
 *   they opened the curriculum, and they are labelled and grouped separately
 *   for exactly that reason.
 */

const WINDOW_OPTIONS = [
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

export default function CurriculumAuditTrailPerson() {
  const params = useParams();
  const email = decodeURIComponent(params.email || '');
  const [windowDays, setWindowDays] = useState('30');
  const [search, setSearch] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const [activity, setActivity] = useState<CurriculumPersonActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return undefined;
    const controller = new AbortController();
    setLoading(true);
    fetchCurriculumPersonActivity(email, { days: Number(windowDays), signal: controller.signal })
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

  // Applied to the pages already on screen: a visit stays if any page in it
  // matches, and that visit then shows only its matching pages, so a search for
  // "cohorts" reads as "when was this person in Cohorts, and what did they do".
  const visits = useMemo(() => {
    const rows = activity?.visits ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows
      .map(visit => ({ ...visit, pages: visit.pages.filter(page => pageMatches(page, query)) }))
      .filter(visit => visit.pages.length > 0);
  }, [activity?.visits, search]);

  const person = activity?.person;
  const counts = activity?.counts;
  const unplaced = (activity?.changes ?? []).filter(change => !isPlaced(change));

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle={person?.name || email || 'Person'}
      pageSubtitle="Every visit, the pages opened, and what happened on each"
      showBackButton
      backFallbackHref="/curriculum/audit-trail"
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
          stats={[
            { icon: 'ri-history-line', label: 'Visits', value: counts?.visits ?? 0, detail: 'Separate sittings' },
            { icon: 'ri-file-list-3-line', label: 'Pages opened', value: counts?.pageViews ?? 0, detail: 'Including repeats' },
            { icon: 'ri-cursor-line', label: 'Read actions', value: counts?.readActions ?? 0, detail: 'Searches, filters, exports' },
            { icon: 'ri-edit-2-line', label: 'Changes', value: counts?.changes ?? 0, detail: 'Saves recorded against them' },
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

        {activity && !activity.visitsRecorded && (
          <div className="flex items-start gap-3 rounded-2xl border border-background-200 bg-background-50 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-400">
              <AppIcon className="ri-eye-off-line text-base"></AppIcon>
            </span>
            <p className="min-w-0 text-[11px] leading-5 text-foreground-500">
              <span className="font-bold text-foreground-700">Page opens are not being recorded.</span>{' '}
              The <span className="font-mono">curriculum.activity_events</span> table does not exist on this database,
              so there are no visits to show. What is below is what the other two histories can still say: the changes
              this person saved, and when their account signed in.
            </p>
          </div>
        )}

        <EntityFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search the pages they opened..."
          selects={[{ label: 'Period', value: windowDays, onChange: setWindowDays, options: WINDOW_OPTIONS }]}
          onReset={() => { setSearch(''); setWindowDays('30'); }}
          isDirty={Boolean(search) || windowDays !== '30'}
          summary={
            loading
              ? 'Reading this person’s activity...'
              : `${visits.length} ${visits.length === 1 ? 'visit' : 'visits'} in this period`
          }
        />

        {loading ? (
          <div className="space-y-2 rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-xl bg-background-200/70" />
            ))}
          </div>
        ) : (
          <>
            {!visits.length && (
              <div className="rounded-2xl border border-foreground-200/60 bg-background-50">
                <EntityEmptyState
                  icon="ri-history-line"
                  title={search ? 'No page matches that search' : 'No recorded visit in this window'}
                  message={
                    search
                      ? 'Clear the search, or widen the period above.'
                      : activity?.visitsRecorded
                        ? 'This person did not open a curriculum page over this period.'
                        : 'Visits are not being recorded, so there is nothing to show here for anybody.'
                  }
                />
              </div>
            )}

            {visits.map(visit => <VisitCard key={visit.id} visit={visit} />)}

            {unplaced.length > 0 && (
              <section className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50">
                <div className="border-b border-background-200 px-4 py-2.5">
                  <h2 className="font-heading text-[13px] font-bold text-foreground-900">
                    Changes we could not place on a page
                  </h2>
                  <p className="mt-0.5 text-[11px] text-foreground-400">
                    These saves are recorded against this person, but no page was recorded as open at the time —
                    they happened before page recording was switched on, or outside a visit the browser reported.
                    They are listed rather than attached to a page they may not belong to.
                  </p>
                </div>
                <ol className="divide-y divide-background-200/70">
                  {unplaced.map(change => (
                    <li key={change.id} className="px-4 py-2.5">
                      <ChangeLine change={change} />
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {activity?.signIns?.length ? (
              <section className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50">
                <div className="border-b border-background-200 px-4 py-2.5">
                  <h2 className="font-heading text-[13px] font-bold text-foreground-900">Account sign-ins</h2>
                  <p className="mt-0.5 text-[11px] text-foreground-400">
                    When this account signed in to the LMS. Account-wide, not curriculum-only: a sign-in here does
                    not mean the curriculum was opened.
                  </p>
                </div>
                <ol className="divide-y divide-background-200/70">
                  {activity.signIns.map(signIn => (
                    <li key={`${signIn.at}-${signIn.ip}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="text-[12px] font-semibold text-foreground-800">{stampLabel(signIn.at)}</span>
                      {signIn.ip && <span className="font-mono text-[11px] text-foreground-400">{signIn.ip}</span>}
                      {signIn.userAgent && (
                        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground-400">{signIn.userAgent}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
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
          {clockLabel(page.at)}
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
                  <span className="text-[11px] font-semibold tabular-nums text-foreground-400">{clockLabel(action.at)}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-foreground-700">
                    <AppIcon className={`${ACTION_ICON[action.kind] || 'ri-cursor-line'} text-[12px] text-foreground-400`}></AppIcon>
                    {action.label}
                  </span>
                  {Object.entries(action.detail || {}).map(([key, value]) => (
                    <span key={key} className="rounded bg-background-100 px-1.5 py-0.5 text-[10px] text-foreground-600">
                      {key}: {value}
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
function ChangeLine({ change }: { change: CurriculumAuditEvent }) {
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <span className="text-[11px] font-semibold tabular-nums text-foreground-400">{clockLabel(change.at)}</span>
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700">
        {change.actionLabel || change.action}
      </span>
      <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">
        {change.entityLabel}
      </span>
      <Link to={change.href} className="truncate text-[12px] font-bold text-foreground-900 hover:text-primary-700 hover:underline">
        {change.title}
      </Link>
      {change.changes?.length ? (
        <span className="text-[11px] text-foreground-400">
          {change.changes.length} {change.changes.length === 1 ? 'field' : 'fields'}:{' '}
          {change.changes.map(field => field.label).join(', ')}
        </span>
      ) : null}
    </span>
  );
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

/**
 * Whether the backend managed to attach this change to a page.
 *
 * Read defensively: a frontend deployed against a backend that predates the
 * flag should show every change in the unplaced list rather than silently
 * dropping them all.
 */
function isPlaced(change: CurriculumAuditEvent): boolean {
  return Boolean(change.placed);
}

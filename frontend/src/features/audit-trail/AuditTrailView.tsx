// Imported explicitly rather than left to unplugin-auto-import: the Vitest
// config deliberately does not load that plugin, so a page that relies on it
// cannot be rendered in a test at all. Every page with tests spells these out.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { auditEventHref, auditFieldValueLabel, auditValueLabel, auditValueTitle, stampLabel, timeMetaLabel } from './activityTime';
import { useAuditRecordNames } from './auditNames';
import { personHref, type AuditTrailScope } from './scope';
import { ActivityPrefetcher } from './prefetch';
import {
  fetchActivityPeople,
  fetchCurriculumAuditTrail,
  type CurriculumActivityPeople,
  type CurriculumActivityPerson,
  type CurriculumAuditEvent,
  type CurriculumAuditTrail,
} from '@/lib/curriculumApi';
import {
  EntityEmptyState,
  EntityFilterBar,
  EntityHero,
  EntityTable,
  HeroSecondaryButton,
  InlineError,
  NamedActions,
  PlainCell,
  StackedCell,
  WorkspaceTabs,
} from '@/pages/curriculum/shared/entities/ui';

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
 *
 * The page opens on People rather than on the change feed, because the question
 * it is most often asked is "who has been in here?" and the feed cannot answer
 * it: a save is the only thing it can see, so somebody who read all afternoon
 * and changed nothing does not appear in it at all. People is built from the
 * recorded visits instead (`curriculum.activity_events`), with the changes and
 * the account's sign-ins folded in. Each of those three sources is reported
 * separately, so a source that is switched off reads as "not recorded" rather
 * than as nobody having done anything.
 */

const WINDOW_OPTIONS = [
  { value: '1', label: 'Today (last 24 hours)' },
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
  { value: 'recorded', label: 'First activity recorded' },
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
  recorded: { label: 'First activity recorded', icon: 'ri-history-line', dot: 'bg-background-400', chip: 'border-background-200 bg-background-100 text-foreground-500' },
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

type AuditTab = 'people' | 'changes';

export default function AuditTrailView({ scope }: { scope: AuditTrailScope }) {
  const [tab, setTab] = useState<AuditTab>('people');
  // The workspace being read. On the system-wide door this is a filter the
  // person can change; on a workspace's own door it is fixed to that workspace
  // and no filter is offered, because a Curriculum page that could be switched
  // to show Safeguarding is not a scoped page, it is a mislabelled one.
  const [workspace, setWorkspace] = useState(scope.workspace);
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

  const [people, setPeople] = useState<CurriculumActivityPeople | null>(null);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [peopleSearch, setPeopleSearch] = useState('');
  // Whether this window has more people in it than one response carries.
  // Latched rather than read from the current response: a server search narrows
  // its own result below the cap, so reading `truncated` back off it would turn
  // the server search off again on the very next keystroke.
  const [peopleCapped, setPeopleCapped] = useState(false);
  const [serverPeopleSearch, setServerPeopleSearch] = useState('');

  // Each tab loads only its own data, and only once it is being looked at. The
  // two reads are unrelated and one of them sweeps a window of visits, so
  // fetching both on arrival would make the page slower at answering the
  // question it opened on.
  // A different window or workspace is a different population, so the cap has
  // to be established again rather than carried over from the last one.
  useEffect(() => { setPeopleCapped(false); }, [windowDays, workspace]);

  // Below the cap the search stays on the client, where it costs nothing. Above
  // it, the list on screen is not the whole window and a client filter would
  // report "no matches" for somebody who is simply on a later page, so the
  // search goes to the server -- debounced, so it is still not a request per
  // keystroke.
  useEffect(() => {
    if (!peopleCapped) {
      setServerPeopleSearch('');
      return undefined;
    }
    const timer = setTimeout(() => setServerPeopleSearch(peopleSearch.trim()), 350);
    return () => clearTimeout(timer);
  }, [peopleCapped, peopleSearch]);

  useEffect(() => {
    if (tab !== 'people') return undefined;
    const controller = new AbortController();
    setPeopleLoading(true);
    fetchActivityPeople({
      days: Number(windowDays),
      workspace,
      search: serverPeopleSearch || undefined,
      signal: controller.signal,
      revalidate: reloadToken > 0,
    })
      .then(result => {
        if (controller.signal.aborted) return;
        setPeople(result);
        if (result.truncated) setPeopleCapped(true);
        setPeopleError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setPeopleError(err instanceof Error ? err.message : `Unable to read who used ${scope.subjectLabel}`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPeopleLoading(false);
      });
    return () => controller.abort();
  }, [tab, windowDays, workspace, serverPeopleSearch, reloadToken, scope.subjectLabel]);

  // A person's activity is the slow read and the list is the fast one, so the
  // list is never made to wait for it. It is warmed behind the list instead:
  // the top rows on a timer, and any row the pointer or keyboard reaches. By
  // the time "View activity" is clicked the answer is usually already in hand.
  const prefetcher = useRef(new ActivityPrefetcher());
  useEffect(() => {
    const warmer = prefetcher.current;
    warmer.reset();
    return () => warmer.cancelIdle();
  }, [windowDays, workspace]);

  useEffect(() => {
    if (tab !== 'people' || !people?.people.length) return undefined;
    const warmer = prefetcher.current;
    // `scope.workspace`, not the filter: the filter decides who is listed, and
    // a person's own page shows everything they did inside this door either
    // way. Warming under the filter's value would fill an entry that page
    // never asks for, and it would still be waiting on the click.
    warmer.prefetchTop(people.people.map(person => person.email), Number(windowDays), scope.workspace);
    return () => warmer.cancelIdle();
  }, [tab, people?.people, windowDays, scope.workspace]);

  const onPersonIntent = useMemo(() => (email: string) => {
    prefetcher.current.prefetch({ email, days: Number(windowDays), workspace: scope.workspace });
  }, [windowDays, scope.workspace]);

  // The window and the two selects are answered by the backend, so they refetch.
  // Search is not: it is applied to the events already on screen so typing does
  // not fire a request per keystroke against a query the page can answer itself.
  useEffect(() => {
    if (tab !== 'changes') return undefined;
    const controller = new AbortController();
    setLoading(true);
    fetchCurriculumAuditTrail({
      days: Number(windowDays),
      // The same scope the People half uses. Without it the scoped door would
      // show every workspace's saves the moment a second workspace started
      // recording them.
      workspace: workspace || undefined,
      entity: entity || undefined,
      action: action || undefined,
      actor: actor || undefined,
      source: source || undefined,
      actorType: actorType || undefined,
      signal: controller.signal,
      revalidate: reloadToken > 0,
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
  }, [tab, windowDays, workspace, entity, action, actor, source, actorType, reloadToken]);

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

  // Names for the ids a save refers to, so a link field reads as the records it
  // points at rather than as a count of them.
  const names = useAuditRecordNames(useMemo(() => trail?.events ?? [], [trail?.events]));

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

  // Which workspaces the Changes half can speak for, named from the People
  // response rather than hard-coded here: the page should start telling the
  // truth about a newly-wired workspace the day the backend does, not the day
  // somebody remembers to edit this list.
  const changeCoverage = useMemo(() => {
    const all = people?.workspaces ?? [];
    const coveredKeys = new Set(people?.changeWorkspaces ?? []);
    const covered = all.filter(entry => coveredKeys.has(entry.value));
    const missing = all.filter(entry => !coveredKeys.has(entry.value));
    return {
      complete: all.length > 0 && missing.length === 0,
      covered: covered.map(entry => entry.label).join(', ') || 'no workspace',
      missing: missing.length > 3
        ? `${missing.slice(0, 3).map(entry => entry.label).join(', ')} and ${missing.length - 3} others`
        : missing.map(entry => entry.label).join(', '),
    };
  }, [people?.workspaces, people?.changeWorkspaces]);

  // Filtered here rather than server-side for the same reason the change feed
  // is: the window is already loaded, and a request per keystroke would answer
  // a question the page can answer itself.
  const peopleRows = useMemo(() => {
    const rows = people?.people ?? [];
    const query = serverPeopleSearch ? '' : peopleSearch.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(person => (
      person.name.toLowerCase().includes(query) || person.email.toLowerCase().includes(query)
    ));
  }, [people?.people, peopleSearch, serverPeopleSearch]);

  return (
    <WorkspaceShell
      role={scope.role}
      roleLabel={scope.roleLabel}
      navItems={scope.navItems}
      workspaceLabel={scope.workspaceLabel}
      pageTitle="Audit Trail"
      pageSubtitle={`Who used ${scope.subjectLabel}, and what they changed`}
    >
      <div className="min-h-full space-y-4 bg-background-100 p-4 sm:p-5 lg:p-6">
        <EntityHero
          eyebrow="Record activity"
          title="Audit Trail"
          description={
            tab === 'people'
              ? people && !people.visitsRecorded
                ? `Who used ${scope.subjectLabel}. Page opens are not being recorded yet, so this is read from recorded changes and account sign-ins alone — it can say who saved something and when they signed in, never which pages they looked at.`
                : `Who used ${scope.subjectLabel}: when they were here, which pages they opened, what they did on each, and what they changed. Open a person to see their visits in full.`
            : trail?.source === 'timestamps'
              ? 'Read from the timestamps on the curriculum records themselves — every create, edit and archive inside the window, newest first. This reading cannot name who made a change.'
              : 'Every recorded change to programmes, cohorts, groups, modules, weeks and components — who made it, when, and exactly which fields moved. Newest first.'
          }
          stats={tab === 'people' ? [
            { icon: 'ri-group-line', label: 'People', value: people?.totals.people ?? 0, detail: `Used ${scope.subjectLabel} in this period` },
            { icon: 'ri-file-list-3-line', label: 'Pages opened', value: people?.totals.pageViews ?? 0, detail: 'Across everyone' },
            { icon: 'ri-cursor-line', label: 'Actions', value: (people?.totals.readActions ?? 0) + (people?.totals.changes ?? 0), detail: 'Searches, exports and saves' },
            { icon: 'ri-time-line', label: 'Window', value: `${people?.windowDays ?? windowDays}d`, detail: 'Period being read' },
          ] : [
            { icon: 'ri-add-circle-line', label: 'Created', value: counts?.created ?? 0, detail: 'New records' },
            { icon: 'ri-edit-2-line', label: 'Edited', value: counts?.updated ?? 0, detail: 'Saved again after creation' },
            { icon: 'ri-archive-line', label: 'Archived', value: counts?.archived ?? 0, detail: 'Soft-deleted, still restorable' },
            { icon: 'ri-time-line', label: 'Window', value: `${trail?.windowDays ?? windowDays}d`, detail: 'Period being read' },
          ]}
          loading={tab === 'people' ? peopleLoading && !people : loading && !trail}
          secondaryActions={(
            <HeroSecondaryButton
              icon="ri-refresh-line"
              label="Refresh"
              onClick={() => setReloadToken(token => token + 1)}
            />
          )}
        />

        <WorkspaceTabs
          tabs={[
            { key: 'people', label: 'People', icon: 'ri-group-line', count: people?.totals.people },
            { key: 'changes', label: 'Changes', icon: 'ri-history-line', count: trail?.total },
          ]}
          active={tab}
          onChange={key => setTab(key as AuditTab)}
        />

        {tab === 'people' && (
          <PeopleView
            scope={scope}
            people={people}
            rows={peopleRows}
            onPersonIntent={onPersonIntent}
            loading={peopleLoading}
            error={peopleError}
            search={peopleSearch}
            onSearch={setPeopleSearch}
            windowDays={windowDays}
            onWindowDays={setWindowDays}
            workspace={workspace}
            onWorkspace={setWorkspace}
            onRetry={() => setReloadToken(token => token + 1)}
          />
        )}

        {tab === 'changes' && (<>
        {error && <InlineError message={error} onRetry={() => setReloadToken(token => token + 1)} />}

        {/* The reading half covers every workspace; the writing half does not
            yet. Which workspaces can name a change is something the server
            reports, and this says it plainly rather than letting an empty feed
            read as "nothing was changed anywhere". */}
        {scope.showWorkspaceFilter && !changeCoverage.complete && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <AppIcon className="ri-error-warning-line text-base"></AppIcon>
            </span>
            <p className="min-w-0 text-[11px] leading-5 text-amber-900">
              <span className="font-bold">This feed covers {changeCoverage.covered} only.</span>{' '}
              Saves made in {changeCoverage.missing} are not in it — those workspaces are not yet
              writing to the shared revision log, so nothing anywhere records what their saves changed.
              The People tab above does cover every workspace: it can say who was in them and what they
              opened, just not what they saved.
            </p>
          </div>
        )}

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

        <TimeContextNote />

        {loading && !trail ? (
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
                  {day.events.map(event => <AuditRow key={event.id} event={event} names={names} />)}
                </ol>
              </section>
            ))}
          </div>
        )}
        </>)}
      </div>
    </WorkspaceShell>
  );
}



/**
 * Everyone who used Curriculum Studio in the window.
 *
 * The three sources behind a row are counted in separate columns rather than
 * summed into one "activity" number, because they are not the same claim: a
 * page open is something the browser reported, a change is something the
 * backend recorded as it saved, and a sign-in is account-wide and may have
 * nothing to do with the curriculum at all. A single total would quietly merge
 * a person who read for an hour with one who signed in and left.
 *
 * When a source is not recorded its columns are absent, and the notice above
 * the table says which one and why — an empty column would otherwise read as a
 * person who did nothing.
 */
function PeopleView({
  scope, people, rows, onPersonIntent, loading, error, search, onSearch, windowDays, onWindowDays,
  workspace, onWorkspace, onRetry,
}: {
  scope: AuditTrailScope;
  people: CurriculumActivityPeople | null;
  rows: CurriculumActivityPerson[];
  /** Warms this person's activity — the row is about to be opened. */
  onPersonIntent: (email: string) => void;
  loading: boolean;
  error: string | null;
  search: string;
  onSearch: (value: string) => void;
  windowDays: string;
  onWindowDays: (value: string) => void;
  workspace: string;
  onWorkspace: (value: string) => void;
  onRetry: () => void;
}) {
  const navigate = useNavigate();
  const visitsRecorded = people?.visitsRecorded ?? true;
  // Offered only on the system-wide door, and built from what the server says
  // it recognises rather than from a list held here — a filter the backend
  // would refuse is a filter that silently shows nothing.
  const workspaceOptions = (people?.workspaces ?? []).map(entry => ({
    value: entry.value,
    label: entry.label,
  }));
  const href = (email: string) => personHref(scope, email, Number(windowDays));

  return (
    <>
      {error && <InlineError message={error} onRetry={onRetry} />}

      {people && !people.visitsRecorded && (
        <div className="flex items-start gap-3 rounded-2xl border border-background-200 bg-background-50 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-400">
            <AppIcon className="ri-eye-off-line text-base"></AppIcon>
          </span>
          <p className="min-w-0 text-[11px] leading-5 text-foreground-500">
            <span className="font-bold text-foreground-700">Page opens are not being recorded yet.</span>{' '}
            The <span className="font-mono">curriculum.activity_events</span> table has not been created on this
            database, so nothing knows which pages anybody opened. The people below are the ones who saved something
            or signed in, which is all the other two histories can say. Recording starts the moment the table exists
            and is never backdated: today has no page opens in it, and never will.
          </p>
        </div>
      )}

      {people && !people.signInsRecorded && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-semibold text-amber-800">
          The sign-in history could not be read, so the "Signed in" column is empty for everybody rather than zero
          for anybody.
        </div>
      )}

      <EntityFilterBar
        search={search}
        onSearch={onSearch}
        placeholder="Search by name or email..."
        selects={[
          { label: 'Period', value: windowDays, onChange: onWindowDays, options: WINDOW_OPTIONS },
          ...(scope.showWorkspaceFilter && workspaceOptions.length
            ? [{ label: 'Workspace', value: workspace, onChange: onWorkspace, options: workspaceOptions }]
            : []),
        ]}
        onReset={() => { onSearch(''); onWindowDays('30'); onWorkspace(scope.workspace); }}
        isDirty={Boolean(search) || windowDays !== '30' || workspace !== scope.workspace}
        summary={
          loading
            ? `Reading who used ${scope.subjectLabel}...`
            : people?.truncated
              ? `${people.totals.people} people used ${scope.subjectLabel} in this period. `
                + `Showing the ${rows.length} most recently active — search to reach the rest.`
              : `${rows.length} ${rows.length === 1 ? 'person' : 'people'} used ${scope.subjectLabel} in this period`
        }
      />

      <EntityTable
        columns={[
          { label: 'Person' },
          { label: 'Role' },
          { label: 'Last seen' },
          ...(scope.showWorkspaceFilter ? [{ label: 'Workspaces' }] : []),
          { label: 'Visits', align: 'right' as const },
          { label: 'Pages opened', align: 'right' as const },
          { label: 'Read actions', align: 'right' as const },
          { label: 'Changes', align: 'right' as const },
          { label: 'Signed in', align: 'right' as const },
          { label: '' },
        ]}
        gridClass={scope.showWorkspaceFilter
          ? 'grid grid-cols-[minmax(180px,2fr)_100px_minmax(140px,1fr)_minmax(160px,1.2fr)_70px_100px_100px_80px_80px_150px]'
          : 'grid grid-cols-[minmax(200px,2fr)_110px_minmax(150px,1fr)_70px_100px_100px_80px_80px_150px]'}
        rows={rows}
        rowKey={person => person.email}
        getRowHref={person => href(person.email)}
        onRowIntent={person => onPersonIntent(person.email)}
        loading={loading && !people}
        renderRow={person => (
          <>
            <StackedCell primary={person.name || person.email} secondary={person.email} />
            <PlainCell>{person.role || '—'}</PlainCell>
            <PlainCell>
              {person.lastSeen ? (
                <span className="block">
                  <span className="block text-[12px] text-foreground-700">{stampLabel(person.lastSeen)}</span>
                  {person.lastPageLabel && (
                    <span className="block truncate text-[11px] text-foreground-400">on {person.lastPageLabel}</span>
                  )}
                </span>
              ) : '—'}
            </PlainCell>
            {/* Which workspaces they were actually in, most recent first. Only
                on the system-wide door: on a scoped one the answer is the
                workspace whose page you are already reading. */}
            {scope.showWorkspaceFilter && (
              <PlainCell>
                {person.workspaces?.length
                  ? person.workspaces.slice(0, 3).map(entry => entry.label).join(', ')
                    + (person.workspaces.length > 3 ? ` +${person.workspaces.length - 3}` : '')
                  : '—'}
              </PlainCell>
            )}
            {/* A dash, not a zero, wherever the source behind the column is not
                being recorded: zero would be a claim that nothing happened. */}
            <PlainCell align="right">{visitsRecorded ? person.visits : '—'}</PlainCell>
            <PlainCell align="right">{visitsRecorded ? person.pageViews : '—'}</PlainCell>
            <PlainCell align="right">{visitsRecorded ? person.readActions : '—'}</PlainCell>
            <PlainCell align="right">{people?.changesRecorded ? person.changes : '—'}</PlainCell>
            <PlainCell align="right">{people?.signInsRecorded ? person.signIns : '—'}</PlainCell>
            <NamedActions
              actions={[{
                icon: 'ri-arrow-right-line',
                label: 'View activity',
                title: `Everything ${person.name || person.email} did in this period`,
                onClick: () => navigate(href(person.email)),
              }]}
            />
          </>
        )}
        empty={
          <EntityEmptyState
            icon="ri-group-line"
            title={search ? 'Nobody matches that search' : `Nobody used ${scope.subjectLabel} in this window`}
            message={
              search
                ? 'Clear the search, or widen the period above.'
                : visitsRecorded
                  ? 'No page was opened, nothing was saved, and nobody signed in over this period.'
                  : 'Page opens are not being recorded yet, and nobody saved anything or signed in over this period.'
            }
          />
        }
      />
    </>
  );
}

function AuditRow({ event, names }: { event: CurriculumAuditEvent; names: ReadonlyMap<string, string> }) {
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
          <span title={timeMetaLabel(event.at)} aria-label={timeMetaLabel(event.at)}>{timeLabel(event.at)}</span>
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
              to={auditEventHref(event)}
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
            <span className="truncate">{event.context || 'Curriculum record'}</span>
            {/* Auto-save is how the save arrived, not what happened. */}
            {event.source && (
              <>
                <span aria-hidden="true">·</span>
                <span className="rounded bg-background-100 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-500">
                  {event.source === 'auto-save' ? 'Saved automatically' : `Saved via ${event.sourceLabel || event.source}`}
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
                      <span className="font-bold">Before:</span> <span title={auditValueTitle(change.before)}>{auditFieldValueLabel(change.label, change.before, event.changes, 'before', names)}</span>
                    </span>
                    <span className="min-w-0 break-words rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
                      <span className="font-bold">After:</span> <span title={auditValueTitle(change.after)}>{auditFieldValueLabel(change.label, change.after, event.changes, 'after', names)}</span>
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
                  <dd className="min-w-0 break-words text-[11px] text-foreground-700"><span title={auditValueTitle(value)}>{displayValue(value)}</span></dd>
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
                  <dd className="min-w-0 break-words text-[11px] text-foreground-700"><span title={auditValueTitle(value)}>{displayValue(value)}</span></dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-2 text-[10px] text-foreground-400">
            Event type: <span className="font-mono">{event.action}</span>
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
  return parsed ? parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
}

function TimeContextNote() {
  return (
    <p className="flex items-center gap-2 text-[11px] text-foreground-500">
      <AppIcon className="ri-time-line text-foreground-400" />
      Times are shown in your local time. Hover a time to see the full date and timezone.
    </p>
  );
}

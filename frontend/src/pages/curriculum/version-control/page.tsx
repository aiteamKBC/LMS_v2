import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  fetchCurriculumRecordHistory,
  fetchCurriculumVersions,
  type CurriculumFieldChange,
  type CurriculumRecordHistory,
  type CurriculumRevision,
  type CurriculumVersionEntity,
  type CurriculumVersionIndex,
} from '@/lib/curriculumApi';
import { EntityEmptyState, EntityFilterBar, EntityHero, InlineError } from '../shared/entities/ui';

/**
 * Curriculum version history.
 *
 * Two things are shown, and keeping them apart is the point of the page. A
 * **named version** is one an author declared — a component whose
 * `settings.version` moved to 0.2, a module that reached published. A
 * **revision** is every save that actually changed something underneath. A
 * version number on its own says nothing about what was in it; the revisions
 * beneath it are what answer that.
 *
 * Nothing here is editable. History is a record of what happened, and a page
 * that let you alter it would not be one.
 */

const ENTITY_LABEL: Record<string, string> = { module: 'Module', week: 'Week', component: 'Component' };

const ENTITY_OPTIONS = [
  { value: 'component', label: 'Components' },
  { value: 'week', label: 'Weeks' },
  { value: 'module', label: 'Modules' },
];

const ACTION_STYLE: Record<string, { label: string; icon: string; chip: string; dot: string }> = {
  created: { label: 'Created', icon: 'ri-add-circle-line', chip: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  updated: { label: 'Edited', icon: 'ri-edit-2-line', chip: 'border-sky-200 bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
  archived: { label: 'Archived', icon: 'ri-archive-line', chip: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  restored: { label: 'Restored', icon: 'ri-arrow-go-back-line', chip: 'border-violet-200 bg-violet-50 text-violet-700', dot: 'bg-violet-500' },
};

export default function CurriculumVersionControl() {
  const [entityType, setEntityType] = useState('component');
  const [search, setSearch] = useState('');
  const [index, setIndex] = useState<CurriculumVersionIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selected, setSelected] = useState<CurriculumVersionEntity | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchCurriculumVersions({ entityType, signal: controller.signal, skipCache: reloadToken > 0 })
      .then(result => {
        if (controller.signal.aborted) return;
        setIndex(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to read curriculum version history');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [entityType, reloadToken]);

  const entities = useMemo(() => {
    const rows = index?.entities ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(row => row.title.toLowerCase().includes(query) || row.entityId.toLowerCase().includes(query));
  }, [index?.entities, search]);

  const available = index?.available !== false;

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Version Control"
      pageSubtitle="Every version of every record, what was in it, and what changed"
    >
      <div className="min-h-full space-y-4 bg-background-100 p-4 sm:p-5 lg:p-6">
        <EntityHero
          eyebrow="Curriculum history"
          title="Version Control"
          description="A revision is written whenever a save actually changes a record, holding the content as it was saved and a field-by-field diff. Where an author declares a version — a component moving to 0.2, a module published — that revision is named."
          stats={[
            { icon: 'ri-git-commit-line', label: 'Revisions', value: index?.totalRevisions ?? 0, detail: 'Changes recorded' },
            { icon: 'ri-price-tag-3-line', label: 'Named versions', value: index?.totalNamedVersions ?? 0, detail: 'Declared by an author' },
            { icon: 'ri-file-list-3-line', label: 'Records tracked', value: entities.length, detail: ENTITY_LABEL[entityType] || 'All' },
            { icon: 'ri-history-line', label: 'Newest change', value: shortDate(entities[0]?.lastChangeAt), detail: entities[0]?.lastActorName || 'No author recorded' },
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

        {!loading && !available && <HistoryOffPanel reason={index?.reason} />}

        {available && (
          <>
            <EntityFilterBar
              search={search}
              onSearch={setSearch}
              placeholder="Search by record name or id..."
              selects={[{ label: 'Record type', value: entityType, onChange: setEntityType, options: ENTITY_OPTIONS }]}
              onReset={() => { setSearch(''); setEntityType('component'); }}
              isDirty={Boolean(search) || entityType !== 'component'}
              summary={
                loading
                  ? 'Reading version history...'
                  : `${entities.length} ${entities.length === 1 ? 'record' : 'records'} with recorded history`
              }
            />

            {loading ? (
              <div className="space-y-2 rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-background-200/70" />)}
              </div>
            ) : !entities.length ? (
              <div className="rounded-2xl border border-foreground-200/60 bg-background-50">
                <EntityEmptyState
                  icon="ri-git-branch-line"
                  title="No history yet for these records"
                  message={
                    search
                      ? 'Nothing matches that search. Clear it to see every tracked record.'
                      : 'History starts at the next save. Records saved before version history was switched on have no earlier revision to compare against, so their first recorded revision is whatever is saved next.'
                  }
                />
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50">
                <div className="grid grid-cols-[minmax(0,2.4fr)_110px_110px_minmax(0,1.2fr)_minmax(0,1fr)_92px] gap-3 border-b border-background-200 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                  <span>Record</span>
                  <span className="text-right">Versions</span>
                  <span className="text-right">Revisions</span>
                  <span>Last change</span>
                  <span>By</span>
                  <span className="text-right">History</span>
                </div>
                {entities.map(entity => (
                  <EntityRow key={`${entity.entityType}:${entity.entityId}`} entity={entity} onOpen={() => setSelected(entity)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {selected && <HistoryDrawer entity={selected} onClose={() => setSelected(null)} />}
    </WorkspaceShell>
  );
}

function HistoryOffPanel({ reason }: { reason?: string }) {
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-amber-700">
          <AppIcon className="ri-database-2-line text-lg"></AppIcon>
        </span>
        <div className="min-w-0">
          <h2 className="font-heading text-base font-bold text-amber-900">Version history is not switched on</h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-amber-800">
            {reason || 'The history tables have not been created, so nothing is being recorded yet.'}
          </p>
          <p className="mt-2 max-w-2xl text-[12px] leading-5 text-amber-800">
            Curriculum saves are unaffected either way — recording is skipped when the tables are absent, never blocked.
            Once the SQL has run, history begins at the next save.
          </p>
          <code className="mt-3 block overflow-x-auto rounded-lg bg-white/70 px-3 py-2 font-mono text-[11px] text-amber-900">
            backend/sql/2026-09-09_curriculum_record_versions.sql
          </code>
        </div>
      </div>
    </section>
  );
}

function EntityRow({ entity, onOpen }: { entity: CurriculumVersionEntity; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[minmax(0,2.4fr)_110px_110px_minmax(0,1.2fr)_minmax(0,1fr)_92px] items-center gap-3 border-b border-background-200/60 px-4 py-2.5 text-left last:border-0 hover:bg-background-100/50"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">
            {ENTITY_LABEL[entity.entityType] || entity.entityType}
          </span>
          <span className="min-w-0 truncate text-[12.5px] font-bold text-foreground-900">{entity.title || entity.entityId}</span>
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-foreground-400">{entity.entityId}</span>
      </span>
      <span className="text-right">
        {entity.versionLabel ? (
          <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] font-extrabold text-primary-700">
            v{entity.versionLabel}
          </span>
        ) : (
          <span className="text-[11px] text-foreground-400" title="This record declares no version of its own">
            {entity.namedVersions || 'None'}
          </span>
        )}
      </span>
      <span className="text-right text-[12px] font-semibold tabular-nums text-foreground-700">{entity.revisions}</span>
      <span className="truncate text-[12px] text-foreground-600">{longDate(entity.lastChangeAt)}</span>
      <span className="truncate text-[12px] text-foreground-500">
        {entity.lastActorName || <span className="text-foreground-400">Not recorded</span>}
      </span>
      <span className="text-right text-[11px] font-bold text-primary-700">
        View <AppIcon className="ri-arrow-right-s-line"></AppIcon>
      </span>
    </button>
  );
}

function HistoryDrawer({ entity, onClose }: { entity: CurriculumVersionEntity; onClose: () => void }) {
  const [history, setHistory] = useState<CurriculumRecordHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openSnapshot, setOpenSnapshot] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchCurriculumRecordHistory(entity.entityType, entity.entityId, {
      snapshot: openSnapshot ?? undefined,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return;
        setHistory(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to read this record’s history');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [entity.entityType, entity.entityId, openSnapshot]);

  // The named version each revision belongs to, so revisions can be shown
  // grouped under the version they ended up in rather than as a flat list.
  const versionAtRevision = useMemo(() => {
    const map = new Map<number, string>();
    for (const version of history?.versions ?? []) map.set(version.revisionNo, version.versionLabel);
    return map;
  }, [history?.versions]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close history" onClick={onClose} className="absolute inset-0 bg-foreground-950/40" />
      <aside className="relative flex h-full w-full max-w-2xl flex-col bg-background-50 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-background-200 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-400">
              {ENTITY_LABEL[entity.entityType] || entity.entityType} history
            </p>
            <h2 className="mt-1 truncate font-heading text-lg font-bold text-foreground-950">
              {entity.title || entity.entityId}
            </h2>
            <p className="mt-1 truncate font-mono text-[10px] text-foreground-400">{entity.entityId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-background-200 text-foreground-500 hover:bg-background-100"
          >
            <AppIcon className="ri-close-line"></AppIcon>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {error && <InlineError message={error} />}

          {loading && !history ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-background-200/70" />)}
            </div>
          ) : !history?.revisions.length ? (
            <EntityEmptyState icon="ri-git-commit-line" title="No revisions" message="Nothing has been recorded for this record yet." />
          ) : (
            <>
              {history.versions.length > 0 && (
                <section className="mb-5">
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-foreground-400">Named versions</h3>
                  <div className="flex flex-wrap gap-2">
                    {history.versions.map(version => (
                      <span
                        key={version.id}
                        className="inline-flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-1.5"
                        title={`Revision ${version.revisionNo}`}
                      >
                        <span className="text-[12px] font-extrabold text-primary-800">v{version.versionLabel}</span>
                        {version.contentStatus && (
                          <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary-700">
                            {version.contentStatus}
                          </span>
                        )}
                        <span className="text-[10px] text-primary-700">{shortDate(version.at)}</span>
                      </span>
                    ))}
                  </div>
                </section>
              )}

              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-foreground-400">
                Revisions ({history.revisions.length})
              </h3>
              <ol className="space-y-2">
                {history.revisions.map(revision => (
                  <RevisionCard
                    key={revision.id}
                    revision={revision}
                    versionLabel={versionAtRevision.get(revision.revisionNo)}
                    snapshotOpen={openSnapshot === revision.revisionNo}
                    snapshot={openSnapshot === revision.revisionNo ? history.snapshot : null}
                    onToggleSnapshot={() =>
                      setOpenSnapshot(current => (current === revision.revisionNo ? null : revision.revisionNo))}
                  />
                ))}
              </ol>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function RevisionCard({ revision, versionLabel, snapshotOpen, snapshot, onToggleSnapshot }: {
  revision: CurriculumRevision;
  versionLabel?: string;
  snapshotOpen: boolean;
  snapshot: CurriculumRecordHistory['snapshot'];
  onToggleSnapshot: () => void;
}) {
  const style = ACTION_STYLE[revision.action] || ACTION_STYLE.updated;
  return (
    <li className="rounded-xl border border-background-200 bg-background-100/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold tabular-nums text-foreground-400">#{revision.revisionNo}</span>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.chip}`}>
          <AppIcon className={`${style.icon} text-[11px]`}></AppIcon>
          {style.label}
        </span>
        {versionLabel && (
          <span className="rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[10px] font-extrabold text-primary-700">
            v{versionLabel}
          </span>
        )}
        <span className="ml-auto text-[11px] text-foreground-400">{longDate(revision.at)}</span>
      </div>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-foreground-500">
        <span className="font-semibold text-foreground-700">
          {revision.actorName || <span className="font-normal text-foreground-400">No author recorded</span>}
        </span>
        {revision.reason && (
          <>
            <span aria-hidden="true">·</span>
            {/* The handler that ran, not a person. */}
            <span className="rounded bg-background-100 px-1.5 py-0.5 font-mono text-[10px]">reason: {revision.reason}</span>
          </>
        )}
      </p>

      {revision.changedFields.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {revision.changedFields.map(change => <FieldChangeRow key={change.field} change={change} />)}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-foreground-400">
          {revision.revisionNo === 1
            ? 'First recorded revision — there is no earlier version to compare against.'
            : 'No field-level detail recorded for this revision.'}
        </p>
      )}

      <button
        type="button"
        onClick={onToggleSnapshot}
        className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-primary-700 hover:underline"
      >
        <AppIcon className={snapshotOpen ? 'ri-eye-off-line' : 'ri-eye-line'}></AppIcon>
        {snapshotOpen ? 'Hide what was in it' : 'See what was in it'}
      </button>

      {snapshotOpen && (
        <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-background-200 bg-background-50 p-3">
          {snapshot ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-5 text-foreground-600">
              {JSON.stringify(snapshot.content, null, 2)}
            </pre>
          ) : (
            <p className="text-[11px] text-foreground-400">Loading the stored content…</p>
          )}
        </div>
      )}
    </li>
  );
}

function FieldChangeRow({ change }: { change: CurriculumFieldChange }) {
  return (
    <li className="rounded-lg bg-background-50 px-2.5 py-1.5">
      <p className="font-mono text-[10px] font-bold text-foreground-600">{change.field}</p>
      <p className="mt-0.5 flex flex-wrap items-start gap-1.5 text-[11px] leading-5">
        <span className="min-w-0 break-words text-red-700 line-through decoration-red-300">{change.from || '(empty)'}</span>
        <AppIcon className="ri-arrow-right-line mt-0.5 shrink-0 text-foreground-300"></AppIcon>
        <span className="min-w-0 break-words text-emerald-700">{change.to || '(empty)'}</span>
        {change.truncated && <span className="shrink-0 text-[10px] text-foreground-400">(shortened)</span>}
      </p>
    </li>
  );
}

/** The backend writes UTC; only append the marker when none is present. */
function parseStamp(value: string | undefined): Date | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const parsed = new Date(zoned ? text : `${text}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shortDate(value: string | undefined): string {
  const parsed = parseStamp(value);
  return parsed ? parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';
}

function longDate(value: string | undefined): string {
  const parsed = parseStamp(value);
  return parsed
    ? parsed.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
}

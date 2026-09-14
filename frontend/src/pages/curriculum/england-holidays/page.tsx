import { useCallback, useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  fetchEnglandHolidaySyncs,
  fetchEnglandHolidays,
  refreshEnglandHolidays,
  type EnglandHoliday,
  type EnglandHolidayChange,
  type EnglandHolidaySync,
  type EnglandHolidaySyncStatus,
} from '@/lib/curriculumApi';
import { cleanText, formatDateLabel, matchesSearch } from '../shared/entities/model';
import {
  EntityEmptyState,
  EntityFilterBar,
  EntityHero,
  EntityTable,
  HeroSecondaryButton,
  InlineError,
  PlainCell,
  StackedCell,
  WorkspacePanel,
} from '../shared/entities/ui';

// GOV.UK's published bank holidays, read straight from curriculum.england_holidays.
//
// A mirror, not an authored list: nobody here edits what GOV.UK publishes. What
// this page has to answer, then, is not "what can I change?" but "is this still
// what GOV.UK says, and what did they change?" — because a bank holiday moving
// reschedules every cohort running across it.
//
// So the mirror checks itself against https://www.gov.uk/bank-holidays.json on
// an interval, records every check, and this page shows the result: when it was
// last looked at, and exactly which holidays were added, moved, retitled or
// withdrawn. "Check GOV.UK now" is the same check on demand.
//
// The college's own closure periods are the other half of the calendar and live
// on the Holidays page, where they are authored with their own date ranges.

const GRID = 'grid grid-cols-[minmax(200px,1.6fr)_140px_120px_minmax(120px,0.9fr)_110px]';

const COLUMNS = [
  { label: 'Bank holiday' },
  { label: 'Date' },
  { label: 'Day' },
  { label: 'Notes' },
  { label: 'Bunting', align: 'center' as const },
];

function holidayYear(holiday: EnglandHoliday): string {
  return cleanText(holiday.date).slice(0, 4);
}

function weekdayLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-GB', { weekday: 'long' });
}

/** A recorded check's timestamp, as a person reads it. */
function stampLabel(value: string): string {
  const parsed = new Date(cleanText(value));
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** How many holidays a check actually moved, in any direction. */
function changeCount(sync: Pick<EnglandHolidaySync, 'added' | 'changed' | 'moved' | 'withdrawn'>): number {
  return (sync.added?.length || 0) + (sync.changed?.length || 0)
    + (sync.moved?.length || 0) + (sync.withdrawn?.length || 0);
}

const SOURCE_LABELS: Record<string, string> = {
  auto: 'Automatic check',
  manual: 'Checked by hand',
  command: 'Checked from the command line',
};

/**
 * One holiday a check found, in the words that say what happened to it.
 *
 * The four kinds read differently on purpose: an added holiday is a date; a
 * moved one is two dates and the arrow between them; a changed one is the old
 * title beside the new; a withdrawn one is a date that is no longer a holiday.
 */
function ChangeRow({ kind, change }: { kind: 'added' | 'moved' | 'changed' | 'withdrawn'; change: EnglandHolidayChange }) {
  const tone = {
    added: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    moved: 'bg-amber-50 text-amber-700 border-amber-200',
    changed: 'bg-sky-50 text-sky-700 border-sky-200',
    withdrawn: 'bg-rose-50 text-rose-700 border-rose-200',
  }[kind];
  const label = { added: 'New', moved: 'Moved', changed: 'Updated', withdrawn: 'Withdrawn' }[kind];

  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5 text-[12px] text-foreground-700">
      <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
        {label}
      </span>
      <span className="font-semibold text-foreground-900">{change.title}</span>
      {kind === 'moved' ? (
        <span className="tabular-nums text-foreground-600">
          {formatDateLabel(change.previousDate || '')} → {formatDateLabel(change.date)}
        </span>
      ) : (
        <span className="tabular-nums text-foreground-600">{formatDateLabel(change.date)}</span>
      )}
      {kind === 'changed' && change.previous?.title && change.previous.title !== change.title && (
        <span className="text-foreground-500">was “{change.previous.title}”</span>
      )}
      {cleanText(change.notes) && <span className="text-foreground-500">({change.notes})</span>}
    </li>
  );
}

export default function CurriculumEnglandHolidaysPage() {
  const [holidays, setHolidays] = useState<EnglandHoliday[]>([]);
  const [syncs, setSyncs] = useState<EnglandHolidaySync[]>([]);
  const [syncStatus, setSyncStatus] = useState<EnglandHolidaySyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setLogError(null);
    try {
      // The dates and the record of what changed are read together but fail
      // apart: the holidays are the page, and a check log that cannot be read
      // should cost the reader that one panel, not the calendar.
      const [rows, log] = await Promise.all([
        fetchEnglandHolidays(signal, { skipCache: true }),
        fetchEnglandHolidaySyncs(signal).catch(err => {
          if (!signal?.aborted) {
            setLogError(err instanceof Error ? err.message : 'The check log could not be read.');
          }
          return { status: null as EnglandHolidaySyncStatus | null, results: [] as EnglandHolidaySync[] };
        }),
      ]);
      if (signal?.aborted) return;
      setHolidays(rows);
      setSyncs(log.results || []);
      setSyncStatus(log.status || null);
      setLoaded(true);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : 'The bank holidays could not be loaded.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      const { summary } = await refreshEnglandHolidays();
      await load();
      const moved = changeCount(summary);
      await showCurriculumAlert({
        title: moved ? 'GOV.UK has changed' : 'Nothing has changed',
        text: moved
          ? `${moved} bank holiday${moved === 1 ? '' : 's'} updated from GOV.UK. Cohorts running across ${moved === 1 ? 'it' : 'them'} pick the new dates up straight away.`
          : `All ${summary.feedCount} bank holidays match what GOV.UK is publishing.`,
        timer: moved ? undefined : 2200,
      });
    } catch (err) {
      await showCurriculumAlert({
        title: 'GOV.UK could not be reached',
        text: err instanceof Error ? err.message : 'The bank holiday feed did not answer. The stored dates are unchanged.',
        icon: 'error',
      });
    } finally {
      setChecking(false);
    }
  }, [load]);

  const years = useMemo(
    () => Array.from(new Set(holidays.map(holidayYear).filter(Boolean))).sort(),
    [holidays],
  );

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const thisYear = today.slice(0, 4);

  const nextHoliday = useMemo(
    () => holidays.find(holiday => cleanText(holiday.date) >= today),
    [holidays, today],
  );

  const visibleHolidays = useMemo(() => {
    const sorted = [...holidays].sort((a, b) => cleanText(a.date).localeCompare(cleanText(b.date)));
    return sorted.filter(holiday => {
      if (yearFilter && holidayYear(holiday) !== yearFilter) return false;
      return matchesSearch(search, [holiday.title, holiday.date, holiday.notes]);
    });
  }, [holidays, search, yearFilter]);

  // When the mirror was last known to match GOV.UK. The sync log is the better
  // answer; fetched_at on the rows is the fallback for a database that has the
  // holidays but has not recorded a check yet.
  const lastChecked = useMemo(() => {
    const recorded = cleanText(syncStatus?.lastSuccessAt);
    if (recorded) return recorded;
    return holidays.reduce((latest, holiday) => {
      const value = cleanText(holiday.fetchedAt);
      return value > latest ? value : latest;
    }, '');
  }, [holidays, syncStatus]);

  // A check that found nothing is worth recording and not worth reading, so the
  // panel lists the ones that found something — plus any that failed, because
  // "we have not reached GOV.UK since Tuesday" is the thing worth seeing.
  const notableSyncs = useMemo(
    () => syncs.filter(sync => sync.status !== 'ok' || changeCount(sync) > 0),
    [syncs],
  );

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="England Holidays"
      pageSubtitle="The national bank holidays published by GOV.UK, kept in step automatically"
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-4 bg-background-50 p-4 sm:p-5 lg:p-6">
        <EntityHero
          eyebrow="Curriculum Studio"
          title="England Holidays"
          description="England and Wales bank holidays exactly as GOV.UK publishes them. They refresh themselves against gov.uk, and every change — a new holiday, one moved off a weekend, one withdrawn — is listed below. A cohort takes every bank holiday inside its own dates, and its module sessions skip them."
          loading={loading && !loaded}
          stats={[
            { icon: 'ri-flag-line', label: 'Bank holidays', value: holidays.length },
            { icon: 'ri-calendar-event-line', label: `In ${thisYear}`, value: holidays.filter(holiday => holidayYear(holiday) === thisYear).length },
            {
              icon: 'ri-calendar-check-line',
              label: 'Next holiday',
              value: nextHoliday ? formatDateLabel(nextHoliday.date) : '—',
              detail: nextHoliday?.title,
            },
            {
              icon: 'ri-refresh-line',
              label: 'Last checked',
              value: lastChecked ? formatDateLabel(lastChecked) : 'Never',
              detail: syncStatus?.autoSync
                ? `Checks itself every ${syncStatus.intervalHours} hours`
                : 'Automatic checks are off',
            },
          ]}
          secondaryActions={(
            <HeroSecondaryButton
              icon="ri-refresh-line"
              label={checking ? 'Checking GOV.UK…' : 'Check GOV.UK now'}
              onClick={() => void checkNow()}
              disabled={checking}
            />
          )}
        />

        {error && <InlineError message={error} onRetry={() => void load()} />}

        <WorkspacePanel
          title="What GOV.UK has changed"
          description={lastChecked
            ? `Last checked ${stampLabel(lastChecked)}. Every check is recorded; the ones that found something are listed here.`
            : 'The feed has not been checked yet. Use “Check GOV.UK now”, or run python manage.py fetch_england_holidays --apply.'}
        >
          {logError ? (
            <p className="py-2 text-[13px] text-rose-700">{logError}</p>
          ) : notableSyncs.length === 0 ? (
            <p className="py-2 text-[13px] text-foreground-500">
              {loading && !loaded
                ? 'Reading the check log…'
                : 'No changes recorded. Every bank holiday stored here matches what GOV.UK is publishing.'}
            </p>
          ) : (
            <ol className="divide-y divide-background-200">
              {notableSyncs.map(sync => (
                <li key={sync.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-semibold text-foreground-900">{stampLabel(sync.checkedAt)}</span>
                    <span className="text-[11px] text-foreground-500">
                      {SOURCE_LABELS[sync.source] || sync.source}
                    </span>
                    {sync.status !== 'ok' && (
                      <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                        Check failed
                      </span>
                    )}
                  </div>
                  {sync.status !== 'ok' ? (
                    <p className="mt-1 text-[12px] text-rose-700">
                      {sync.message || 'GOV.UK could not be reached. The stored dates were left as they were.'}
                    </p>
                  ) : (
                    <ul className="mt-1">
                      {sync.added.map(change => <ChangeRow key={`a-${change.id}`} kind="added" change={change} />)}
                      {sync.moved.map(change => <ChangeRow key={`m-${change.id}`} kind="moved" change={change} />)}
                      {sync.changed.map(change => <ChangeRow key={`c-${change.id}`} kind="changed" change={change} />)}
                      {sync.withdrawn.map(change => <ChangeRow key={`w-${change.id}`} kind="withdrawn" change={change} />)}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </WorkspacePanel>

        <EntityFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search bank holidays..."
          selects={[
            {
              label: 'Year',
              value: yearFilter,
              onChange: setYearFilter,
              options: [{ value: '', label: 'All years' }, ...years.map(year => ({ value: year, label: year }))],
            },
          ]}
          onReset={() => { setSearch(''); setYearFilter(''); }}
          summary={loaded
            ? `Showing ${visibleHolidays.length} of ${holidays.length} bank holidays${lastChecked ? ` — last checked ${formatDateLabel(lastChecked)}` : ''}`
            : undefined}
        />

        <EntityTable
          columns={COLUMNS}
          gridClass={GRID}
          rows={visibleHolidays}
          rowKey={holiday => holiday.id}
          loading={loading && !loaded}
          empty={(
            <EntityEmptyState
              icon="ri-flag-line"
              title={holidays.length ? 'No bank holidays match these filters' : 'No bank holidays stored yet'}
              message={holidays.length
                ? 'Clear a filter, or search for a different holiday.'
                : 'Apply sql/2026-09-13_curriculum_england_holidays.sql, then press “Check GOV.UK now” to load them.'}
            />
          )}
          renderRow={holiday => (
            <>
              <StackedCell
                primary={(
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${cleanText(holiday.date) < today ? 'bg-foreground-300' : 'bg-primary-500'}`}
                    />
                    {holiday.title}
                  </span>
                )}
                secondary={holiday.division}
              />
              <PlainCell>{formatDateLabel(holiday.date)}</PlainCell>
              <PlainCell>{weekdayLabel(holiday.date)}</PlainCell>
              <PlainCell>{cleanText(holiday.notes, '—')}</PlainCell>
              <PlainCell align="center">
                {holiday.bunting
                  ? <span className="text-emerald-600" title="GOV.UK marks this as a flag-flying day">Yes</span>
                  : <span className="text-foreground-400">No</span>}
              </PlainCell>
            </>
          )}
        />
      </div>
    </WorkspaceShell>
  );
}

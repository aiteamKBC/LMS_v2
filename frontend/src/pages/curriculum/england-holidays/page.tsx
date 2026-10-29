import styles from './BankHolidays.module.css';
import HolidayCatalogue from './HolidayCatalogue';
import { periodDays, regionLabel } from './calendar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DatePickerField } from '@/components/feature/DatePickerField';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  archiveCurriculumHoliday,
  createCurriculumHoliday,
  fetchCurriculumHolidays,
  fetchEnglandHolidaySyncs,
  refreshEnglandHolidays,
  updateCurriculumHoliday,
  type CurriculumHoliday,
  type EnglandHolidayChange,
  type EnglandHolidaySync,
  type EnglandHolidaySyncStatus,
} from '@/lib/curriculumApi';
import { cleanText, formatDateLabel } from '../shared/entities/model';
import {
  ColorControl,
  EntityDrawer,
  EntityEmptyState,
  EntityTable,
  FormField,
  InlineError,
  NamedActions,
  PlainCell,
  StackedCell,
  TextControl,
  WorkspacePanel,
} from '../shared/entities/ui';
import { useDrawerState } from '../shared/entities/useDrawerState';

const MANUAL_TYPE = 'Manual holiday';
const MANUAL_COLOR = '#7c3aed';

const GRID = 'grid grid-cols-[minmax(220px,1.4fr)_120px_120px_72px_100px_minmax(120px,1fr)_168px]';

const COLUMNS = [
  { label: 'Holiday' },
  { label: 'Start' },
  { label: 'End' },
  { label: 'Days', align: 'center' as const },
  { label: 'Source' },
  { label: 'Notes' },
  { label: '' },
];

interface ManualHolidayForm {
  label: string;
  startDate: string;
  endDate: string;
  type: string;
  color: string;
}

const EMPTY_FORM: ManualHolidayForm = {
  label: '',
  startDate: '',
  endDate: '',
  type: '',
  color: MANUAL_COLOR,
};

interface HolidayTypeOption {
  label: string;
  color: string;
  count: number;
}

/**
 * The types already in use on manual holidays, most-used first. A type is not
 * a record of its own — it is just the `type` text a holiday carries — so
 * these are suggestions to fill the Type field from, not a list to manage.
 */
function collectTypeOptions(manualHolidays: CurriculumHoliday[]): HolidayTypeOption[] {
  const byKey = new Map<string, HolidayTypeOption>();
  for (const holiday of manualHolidays) {
    const label = cleanText(holiday.type);
    if (!label) continue;
    const key = label.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(key, { label, color: holiday.color || MANUAL_COLOR, count: 1 });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function isBankHoliday(holiday: CurriculumHoliday): boolean {
  return holiday.source === 'gov.uk';
}

function stampLabel(value: string): string {
  const parsed = new Date(cleanText(value));
  if (Number.isNaN(parsed.getTime())) return 'Unavailable';
  return parsed.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function changeCount(sync: Pick<EnglandHolidaySync, 'added' | 'changed' | 'moved' | 'withdrawn'>): number {
  return (sync.added?.length || 0) + (sync.changed?.length || 0)
    + (sync.moved?.length || 0) + (sync.withdrawn?.length || 0);
}

const SOURCE_LABELS: Record<string, string> = {
  auto: 'Automatic check',
  manual: 'Checked by hand',
  command: 'Checked from the command line',
};

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
          {formatDateLabel(change.previousDate || '')} to {formatDateLabel(change.date)}
        </span>
      ) : (
        <span className="tabular-nums text-foreground-600">{formatDateLabel(change.date)}</span>
      )}
      {kind === 'changed' && change.previous?.title && change.previous.title !== change.title && (
        <span className="text-foreground-500">was "{change.previous.title}"</span>
      )}
      {cleanText(change.notes) && <span className="text-foreground-500">({change.notes})</span>}
    </li>
  );
}

export default function CurriculumEnglandHolidaysPage() {
  const [holidays, setHolidays] = useState<CurriculumHoliday[]>([]);
  const [syncs, setSyncs] = useState<EnglandHolidaySync[]>([]);
  const [syncStatus, setSyncStatus] = useState<EnglandHolidaySyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [writing, setWriting] = useState(false);
  const mutationLock = useRef(false);
  const loadSequence = useRef(0);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const drawer = useDrawerState<ManualHolidayForm>(EMPTY_FORM);

  /**
   * `fresh` is for the reloads that follow a write on this page -- the GOV.UK
   * check, and adding, editing or deleting a manual holiday. Only those need
   * the backend to rebuild its holidays payload rather than answer from it.
   * Opening the page is not one of them: it used to bypass both caches, which
   * made every visit wait for a rebuild of a calendar nobody had just changed.
   */
  const load = useCallback(async (signal?: AbortSignal, { fresh = false } = {}) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    setLogError(null);
    try {
      const [calendarRows, log] = await Promise.all([
        fetchCurriculumHolidays(signal, { skipCache: fresh, revalidate: !fresh }),
        fetchEnglandHolidaySyncs(signal, 20, { skipCache: fresh }).catch(err => {
          if (!signal?.aborted && sequence === loadSequence.current) {
            setLogError(err instanceof Error ? err.message : 'The GOV.UK check log could not be read.');
          }
          return { status: null as EnglandHolidaySyncStatus | null, results: [] as EnglandHolidaySync[] };
        }),
      ]);
      if (signal?.aborted || sequence !== loadSequence.current) return false;
      setHolidays(calendarRows);
      setSyncs(log.results || []);
      setSyncStatus(log.status || null);
      setLoaded(true);
      setNeedsRefresh(false);
      return true;
    } catch (err) {
      if (signal?.aborted || sequence !== loadSequence.current) return false;
      setError(err instanceof Error ? err.message : 'The bank holidays could not be loaded.');
      return false;
    } finally {
      if (!signal?.aborted && sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { loadSequence.current += 1; controller.abort(); };
  }, [load]);

  const manualHolidays = useMemo(() => holidays.filter(holiday => !isBankHoliday(holiday)), [holidays]);
  const typeOptions = useMemo(() => collectTypeOptions(manualHolidays), [manualHolidays]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const lastChecked = useMemo(() => cleanText(syncStatus?.lastSuccessAt), [syncStatus]);

  const notableSyncs = useMemo(
    () => syncs.filter(sync => sync.status !== 'ok' || changeCount(sync) > 0),
    [syncs],
  );

  const checkNow = useCallback(async () => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setChecking(true);
    try {
      const { summary } = await refreshEnglandHolidays();
      const refreshed = await load(undefined, { fresh: true });
      if (!refreshed) {
        setNeedsRefresh(true);
        await showCurriculumAlert({ title: 'Feed checked; calendar refresh failed', text: 'The feed check completed. Retry loading the stored calendar before making another change.', icon: 'warning' });
        return;
      }
      const moved = changeCount(summary);
      await showCurriculumAlert({
        title: moved ? 'GOV.UK has changed' : 'Nothing has changed',
        text: moved
          ? `${moved} bank holiday${moved === 1 ? '' : 's'} updated from GOV.UK.`
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
      mutationLock.current = false;
    }
  }, [load]);

  const openAddDrawer = useCallback(() => {
    if (mutationLock.current || needsRefresh) return;
    setEditingId(null);
    drawer.openWith(EMPTY_FORM);
  }, [drawer, needsRefresh]);

  const openEditDrawer = useCallback((holiday: CurriculumHoliday) => {
    if (isBankHoliday(holiday) || mutationLock.current || needsRefresh) return;
    setEditingId(holiday.id);
    drawer.openWith({
      label: holiday.label,
      startDate: cleanText(holiday.startDate),
      endDate: cleanText(holiday.endDate) === cleanText(holiday.startDate) ? '' : cleanText(holiday.endDate),
      type: cleanText(holiday.type),
      color: holiday.color || MANUAL_COLOR,
    });
  }, [drawer, needsRefresh]);

  const saveManualHoliday = async () => {
    if (mutationLock.current) return;
    const form = drawer.form;
    if (!form.label.trim()) { drawer.setError('Give the holiday a name.'); return; }
    if (!form.startDate) { drawer.setError('Set the start date.'); return; }
    if (form.endDate && form.endDate < form.startDate) {
      drawer.setError('The end date cannot be before the start date.');
      return;
    }

    mutationLock.current = true;
    setWriting(true);
    drawer.setSaving(true);
    drawer.setError(null);
    try {
      const payload = {
        label: form.label.trim(),
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        type: form.type.trim(),
        color: form.type.trim() ? form.color || MANUAL_COLOR : MANUAL_COLOR,
      };
      if (editingId != null) {
        await updateCurriculumHoliday(editingId, payload);
      } else {
        await createCurriculumHoliday(payload);
      }
      drawer.close();
      setEditingId(null);
      const refreshed = await load(undefined, { fresh: true });
      if (!refreshed) {
        setNeedsRefresh(true);
        await showCurriculumAlert({ title: 'Holiday saved; calendar refresh failed', text: 'Your holiday was saved. Retry loading the calendar before making another change.', icon: 'warning' });
        return;
      }
      await showCurriculumAlert({
        title: editingId != null ? 'Manual holiday updated' : 'Manual holiday added',
        text: editingId != null
          ? `${payload.label} has been updated.`
          : `${payload.label} has been added to the bank holiday calendar.`,
        timer: 1800,
      });
    } catch (err) {
      drawer.setError(err instanceof Error ? err.message : 'The manual holiday could not be saved.');
    } finally {
      drawer.setSaving(false);
      setWriting(false);
      mutationLock.current = false;
    }
  };

  const deleteManualHoliday = async (holiday: CurriculumHoliday) => {
    if (mutationLock.current || isBankHoliday(holiday)) return;
    mutationLock.current = true;
    setWriting(true);
    try {
    await showCurriculumConfirm({
      title: 'Delete manual holiday?',
      text: `${holiday.label} will be removed from the bank holiday calendar. This does not touch GOV.UK bank holidays.`,
      icon: 'warning',
      confirmButtonText: 'Delete holiday',
      onConfirm: async () => {
        await archiveCurriculumHoliday(holiday.id);
        const refreshed = await load(undefined, { fresh: true });
        if (!refreshed) setNeedsRefresh(true);
      },
      successTitle: 'Manual holiday deleted',
    });
    } finally { mutationLock.current = false; setWriting(false); }
  };

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Bank Holidays"
      pageSubtitle="GOV.UK bank holidays plus manually added dates"
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div id="curriculum-bank-holidays-page" className={styles.page}>
        <HolidayCatalogue holidays={holidays} loaded={loaded} loading={loading} today={today}
          search={search} onSearch={setSearch} year={yearFilter} onYear={setYearFilter} source={sourceFilter} onSource={setSourceFilter}
          onReset={() => { setSearch(''); setSourceFilter(''); setYearFilter(''); }}
          lastSuccess={lastChecked ? stampLabel(lastChecked) : ''} feedSource={cleanText(syncStatus?.source)} logUnavailable={Boolean(logError)}
          checking={checking} mutationPending={checking || writing || needsRefresh}
          onSync={() => void checkNow()} onAdd={openAddDrawer} onEdit={openEditDrawer} onDelete={holiday => void deleteManualHoliday(holiday)}
          renderTable={rows => (
        <EntityTable
          columns={COLUMNS}
          gridClass={GRID}
          rows={rows}
          rowKey={holiday => String(holiday.id)}
          loading={loading && !loaded}
          empty={loaded ? (
            <EntityEmptyState
              icon="ri-flag-line"
              title={holidays.length ? 'No holidays match these filters' : 'No bank holidays stored yet'}
              message={holidays.length
                ? 'Clear a filter, or search for a different holiday.'
                : 'Use Check GOV.UK now to sync the official feed, or add a manual holiday.'}
              action={holidays.length || writing || needsRefresh ? undefined : { label: 'Add manual holiday', onClick: openAddDrawer }}
            />
          ) : <p role="status">Holiday calendar unavailable. Retry the request below.</p>}
          renderRow={holiday => {
            const bankHoliday = isBankHoliday(holiday);
            return (
              <>
                <StackedCell
                  primary={(
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: holiday.color || (bankHoliday ? '#dc2626' : MANUAL_COLOR) }}
                      />
                      {holiday.label}
                    </span>
                  )}
                  secondary={bankHoliday ? regionLabel(holiday) || 'Region unavailable' : (cleanText(holiday.type) || MANUAL_TYPE)}
                />
                <PlainCell>{formatDateLabel(holiday.startDate)}</PlainCell>
                <PlainCell>{formatDateLabel(holiday.endDate || holiday.startDate)}</PlainCell>
                <PlainCell align="center">{periodDays(holiday) ?? 'Unavailable'}</PlainCell>
                <PlainCell>{bankHoliday ? 'GOV.UK' : 'Manual'}</PlainCell>
                <PlainCell>{cleanText(holiday.notes, '-')}</PlainCell>
                {bankHoliday ? (
                  <PlainCell align="right">-</PlainCell>
                ) : (
                  <NamedActions
                    actions={[
                      { icon: 'ri-edit-line', label: 'Edit', disabled: checking || writing || needsRefresh, title: 'Edit this manual holiday', onClick: () => openEditDrawer(holiday) },
                      { icon: 'ri-delete-bin-line', label: 'Delete', disabled: checking || writing || needsRefresh, title: 'Delete this manual holiday', onClick: () => void deleteManualHoliday(holiday) },
                    ]}
                  />
                )}
              </>
            );
          }}
        />
          )}
        />
        {error && <InlineError message={error} onRetry={() => void load()} />}
        {needsRefresh && <p role="status">The last change was saved, but the calendar could not be refreshed. Reload the calendar before making another change.</p>}
        <WorkspacePanel
          title="GOV.UK updates"
          description={lastChecked
            ? `Last checked ${stampLabel(lastChecked)}. Manual holidays are kept separately and are not overwritten by GOV.UK.`
            : 'The GOV.UK feed has not recorded a successful check yet.'}
        >
          {logError ? (
            <p className="py-2 text-[13px] text-rose-700">{logError}</p>
          ) : notableSyncs.length === 0 ? (
            <p className="py-2 text-[13px] text-foreground-500">
              {loading && !loaded
                ? 'Reading the check log...'
                : 'No changes reported in the available GOV.UK check log.'}
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
                      {sync.message || 'GOV.UK could not be reached. The stored dates were left unchanged.'}
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
      </div>

      <EntityDrawer
        open={drawer.open}
        title={editingId != null ? 'Edit manual holiday' : 'Add manual holiday'}
        subtitle="Manual holidays sit beside GOV.UK bank holidays and are not overwritten by GOV.UK sync."
        onClose={() => { drawer.close(); setEditingId(null); }}
        onSubmit={saveManualHoliday}
        submitLabel={editingId != null ? 'Save changes' : 'Add holiday'}
        submitDisabled={
          !drawer.form.label.trim()
          || !drawer.form.startDate
          || Boolean(drawer.form.endDate && drawer.form.endDate < drawer.form.startDate)
        }
        saving={drawer.saving}
        error={drawer.error}
        dirty={drawer.dirty}
        width="w-[440px]"
      >
        <div className={styles.holidayForm}>
        <FormField label="Name" required>
          <TextControl
            value={drawer.form.label}
            onChange={value => drawer.patch({ label: value })}
            placeholder="e.g. College closure"
          />
        </FormField>
        <div className={styles.holidayDates}>
          <DatePickerField
            label="Start date"
            required
            value={drawer.form.startDate}
            onChange={value => drawer.patch({
              startDate: value,
              // An end date the new start date has moved past no longer describes a
              // real range, so it is cleared rather than left to fail at submit.
              endDate: drawer.form.endDate && drawer.form.endDate < value ? '' : drawer.form.endDate,
            })}
          />
          <DatePickerField
            label="End date"
            value={drawer.form.endDate}
            onChange={value => drawer.patch({ endDate: value })}
            min={drawer.form.startDate || undefined}
            disabled={!drawer.form.startDate}
            helper={drawer.form.startDate ? 'Leave blank for one day.' : 'Set the start date first.'}
          />
        </div>
        <FormField label="Type" hint="Optional — e.g. Workshop, Staff training, Exam week.">
          <TextControl
            value={drawer.form.type}
            onChange={value => drawer.patch({ type: value })}
            placeholder="e.g. Workshop"
          />
        </FormField>
        {typeOptions.length > 0 && (
          <div className={styles.usedTypes}>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Already used:</span>
            {typeOptions.map(option => {
              const active = drawer.form.type.trim().toLowerCase() === option.label.toLowerCase();
              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => drawer.patch({ type: option.label, color: option.color })}
                  aria-pressed={active}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-smooth ${
                    active ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100'
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />
                  {option.label}
                </button>
              );
            })}
          </div>
        )}
        {drawer.form.type.trim() && (
          <FormField label="Type colour" as="group">
            <ColorControl value={drawer.form.color} onChange={color => drawer.patch({ color })} />
          </FormField>
        )}
        </div>
      </EntityDrawer>
    </WorkspaceShell>
  );
}

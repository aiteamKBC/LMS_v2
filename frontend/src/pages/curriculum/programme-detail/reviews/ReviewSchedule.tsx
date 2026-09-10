// Review Schedule / clash management -- previews each Review template's
// projected occurrences for this Programme, grouped by calendar month, and
// lets staff resolve a month where more than one Review falls due. Skipping
// an occurrence here never disables the recurring template: it only removes
// that one calendar occurrence from the effective schedule (see
// review_schedule.py). Loaded lazily by ReviewsTab alongside the templates
// grid, in the same tab -- not a separate page.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import { Modal } from '@/pages/users/components/Modal';
import {
  fetchReviewSchedule,
  resolveReviewClash,
  type ReviewClashDecisionItem,
  type ReviewScheduleMonth,
  type ReviewScheduleOccurrence,
} from '@/lib/curriculumApi';
import { EntityEmptyState, InlineError, WorkspacePanel } from '@/pages/curriculum/shared/entities/ui';

const PREVIEW_MONTHS = 12;

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function dayLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function resolutionBadge(month: ReviewScheduleMonth): { label: string; className: string } | null {
  if (!month.hasClash) return null;
  if (month.resolutionStatus === 'unresolved') {
    return { label: `Clash – ${month.occurrences.length} reviews due`, className: 'border-amber-300 bg-amber-50 text-amber-800' };
  }
  if (month.resolutionStatus === 'kept_all') {
    return { label: 'Resolved – kept both', className: 'border-green-200 bg-green-50 text-green-700' };
  }
  return { label: 'Resolved', className: 'border-green-200 bg-green-50 text-green-700' };
}

export function ReviewSchedulePanel({ programmeId }: { programmeId: string }) {
  const [months, setMonths] = useState<ReviewScheduleMonth[] | null>(null);
  const [error, setError] = useState('');
  const [resolveTarget, setResolveTarget] = useState<ReviewScheduleMonth | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (opts: { silent?: boolean; skipCache?: boolean } = {}) => {
    if (!programmeId) return;
    if (!opts.silent) setError('');
    try {
      const result = await fetchReviewSchedule(programmeId, { months: PREVIEW_MONTHS, skipCache: opts.skipCache });
      setMonths(result.months);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the review schedule.');
    }
  }, [programmeId]);

  useEffect(() => { void load(); }, [load]);

  const handleRestore = useCallback(async (month: ReviewScheduleMonth, occurrence: ReviewScheduleOccurrence) => {
    const key = `${occurrence.reviewId}:${occurrence.occurrenceDate}`;
    setBusyKey(key);
    try {
      await resolveReviewClash(programmeId, {
        month: month.month,
        occurrences: [{ reviewId: occurrence.reviewId, occurrenceDate: occurrence.occurrenceDate, action: 'keep' }],
      });
      await load({ silent: true, skipCache: true });
    } catch (err) {
      await showCurriculumAlert({ icon: 'error', title: 'Could not restore this occurrence', text: err instanceof Error ? err.message : 'Please try again.', confirmButtonText: 'OK' });
    } finally {
      setBusyKey(null);
    }
  }, [programmeId, load]);

  const loading = months === null && !error;

  return (
    <WorkspacePanel
      title="Review Schedule"
      description={`Projected review occurrences for the next ${PREVIEW_MONTHS} months. A month with more than one review due needs a scheduling decision.`}
    >
      {error && <InlineError message={error} onRetry={() => void load()} />}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-[12px] font-semibold text-foreground-400">
          <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
          Loading schedule...
        </div>
      )}

      {!loading && !error && months && months.length === 0 && (
        <EntityEmptyState
          icon="ri-calendar-line"
          title="No review occurrences in the next 12 months"
          message="Add a review or check its recurrence settings to see a schedule preview here."
        />
      )}

      {!loading && !error && months && months.length > 0 && (
        <div className="space-y-2">
          {months.map(month => {
            const badge = resolutionBadge(month);
            return (
              <div key={month.month} className="rounded-xl border border-background-200 bg-background-50 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] font-bold text-foreground-950">{monthLabel(month.month)}</p>
                  <div className="flex items-center gap-2">
                    {badge && (
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${badge.className}`}>
                        {badge.label}
                      </span>
                    )}
                    {month.hasClash && month.resolutionStatus === 'unresolved' && (
                      <button
                        type="button"
                        onClick={() => setResolveTarget(month)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
                      >
                        Resolve clash
                      </button>
                    )}
                    {month.hasClash && month.resolutionStatus !== 'unresolved' && (
                      <button
                        type="button"
                        onClick={() => setResolveTarget(month)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-background-200 bg-white px-3 text-[11px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
                      >
                        Change decision
                      </button>
                    )}
                  </div>
                </div>
                <ul className="mt-2.5 space-y-1.5">
                  {month.occurrences.map(occurrence => {
                    const key = `${occurrence.reviewId}:${occurrence.occurrenceDate}`;
                    const skipped = occurrence.status === 'skipped';
                    return (
                      <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-[12px]">
                        <span className={`min-w-0 truncate font-semibold ${skipped ? 'text-foreground-400 line-through' : 'text-foreground-800'}`}>
                          {occurrence.reviewName}
                          <span className="ml-1.5 font-normal text-foreground-400">{dayLabel(occurrence.occurrenceDate)}</span>
                        </span>
                        {skipped ? (
                          <button
                            type="button"
                            onClick={() => void handleRestore(month, occurrence)}
                            disabled={busyKey === key}
                            className="shrink-0 text-[11px] font-bold text-primary-600 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {busyKey === key ? 'Restoring...' : 'Restore occurrence'}
                          </button>
                        ) : (
                          <span className="shrink-0 rounded-full border border-background-200 bg-background-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground-500">
                            Scheduled
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {resolveTarget && (
        <ClashResolutionModal
          programmeId={programmeId}
          month={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={() => { setResolveTarget(null); void load({ silent: true, skipCache: true }); }}
        />
      )}
    </WorkspacePanel>
  );
}

function ClashResolutionModal({ programmeId, month, onClose, onResolved }: {
  programmeId: string;
  month: ReviewScheduleMonth;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [keepMap, setKeepMap] = useState<Record<string, boolean>>(() => (
    Object.fromEntries(month.occurrences.map(o => [`${o.reviewId}:${o.occurrenceDate}`, o.status !== 'skipped']))
  ));
  const [saving, setSaving] = useState(false);

  const keyOf = (occurrence: ReviewScheduleOccurrence) => `${occurrence.reviewId}:${occurrence.occurrenceDate}`;

  const toggle = (occurrence: ReviewScheduleOccurrence) => {
    const key = keyOf(occurrence);
    setKeepMap(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const keepAll = () => {
    setKeepMap(Object.fromEntries(month.occurrences.map(o => [keyOf(o), true])));
  };

  const skippedCount = useMemo(
    () => month.occurrences.filter(o => !keepMap[keyOf(o)]).length,
    [keepMap, month.occurrences],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const occurrences: ReviewClashDecisionItem[] = month.occurrences.map(o => ({
        reviewId: o.reviewId,
        occurrenceDate: o.occurrenceDate,
        action: keepMap[keyOf(o)] ? 'keep' : 'skip',
      }));
      await resolveReviewClash(programmeId, { month: month.month, occurrences });
      onResolved();
    } catch (err) {
      await showCurriculumAlert({ icon: 'error', title: 'Could not save this decision', text: err instanceof Error ? err.message : 'Please try again.', confirmButtonText: 'OK' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Review clash, ${monthLabel(month.month)}`}
      onClose={onClose}
      size="max-w-lg"
      footer={(
        <div className="flex w-full items-center justify-between gap-2">
          <button
            type="button"
            onClick={keepAll}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-700 hover:bg-background-100"
          >
            Keep both
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 hover:bg-background-100">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving && <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>}
              Save decision
            </button>
          </div>
        </div>
      )}
    >
      <div className="space-y-3">
        <p className="text-[12px] text-foreground-500">
          The following reviews are due this month. Choose which should remain scheduled -- skipping one does not
          delete or disable it, it only skips this month&apos;s occurrence.
        </p>
        <div className="space-y-2">
          {month.occurrences.map(occurrence => {
            const key = keyOf(occurrence);
            const checked = Boolean(keepMap[key]);
            return (
              <label
                key={key}
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-smooth ${checked ? 'border-primary-300 bg-primary-50' : 'border-background-200 bg-background-50'}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(occurrence)}
                  className="mt-0.5 h-4 w-4 rounded border-background-300 text-primary-600 focus:ring-primary-300"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-bold text-foreground-900">{occurrence.reviewName}</span>
                  <span className="block text-[11px] text-foreground-500">{dayLabel(occurrence.occurrenceDate)} {new Date(`${occurrence.occurrenceDate}T00:00:00`).getFullYear()}</span>
                  <span className="block text-[11px] text-foreground-400">{occurrence.recurrenceLabel}</span>
                </span>
              </label>
            );
          })}
        </div>
        {skippedCount > 0 && (
          <p className="text-[11px] font-semibold text-amber-700">
            {skippedCount} review{skippedCount === 1 ? '' : 's'} will be skipped for this month only. The recurring review is not affected.
          </p>
        )}
      </div>
    </Modal>
  );
}

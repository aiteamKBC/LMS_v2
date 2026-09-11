import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { useToast } from '@/hooks/useToast';
import {
  bulkGenerateProgressReviews,
  fetchActiveLearners,
  fetchProgressReviewDownloadUrl,
  fetchReviewPack,
  fetchReviewPeriods,
  generateProgressReview,
  type ProgressReviewActiveLearner,
  type ProgressReviewBulkResult,
  type ProgressReviewGenerateResult,
  type ProgressReviewPack,
  type ProgressReviewPeriod,
} from '@/api/progressReviews';

function str(value: unknown, fallback = 'Not available'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function formatDate(value?: string | null) {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
}

function isSuccess(row: ProgressReviewBulkResult['results'][number]): row is ProgressReviewGenerateResult {
  return row.generationStatus === 'completed';
}

export default function ProgressReviewGeneratePanel() {
  const { success, error: toastError } = useToast();

  const [learners, setLearners] = useState<ProgressReviewActiveLearner[]>([]);
  const [learnersLoading, setLearnersLoading] = useState(true);
  const [learnersError, setLearnersError] = useState<string | null>(null);

  const [selectedLearnerId, setSelectedLearnerId] = useState<string>('');
  const [periods, setPeriods] = useState<ProgressReviewPeriod[]>([]);
  const [selectedReviewDate, setSelectedReviewDate] = useState<string>('');

  const [pack, setPack] = useState<ProgressReviewPack | null>(null);
  const [packLoading, setPackLoading] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<ProgressReviewGenerateResult | null>(null);
  const [downloading, setDownloading] = useState(false);

  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResults, setBulkResults] = useState<ProgressReviewBulkResult['results'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLearnersLoading(true);
    fetchActiveLearners()
      .then((results) => { if (!cancelled) setLearners(results); })
      .catch((err) => { if (!cancelled) setLearnersError(err instanceof Error ? err.message : 'Unable to load active learners.'); })
      .finally(() => { if (!cancelled) setLearnersLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setPeriods([]);
    setSelectedReviewDate('');
    setPack(null);
    setPackError(null);
    setGenerateResult(null);
    if (!selectedLearnerId) return;
    let cancelled = false;
    fetchReviewPeriods(selectedLearnerId)
      .then((results) => {
        if (cancelled) return;
        setPeriods(results);
        const latest = results[results.length - 1];
        if (latest) setSelectedReviewDate(latest.review_date);
      })
      .catch((err) => { if (!cancelled) setPackError(err instanceof Error ? err.message : 'Unable to load review periods.'); });
    return () => { cancelled = true; };
  }, [selectedLearnerId]);

  useEffect(() => {
    if (!selectedLearnerId) return;
    let cancelled = false;
    setPackLoading(true);
    setPackError(null);
    fetchReviewPack(selectedLearnerId, selectedReviewDate || undefined)
      .then((data) => { if (!cancelled) setPack(data); })
      .catch((err) => { if (!cancelled) setPackError(err instanceof Error ? err.message : 'Unable to load the review pack preview.'); })
      .finally(() => { if (!cancelled) setPackLoading(false); });
    return () => { cancelled = true; };
  }, [selectedLearnerId, selectedReviewDate]);

  const selectedLearner = useMemo(
    () => learners.find((learner) => String(learner.learnerId) === selectedLearnerId) || null,
    [learners, selectedLearnerId],
  );

  const learnerSection = pack?.learner as Record<string, unknown> | undefined;
  const reviewSection = pack?.review as Record<string, unknown> | undefined;
  const isActive = Boolean(learnerSection?.active_status);
  const warnings = pack?.source_warnings || [];

  async function handleGenerate() {
    if (!selectedLearnerId) return;
    setGenerating(true);
    setGenerateResult(null);
    try {
      const result = await generateProgressReview(selectedLearnerId, selectedReviewDate || undefined);
      setGenerateResult(result);
      success('Progress Review generated', `PPTX created for ${str(learnerSection?.full_name, 'this learner')}.`);
    } catch (err) {
      toastError('Generation failed', err instanceof Error ? err.message : 'Unable to generate the Progress Review PPTX.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownload(reviewId: string) {
    setDownloading(true);
    try {
      const url = await fetchProgressReviewDownloadUrl(reviewId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toastError('Download failed', err instanceof Error ? err.message : 'Unable to fetch the download link.');
    } finally {
      setDownloading(false);
    }
  }

  async function handleBulkGenerate() {
    if (!window.confirm(`Generate Progress Review PPTX decks for all ${learners.length} active learners? This may take a while.`)) return;
    setBulkRunning(true);
    setBulkResults(null);
    try {
      const data = await bulkGenerateProgressReviews({});
      setBulkResults(data.results);
      const failed = data.results.filter((row) => row.generationStatus === 'failed').length;
      if (failed) {
        toastError('Bulk generation finished with errors', `${failed} of ${data.results.length} learner(s) failed — see the results below.`);
      } else {
        success('Bulk generation complete', `${data.results.length} Progress Review deck(s) generated.`);
      }
    } catch (err) {
      toastError('Bulk generation failed', err instanceof Error ? err.message : 'Unable to run bulk generation.');
    } finally {
      setBulkRunning(false);
    }
  }

  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground-950">Progress Review PPTX</h3>
            <p className="text-sm text-foreground-500">
              Select a learner, review the calculated 12-week period, and generate a stored PPTX deck.
            </p>
          </div>
          <button
            type="button"
            onClick={handleBulkGenerate}
            disabled={bulkRunning || !learners.length}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-foreground-200 bg-white px-4 text-[12px] font-semibold text-foreground-700 transition hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <AppIcon className={bulkRunning ? 'ri-loader-4-line animate-spin' : 'ri-stack-line'} />
            {bulkRunning ? 'Generating all…' : `Bulk generate (${learners.length} active)`}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Learner</span>
            <select
              value={selectedLearnerId}
              onChange={(event) => setSelectedLearnerId(event.target.value)}
              disabled={learnersLoading}
              className="h-10 rounded-lg border border-foreground-200 bg-white px-3 text-sm text-foreground-900"
            >
              <option value="">{learnersLoading ? 'Loading active learners…' : 'Select an active learner'}</option>
              {learners.map((learner) => (
                <option key={learner.learnerId} value={learner.learnerId}>
                  {learner.fullName} — {learner.programme || 'No programme'}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Review period</span>
            <select
              value={selectedReviewDate}
              onChange={(event) => setSelectedReviewDate(event.target.value)}
              disabled={!selectedLearnerId || !periods.length}
              className="h-10 rounded-lg border border-foreground-200 bg-white px-3 text-sm text-foreground-900"
            >
              {!periods.length && <option value="">{selectedLearnerId ? 'Loading periods…' : 'Select a learner first'}</option>}
              {periods.map((period) => (
                <option key={period.review_date} value={period.review_date}>
                  Review {period.review_number ?? '?'} — {formatDate(period.review_period_start)} to {formatDate(period.review_period_end)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {learnersError && <EmptyState variant="error" title="Could not load active learners" description={learnersError} size="sm" />}

        {!selectedLearnerId ? (
          <EmptyState variant="empty" title="No learner selected" description="Choose an active learner above to preview their review pack." size="sm" />
        ) : packLoading ? (
          <div className="rounded-lg border border-foreground-200 bg-background-50 p-4 text-sm text-foreground-500">Loading review pack preview…</div>
        ) : packError ? (
          <EmptyState variant="error" title="Could not load the review pack" description={packError} size="sm" />
        ) : pack ? (
          <div className="flex flex-col gap-3 rounded-lg border border-foreground-200 bg-background-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground-950">{str(learnerSection?.full_name)}</p>
                <p className="text-xs text-foreground-500">
                  {str(learnerSection?.programme)} · {str(learnerSection?.employer)} · Review {str(reviewSection?.review_number)} ·{' '}
                  {formatDate(str(reviewSection?.review_period_start, ''))} to {formatDate(str(reviewSection?.review_period_end, ''))}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                  isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                }`}
              >
                {isActive ? 'Active learner' : 'Not active — cannot generate'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Attendance', str((pack.attendance as Record<string, unknown>)?.attendance_percentage)],
                ['Programme progress', str((pack.progress as Record<string, unknown>)?.current_programme_progress_percentage)],
                ['OTJ status', str((pack.otj as Record<string, unknown>)?.risk_status)],
                ['EPA readiness', str((pack.epa as Record<string, unknown>)?.current_readiness)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-foreground-200 bg-white px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground-900">{value}</p>
                </div>
              ))}
            </div>

            {warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Missing data warnings ({warnings.length})</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-800">
                  {warnings.slice(0, 6).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                  {warnings.length > 6 && <li>+{warnings.length - 6} more</li>}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || !isActive}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground-950 px-4 text-[12px] font-semibold text-white transition hover:bg-foreground-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon className={generating ? 'ri-loader-4-line animate-spin' : 'ri-slideshow-line'} />
                {generating ? 'Generating…' : 'Generate PPTX'}
              </button>
              {generateResult && (
                <button
                  type="button"
                  onClick={() => handleDownload(generateResult.reviewId)}
                  disabled={downloading}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-foreground-200 bg-white px-4 text-[12px] font-semibold text-foreground-700 transition hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <AppIcon className={downloading ? 'ri-loader-4-line animate-spin' : 'ri-download-line'} />
                  {downloading ? 'Fetching link…' : 'Download PPTX'}
                </button>
              )}
              {!isActive && <p className="text-xs text-foreground-500">Only active learners can have a Progress Review generated.</p>}
            </div>
          </div>
        ) : null}

        {bulkResults && (
          <div className="overflow-hidden rounded-lg border border-foreground-200">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-background-100 text-foreground-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Learner ID</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground-100 bg-white">
                {bulkResults.map((row) => (
                  <tr key={row.learnerId}>
                    <td className="px-3 py-2">{row.learnerId}</td>
                    <td className="px-3 py-2">
                      <span className={isSuccess(row) ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>
                        {row.generationStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-foreground-600">
                      {isSuccess(row) ? (
                        <button type="button" className="font-semibold text-violet-700 hover:underline" onClick={() => handleDownload(row.reviewId)}>
                          Download
                        </button>
                      ) : (
                        row.error
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}

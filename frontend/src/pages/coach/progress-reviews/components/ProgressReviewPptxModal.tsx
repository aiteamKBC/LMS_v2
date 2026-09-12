import { useEffect, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { useToast } from '@/hooks/useToast';
import {
  fetchLatestRun,
  fetchProgressReviewDownloadUrl,
  fetchReviewPack,
  generateProgressReview,
  type ProgressReviewGenerateResult,
  type ProgressReviewPack,
} from '@/api/progressReviews';
import {
  type CoachCalendarEvent,
  eventPeriodLabel,
  eventTargetDate,
  formatDateLabel,
  statusLabel,
} from '../../shared/calendarEvents';

type Phase = 'loading' | 'idle' | 'generating' | 'generated' | 'failed' | 'error';

function str(value: unknown, fallback = 'Not available'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function pctLabel(value: unknown): string {
  if (value === null || value === undefined || value === '' || value === 'Not available') return 'Not available';
  return typeof value === 'number' ? `${value}%` : String(value);
}

export default function ProgressReviewPptxModal({
  open,
  review,
  onClose,
  onGenerated,
}: {
  open: boolean;
  review: CoachCalendarEvent | null;
  onClose: () => void;
  /** Lets the review card's own button relabel to "Slides" the moment a deck
   * is generated, without the whole reviews list needing to refetch. */
  onGenerated?: (review: CoachCalendarEvent) => void;
}) {
  const { success, error: toastError } = useToast();
  const [phase, setPhase] = useState<Phase>('loading');
  const [pack, setPack] = useState<ProgressReviewPack | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const learnerId = review?.learnerId || review?.enrolmentId || '';
  const reviewDate = review ? eventTargetDate(review) : '';

  useEffect(() => {
    if (!open || !review || !learnerId || !reviewDate) return;
    let cancelled = false;
    setPhase('loading');
    setPack(null);
    setPackError(null);
    setReviewId(null);
    setGenerateError(null);

    Promise.all([
      fetchReviewPack(learnerId, reviewDate),
      fetchLatestRun(learnerId, reviewDate).catch(() => ({ exists: false as const })),
    ])
      .then(([packData, latestRun]) => {
        if (cancelled) return;
        setPack(packData);
        if (latestRun.exists && latestRun.generationStatus === 'completed' && latestRun.reviewId) {
          setReviewId(latestRun.reviewId);
          setPhase('generated');
        } else {
          setPhase('idle');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setPackError(err instanceof Error ? err.message : 'Unable to load the review pack preview.');
        setPhase('error');
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, learnerId, reviewDate]);

  if (!open || !review) return null;

  const isCompletedReview = review.status === 'completed';

  async function handleGenerate() {
    if (isCompletedReview && phase === 'generated') {
      const confirmed = window.confirm(
        'This review is already marked Completed. Regenerating will create a new PPTX for the same review — continue?',
      );
      if (!confirmed) return;
    }
    setPhase('generating');
    setGenerateError(null);
    try {
      const result: ProgressReviewGenerateResult = await generateProgressReview(learnerId, reviewDate);
      setReviewId(result.reviewId);
      setPhase('generated');
      success('Slides generated', `PPTX created for ${str(review.learner, 'this learner')}.`);
      if (review) onGenerated?.(review);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Unable to generate the Progress Review PPTX.');
      setPhase('failed');
    }
  }

  async function handleDownload() {
    if (!reviewId) return;
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

  const learnerSection = pack?.learner as Record<string, unknown> | undefined;
  const reviewSection = pack?.review as Record<string, unknown> | undefined;
  const warnings = pack?.source_warnings || [];
  const periodLabel = reviewSection
    ? `${formatDateLabel(str(reviewSection.review_period_start, ''))} to ${formatDateLabel(str(reviewSection.review_period_end, ''))}`
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground-950/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
        <header className="border-b border-foreground-200 px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground-950">Progress Review Slides</h2>
              <p className="mt-1 truncate text-sm font-medium text-foreground-800">
                {str(review.learner)} · {str(review.programme)}
              </p>
              <p className="mt-0.5 text-[12px] text-foreground-500">
                {eventPeriodLabel(review)}{periodLabel ? ` · ${periodLabel}` : ` · ${formatDateLabel(reviewDate)}`}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-foreground-400 hover:bg-background-100 hover:text-foreground-700">
              <AppIcon className="ri-close-line" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {phase === 'loading' ? (
            <div className="flex items-center gap-2 py-8 text-sm text-foreground-500">
              <AppIcon className="ri-loader-4-line animate-spin" /> Loading review pack…
            </div>
          ) : packError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{packError}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Attendance', pctLabel((pack?.attendance as Record<string, unknown>)?.attendance_percentage)],
                  ['Programme Progress', pctLabel((pack?.progress as Record<string, unknown>)?.current_programme_progress_percentage)],
                  ['OTJ Status', str((pack?.otj as Record<string, unknown>)?.risk_status)],
                  ['EPA Readiness', pctLabel((pack?.epa as Record<string, unknown>)?.current_readiness)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-foreground-200 bg-background-50 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-foreground-900">{value}</p>
                  </div>
                ))}
              </div>

              {warnings.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
                    Missing data warnings ({warnings.length})
                  </p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[12px] leading-snug text-amber-800">
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[11px] text-amber-700/80">
                    These describe missing source data — they do not block generation.
                  </p>
                </div>
              )}

              {phase === 'generating' && (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-foreground-200 bg-background-50 px-3 py-2.5 text-sm text-foreground-600">
                  <AppIcon className="ri-loader-4-line animate-spin" /> Generating slides…
                </div>
              )}

              {phase === 'generated' && (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                  <AppIcon className="ri-checkbox-circle-line" /> Slides generated successfully.
                </div>
              )}

              {phase === 'failed' && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  <p className="font-semibold">Generation failed</p>
                  <p className="mt-0.5">{generateError}</p>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-foreground-200 px-6 py-4">
          {phase === 'generated' ? (
            <>
              <button
                type="button"
                onClick={handleGenerate}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-foreground-200 bg-white px-4 text-[12px] font-semibold text-foreground-700 transition hover:bg-background-100"
              >
                <AppIcon className="ri-refresh-line" /> Regenerate
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground-950 px-4 text-[12px] font-semibold text-white transition hover:bg-foreground-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <AppIcon className={downloading ? 'ri-loader-4-line animate-spin' : 'ri-download-line'} />
                {downloading ? 'Fetching link…' : 'Download PPTX'}
              </button>
            </>
          ) : phase === 'failed' ? (
            <>
              <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-lg border border-foreground-200 bg-white px-4 text-[12px] font-semibold text-foreground-700 hover:bg-background-100">
                Close
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground-950 px-4 text-[12px] font-semibold text-white hover:bg-foreground-800"
              >
                <AppIcon className="ri-refresh-line" /> Try again
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-lg border border-foreground-200 bg-white px-4 text-[12px] font-semibold text-foreground-700 hover:bg-background-100">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={phase === 'loading' || phase === 'generating' || Boolean(packError)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground-950 px-4 text-[12px] font-semibold text-white transition hover:bg-foreground-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon className={phase === 'generating' ? 'ri-loader-4-line animate-spin' : 'ri-slideshow-line'} />
                {phase === 'generating' ? 'Generating…' : 'Generate PPTX'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

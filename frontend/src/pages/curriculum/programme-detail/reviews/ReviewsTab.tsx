// Programme "Reviews ID" tab: the Review Templates configured for one Programme.
//
// Loaded lazily -- only while this tab is actually selected (see page.tsx) -- so
// switching to Reviews never adds a request to every other tab's load.
import { useCallback, useEffect, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import {
  archiveReviewTemplate,
  fetchProgrammeReviews,
  type ReviewSummary,
} from '@/lib/curriculumApi';
import { EntityEmptyState, InlineError, NamedActions, WorkspacePanel } from '@/pages/curriculum/shared/entities/ui';
import { ReviewFormModal } from './ReviewForm';
import { CloneReviewsModal } from './CloneReviewsModal';
import { ReviewSchedulePanel } from './ReviewSchedule';

const RECURRENCE_UNIT_LABEL: Record<string, string> = { days: 'day', weeks: 'week', months: 'month' };

function recurrenceLabel(review: ReviewSummary): string {
  const { interval, unit } = review.recurrence;
  const noun = RECURRENCE_UNIT_LABEL[unit] || unit;
  return `Every ${interval} ${noun}${interval === 1 ? '' : 's'}`;
}

function statusesLabel(statuses: string[]): string {
  return statuses.length ? statuses.join(', ') : 'All statuses';
}

export function ReviewsTab({ programmeId, programmeName }: { programmeId: string; programmeName: string }) {
  const [reviews, setReviews] = useState<ReviewSummary[] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [formTarget, setFormTarget] = useState<'new' | ReviewSummary | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [busyReviewId, setBusyReviewId] = useState<string | null>(null);

  const load = useCallback(async (opts: { silent?: boolean; skipCache?: boolean } = {}) => {
    if (!programmeId) return;
    if (!opts.silent) setError('');
    setRefreshing(true);
    try {
      const results = await fetchProgrammeReviews(programmeId, { skipCache: opts.skipCache });
      setReviews(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load reviews for this programme.');
    } finally {
      setRefreshing(false);
    }
  }, [programmeId]);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = useCallback((review: ReviewSummary) => {
    void showCurriculumConfirm({
      title: `Delete "${review.name}"?`,
      text: 'This will remove this review configuration from the programme. Nothing is deleted from the database -- it can be restored by support if needed.',
      icon: 'warning',
      confirmButtonText: 'Delete Review',
      onConfirm: async () => {
        setBusyReviewId(review.id);
        try {
          await archiveReviewTemplate(review.id);
        } finally {
          setBusyReviewId(null);
        }
        await load({ silent: true, skipCache: true });
      },
      successTitle: 'Review deleted',
    });
  }, [load]);

  const loading = reviews === null && !error;

  return (
    <div className="space-y-5">
      <WorkspacePanel
        title="Reviews ID"
        description="Reusable review templates configured for this programme -- recurrence, eligibility, participants and the questions each review asks. Reviews here are templates only; nothing is sent to a learner yet."
        actions={(
          <>
            <button
              type="button"
              onClick={() => setCloneOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
            >
              <AppIcon className="ri-file-copy-2-line text-sm"></AppIcon>
              Clone Review From Another Programme
            </button>
            <button
              type="button"
              onClick={() => setFormTarget('new')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
            >
              <AppIcon className="ri-add-line text-sm"></AppIcon>
              Add New Review
            </button>
          </>
        )}
      >
        {error && <InlineError message={error} onRetry={() => void load()} />}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-[12px] font-semibold text-foreground-400">
            <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
            Loading reviews...
          </div>
        )}

        {!loading && !error && reviews && reviews.length === 0 && (
          <EntityEmptyState
            icon="ri-clipboard-line"
            title="No reviews have been configured yet"
            message="Add a new review, or clone one that's already set up on another programme, to get started."
            action={{ label: 'Add New Review', onClick: () => setFormTarget('new') }}
          />
        )}

        {!loading && !error && reviews && reviews.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {reviews.map(review => (
              <div key={review.id} className="flex flex-col gap-3 rounded-xl border border-background-200 bg-background-50 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-foreground-950">{review.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-foreground-400" title={review.id}>{review.id}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                    review.enabled ? 'border-green-200 bg-green-50 text-green-700' : 'border-background-300 bg-background-100 text-foreground-500'
                  }`}
                  >
                    {review.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="space-y-1 text-[12px] text-foreground-600">
                  <p><AppIcon className="ri-repeat-line mr-1.5 text-foreground-400"></AppIcon>{recurrenceLabel(review)}</p>
                  <p className="truncate" title={statusesLabel(review.applicableStatuses)}>
                    <AppIcon className="ri-user-follow-line mr-1.5 text-foreground-400"></AppIcon>{statusesLabel(review.applicableStatuses)}
                  </p>
                  <p><AppIcon className="ri-list-check-2 mr-1.5 text-foreground-400"></AppIcon>{review.fieldCount} field{review.fieldCount === 1 ? '' : 's'}</p>
                </div>
                <div className="mt-auto flex justify-end">
                  <NamedActions actions={[
                    { icon: 'ri-edit-line', label: 'Edit', title: `Edit ${review.name}`, onClick: () => setFormTarget(review) },
                    { icon: 'ri-delete-bin-line', label: 'Delete', title: `Delete ${review.name}`, onClick: () => handleDelete(review), disabled: busyReviewId === review.id, busy: busyReviewId === review.id },
                  ]}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </WorkspacePanel>

      {!loading && !error && reviews && reviews.length > 0 && (
        <ReviewSchedulePanel programmeId={programmeId} />
      )}

      {formTarget && (
        <ReviewFormModal
          programmeId={programmeId}
          review={formTarget === 'new' ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={() => { setFormTarget(null); void load({ silent: true, skipCache: true }); }}
        />
      )}

      {cloneOpen && (
        <CloneReviewsModal
          destinationProgrammeId={programmeId}
          destinationProgrammeName={programmeName}
          onClose={() => setCloneOpen(false)}
          onCloned={() => { setCloneOpen(false); void load({ silent: true, skipCache: true }); }}
        />
      )}
    </div>
  );
}

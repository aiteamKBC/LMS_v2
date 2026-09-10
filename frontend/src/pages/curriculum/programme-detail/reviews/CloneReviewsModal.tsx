// Clone Review From Another Programme -- pick a source programme, pick one or
// more of its reviews, deep-copy them into the current programme with fresh
// REV- ids. Source reviews are fetched only after a source programme is picked,
// so opening this modal never fires more than the programme-list request.
import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import { Modal } from '@/pages/users/components/Modal';
import {
  cloneReviewTemplates,
  fetchCurriculumProgrammes,
  fetchProgrammeReviews,
  type CurriculumProgramme,
  type ReviewSummary,
} from '@/lib/curriculumApi';
import { FormField, SelectControl } from '@/pages/curriculum/shared/entities/ui';

export function CloneReviewsModal({ destinationProgrammeId, destinationProgrammeName, onClose, onCloned }: {
  destinationProgrammeId: string;
  destinationProgrammeName: string;
  onClose: () => void;
  onCloned: () => void;
}) {
  const [programmes, setProgrammes] = useState<CurriculumProgramme[] | null>(null);
  const [programmesError, setProgrammesError] = useState('');
  const [sourceProgrammeId, setSourceProgrammeId] = useState('');

  const [sourceReviews, setSourceReviews] = useState<ReviewSummary[] | null>(null);
  const [sourceReviewsError, setSourceReviewsError] = useState('');
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionError, setSelectionError] = useState('');
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCurriculumProgrammes()
      .then(list => { if (!cancelled) setProgrammes(list); })
      .catch(err => { if (!cancelled) setProgrammesError(err instanceof Error ? err.message : 'Unable to load programmes.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sourceProgrammeId) { setSourceReviews(null); return; }
    let cancelled = false;
    setLoadingReviews(true);
    setSourceReviewsError('');
    setSelectedIds(new Set());
    fetchProgrammeReviews(sourceProgrammeId)
      .then(list => { if (!cancelled) setSourceReviews(list); })
      .catch(err => { if (!cancelled) setSourceReviewsError(err instanceof Error ? err.message : 'Unable to load reviews for this programme.'); })
      .finally(() => { if (!cancelled) setLoadingReviews(false); });
    return () => { cancelled = true; };
  }, [sourceProgrammeId]);

  const sourceOptions = useMemo(
    () => (programmes || [])
      .filter(programme => programme.id !== destinationProgrammeId)
      .map(programme => ({ value: programme.id, label: programme.name })),
    [programmes, destinationProgrammeId],
  );

  const toggle = (id: string) => {
    setSelectionError('');
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCopy = async () => {
    if (selectedIds.size === 0) {
      setSelectionError('Please choose one or more types.');
      return;
    }
    setCloning(true);
    try {
      await cloneReviewTemplates(destinationProgrammeId, {
        sourceProgrammeId,
        reviewIds: Array.from(selectedIds),
      });
      onCloned();
    } catch (err) {
      await showCurriculumAlert({ icon: 'error', title: 'Could not clone these reviews', text: err instanceof Error ? err.message : 'Please try again.', confirmButtonText: 'OK' });
    } finally {
      setCloning(false);
    }
  };

  return (
    <Modal
      title={`Clone reviews into ${destinationProgrammeName}`}
      onClose={onClose}
      size="max-w-2xl"
      footer={(
        <div className="flex w-full items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 hover:bg-background-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={cloning || !sourceProgrammeId}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cloning && <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>}
            Copy
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <FormField label="Source programme" required>
          {programmesError ? (
            <p className="text-[11px] font-semibold text-red-600">{programmesError}</p>
          ) : (
            <SelectControl
              value={sourceProgrammeId}
              onChange={setSourceProgrammeId}
              options={sourceOptions}
              placeholder={programmes === null ? 'Loading programmes...' : 'Choose a programme'}
              disabled={programmes === null}
            />
          )}
        </FormField>

        {sourceProgrammeId && (
          <FormField label="Reviews to copy" as="group" error={selectionError}>
            {loadingReviews && (
              <div className="flex items-center gap-2 py-4 text-[12px] font-semibold text-foreground-400">
                <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
                Loading reviews...
              </div>
            )}
            {sourceReviewsError && <p className="text-[11px] font-semibold text-red-600">{sourceReviewsError}</p>}
            {!loadingReviews && !sourceReviewsError && sourceReviews && sourceReviews.length === 0 && (
              <p className="rounded-lg border border-dashed border-background-300 bg-background-50 px-3 py-4 text-center text-[12px] text-foreground-400">
                This programme has no reviews to copy.
              </p>
            )}
            {!loadingReviews && sourceReviews && sourceReviews.length > 0 && (
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-background-200 bg-background-50 p-2">
                {sourceReviews.map(review => {
                  const checked = selectedIds.has(review.id);
                  return (
                    <label key={review.id} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-smooth ${checked ? 'border-primary-300 bg-primary-50' : 'border-transparent hover:bg-background-100'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(review.id)}
                        className="h-4 w-4 rounded border-background-300 text-primary-600 focus:ring-primary-300"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-foreground-900">{review.name}</span>
                        <span className="block text-[11px] text-foreground-400">{review.fieldCount} field{review.fieldCount === 1 ? '' : 's'}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </FormField>
        )}
      </div>
    </Modal>
  );
}

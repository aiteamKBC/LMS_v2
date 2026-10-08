import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import {
  downloadEmployerProgressReview, fetchEmployerProgressReview, fetchEmployerProgressReviews, saveEmployerReviewAnswers, signReviewAsEmployer,
} from '@/api/employerPortal';
import {
  downloadMigratedReviewForParty, fetchMigratedReviewForParty, signMigratedReviewAsParty,
  type LearnerReviewDefinition,
} from '@/api/learnerCalendar';
import ReviewsHome from '@/pages/learner/progress-reviews/ReviewsHome';
import { ImportedReviewSections } from '@/pages/learner/progress-reviews/page';
import { LearnerReviewInstanceForm } from '@/pages/learner/reviews/LearnerReviewInstanceForm';
import styles from '@/pages/learner/progress-reviews/reviewsHome.module.css';

type Props = {
  employerId: string; kind: LearnerKind; learnerId: string; employerName: string;
  onReviewChanged: () => void | Promise<void>;
};

export function EmployerProgressReviewsTab({ employerId, kind, learnerId, employerName, onReviewChanged }: Props) {
  const client = useQueryClient();
  const listKey = ['employer-progress-reviews', employerId, kind, learnerId];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const list = useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) => fetchEmployerProgressReviews(employerId, kind, learnerId, signal),
  });
  const detail = useQuery({
    queryKey: [...listKey, selectedKey], enabled: !!selectedKey,
    queryFn: async ({ signal }) => {
      const value = await fetchEmployerProgressReview(employerId, kind, learnerId, selectedKey!, signal);
      return value.event.migratedForm
        ? { ...value, definition: await fetchMigratedReviewForParty(value.event.eventKey, signal) }
        : value;
    },
  });
  const review = detail.data?.event;
  const definition = detail.data?.definition;
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: listKey }),
      Promise.resolve(onReviewChanged()),
    ]);
  };
  const saveAnswers = async (answers: Record<string, unknown>): Promise<LearnerReviewDefinition> => {
    if (!review || !definition?.instance) throw new Error('This review is not ready for employer answers.');
    await saveEmployerReviewAnswers(employerId, kind, learnerId, definition.instance.id, answers);
    const updated = await detail.refetch();
    if (updated.error) throw updated.error;
    if (!updated.data?.definition) throw new Error('Could not refresh the review. Please try again.');
    await client.invalidateQueries({ queryKey: listKey, exact: true });
    return updated.data.definition;
  };
  const sign = async (signature: string) => {
    if (!review || !definition) throw new Error('This review is not ready for signing.');
    if (review.migratedForm) await signMigratedReviewAsParty(review.eventKey, signature);
    else if (definition.instance) await signReviewAsEmployer(employerId, kind, learnerId, definition.instance.id, { name: employerName, signature });
    else throw new Error('The coach must prepare this review before you can sign.');
    await refresh();
  };
  const errorMessage = (error: Error | null) => error?.message || 'Could not load progress reviews. Please try again.';

  if (selectedKey) return <section className={`${styles.home} space-y-4`} aria-label="Employer progress review">
    <button type="button" className={styles.secondaryButton} onClick={() => setSelectedKey(null)}><ArrowLeft size={19} aria-hidden="true" />Back to reviews</button>
    {detail.isPending ? <p role="status" className={styles.loading}>Loading review…</p>
      : detail.isError ? <div role="alert" className={styles.empty}><p>{errorMessage(detail.error)}</p><button type="button" className={styles.secondaryButton} onClick={() => void detail.refetch()}>Try again</button></div>
      : definition ? <LearnerReviewInstanceForm key={review?.eventKey} definition={definition} viewerRole="employer" signatoryName={employerName}
        onSaveAnswers={!review?.migratedForm && definition.instance ? saveAnswers : undefined}
        onSign={sign} onDownload={review ? () => review.migratedForm
          ? downloadMigratedReviewForParty(review.eventKey)
          : downloadEmployerProgressReview(employerId, kind, learnerId, review.eventKey) : undefined} />
      : review?.importedReview ? <article className="space-y-4"><h2 className="text-lg font-semibold">{review.title}</h2><ImportedReviewSections review={review.importedReview} /></article>
      : <article className={styles.current}><h2>{review?.title || 'Progress review'}</h2><p className={styles.help}>{review?.notes || 'The coach is preparing this review. Its form will appear here when available.'}</p></article>}
  </section>;

  return <div className="space-y-4">
    {list.isError && <div role="alert" className={styles.home}><p>{errorMessage(list.error)}</p><button type="button" className={styles.secondaryButton} onClick={() => void list.refetch()}>Try again</button></div>}
    <ReviewsHome sessions={list.data?.events || []} definitions={list.data?.definitions} attendance={[]}
      learner={{ kind, id: learnerId }} lineManager={employerName} today={new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })}
      timeZone="Europe/London" loading={list.isPending} error={list.isError ? errorMessage(list.error) : ''}
      busy={false} canAct viewerRole="employer" titleOf={event => `${event.title}${event.occurrenceNumber != null ? ` #${event.occurrenceNumber}` : ''}`}
      onOpenReview={event => setSelectedKey(event.eventKey)} onSchedule={() => undefined} onAttend={() => undefined} onReport={() => undefined} />
  </div>;
}

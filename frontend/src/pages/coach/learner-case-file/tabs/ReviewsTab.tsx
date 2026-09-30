import { useEffect, useState } from 'react';
import { ImportedReviewHistory } from '@/pages/learner/reviews/ImportedReviewHistory';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import type { CaseFileReviewGroup, CaseFileReviewMeeting, CoachLearnerCaseFileData } from '../types';
import { caseFileReviewCategory, type CaseFileReviewCategory } from '../data';
import type { useCaseFileReviews } from '../useCaseFileReviews';
import { ReferencePanel } from '../components/CaseFilePrimitives';
import styles from '../learnerCaseFile.module.css';

export function ReviewsTab({
  data,
  reviewsState,
  onOpen,
  requestedReviewId,
}: {
  data: CoachLearnerCaseFileData;
  reviewsState: ReturnType<typeof useCaseFileReviews>;
  onOpen: (item: CaseFileReviewMeeting) => void;
  requestedReviewId?: string;
}) {
  type ReviewTypeFilter = 'all' | CaseFileReviewCategory;
  type ReviewStatusFilter = 'all' | 'completed' | 'upcoming';
  const pageSize = 10;
  const [typeFilter, setTypeFilter] = useState<ReviewTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>('all');
  const [page, setPage] = useState(1);
  const reviewsLoading = reviewsState.loading;
  const reviewGroups = reviewsState.data?.groups || [];
  const reviewItems = reviewGroups.flatMap(group => group.items);
  const isUpcoming = (item: CaseFileReviewMeeting) => !['completed', 'cancelled'].includes(item.status);
  const visibleItems = reviewGroups.flatMap(group => {
    const groupCategory = reviewGroupCategory(group);
    // Keep the group as a useful fallback for legacy/generic rows, but always
    // validate the item's own classification for the system MCM/PR groups.
    // This prevents a stale/mixed API group from leaking a Progress Review
    // row into the Monthly Coaching Meeting filter.
    const typeItems = group.items.filter(item => {
      if (typeFilter === 'all') return true;
      const itemCategory = caseFileReviewCategory(item);
      if (groupCategory === null) return itemCategory === typeFilter;
      return groupCategory === typeFilter && itemCategory === typeFilter;
    });
    return typeItems.filter(item => statusFilter === 'all'
      || (statusFilter === 'completed' ? item.status === 'completed' : isUpcoming(item)));
  });
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedItems = visibleItems.slice(pageStart, pageStart + pageSize);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter(pageNumber => totalPages <= 7 || pageNumber === 1 || pageNumber === totalPages || Math.abs(pageNumber - currentPage) <= 1);
  const paginationItems = pageNumbers.reduce<Array<number | 'ellipsis'>>((items, pageNumber, index) => {
    if (index > 0 && pageNumber - pageNumbers[index - 1] > 1) items.push('ellipsis');
    items.push(pageNumber);
    return items;
  }, []);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);
  const summaries = [
    ['Total Reviews', reviewItems.length],
    ['Progress Reviews', reviewItems.filter(item => caseFileReviewCategory(item) === 'progress-review').length],
    ['Monthly Coaching Meetings', reviewItems.filter(item => caseFileReviewCategory(item) === 'mcr').length],
    ['Completed', reviewItems.filter(item => item.status === 'completed').length],
    ['Upcoming', reviewItems.filter(isUpcoming).length],
  ] as const;
  const typeFilters: Array<{ id: ReviewTypeFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'progress-review', label: 'Progress Review' },
    { id: 'mcr', label: 'Monthly Coaching Meeting' },
    { id: 'review', label: 'Review' },
  ];
  const statusFilters: Array<{ id: ReviewStatusFilter; label: string }> = [
    { id: 'all', label: 'All statuses' },
    { id: 'completed', label: 'Completed' },
    { id: 'upcoming', label: 'Upcoming' },
  ];

  return (
    <div className={styles.stack}>
      {requestedReviewId ? <ImportedReviewHistory
        kind={data.kind}
        learnerId={data.enrolmentId || data.learnerId}
        category="reviews"
        reviewId={requestedReviewId}
      /> : null}
      {!requestedReviewId && <>
      {(reviewsState.data?.issues || []).map(issue => (
        <div key={issue.code} className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900" role="status">
          <AppIcon className="ri-error-warning-line mt-0.5 shrink-0 text-[18px]"></AppIcon>
          <div>
            <p className="text-[13px] font-semibold">Review schedule unavailable</p>
            <p className="mt-1 text-[12px] leading-5">{reviewGenerationIssueMessage(issue.code)}</p>
          </div>
        </div>
      ))}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Review summary">
        {summaries.map(([label, value]) => <div key={label} className="rounded-xl border border-foreground-200/70 bg-white p-4 shadow-sm">
          <strong className="block text-2xl text-foreground-950">{value}</strong>
          <span className="mt-1 block text-xs font-semibold text-foreground-500">{label}</span>
        </div>)}
      </div>
      <ReferencePanel title="Review History" subtitle="Curriculum reviews and coaching meetings for this learner" icon="ri-file-list-3-line" tone="primary">
        {reviewsState.error ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <span>{reviewsState.error}</span> <button type="button" onClick={reviewsState.retry}>Retry reviews</button>
        </div> : null}
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Review filters">
          <div className="flex flex-wrap gap-2" aria-label="Review type filters">
            {typeFilters.map(option => <button key={option.id} type="button" aria-pressed={typeFilter === option.id} onClick={() => { setTypeFilter(option.id); setPage(1); }}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition', typeFilter === option.id ? 'border-primary-600 bg-primary-600 text-white' : 'border-foreground-200 bg-white text-foreground-700 hover:border-primary-300')}>
              {option.label}
            </button>)}
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Review status filters">
            {statusFilters.map(option => <button key={option.id} type="button" aria-pressed={statusFilter === option.id} onClick={() => { setStatusFilter(option.id); setPage(1); }}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition', statusFilter === option.id ? 'border-primary-600 bg-primary-600 text-white' : 'border-foreground-200 bg-white text-foreground-700 hover:border-primary-300')}>
              {option.label}
            </button>)}
          </div>
        </div>
        {reviewsLoading ? <div aria-label="Loading reviews"><RowsSkeleton rows={5} avatar={false} /></div> : reviewsState.error ? null : reviewItems.length === 0
          ? <div className={styles.empty}><p>No reviews found for this learner.</p></div>
          : visibleItems.length === 0 ? <div className={styles.empty}><p>No reviews match this filter.</p></div>
          : <><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-xs">
            <thead><tr className="border-b border-foreground-200 text-foreground-500">
              {['Review Type', 'Planned Date', 'Scheduled Date & Time', 'Completed Date', 'Status', 'Reviewer', 'Actions'].map(label => <th key={label} className="px-3 py-3 font-semibold">{label}</th>)}
            </tr></thead>
            <tbody>{paginatedItems.map(item => <tr key={item.id} className="border-b border-foreground-100 last:border-0">
              <td className="px-3 py-3 font-semibold text-foreground-900">{item.reviewTypeName}</td>
              <td className="px-3 py-3 text-foreground-700">{item.plannedDate}</td>
              <td
                className="px-3 py-3 text-foreground-700"
                aria-label={item.scheduledDate === '--' ? 'Not scheduled' : `${item.scheduledDate} at ${item.scheduledTime}`}
              >
                {item.scheduledDate === '--' ? '--' : <>
                  <span className="block">{item.scheduledDate}</span>
                  <span className="mt-0.5 block text-foreground-500">{item.scheduledTime}</span>
                </>}
              </td>
              <td className="px-3 py-3 text-foreground-700">{item.completedDate}</td>
              <td className="px-3 py-3"><StatusBadge status={item.status} label={item.statusLabel} size="sm" /></td>
              <td className="px-3 py-3 text-foreground-700">{item.reviewer}</td>
              <td className="px-3 py-3"><div className="flex flex-wrap gap-2">
                <button type="button" className="font-semibold text-primary-700 hover:text-primary-900" onClick={() => onOpen(item)}>View</button>
                {item.hasForm ? <button type="button" className="font-semibold text-primary-700 hover:text-primary-900" onClick={() => onOpen(item)}>View Form</button> : null}
                {item.hasTranscript ? <button type="button" className="font-semibold text-primary-700 hover:text-primary-900" onClick={() => onOpen(item)}>View Transcript</button> : null}
                {item.hasAttendance ? <button type="button" className="font-semibold text-primary-700 hover:text-primary-900" onClick={() => onOpen(item)}>View Attendance</button> : null}
              </div></td>
            </tr>)}</tbody>
          </table></div>
          {visibleItems.length > pageSize && <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-foreground-100 pt-4" aria-label="Review pagination">
            <p className="text-xs font-medium text-foreground-500">
              Showing {pageStart + 1}-{Math.min(pageStart + pageSize, visibleItems.length)} of {visibleItems.length} reviews
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" disabled={currentPage === 1} onClick={() => setPage(value => Math.max(1, value - 1))}
                className="rounded-lg border border-foreground-200 bg-white px-3 py-1.5 text-xs font-semibold text-foreground-700 transition hover:border-primary-300 disabled:cursor-not-allowed disabled:opacity-45">
                Previous
              </button>
              {paginationItems.map((item, index) => item === 'ellipsis'
                ? <span key={`ellipsis-${index}`} className="px-1 text-xs text-foreground-400" aria-hidden="true">...</span>
                : <button key={item} type="button" aria-label={`Go to page ${item}`} aria-current={item === currentPage ? 'page' : undefined} onClick={() => setPage(item)}
                    className={cn('h-8 min-w-8 rounded-lg border px-2 text-xs font-semibold transition', item === currentPage ? 'border-primary-600 bg-primary-600 text-white' : 'border-foreground-200 bg-white text-foreground-700 hover:border-primary-300')}>
                    {item}
                  </button>)}
              <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}
                className="rounded-lg border border-foreground-200 bg-white px-3 py-1.5 text-xs font-semibold text-foreground-700 transition hover:border-primary-300 disabled:cursor-not-allowed disabled:opacity-45">
                Next
              </button>
            </div>
          </nav>}</>}
      </ReferencePanel>
      </>}
    </div>
  );
}

function reviewGenerationIssueMessage(code: string) {
  if (code === 'missing_learner_start_date') {
    return 'Future reviews and monthly coaching meetings cannot be generated because the learner start date is missing. Existing scheduled records may still appear below.';
  }
  if (code === 'invalid_learner_start_date') {
    return 'Future reviews and monthly coaching meetings cannot be generated because the learner start date is invalid.';
  }
  if (code === 'missing_learner_enrolment') {
    return 'Future reviews and monthly coaching meetings cannot be generated because this learner is not linked to an enrolment record.';
  }
  if (code === 'missing_curriculum_programme') {
    return 'Review scheduling is unavailable because this learner is not linked to a Curriculum programme.';
  }
  if (code === 'no_enabled_review_templates') {
    return 'No enabled Review templates are configured for this learner\'s Curriculum programme.';
  }
  return 'The review schedule could not be generated for this learner. Check their enrolment and Curriculum configuration.';
}

function reviewGroupCategory(group: CaseFileReviewGroup): CaseFileReviewCategory | null {
  const label = group.title.trim().toLowerCase().replace(/\s+/g, ' ');
  if (label === 'monthly coaching meeting') return 'mcr';
  if (label === 'progress review') return 'progress-review';
  if (label === 'reviews' || label === 'all reviews') return null;
  return caseFileReviewCategory(group.items[0] || {
    source: 'review',
    reviewTypeName: group.title,
    reviewTypeCode: null,
  });
}

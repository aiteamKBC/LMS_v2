import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import { Pagination } from '@/components/ui/Pagination';
import type { MarkingKind } from '@/lib/markingKind';
import styles from './markingQueue.module.css';
import { useMarkingQueue } from '@/features/coach/marking/hooks/useMarkingQueue';
import { markingActivityLabel, markingStatusLabel, markingSubmissionPreview } from '@/features/coach/marking/selectors/markingSelectors';
import type { MarkingQueueFilter } from '@/features/coach/marking/types/marking.types';

const coachNav = roleNavMap.coach;
const FILTERS: Array<{ value: MarkingQueueFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'referred', label: 'Referred' },
];

export default function CoachMarkingQueue() {
  const [searchParams] = useSearchParams();
  const personal = searchParams.get('scope') === 'personal';
  const scopeQuery = personal ? '?scope=personal' : '';
  const navigate = useNavigate();
  const coach = useCoachIdentity();
  const [filter, setFilter] = useState<MarkingQueueFilter>('pending');
  const [kind, setKind] = useState<MarkingKind>('assignment');
  const [page, setPage] = useState(1);
  const queue = useMarkingQueue({ scope: personal ? 'personal' : 'official', status: filter, kind, page }, coach.isInitialized && Boolean(coach.email));
  const { items, summary, pagination, refresh: loadQueue } = queue;
  const loading = coach.isInitialized && !coach.email ? false : (!coach.isInitialized || queue.loading);
  const error = coach.isInitialized && !coach.email ? 'Coach access is required to load the marking queue.' : queue.error;

  const filterCounts: Record<MarkingQueueFilter, number> = {
    all: summary.totalItems,
    pending: summary.pendingItems,
    overdue: summary.overdueItems,
    accepted: summary.acceptedItems,
    referred: summary.referredItems,
  };

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Marking"
      pageSubtitle="Review learner submissions and record your judgement"
      userName={coach.name}
      userRole="Progress Coach"
    >
      <div className={styles.page}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Marking queue</p>
          <div className={styles.heroRow}>
            <div>
              <h1>Pending submissions</h1>
              <p>AI drafts support your review. Your professional judgement is the final decision.</p>
            </div>
          </div>
        </header>

        <section className={styles.controls} aria-label="Marking queue filters">
          <div className={styles.kindTabs} role="group" aria-label="Submission type">
            <button type="button" aria-pressed={kind === 'assignment'} onClick={() => { setKind('assignment'); setPage(1); }}>
              Assignments <span>{summary.assignmentItems}</span>
            </button>
            <button type="button" aria-pressed={kind === 'reflection'} onClick={() => { setKind('reflection'); setPage(1); }}>
              Reflections <span>{summary.reflectionItems}</span>
            </button>
          </div>
          <div className={styles.statusTabs} role="group" aria-label="Submission status">
            {FILTERS.map(option => (
              <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => { setFilter(option.value); setPage(1); }}>
                {option.label} <span>{filterCounts[option.value]}</span>
              </button>
            ))}
            <button type="button" className={styles.refresh} onClick={() => void loadQueue()} aria-label="Refresh marking queue">
              <i className="ri-refresh-line" aria-hidden="true" />
            </button>
          </div>
        </section>

        {loading ? (
          <div className={styles.cardList} aria-label="Loading submissions">
            {[0, 1, 2].map(value => <div className={styles.skeleton} key={value} />)}
          </div>
        ) : error ? (
          <div className={styles.state} role="alert">
            <i className="ri-error-warning-line" aria-hidden="true" />
            <h2>Unable to load the marking queue</h2>
            <p>{error}</p>
            <button type="button" onClick={() => void loadQueue()}>Try again</button>
          </div>
        ) : items.length === 0 ? (
          <div className={styles.state}>
            <i className="ri-checkbox-circle-line" aria-hidden="true" />
            <h2>No submissions in this view</h2>
            <p>Change the type or status filter to see other marking work.</p>
          </div>
        ) : (
          <div className={styles.cardList}>
            {items.map(item => (
              <article className={styles.submissionCard} key={item.id}>
                <div className={styles.cardTop}>
                  <div className={styles.cardContent}>
                    <div className={styles.tags}>
                      <span className={styles.typeTag}>{markingActivityLabel(item, kind)}</span>
                      {item.ksbCodes.slice(0, 4).map(code => <span className={styles.ksbTag} key={code}>{code}</span>)}
                      <span className={styles.statusTag} data-status={item.isOverdue ? 'overdue' : item.status}>
                        {markingStatusLabel(item.status, item.isOverdue)}
                      </span>
                    </div>
                    <h2>{item.activityTitle || item.activityType}</h2>
                    <p className={styles.meta}>
                      <span>{item.learner}</span>{item.programme ? ` · ${item.programme}` : ''}{` · Submitted ${item.submittedDisplay}`}
                    </p>
                  </div>
                  <div className={styles.cardActions}>
                    <span className={styles.quality} title="Learner submission quality score">
                      <i className="ri-sparkling-line" aria-hidden="true" /> Quality {item.qualityScore}%
                    </span>
                    <button type="button" onClick={() => navigate(`/coach/marking-queue/${item.id}${scopeQuery}`)}>
                      {item.reviewedBy ? 'Review' : 'View'}
                      <i className="ri-arrow-right-line" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className={styles.preview}>
                  <strong>Submission preview:</strong> {markingSubmissionPreview(item)}
                </div>
              </article>
            ))}
          </div>
        )}

        {pagination.totalPages > 1 && !loading && !error && (
          <div className={styles.pagination}>
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.totalItems}
              pageSize={pagination.pageSize}
              noun="submissions"
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

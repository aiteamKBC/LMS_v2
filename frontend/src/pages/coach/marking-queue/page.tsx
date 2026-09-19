import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import { Pagination } from '@/components/ui/Pagination';
import type { MarkingKind } from '@/lib/markingKind';
import styles from './markingQueue.module.css';

const coachNav = roleNavMap.coach;
type QueueFilter = 'all' | 'pending' | 'overdue' | 'accepted' | 'referred';

interface MarkingSubmission {
  version?: number;
  id: string;
  learner: string;
  programme: string;
  activityType: string;
  activityTitle: string;
  module: string;
  week: string;
  status: string;
  learningReflection: string;
  ksbCodes: string[];
  applicationText: string;
  benefitExplanation: string;
  qualityScore: number;
  coachFeedback: string | null;
  reviewedBy: string | null;
  submittedDisplay: string;
  elapsedDays: number;
  isOverdue: boolean;
}

interface QueueSummary {
  totalItems: number;
  activeLearners: number;
  pendingItems: number;
  acceptedItems: number;
  referredItems: number;
  overdueItems: number;
  assignmentItems: number;
  reflectionItems: number;
}

interface QueuePagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

const EMPTY_SUMMARY: QueueSummary = {
  totalItems: 0,
  activeLearners: 0,
  pendingItems: 0,
  acceptedItems: 0,
  referredItems: 0,
  overdueItems: 0,
  assignmentItems: 0,
  reflectionItems: 0,
};

const EMPTY_PAGINATION: QueuePagination = {
  page: 1,
  pageSize: 25,
  totalItems: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

const FILTERS: Array<{ value: QueueFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'referred', label: 'Referred' },
];

function statusLabel(status: string, isOverdue: boolean) {
  if (isOverdue) return 'Overdue';
  if (status === 'accepted') return 'Accepted';
  if (status === 'partial') return 'Partially awarded';
  if (status === 'referred' || status === 'rejected') return 'Referred back';
  if (status === 'escalated') return 'Escalated';
  return 'Pending';
}

function submissionPreview(item: MarkingSubmission) {
  return item.learningReflection
    || item.applicationText
    || item.benefitExplanation
    || 'Open the submission to review the learner evidence and recorded KSBs.';
}

function activityLabel(item: MarkingSubmission, kind: MarkingKind) {
  if (item.activityType) return item.activityType.replaceAll('_', ' ');
  return kind === 'assignment' ? 'Assignment' : 'Learning reflection';
}

export default function CoachMarkingQueue() {
  const [searchParams, setSearchParams] = useSearchParams();
  const personal = searchParams.get('scope') === 'personal';
  const apiEndpoint = personal ? '/coach_api/coach/personal-marking' : '/coach_api/coach/marking-queue';
  const scopeQuery = personal ? '?scope=personal' : '';
  const navigate = useNavigate();
  const coach = useCoachIdentity();
  const [items, setItems] = useState<MarkingSubmission[]>([]);
  const [summary, setSummary] = useState<QueueSummary>(EMPTY_SUMMARY);
  const [pagination, setPagination] = useState<QueuePagination>(EMPTY_PAGINATION);
  const [filter, setFilter] = useState<QueueFilter>('pending');
  const [kind, setKind] = useState<MarkingKind>('assignment');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSequence = useRef(0);
  const loadQueue = useCallback(async () => {
    const sequence = ++loadSequence.current;
    if (!coach.isInitialized) return;
    setLoading(true);
    setError('');
    if (!coach.email) {
      setItems([]);
      setSummary(EMPTY_SUMMARY);
      setError('Coach access is required to load the marking queue.');
      setLoading(false);
      return;
    }

    try {
      const query = new URLSearchParams({ status: filter, kind, page: String(page), page_size: '25' });
      const response = await coachFetch(`${apiEndpoint}?${query}`);
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (sequence !== loadSequence.current) return;
      if (!response.ok) throw new Error(data.detail || 'Unable to load the marking queue.');
      setItems(data.items || []);
      setSummary(data.summary || EMPTY_SUMMARY);
      setPagination(data.pagination || EMPTY_PAGINATION);
    } catch (loadError) {
      if (sequence !== loadSequence.current) return;
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the marking queue.');
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [apiEndpoint, coach.email, coach.isInitialized, filter, kind, page]);

  useEffect(() => {
    void loadQueue();
    return () => { ++loadSequence.current; };
  }, [loadQueue]);

  const filterCounts: Record<QueueFilter, number> = {
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
            <div className={styles.judgementBadge}>
              <i className="ri-shield-check-line" aria-hidden="true" />
              Coach judgement final
            </div>
          </div>
        </header>

        <section className={styles.controls} aria-label="Coursework source">
          <div className={styles.kindTabs} role="group" aria-label="Coursework source">
            <button type="button" aria-pressed={!personal} onClick={() => { setSearchParams({}); setPage(1); }}>
              Learner coursework
            </button>
            <button type="button" aria-pressed={personal} onClick={() => { setSearchParams({ scope: 'personal' }); setPage(1); }}>
              Personal learning
            </button>
          </div>
        </section>

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
                      <span className={styles.typeTag}>{activityLabel(item, kind)}</span>
                      {item.ksbCodes.slice(0, 4).map(code => <span className={styles.ksbTag} key={code}>{code}</span>)}
                      <span className={styles.statusTag} data-status={item.isOverdue ? 'overdue' : item.status}>
                        {statusLabel(item.status, item.isOverdue)}
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
                  <strong>Submission preview:</strong> {submissionPreview(item)}
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

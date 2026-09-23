import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck } from 'lucide-react';
import type { ComponentMarking } from '@/api/learnerDetail';
import { statusLabels } from './model';
import styles from './monthlySubmission.module.css';

export function AssignmentFeedback({ marking, status }: { marking?: ComponentMarking; status: string }) {
  const feedback = marking?.feedback?.trim() || '';
  const result = marking?.status || status;
  const reviewed = ['accepted', 'partial', 'referred', 'returned', 'rejected'].includes(result);
  const pending = ['submitted_for_tutor_review', 'escalated'].includes(result);
  const reviewedDate = marking?.reviewedAt ? new Date(marking.reviewedAt) : null;
  const dateLabel = reviewedDate && Number.isFinite(reviewedDate.getTime())
    ? reviewedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const contentRef = useRef<HTMLParagraphElement>(null);
  const contentId = useId();

  useEffect(() => { setExpanded(false); }, [feedback, result]);
  useEffect(() => {
    const content = contentRef.current;
    if (!content) { setOverflows(false); return; }
    // Match the six-line CSS preview, including narrower mobile layouts.
    const measure = () => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(content).lineHeight) || 24.5;
      setOverflows(content.scrollHeight > lineHeight * 6 + 1);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(content);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [feedback]);

  const label = reviewed ? statusLabels[result] : pending ? 'Awaiting coach review' : result === 'draft' ? 'Draft ? not submitted for review' : 'Not marked yet';
  const emptyMessage = pending ? 'Your assignment is awaiting review. Your coach’s feedback will appear here once it is available.'
    : reviewed ? 'No written feedback was added to this result.' : result === 'draft'
      ? 'Your assignment is still a draft. Submit it when you are ready for your coach to review it.'
      : 'No marking result is available yet.';
  return <section className={styles.feedback} aria-label="Assignment marking result">
    <div className={styles.feedbackHeading}>
      <h4><ClipboardCheck size={17} aria-hidden="true" />Marking result</h4>
      <span className={styles.status} data-status={result}>
        {result === 'accepted' && <CheckCircle2 size={14} aria-hidden="true" />}{label}
      </span>
    </div>
    {(marking?.reviewedBy || dateLabel) && <p className={styles.feedbackReviewer}>
      {marking?.reviewedBy && <span>Reviewed by {marking.reviewedBy}</span>}
      {dateLabel && <time dateTime={marking!.reviewedAt!}>{dateLabel}</time>}
    </p>}
    {feedback ? <>
      <p className={styles.feedbackLabel}>{pending || result === 'draft' ? 'Previous coach feedback' : 'Coach feedback'}</p>
      <p ref={contentRef} id={contentId} className={`${styles.feedbackText} ${expanded ? '' : styles.feedbackPreview}`}>{feedback}</p>
      {overflows && <button type="button" className={styles.feedbackToggle} aria-expanded={expanded} aria-controls={contentId}
        onClick={() => setExpanded(value => !value)}>
        {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        {expanded ? 'Show less feedback' : 'View full feedback'}
      </button>}
    </> : <p className={styles.feedbackEmpty}>{emptyMessage}</p>}
  </section>;
}

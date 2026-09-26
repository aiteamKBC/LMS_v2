import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, FileText, MessageCircle } from 'lucide-react';
import DOMPurify from 'dompurify';
import type { LearnerKind } from '@/api/learnerDetail';
import { monthName, statusLabels, type AssignmentMonth, type MonthlyAssignmentRow } from './model';
import styles from './monthlySubmission.module.css';
import { AssignmentSubmissions } from './AssignmentSubmissions';
import { AssignmentAttachment } from './AssignmentAttachment';

export function AssignmentDetailsCard({ assignment, group, kind, learnerId }: {
  assignment: MonthlyAssignmentRow; group: AssignmentMonth; kind: LearnerKind; learnerId: string;
}) {
  const rawQuestion = assignment.assignmentBriefHtml || assignment.assignmentBrief || assignment.description || '';
  const attachmentUrl = assignment.resourceUrl?.trim();
  const questionHtml = useMemo(() => /<[a-zA-Z][^>]*>/.test(rawQuestion) ? DOMPurify.sanitize(rawQuestion) : '', [rawQuestion]);
  const href = `/learner/monthly-submission/${kind}/${encodeURIComponent(learnerId)}/${encodeURIComponent(assignment.id)}`
    + (group.month ? `?month=${group.month}` : '');
  const supportParams = new URLSearchParams({ book: 'student-support', kind, learner: learnerId,
    notes: `Assignment support: ${assignment.component}\n${group.label}${group.topics.length ? ` — ${group.topics.join(' · ')}` : ''}\n${[assignment.module, assignment.week].filter(Boolean).join(' · ')}`.slice(0, 500) });
  const ksbs = [...new Map((assignment.ksbMappings || []).map(mapping => [mapping.code, mapping])).values()];
  return <section className={styles.hero} aria-labelledby="assignment-details-title">
    <div className={styles.heroHeader}>
      <div className={styles.heroHeading}><span className={styles.heroIcon}><FileText size={24} aria-hidden="true" /></span><div>
        <p className={styles.eyebrow}>Your monthly assignment</p>
        <h2 id="assignment-details-title">{monthName(group.month)}</h2>
        {(group.label !== monthName(group.month) || group.topics.length > 0) && <p className={styles.focus}>{[group.label !== monthName(group.month) ? group.label : '', ...group.topics].filter(Boolean).join(' · ')}</p>}
      </div></div>
      <span className={styles.status} data-status={assignment.status}>
        {assignment.submitted && <CheckCircle2 size={14} aria-hidden="true" />}{statusLabels[assignment.status] || assignment.status.replaceAll('_', ' ') || 'Status unavailable'}
      </span>
    </div>
    <div className={styles.heroBody}>
      <div className={styles.brief}>
        <p className={styles.eyebrow}>Assignment question</p>
        <h3>{assignment.component}</h3>
        {questionHtml ? <div className={styles.question} dangerouslySetInnerHTML={{ __html: questionHtml }} />
          : <p className={styles.question}>{rawQuestion || (attachmentUrl
            ? 'Read the attached file for the assignment instructions, then start your submission.'
            : 'Your tutor has not added the assignment question yet. Use the support button if you need help getting started.')}</p>}
        {attachmentUrl && <AssignmentAttachment key={`${kind}:${learnerId}:${assignment.id}:${attachmentUrl}`} url={attachmentUrl} fileName={assignment.fileName} title={assignment.component} />}
        <AssignmentSubmissions key={`${kind}:${learnerId}:${assignment.id}`} kind={kind} learnerId={learnerId} activityId={assignment.id}
          month={group.month} marking={assignment.marking} status={assignment.status} submissionCount={assignment.submissionCount} />
        {ksbs.length > 0 && <div className={styles.ksbs}><p className={styles.eyebrow}>Knowledge, skills & behaviours</p><div>
          {ksbs.map(mapping => <span key={mapping.code} title={mapping.description || undefined}>{mapping.code}</span>)}
        </div></div>}
      </div>
      <aside className={styles.facts} aria-label="Assignment information">
        <dl>
          {assignment.submissionCount !== undefined && <div><dt>Submission history</dt><dd>{assignment.submissionCount} submission{assignment.submissionCount === 1 ? '' : 's'}</dd></div>}
          <div><dt><CalendarDays size={16} aria-hidden="true" />Training Plan month</dt><dd>{group.label}{group.month && group.label !== monthName(group.month) && <small>{monthName(group.month)}</small>}</dd></div>
          <div><dt><Clock3 size={16} aria-hidden="true" />Expected OTJ hours</dt><dd>{assignment.expectedOtjh != null ? `${assignment.expectedOtjh} hours` : 'Not specified'}</dd></div>
          <div><dt>Planned date</dt><dd>{assignment.date ? new Date(`${assignment.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }) : 'Not scheduled'}</dd></div>
          {assignment.module && <div><dt>Module</dt><dd>{assignment.module}</dd></div>}
          {assignment.week && <div><dt>Week / topic</dt><dd>{assignment.week}</dd></div>}
        </dl>
      </aside>
    </div>
    <div className={styles.heroFooter}>
      <p>Prepare your answer, supporting evidence and KSB examples. You can save a draft at any step.</p>
      <div className={styles.actions}>
        {assignment.awaitingBrief ? <button type="button" className={styles.primary} disabled>{assignment.action}</button>
          : <Link className={styles.primary} data-status={assignment.status} to={href}>{assignment.action}<ArrowRight size={17} aria-hidden="true" /></Link>}
        <Link className={styles.secondary} to={`/learner/calendar?${supportParams}`}><MessageCircle size={17} aria-hidden="true" />Book 1:1 coach support</Link>
      </div>
    </div>
  </section>;
}

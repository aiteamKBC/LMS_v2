import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, ExternalLink, FileText, MessageCircle } from 'lucide-react';
import DOMPurify from 'dompurify';
import type { LearnerKind } from '@/api/learnerDetail';
import { hasHtmlText, presentTopic, topicLabel, type AssignmentResourceLink } from '@/lib/assignmentTopics';
import { monthName, statusLabels, type AssignmentMonth, type MonthlyAssignmentRow } from './model';
import styles from './monthlySubmission.module.css';
import { AssignmentSubmissions, type AssignmentSubmissionHistory } from './AssignmentSubmissions';
import { AssignmentAttachment } from './AssignmentAttachment';
import { formatSubmissionHours } from './submissionHours';

/** Authored text: rich text is sanitised, plain text keeps its line breaks. */
function BriefText({ value }: { value: string }) {
  const html = useMemo(() => /<[a-zA-Z][^>]*>/.test(value) ? DOMPurify.sanitize(value) : '', [value]);
  return html ? <div className={styles.question} dangerouslySetInnerHTML={{ __html: html }} /> : <p className={styles.question}>{value}</p>;
}

function ResourceLinks({ links }: { links: AssignmentResourceLink[] }) {
  return <ul className={styles.resourceLinks}>{links.map(link => <li key={link.url}>
    <a href={link.url} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />{link.label}</a>
  </li>)}</ul>;
}

export function AssignmentDetailsCard({ assignment, group, kind, learnerId }: {
  assignment: MonthlyAssignmentRow; group: AssignmentMonth; kind: LearnerKind; learnerId: string;
}) {
  const [history, setHistory] = useState<AssignmentSubmissionHistory | null>(null);
  const selectedHistory = history?.kind === kind && history.learnerId === learnerId && history.activityId === assignment.id ? history : null;
  const latestAttempt = selectedHistory?.attempts[selectedHistory.attempts.length - 1];
  const actualHours = assignment.submissionCount === 0 || assignment.status === 'todo' ? 'Not submitted yet'
    : !selectedHistory || selectedHistory.loading ? 'Loading…'
    : selectedHistory.error ? 'Unavailable' : formatSubmissionHours(latestAttempt?.actualTimeHours);
  const topics = assignment.assignmentTopics || [];
  // One topic is the assignment itself; two or more are options to choose from.
  const single = topics.length === 1 ? presentTopic(topics[0]) : null;
  const options = topics.length > 1 ? topics.map(topic => ({ topic, shown: presentTopic(topic) })) : [];
  const rawQuestion = (single && hasHtmlText(single.question) ? single.question : '')
    || assignment.assignmentBriefHtml || assignment.assignmentBrief || assignment.description || '';
  const attachmentUrl = assignment.resourceUrl?.trim();
  const questionHtml = useMemo(() => /<[a-zA-Z][^>]*>/.test(rawQuestion) ? DOMPurify.sanitize(rawQuestion) : '', [rawQuestion]);
  const extraFiles = (single?.files || []).filter(file => file.url !== attachmentUrl);
  const resourceLinks = single?.links || [];
  const otherTopics = group.topics.filter(topic => !group.planAssignments.includes(topic));
  const href = `/learner/monthly-submission/${kind}/${encodeURIComponent(learnerId)}/${encodeURIComponent(assignment.id)}`
    + (group.month ? `?month=${group.month}` : '');
  const supportParams = new URLSearchParams({ book: 'student-support', kind, learner: learnerId,
    notes: `Assignment support: ${assignment.title}\n${group.label}${group.topics.length ? ` — ${group.topics.join(' · ')}` : ''}\n${[assignment.module, assignment.week].filter(Boolean).join(' · ')}`.slice(0, 500) });
  const ksbs = [...new Map((assignment.ksbMappings || []).map(mapping => [mapping.code, mapping])).values()];
  return <section className={styles.hero} aria-labelledby="assignment-details-title">
    <div className={styles.heroHeader}>
      <div className={styles.heroHeading}><span className={styles.heroIcon}><FileText size={24} aria-hidden="true" /></span><div>
        <p className={styles.eyebrow}>Your monthly assignment</p>
        <h2 id="assignment-details-title">{monthName(group.month)}</h2>
        {(group.label !== monthName(group.month) || otherTopics.length > 0) && <p className={styles.focus}>{[group.label !== monthName(group.month) ? group.label : '', ...otherTopics].filter(Boolean).join(' · ')}</p>}
      </div></div>
      <span className={styles.status} data-status={assignment.status}>
        {assignment.submitted && <CheckCircle2 size={14} aria-hidden="true" />}{statusLabels[assignment.status] || assignment.status.replaceAll('_', ' ') || 'Status unavailable'}
      </span>
    </div>
    <div className={styles.heroBody}>
      <div className={styles.brief}>
        {group.planAssignments.length > 0 && <p className={styles.planAssignment}>
          Assignment in your training plan: <strong>{group.planAssignments.join(' · ')}</strong>
        </p>}
        <p className={styles.eyebrow}>Assignment question</p>
        <h3>{assignment.title}</h3>
        {questionHtml ? <div className={styles.question} dangerouslySetInnerHTML={{ __html: questionHtml }} />
          : <p className={styles.question}>{rawQuestion || (attachmentUrl
            ? 'Read the attached file for the assignment instructions, then start your submission.'
            : 'Your tutor has not added the assignment question yet. Use the support button if you need help getting started.')}</p>}
        {single?.instructions && <section className={styles.briefSection} aria-label="Instructions">
          <p className={styles.eyebrow}>Instructions</p><BriefText value={single.instructions} />
        </section>}
        {options.length > 0 && <section className={styles.briefSection} aria-label="Assignment options">
          <p className={styles.eyebrow}>Choose one of these options</p>
          <ol className={styles.options}>{options.map(({ topic, shown }) => <li key={topic.id}>
            <strong>{topicLabel(topic)}</strong>
            {hasHtmlText(shown.question) && <BriefText value={shown.question} />}
            {shown.instructions && <><p className={styles.optionLabel}>Instructions</p><BriefText value={shown.instructions} /></>}
            {(shown.links.length > 0 || shown.files.length > 0) && <ResourceLinks links={[
              ...shown.files.map(file => ({ label: file.fileName || 'Assignment file', url: file.url })), ...shown.links]} />}
          </li>)}</ol>
        </section>}
        {resourceLinks.length > 0 && <section className={styles.briefSection} aria-label="Resources">
          <p className={styles.eyebrow}>Resources</p><ResourceLinks links={resourceLinks} />
        </section>}
        {attachmentUrl && <AssignmentAttachment key={`${kind}:${learnerId}:${assignment.id}:${attachmentUrl}`} url={attachmentUrl} fileName={assignment.fileName} title={assignment.title} />}
        {extraFiles.map(file => <AssignmentAttachment key={`${kind}:${learnerId}:${assignment.id}:${file.url}`} url={file.url} fileName={file.fileName} title={assignment.title} />)}
        <AssignmentSubmissions key={`${kind}:${learnerId}:${assignment.id}`} kind={kind} learnerId={learnerId} activityId={assignment.id}
          month={group.month} marking={assignment.marking} status={assignment.status} submissionCount={assignment.submissionCount} onHistoryChange={setHistory} />
        {ksbs.length > 0 && <div className={styles.ksbs}><p className={styles.eyebrow}>Knowledge, skills & behaviours</p><div>
          {ksbs.map(mapping => <span key={mapping.code} title={mapping.description || undefined}>{mapping.code}</span>)}
        </div></div>}
      </div>
      <aside className={styles.facts} aria-label="Assignment information">
        <dl>
          {assignment.submissionCount !== undefined && <div><dt>Submission history</dt><dd>{assignment.submissionCount} submission{assignment.submissionCount === 1 ? '' : 's'}</dd></div>}
          <div><dt><Clock3 size={16} aria-hidden="true" />Actual hours</dt><dd>{actualHours}{latestAttempt && !selectedHistory?.loading && !selectedHistory?.error && <small>Submission {latestAttempt.number} · Latest submission</small>}</dd></div>
          <div><dt><CalendarDays size={16} aria-hidden="true" />Training Plan month</dt><dd>{group.label}{group.month && group.label !== monthName(group.month) && <small>{monthName(group.month)}</small>}</dd></div>
          <div><dt><Clock3 size={16} aria-hidden="true" />Expected OTJ hours</dt><dd>{assignment.expectedOtjh != null ? `${assignment.expectedOtjh} hours` : 'Not specified'}</dd></div>
          <div><dt>Planned date</dt><dd>{assignment.date ? new Date(`${assignment.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }) : 'Not scheduled'}</dd></div>
          {assignment.dueDate && <div><dt>Due date</dt><dd>{new Date(`${assignment.dueDate}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })}</dd></div>}
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

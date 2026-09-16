import { fetchEvidence, getEvidenceDownloadUrl } from '@/api/evidence';
import { loadLearningReflectionSubmission, type StoredLearningReflectionSubmission } from '@/api/reflectionSubmission';
import type { LearnerKind } from '@/api/learnerDetail';
import { monthName, statusLabels } from './model';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const safeName = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '_').trim() || 'assignment';

export function assignmentReport(submission: StoredLearningReflectionSubmission): string {
  const monthly = submission.monthlyAssignment;
  const yesNo = (value: boolean | undefined) => value == null ? '' : value ? 'Yes' : 'No';
  const table = (headers: string[], rows: unknown[][]) => rows.length ? `<table><thead><tr>${headers.map(value => `<th>${escape(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p>No entries recorded.</p>';
  const section = (label: string, value: unknown): string => {
    if (value == null || value === '') return '';
    return `<h3>${escape(label)}</h3><p dir="auto">${escape(value)}</p>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Assignment and feedback</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:24px;color:#172b4d}h1,h2{color:#163e68}h2{border-bottom:1px solid #ccd7e2;padding-bottom:8px}h3{text-transform:capitalize;margin-bottom:4px}p{white-space:pre-wrap;overflow-wrap:anywhere}section{padding-left:16px;border-left:2px solid #e1e8ef}@media print{body{margin:0}}</style></head><body>
    <h1>${escape(submission.activityTitle || 'Assignment')}</h1>
    ${section('Learner', submission.learnerName)}${section('Programme', submission.programmeName)}${section('Assignment month', monthly?.month ? monthName(monthly.month) : '')}
    <h2>1. Assignment answer</h2>
    ${section('Assignment answer', submission.assignmentAnswer)}
    ${section('What I learned', submission.whatYouLearned)}${section('What I understood', monthly?.understood)}${section('Skills I gained', monthly?.gainedSkills)}
    <h2>2. Evidence & cross-referencing</h2>
    ${table(['Evidence', 'Answer points'], monthly?.evidence?.map(item => [item.name, item.points]) || submission.evidenceFiles?.map(name => [name, '']) || [])}
    ${monthly?.evidence?.filter(item => item.url).map(item => section(`Evidence link: ${item.name}`, item.url)).join('') || ''}
    ${section('Evidence-sharing consent', yesNo(monthly?.sharingConsent))}
    <h2>3. KSBs & hours claimed</h2>
    ${section('Planned hours', submission.plannedOtjh)}${section('Total hours claimed', submission.actualTimeHours)}
    ${table(['Topic', 'Hours', 'Date'], monthly?.timeEntries?.map(item => [item.topic, item.hours, item.date]) || [])}
    ${section('Completed during paid working hours', yesNo(monthly?.paidHours))}${section('Planned hours and KSBs reviewed', yesNo(monthly?.plannedReviewed))}${section('New knowledge', yesNo(monthly?.newKnowledge))}${section('New skills', yesNo(monthly?.newSkills))}
    ${(monthly?.claims || Object.entries(submission.ksbExplanations || {}).map(([code, explanation]) => ({ code, explanation, evidenceIds: [] }))).map(claim => section(claim.code, claim.explanation) + section('Supporting evidence', claim.evidenceIds.map(id => monthly?.evidence?.find(item => item.id === id)?.name || id).join(', '))).join('')}
    <h2>4. Impact & employer benefit</h2>
    ${section('Business impact', submission.businessImpact || submission.benefitExplanation)}${section('Career impact', monthly?.careerImpact)}${section('Job impact', monthly?.jobImpact)}${section('Employer impact', monthly?.employerImpact)}${section('Employer benefit confirmed', yesNo(monthly?.employerBenefit))}
    <h2>5. Action plan & EPA</h2>
    ${section('Action plan', monthly?.actionPlan)}${section('EPA preparedness', monthly?.epaPreparedness)}
    <h2>6. Coach assessment & feedback</h2>${section('Result', statusLabels[submission.status] || submission.status)}${section('Reviewed by', submission.reviewedBy)}${section('Reviewed at', submission.reviewedAt)}${section('Coach feedback', submission.coachFeedback || 'No written feedback was added to this result.')}
    </body></html>`;
}

export async function buildAssignmentReport(kind: LearnerKind, learnerId: string, activityId: string, fallbackMonth = ''): Promise<{ blob: Blob; filename: string }> {
  const submission = await loadLearningReflectionSubmission({ learnerKind: kind, learnerId, activityType: 'assignment', activityId });
  if (!submission) throw new Error('No saved submission was found for this assignment.');
  const { createAssignmentPdf } = await import('./assignmentPdf');
  const report = await createAssignmentPdf(assignmentReport(submission));
  const documents = submission.legacyAssignment?.documents;
  const files = documents?.length
    ? documents.map(doc => ({ name: doc.name, resolve: async () => {
      const params = new URLSearchParams({ learnerKind: kind, learnerId, activityId, part: doc.part });
      const response = await fetch(`/learner_api/reflection/assignment/legacy-document/${doc.evidenceId}/?${params}`);
      if (!response.ok) throw new Error(`Could not download ${doc.name}. Please try again.`);
      const data = await response.json();
      if (!data.url) throw new Error(`No download is available for ${doc.name}.`);
      return data.url as string;
    } }))
    : (await fetchEvidence(kind, learnerId, { sectionRef: activityId })).map(file => ({ name: file.filename, resolve: () => getEvidenceDownloadUrl(kind, learnerId, file.id) }));
  // Stop on a failed file rather than silently deliver an incomplete assignment.
  for (const file of files) {
    const response = await fetch(await file.resolve());
    if (!response.ok) throw new Error(`Could not download ${file.name}. Please try again.`);
    await report.attachment(file.name, await response.arrayBuffer(), response.headers.get('content-type') || '');
  }
  const month = [submission.monthlyAssignment?.month, fallbackMonth, submission.submittedAt?.slice(0, 7)]
    .find(value => value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
  return { blob: report.finish(), filename: `${safeName(submission.activityTitle || 'Assignment')} - ${month ? monthName(month) : 'Undated'}.pdf` };
}

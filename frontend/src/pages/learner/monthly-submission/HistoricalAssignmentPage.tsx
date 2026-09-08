import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { loadLearningReflectionSubmission, type StoredLearningReflectionSubmission } from '@/api/reflectionSubmission';
import type { EvidenceRecord } from '@/api/evidence';
import { AssignmentSubmissionWizard } from '../video-watch/AssignmentSubmissionWizard';
import { ArchiveSpreadsheetPreview } from './ArchiveSpreadsheetPreview';

export function HistoricalFilePreview({ file, url }: { file: EvidenceRecord; url: string }) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const isDocx = /\.docx$/i.test(file.filename);
  const isArchiveSpreadsheet = /\.(xlsx|zip)$/i.test(file.filename);
  const originalUrl = isArchiveSpreadsheet ? url.replace('delivery=preview', 'delivery=content') : url;
  useEffect(() => {
    setHtml(''); setError(''); setLoading(true);
    if (!isDocx) return;
    const controller = new AbortController();
    (async () => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Could not load the document preview.');
      const mammoth = await import('mammoth');
      const result = await mammoth.convertToHtml({ arrayBuffer: await response.arrayBuffer() });
      if (!controller.signal.aborted) setHtml(DOMPurify.sanitize(result.value, { FORBID_TAGS: ['img', 'style'], FORBID_ATTR: ['style'] }));
    })().catch(() => { if (!controller.signal.aborted) setError('Preview is unavailable. You can still open or download the original file.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isDocx, url]);
  return <div className="space-y-3">
    <a className="inline-block rounded-lg bg-white px-4 py-2 text-sm font-semibold text-purple-800" href={originalUrl} target="_blank" rel="noopener noreferrer">Open / download original file</a>
    {isArchiveSpreadsheet ? <ArchiveSpreadsheetPreview url={url} /> : isDocx ? <div className="rounded-lg bg-white p-6 text-slate-900">
      {error ? <p role="alert">{error}</p> : loading ? <p role="status">Loading document…</p> : html ? <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} /> : <p>No text preview is available. Open the original file above.</p>}
    </div> : <iframe title={file.filename} src={url} className="h-[65vh] w-full rounded-lg bg-white" referrerPolicy="no-referrer" />}
  </div>;
}

export default function HistoricalAssignmentPage() {
  const { kind, id, activityId } = useParams();
  const [submission, setSubmission] = useState<StoredLearningReflectionSubmission | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setSubmission(null); setError(''); setLoading(true);
    if ((kind !== 'commercial' && kind !== 'apprenticeship') || !id || !activityId) {
      setError('Invalid assignment link.'); setLoading(false); return;
    }
    loadLearningReflectionSubmission({ learnerKind: kind, learnerId: id, activityType: 'assignment', activityId })
      .then(row => {
        if (!active) return;
        if (!['imported_legacy', 'classified_legacy'].includes(row?.submissionOrigin || '') || !row.legacyAssignment) setError('Historical assignment not found.');
        else setSubmission(row);
      })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not load assignment.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, id, activityId]);
  const nav = roleNavMap.learner;
  const documents = submission?.legacyAssignment?.documents || [];
  const files: EvidenceRecord[] = documents.map(doc => ({
    id: `legacy:${doc.evidenceId}:${doc.part}`, filename: doc.name, contentType: '', sizeBytes: 0,
    status: 'approved', scanResult: null, sectionRef: activityId || '',
    uploadedAt: submission?.submittedAt || null, trainingPlanDetails: null,
  }));
  async function resolveEvidenceUrl(file: EvidenceRecord) {
    const doc = documents.find(item => `legacy:${item.evidenceId}:${item.part}` === file.id);
    if (!doc || !kind || !id || !activityId) throw new Error('Document not found.');
    const params = new URLSearchParams({ learnerKind: kind, learnerId: id, activityId, part: doc.part });
    if (/\.(xlsx|zip)$/i.test(doc.name) && doc.part === 'file') {
      params.set('delivery', 'preview');
      return `/learner_api/reflection/assignment/legacy-document/${doc.evidenceId}/?${params}`;
    }
    if (/\.docx$/i.test(doc.name) && doc.part === 'file') {
      // Word conversion needs fetchable bytes. Read through the authenticated
      // backend because Azure's CORS policy may reject browser-side fetching.
      params.set('delivery', 'content');
      return `/learner_api/reflection/assignment/legacy-document/${doc.evidenceId}/?${params}`;
    }
    const response = await fetch(`/learner_api/reflection/assignment/legacy-document/${doc.evidenceId}/?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not open document.');
    return data.url as string;
  }
  return <WorkspaceShell role="learner" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel}
    pageTitle="Historical assignment" pageSubtitle={submission?.activityTitle || ''} userName={submission?.learnerName || 'Learner'} userRole="Learner">
    <main className="mx-auto max-w-6xl space-y-5 p-5 sm:p-8">
      <Link className="text-sm font-semibold text-purple-800" to={`/learner/my-learning/${kind}/${id}?tab=assignments`}>← Back to assignments</Link>
      {loading ? <p role="status">Loading assignment…</p> : error ? <div role="alert">{error}<button className="ml-3 underline" onClick={() => window.location.reload()}>Retry</button></div> : submission && id && activityId && (kind === 'commercial' || kind === 'apprenticeship') && <>
        <div className="rounded-xl border border-purple-100 bg-purple-50 p-4 text-sm text-purple-900">
          <p>Original status: {submission.legacyAssignment?.sourceStatus || submission.status}. Completed: {submission.dateCompleted || 'Not recorded'}. Uploaded: {submission.submittedAt ? new Date(submission.submittedAt).toLocaleDateString('en-GB', { timeZone: 'Europe/London' }) : 'Not recorded'}.</p>
          <p className="mt-2">Read the original content in the eight assignment sections. Open Evidence to view the source files, or Preview to see all sections together.</p>
        </div>
        <AssignmentSubmissionWizard key={activityId} historicalReadOnly kind={kind} learnerId={id}
          historicalContent={submission.legacyAssignment?.content}
          learnerName={submission.learnerName} programmeName={submission.programmeName}
          componentId={activityId} title={submission.activityTitle} moduleTitle={submission.moduleTitle || ''}
          weekTitle={submission.weekTitle || ''} plannedOtjh={null} ksbMappings={[]}
          questionText="The original assignment is preserved in the attached file."
          evidenceFiles={files} evidenceDetails={{}} timeSeconds={null} timeControl={<p>See the original record for time evidence.</p>}
          outsideWorkingHours={false} outsideWorkingHoursConfirmed={false} submittingProgress={false}
          onEvidenceChanged={() => {}} onRestoreTime={() => {}} onSubmitProgress={async () => {}}
          resolveEvidenceUrl={resolveEvidenceUrl} renderEvidencePreview={(file, url) => <HistoricalFilePreview key={file.id} file={file} url={url} />} />
        {!submission.legacyAssignment?.content && (submission.legacyAssignment?.feedbacks || []).map((feedback, index) => <section key={index} className="rounded-xl border bg-white p-5">
          <h2 className="font-semibold">Original tutor feedback{feedback.author ? ` — ${feedback.author}` : ''}</h2>
          <div className="mt-3 text-sm leading-6" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(feedback.message || '') }} />
        </section>)}
      </>}
    </main>
  </WorkspaceShell>;
}

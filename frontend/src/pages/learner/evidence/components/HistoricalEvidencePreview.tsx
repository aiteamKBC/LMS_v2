import { useEffect, useState } from 'react';
import { ExternalLink, Download, FileText, MessageSquare } from 'lucide-react';
import DOMPurify from 'dompurify';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchHistoricalEvidenceDetail, openHistoricalDocument, type HistoricalEvidenceItem, type HistoricalEvidenceDetail, type HistoricalDocument } from '@/api/historicalEvidence';
import { auditDocumentEmbedUrl } from '@/features/audit/documentPreview';
import { HtmlPreview } from '@/features/old-otjh/ContentPreview';
import { ActivityExpansion } from '@/features/old-otjh/ActivityExpansion';
import { getLogContent } from '@/features/monthly-logs/api';
import { Modal } from '@/pages/users/components/Modal';
import styles from './HistoricalEvidencePreview.module.css';

const plainText = (html: string) => DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [], RETURN_DOM_FRAGMENT: true }).textContent;

export function HistoricalEvidencePreview({ item, kind, learnerId, onClose }: {
  item: HistoricalEvidenceItem; kind: LearnerKind; learnerId: string; onClose: () => void;
}) {
  const [detail, setDetail] = useState<HistoricalEvidenceDetail | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [part, setPart] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setError('');
    fetchHistoricalEvidenceDetail(kind, learnerId, item, controller.signal)
      .then(data => { if (!controller.signal.aborted) { setDetail(data); setPart(data.documents[0]?.part || (data.item.activity ? 'activity' : data.note ? 'inline-note' : '')); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load this evidence.'); });
    return () => controller.abort();
  }, [kind, learnerId, item, retry]);

  const document = detail?.documents.find(doc => doc.part === part);
  return <Modal title={item.name} size="max-w-6xl" onClose={onClose}>
    <div className={`dashboard-theme ${styles.root}`} data-workspace-role="learner">
      <div className={styles.summary}>
        <span>Previous evidence</span><span>{item.status || 'Status not recorded'}</span>
        <span>{item.date || 'Date not recorded'}</span>
        {item.component_name && <span>{item.component_name}</span>}
      </div>
      {error ? <div role="alert" className={styles.notice}>{error}<button onClick={() => setRetry(value => value + 1)}>Retry evidence</button></div>
        : !detail ? <p role="status">Loading evidence and documents…</p> : <>
          {(detail.documents.length > 0 || detail.note || detail.item.activity) && <div className={styles.documents} aria-label="Evidence documents">
            {detail.documents.map(doc => <button key={doc.part} type="button" aria-pressed={part === doc.part} onClick={() => setPart(doc.part)}>
              <FileText size={15} /><span>{doc.part === 'report' ? 'Assessment report' : doc.part === 'original' ? 'Original file' : doc.name}</span>
            </button>)}
            {detail.note && <button type="button" aria-pressed={part === 'inline-note'} onClick={() => setPart('inline-note')}><MessageSquare size={15} />Saved note</button>}
            {detail.item.activity && <button type="button" aria-pressed={part === 'activity'} onClick={() => setPart('activity')}><FileText size={15} />Original activity</button>}
          </div>}
          {part === 'activity' && detail.item.activity ? <ActivityExpansion row={detail.item.activity} month={detail.item.activity.month}
            contentScope={`evidence:${kind}:${learnerId}`} onClose={onClose}
            loadContent={rowId => getLogContent(learnerId, detail.item.activity!.month, rowId, 'learner')} />
            : part === 'inline-note' && detail.note ? <HtmlPreview html={detail.note} title={`Saved note: ${item.name}`} />
            : document ? <DocumentFrame key={`${kind}:${learnerId}:${item.id}:${document.part}`} kind={kind} learnerId={learnerId} item={item} part={document.part} />
              : <p className={styles.notice}>This record has no attached file or saved note.</p>}
          {detail.feedbacks.length > 0 && <section className={styles.feedback} aria-label="Assessor feedback">
            <h3>Assessor feedback</h3>
            {detail.feedbacks.map((feedback, index) => <article key={`${feedback.id ?? index}`}>
              <p><strong>{feedback.author || 'Assessor'}</strong>{feedback.date && <span>{feedback.date}</span>}</p>
              <div>{plainText(feedback.message || '')}</div>
            </article>)}
          </section>}
        </>}
    </div>
  </Modal>;
}

function DocumentFrame({ kind, learnerId, item, part }: { kind: LearnerKind; learnerId: string; item: HistoricalEvidenceItem; part: string }) {
  const [file, setFile] = useState<(HistoricalDocument & { embed: string }) | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFile(null); setError('');
    openHistoricalDocument(kind, learnerId, item, part, controller.signal)
      .then(data => { const embed = auditDocumentEmbedUrl(data.url, data.name, data.content_type); if (!controller.signal.aborted) setFile({ ...data, embed }); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not open this document.'); });
    return () => controller.abort();
  }, [kind, learnerId, item, part, retry]);
  if (error) return <div role="alert" className={styles.notice}>{error}<button onClick={() => setRetry(value => value + 1)}>Retry document</button></div>;
  if (!file) return <p role="status">Preparing the document preview…</p>;
  return <div className={styles.viewer}>
    <div className={styles.actions}><span>{file.name}</span><a href={file.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open in new tab</a><a href={file.download_url}><Download size={14} />Download</a></div>
    <iframe title={file.name} src={file.embed} className={styles.frame} />
    <p className={styles.hint}>If the document cannot be displayed, use Open in new tab or Download.</p>
  </div>;
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FileSignature } from 'lucide-react';
import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { fetchEmployerDocuments, type EmployerDocuments } from '@/api/employerPortal';
import { SignModal } from './EmployerDocumentRows';
import { EmployerDocumentPreview } from './EmployerDocumentPreview';
import { learnerHref } from './employerDashboardData';
import { compareSignable, targetKey, useEmployerSigning } from './useEmployerSigning';
import styles from './EmployerPortalPage.module.css';

export function EmployerSignatures({ employerId, returnState, onSigned }: {
  employerId: string; returnState?: unknown; onSigned: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [documents, setDocuments] = useState<{ data?: EmployerDocuments; error?: boolean }>({});
  useEffect(() => {
    let active = true;
    setDocuments({});
    void fetchEmployerDocuments(employerId)
      .then(data => { if (active) setDocuments({ data }); })
      .catch(() => { if (active) setDocuments({ error: true }); });
    return () => { active = false; };
  }, [employerId, attempt]);

  const signing = useEmployerSigning(employerId, () => {
    setAttempt(value => value + 1);
    onSigned();
  });
  const items = (documents.data?.items || []).filter(item => item.signable && !item.signed).sort(compareSignable);
  return <>
    <section className={styles.panel} aria-labelledby="employer-signatures">
      <header className={styles.panelHeader}>
        <h2 id="employer-signatures"><FileSignature size={21} />Signatures required{documents.data ? ` (${items.length})` : ''}</h2>
      </header>
      <p className={styles.chartCaption}>Reviews and documents ready for your signature.</p>
      <div className={styles.meetingList}>
        {!documents.data && !documents.error && <LoadingSkeleton label="Loading required signatures" variant="rows" />}
        {documents.error && <div role="alert">
          <p className={styles.caption}>Required signatures could not be loaded.</p>
          <button type="button" className={styles.textButton} onClick={() => setAttempt(value => value + 1)}>Retry signatures</button>
        </div>}
        {documents.data && !items.length && <p className={styles.signatureEmpty}><CheckCircle2 size={19} />No signatures required. You’re up to date.</p>}
        {items.map(item => {
          const target = { item, kind: item.learner.kind, learnerId: item.learner.id };
          return <article key={targetKey(target)} className={styles.meetingItem}>
            <div>
              <Link className={styles.learnerName} to={learnerHref(employerId, item.learner, 'documents')} state={returnState}>{item.learner.name}</Link>
              <strong className={styles.reviewTitle}>{item.label}</strong>
              <small>{item.learner.programme}</small>
              <span className={styles.signatureStatus}><FileSignature size={14} />Awaiting your signature</span>
            </div>
            <div className={styles.meetingActions}>
              <button type="button" className={styles.viewButton} onClick={() => signing.startSigning(target)} aria-label={`Sign ${item.label} for ${item.learner.name}`}><FileSignature size={16} />Sign now</button>
              <button type="button" className={`${styles.textButton} ${styles.reviewActionLink}`} onClick={() => signing.openDocument(target)} aria-label={`View ${item.label} for ${item.learner.name}`}>View document</button>
            </div>
          </article>;
        })}
      </div>
      <Link className={`${styles.textButton} ${styles.allDocumentsLink}`} to={`/employers/${employerId}/documents`} state={returnState}>View all documents</Link>
    </section>
    {signing.preview && <EmployerDocumentPreview employerId={employerId} target={signing.preview} onClose={signing.closePreview} />}
    {signing.signing && documents.data && <SignModal item={signing.signing.item} employerName={documents.data.employer.name}
      reviewDefinition={signing.reviewDefinition} onClose={signing.closeSigning} onSign={signing.sign} onSaveReviewAnswers={signing.saveReviewAnswers} />}
  </>;
}

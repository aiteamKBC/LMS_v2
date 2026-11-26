import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { fetchEmployerContracts, type EmployerContractsResponse } from '@/api/employerContracts';
import { EmployerDocumentPreview } from './EmployerDocumentPreview';
import type { SigningTarget } from './useEmployerSigning';
import { formatReviewDate, learnerHref, learnerKey, type Loadable } from './employerDashboardData';
import styles from './EmployerPortalPage.module.css';

export function EmployerContracts({ employerId, learners, returnState }: {
  employerId: string; learners: EmployerLearnerCard[]; returnState?: unknown;
}) {
  const [attempt, setAttempt] = useState(0);
  const [records, setRecords] = useState<{ employerId: string; items: Record<string, Loadable<EmployerContractsResponse>> }>({ employerId, items: {} });
  const [preview, setPreview] = useState<SigningTarget | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setRecords({ employerId, items: {} });
    setPreview(null);
    const queue = [...learners];
    async function worker() {
      while (queue.length && !signal.aborted) {
        const learner = queue.shift()!;
        let result: Loadable<EmployerContractsResponse>;
        try {
          result = { status: 'ready', data: await fetchEmployerContracts(employerId, learner.kind, learner.id, signal) };
        } catch {
          result = { status: 'error' };
        }
        if (!signal.aborted) setRecords(current => ({ employerId, items: { ...current.items, [learnerKey(learner)]: result } }));
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, learners.length) }, () => worker()));
    return () => controller.abort();
  }, [employerId, learners, attempt]);
  const items = records.employerId === employerId ? records.items : {};
  const loading = learners.some(learner => !items[learnerKey(learner)]);
  const failed = learners.some(learner => {
    const record = items[learnerKey(learner)];
    return record?.status === 'error' || Object.values(record?.data?.sources || {}).includes('error');
  });
  const contracts = learners.flatMap(learner => (items[learnerKey(learner)]?.data?.contracts || []).map(contract => ({ learner, contract })));
  return <section className={styles.panel} aria-labelledby="employer-contracts">
    <header className={styles.panelHeader}><h2 id="employer-contracts"><FileText size={21} />Contracts{contracts.length ? ` (${contracts.length})` : ''}</h2></header>
    <p className={styles.chartCaption}>Learner contracts and agreements issued in LMS.</p>
    <div className={styles.meetingList}>
      {contracts.map(({ learner, contract }) => <article key={`${learnerKey(learner)}:${contract.source}:${contract.document?.kind || ''}:${contract.id}`} className={styles.meetingItem}>
        <div>
          <Link className={styles.learnerName} to={learnerHref(employerId, learner, 'documents')} state={returnState}>{learner.name}</Link>
          <strong>{contract.label}</strong>
          <small>LMS{contract.date ? ` · ${formatReviewDate(contract.date.slice(0, 10))}` : ''}</small>
          <small>{contract.signed ? 'Your signature saved' : contract.document?.signable ? 'Your signature needed' : 'No employer signature required'}</small>
        </div>
        <div className={styles.meetingActions}>
          {!contract.available ? <span className={styles.unavailable}>Contract file not available yet.</span>
            : contract.document && <button type="button" className={styles.viewButton} onClick={() => setPreview({ item: contract.document!, kind: learner.kind, learnerId: learner.id })} aria-label={`Open ${learner.name}: ${contract.label}`}>Open contract</button>}
        </div>
      </article>)}
      {loading && <LoadingSkeleton label="Loading contracts" variant="rows" />}
      {failed && <div role="alert"><p className={styles.caption}>Some contracts could not be loaded. Available contracts are still shown.</p><button type="button" className={styles.textButton} onClick={() => setAttempt(value => value + 1)}>Retry contracts</button></div>}
      {!contracts.length && !loading && !failed && <p className={styles.caption}>No contracts available for your learners.</p>}
    </div>
    {preview && <EmployerDocumentPreview key={`${employerId}:${preview.learnerId}:${preview.item.kind}`} employerId={employerId} target={preview} onClose={() => setPreview(null)} />}
  </section>;
}

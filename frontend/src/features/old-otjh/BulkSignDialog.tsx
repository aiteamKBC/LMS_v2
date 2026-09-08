import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Modal } from '@/pages/users/components/Modal';
import { SignatureCapture } from './SignatureCapture';
import { saveMonthSignatures, type SignatureCaptureMethod, type SignedMonths, type Summary } from './api';
import { monthLabel } from './report';
import styles from './design.module.css';

export function BulkSignDialog({ summary, aptemId, onClose, onSaved }: {
  summary: Summary; aptemId?: number; onClose: () => void; onSaved: (result: SignedMonths) => void;
}) {
  const { auth } = useAuth();
  const student = auth.account?.role === 'learner';
  // No per-month requests: capture opens using the month list already on screen.
  const [months] = useState(() => summary.months.filter(month => month.is_required !== false).map(month => month.month));
  const mutation = useMutation({ mutationFn: ({ blob, capture }: { blob: Blob; capture: SignatureCaptureMethod }) =>
    saveMonthSignatures(months, blob, capture, aptemId), onSuccess: onSaved });
  const base = aptemId === undefined ? '/old-otjh/months' : `/old-otjh/coach/${aptemId}/months`;
  return <Modal title="Sign all months" size="max-w-2xl" className={`${styles.scope} ${styles.dialog}`}
    onClose={() => { if (!mutation.isPending) onClose(); }} footer={<button className={styles.secondaryButton} disabled={mutation.isPending} onClick={onClose}>Close</button>}>
    <div className={styles.bulkSignBody}>
      <p>Draw or upload your signature once for all {months.length} months in your previous learning record.</p>
      <details>
        <summary className="cursor-pointer font-semibold">View included months ({months.length})</summary>
        <ul className={`${styles.bulkMonthList} mt-3`}>{months.map(month => <li key={month}>
          <Link to={`${base}/${month}`} aria-disabled={mutation.isPending} onClick={event => { if (mutation.isPending) event.preventDefault(); }}>{monthLabel(month)}</Link>
        </li>)}</ul>
      </details>
      <p className={styles.metricNote}>{student
        ? 'Your signature completes all months and locks your previous learning record. LMS access will open automatically.'
        : 'Your coach signature will be saved on all months. The learner completes the record with their own signature.'}</p>
      {!!months.length && <SignatureCapture name={auth.account?.displayName || auth.user?.fullName || ''}
        busy={mutation.isPending} confirmationText={student
          ? `I confirm this is my signature for all ${months.length} months. Save my signature and complete my previous learning record.`
          : `I confirm this is my coach signature for all ${months.length} months in this learner’s previous learning record.`}
        onSave={(blob, capture) => mutation.mutate({ blob, capture })} />}
      {mutation.error && <p role="alert" className="text-sm text-red-600">{mutation.error.message}</p>}
      {mutation.isPending && <p role="status">Saving your signature for all months…</p>}
    </div>
  </Modal>;
}

import { useState } from 'react';
import { deleteEnrolmentUser, setEnrolmentUserArchived } from '@/api/enrolmentUsers';
import type { UserListRow } from '../types';
import { Modal } from './Modal';
import { btnDestructive, btnPrimary, btnSecondary } from './ui';
import styles from './UserArchive.module.css';

export type UserArchiveAction = 'archive' | 'restore' | 'delete';
const labels: Record<UserArchiveAction, string> = {
  archive: 'Move to archive', restore: 'Restore user', delete: 'Delete permanently',
};

export function UserArchiveModal({ row, action, onClose, onSaved }: {
  row: UserListRow; action: UserArchiveAction; onClose: () => void; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'delete') await deleteEnrolmentUser(row.id);
      else await setEnrolmentUserArchived(row.id, action === 'archive');
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update this user. Please try again.');
      setBusy(false);
    }
  };
  return <Modal title={labels[action]} onClose={onClose} dismissible={!busy} size="max-w-lg" footer={<>
    <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>Cancel</button>
    <button type="button" className={action === 'delete' ? btnDestructive : `${btnPrimary} ${styles.confirm}`} disabled={busy} onClick={save}>
      {busy ? 'Saving…' : labels[action]}
    </button>
  </>}>
    <p className="text-[13px] text-foreground-700">
      {action === 'archive' && <>Move <strong>{row.name}</strong> to the archive? Their details and learning history will be kept, and you can restore them later.</>}
      {action === 'restore' && <>Restore <strong>{row.name}</strong> to the users list with their previous subscription status? Older archived records without a saved status will return as FullUser.</>}
      {action === 'delete' && <>Permanently delete <strong>{row.name}</strong>, their linked sign-in account and learner records? This cannot be undone.</>}
    </p>
    {error && <p role="alert" className="mt-3 text-[13px] text-red-600">{error}</p>}
  </Modal>;
}

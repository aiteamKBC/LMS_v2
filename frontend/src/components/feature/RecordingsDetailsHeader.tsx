import type { ReactNode, Ref } from 'react';
import { Video, X } from 'lucide-react';
import styles from './RecordingsDetails.module.css';

interface Props {
  eyebrow: string;
  title: ReactNode;
  titleId?: string;
  closeLabel: string;
  onClose: () => void;
  closeButtonRef?: Ref<HTMLButtonElement>;
}

export default function RecordingsDetailsHeader({ eyebrow, title, titleId, closeLabel, onClose, closeButtonRef }: Props) {
  return <header className={styles.header}>
    <span className={styles.headerIcon}><Video size={22} aria-hidden="true" /></span>
    <div className={styles.heading}>
      <p id={titleId} className={styles.eyebrow}>{eyebrow}</p>
      <h2>{title}</h2>
    </div>
    <button ref={closeButtonRef} type="button" onClick={onClose} aria-label={closeLabel} className={styles.close}>
      <X size={19} aria-hidden="true" />
    </button>
  </header>;
}

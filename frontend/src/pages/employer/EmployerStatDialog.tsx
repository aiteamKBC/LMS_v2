import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './EmployerPortalPage.module.css';

export interface StatDialogRow {
  id: string;
  primary: string;
  secondary?: string;
  meta?: string;
  /** Row actions, where the record has any (a review's join and detail links). */
  action?: ReactNode;
}

/**
 * The records behind one summary card, read without leaving the overview.
 *
 * The cards used to navigate to a filtered section, which took the employer off
 * the dashboard to read a single figure. This shows the same records in place:
 * no filters and no bulk actions, and nothing leaves the overview unless the
 * employer picks a row's own action. Escape, the backdrop and Close close it.
 */
export function EmployerStatDialog({ title, caption, rows, emptyMessage, onClose }: {
  title: string;
  caption: string;
  rows: StatDialogRow[];
  emptyMessage: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = dialog.current!;
    modal.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      modal.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);

  return createPortal(
    <dialog ref={dialog} className={styles.statDialog} aria-labelledby={titleId} onCancel={onClose}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <header className={styles.statDialogHeader}>
        <div>
          <h2 id={titleId}>{title}</h2>
          <p>{caption}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={`Close ${title}`}><X size={18} aria-hidden="true" /></button>
      </header>
      {rows.length
        ? <ul className={styles.statDialogList}>{rows.map(row => <li key={row.id}>
          <span className={styles.statDialogRow}><strong>{row.primary}</strong>{row.secondary && <small>{row.secondary}</small>}</span>
          <span className={styles.statDialogSide}>
            {row.meta && <span className={styles.statDialogMeta}>{row.meta}</span>}
            {row.action}
          </span>
        </li>)}</ul>
        : <p className={styles.statDialogEmpty}>{emptyMessage}</p>}
      <footer className={styles.statDialogFooter}>
        <button type="button" className={styles.clearButton} onClick={onClose}>Close</button>
      </footer>
    </dialog>, document.body,
  );
}

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './EnrolmentWorkspace.module.css';

export function EnrolmentDrawer({ children, onClose, returnFocusTo }: { children: ReactNode; onClose: () => void; returnFocusTo: HTMLElement | null }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = returnFocusTo || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const targets = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') ?? [])
        .filter(element => element.offsetParent !== null);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [returnFocusTo]);
  return createPortal(<div className={`${styles.drawerLayer} ${styles.shellFont}`}>
    <div className={styles.drawerBackdrop} aria-hidden="true" onClick={onClose} />
    <div ref={panel} className={styles.drawer} role="dialog" aria-modal="true" aria-label="Coach editor">
      <button type="button" className={styles.drawerClose} aria-label="Close coach editor" onClick={onClose}><X size={17} /></button>
      {children}
    </div>
  </div>, document.body);
}

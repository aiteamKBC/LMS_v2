import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import styles from './markingReview.module.css';

export function MarkingInstructionsPanel({ children, edited, guidanceAttached }: {
  children: ReactNode;
  edited: boolean;
  guidanceAttached: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const contentId = useId();
  // The trigger is remounted when moving between the page and the portal.
  const focusExpandButton = useCallback(() => expandRef.current?.focus({ preventScroll: true }), []);

  useEffect(() => {
    if (!expanded) return;
    const panel = panelRef.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    focusExpandButton();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setExpanded(false);
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      focusExpandButton();
    };
  }, [expanded, focusExpandButton]);

  const panel = <section
    ref={panelRef}
    className={`${styles.promptEditor} ${expanded ? styles.promptEditorExpanded : ''}`}
    role={expanded ? 'dialog' : undefined}
    aria-modal={expanded || undefined}
    aria-labelledby={titleId}
  >
    <div className={styles.promptHeader}>
      <button type="button" id={titleId} className={styles.promptSummary}
        aria-expanded={open || expanded} aria-controls={contentId} disabled={expanded}
        onClick={() => setOpen(value => !value)}>
        {open || expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
        AI marking instructions
        {edited && <span>Edited</span>}
        {guidanceAttached && <span>Guidance attached</span>}
      </button>
      <button ref={expandRef} type="button" className={styles.promptExpandButton}
        aria-label={expanded ? 'Collapse AI marking instructions' : 'Expand AI marking instructions'}
        aria-expanded={expanded} aria-controls={contentId}
        title={expanded ? 'Collapse AI marking instructions (Esc)' : 'Expand AI marking instructions'}
        onClick={() => { setOpen(true); setExpanded(value => !value); }}>
        {expanded ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
        {expanded ? 'Collapse' : 'Expand'}
      </button>
    </div>
    <div id={contentId} className={styles.promptBody} hidden={!open && !expanded}>{children}</div>
  </section>;

  // Keep the overlay outside the workspace's scroll and containment boundaries.
  return expanded ? createPortal(<div className={styles.promptBackdrop}
    onClick={event => { if (event.target === event.currentTarget) setExpanded(false); }}>
    {panel}
  </div>, document.body) : panel;
}

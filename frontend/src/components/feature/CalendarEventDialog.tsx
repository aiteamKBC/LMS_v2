import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon } from './AppIcon';

interface CalendarEventDialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
}

/** Shared event preview for calendar cards in every calendar view. */
export function CalendarEventDialog({ title, onClose, children, badges, actions }: CalendarEventDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current!;
    document.body.style.overflow = 'hidden';
    dialog.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      // Other workflows (for example a confirmation) can open above this preview.
      if (!dialog.contains(document.activeElement)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      )).filter(element => !element.closest('[hidden], [inert], [aria-hidden="true"]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground-950/40 p-3 backdrop-blur-sm sm:p-6"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-foreground-200 bg-white text-foreground-900 shadow-2xl outline-none sm:max-h-[calc(100dvh-3rem)]"
      >
        <div className="shrink-0 border-b border-foreground-200 bg-background-50 px-5 py-4 sm:px-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-semibold text-foreground-500">
              <AppIcon className="ri-calendar-event-line h-4 w-4" />Event details
            </span>
            <button type="button" aria-label="Close event details" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-500 transition hover:bg-background-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">
              <AppIcon className="ri-close-line h-5 w-5" />
            </button>
          </div>
          <h2 id={titleId} className="break-words text-xl font-heading font-bold leading-snug text-foreground-950">{title}</h2>
          {badges && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">{badges}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2 border-b border-foreground-200 bg-white px-5 py-3 sm:px-6">{actions}</div>}
        <div className="min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { focusableIn, useFloatingPanel, type FloatingAlign } from './floatingPanel';
import styles from './FloatingMenu.module.css';

type Close = (options?: { restoreFocus?: boolean }) => void;

/**
 * A menu or popover panel that is never clipped by its card or table.
 *
 * The panel stays mounted while closed (hidden), so actions that show inline
 * progress or results keep that state, as a native <details> would. Pass a
 * function as children to close the panel from an action that opens a dialog.
 */
export function FloatingMenu({ label, panelLabel, trigger, triggerId, triggerClassName, panelClassName, align = 'end', matchWidth = false, maxHeight, disabled = false, children }: {
  /** Accessible name of an icon-only trigger, e.g. "More actions for Jamie". Omit when the trigger has visible text. */
  label?: string;
  panelLabel?: string;
  trigger: ReactNode;
  triggerId?: string;
  triggerClassName?: string;
  panelClassName?: string;
  align?: FloatingAlign;
  /** Make the panel exactly as wide as its trigger (field-style dropdowns). */
  matchWidth?: boolean;
  /** Upper limit in px; the panel scrolls beyond it. */
  maxHeight?: number;
  disabled?: boolean;
  children: ReactNode | ((close: Close) => ReactNode);
}) {
  const [requested, setOpen] = useState(false);
  // A trigger that becomes disabled while open must not leave its panel behind.
  const open = requested && !disabled;
  const panelId = useId();
  const dismiss = useCallback(() => setOpen(false), []);
  const { triggerRef, panelRef, style, side } = useFloatingPanel<HTMLButtonElement, HTMLDivElement>({ open, onDismiss: dismiss, align, matchWidth, maxHeight });
  const focusOnOpen = useRef<'first' | 'last' | null>(null);

  const close: Close = useCallback(({ restoreFocus = true } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, [triggerRef]);

  // The panel is portalled to the end of <body>, so focus moves into it on open.
  useLayoutEffect(() => {
    if (!open || !focusOnOpen.current) return;
    const items = focusableIn(panelRef.current);
    (focusOnOpen.current === 'last' ? items.at(-1) : items[0])?.focus();
    focusOnOpen.current = null;
  }, [open, panelRef]);

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusOnOpen.current = event.key === 'ArrowUp' ? 'last' : 'first';
      setOpen(true);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  };

  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = focusableIn(panelRef.current);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const typing = event.target instanceof HTMLTextAreaElement
      || (event.target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(event.target.type));
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      // Leaving the panel returns to the trigger's place in the page order.
      if (event.shiftKey && index <= 0) { event.preventDefault(); close(); }
      else if (!event.shiftKey && index === items.length - 1) close();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && items.length && !typing) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  };

  return <>
    <button ref={triggerRef} id={triggerId} type="button" className={triggerClassName} disabled={disabled}
      aria-label={label} title={label} aria-expanded={open} aria-controls={panelId}
      onClick={() => { focusOnOpen.current = open ? null : 'first'; setOpen(!open); }} onKeyDown={onTriggerKey}>
      {trigger}
    </button>
    {createPortal(<div ref={panelRef} id={panelId} role="group" aria-label={panelLabel} hidden={!open}
      data-side={side} className={`${styles.panel} ${panelClassName ?? ''}`} style={style} onKeyDown={onPanelKey}>
      {typeof children === 'function' ? children(close) : children}
    </div>, document.body)}
  </>;
}

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import styles from '../monthlyCoaching.module.css';

interface MeetingAction {
  label: string;
  icon: string;
  onSelect: () => void;
}

/** Portal keeps row actions outside the horizontally scrolling table. */
export function MeetingActionsMenu({ learner, actions }: { learner: string; actions: MeetingAction[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const below = rect.bottom + 6;
    setPosition({
      left: Math.max(8, Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - 8)),
      top: Math.max(8, below + menuRect.height <= window.innerHeight - 8 ? below : rect.top - menuRect.height - 6),
    });
    const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items[initialFocus.current === 'last' ? items.length - 1 : 0]?.focus();
    const outside = (event: PointerEvent) => {
      if (!trigger.contains(event.target as Node) && !menu.contains(event.target as Node)) setOpen(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (!trigger.contains(event.target as Node) && !menu.contains(event.target as Node)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    const scroll = (event: Event) => { if (!menu.contains(event.target as Node)) dismiss(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focusOutside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', focusOutside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);

  const closeAndFocus = () => { setOpen(false); triggerRef.current?.focus(); };
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      closeAndFocus();
      return;
    }
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length
      : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1 : null;
    if (next !== null) { event.preventDefault(); items[next]?.focus(); }
  };

  if (!actions.length) return null;
  return (
    <>
      <button ref={triggerRef} type="button" aria-label={'More actions for ' + learner} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        className={styles.menuTrigger}
        onClick={() => { initialFocus.current = 'first'; setOpen(value => !value); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
            setOpen(true);
          } else if (event.key === 'Escape') closeAndFocus();
        }}>
        <AppIcon className="ri-more-fill text-lg" />
      </button>
      {open ? createPortal(
        <div ref={menuRef} id={menuId} role="menu" aria-label={'Actions for ' + learner} className={styles.menu} style={position} onKeyDown={onMenuKey} onClick={(event) => event.stopPropagation()}>
          {actions.map(action => <button key={action.label} type="button" role="menuitem" onClick={() => { closeAndFocus(); action.onSelect(); }}><AppIcon className={action.icon} />{action.label}</button>)}
        </div>,
        document.body,
      ) : null}
    </>
  );
}

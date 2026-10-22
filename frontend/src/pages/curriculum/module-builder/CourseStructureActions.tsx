import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import styles from './ModuleEditor.module.css';

export function CourseStructureActions({ hasCalendar, onMeeting, onReplaceLinks, onRestoreData }: {
  hasCalendar: boolean;
  onMeeting: () => void;
  onReplaceLinks: () => void;
  onRestoreData: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initialFocus = useRef(0);
  const menuId = useId();
  const actions = [
    { label: hasCalendar ? 'Update Teams meeting' : 'Create Teams meeting', icon: 'ri-calendar-event-line', run: onMeeting },
    { label: 'Replace Teams links', icon: 'ri-links-line', run: onReplaceLinks },
    { label: 'Restore Teams data', icon: 'ri-database-2-line', run: onRestoreData },
  ];

  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items?.[initialFocus.current]?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const current = items.findIndex(item => item === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={root} className={styles.structureTeamsActions} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => { initialFocus.current = 0; setOpen(value => !value); }}
        onKeyDown={event => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          initialFocus.current = event.key === 'ArrowUp' ? actions.length - 1 : 0;
          if (open) menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[initialFocus.current]?.focus();
          else setOpen(true);
        }} className={styles.structurePrimary}>
        <AppIcon className="ri-calendar-event-line" />
        Teams actions
        <AppIcon className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
      </button>
      {open && <div ref={menu} id={menuId} role="menu" aria-label="Teams actions" className={styles.structureTeamsMenu} onKeyDown={moveFocus}>
        {actions.map(action => <button key={action.label} type="button" role="menuitem" onClick={() => { setOpen(false); action.run(); }}>
          <AppIcon className={action.icon} />{action.label}
        </button>)}
      </div>}
    </div>
  );
}

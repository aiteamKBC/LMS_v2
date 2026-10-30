import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TransferReview } from '@/api/progressTransfer';
import { byWeek } from './componentSuggestions';
import styles from './progressTransfers.module.css';

type Targets = TransferReview['modules'][number]['targets'];
type Props = {
  label: string; candidates: Targets; selectedId: string; suggestedId: string | null;
  used: ReadonlySet<string>; disabled: boolean; onChange: (componentId: string) => void;
};

function menuPlacement(trigger: HTMLButtonElement) {
  const rect = trigger.getBoundingClientRect();
  const dialog = trigger.closest('[role="dialog"]')?.getBoundingClientRect();
  const upper = Math.max(8, dialog?.top ?? 0);
  const lower = Math.min(window.innerHeight - 8, dialog?.bottom ?? window.innerHeight);
  const below = lower - rect.bottom - 6;
  const above = rect.top - upper - 6;
  const upwards = below < Math.min(320, above);
  const maxHeight = Math.max(0, Math.min(320, upwards ? above : below));
  const width = Math.min(rect.width, window.innerWidth - 16);
  return { top: upwards ? rect.top - maxHeight - 6 : rect.bottom + 6,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width, maxHeight };
}

export function WeekComponentChoices({ label, candidates, selectedId, suggestedId, used, disabled, onChange }: Props) {
  const groupId = useId();
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ReturnType<typeof menuPlacement> | null>(null);
  const open = placement !== null;
  const selected = candidates.find(target => target.componentId === selectedId);
  function toggleMenu() {
    if (open) { setPlacement(null); return; }
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPlacement(menuPlacement(trigger));
  }
  function choose(componentId: string) {
    onChange(componentId);
    setPlacement(null);
    triggerRef.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const initial = menu?.querySelector<HTMLElement>('input:checked:not(:disabled)')
      ?? menu?.querySelector<HTMLElement>('button:not(:disabled)');
    initial?.focus({ preventScroll: true });
    // Scroll only the dropdown: scrollIntoView also moves the enclosing wizard.
    if (initial && menu) {
      const itemBounds = (initial.closest('label') ?? initial).getBoundingClientRect();
      const menuBounds = menu.getBoundingClientRect();
      menu.scrollTop += Math.max(0, itemBounds.bottom - menuBounds.bottom + 12)
        + Math.min(0, itemBounds.top - menuBounds.top - 12);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setPlacement(null);
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const dialog = trigger.closest('[role="dialog"]')?.getBoundingClientRect();
      if (rect.bottom <= Math.max(0, dialog?.top ?? 0) || rect.top >= Math.min(window.innerHeight, dialog?.bottom ?? window.innerHeight)) {
        setPlacement(null);
      } else {
        // Layout changes and browser focus can scroll the modal just after opening.
        setPlacement(current => current ? menuPlacement(trigger) : null);
      }
    };
    const resize = () => setPlacement(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // The parent modal handles Escape on document capture. Dismiss this picker first.
      event.preventDefault(); event.stopPropagation();
      setPlacement(null);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  return <fieldset ref={rootRef} className={styles.componentChoices} aria-label={label} disabled={disabled}>
    <legend>Match in new module</legend>
    <div className={styles.selectedComponent}>
      <button ref={triggerRef} type="button" className={styles.componentTrigger} aria-label="Choose component" aria-expanded={open}
        aria-describedby={`${groupId}-value`}
        aria-controls={open ? `${groupId}-menu` : undefined} disabled={disabled || !candidates.length} onClick={toggleMenu}
        title={selected ? `${selected.title} — ${selected.week || 'No week specified'}` : undefined}>
        <span id={`${groupId}-value`}>{selected ? <><strong>{selected.title}</strong>{' '}<small>{selected.week || 'No week specified'}</small></> : 'Choose a matching component'}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <button type="button" className={styles.clearMatch} disabled={disabled || !selectedId} onClick={() => choose('')}>Clear match</button>
    </div>
    {placement && <div ref={menuRef} id={`${groupId}-menu`} className={styles.componentMenu} style={placement} role="region" aria-label="Components by week">
      <p>Open a week to choose a component.</p>
      <div className={styles.componentWeeks}>
      {byWeek(candidates).map(([week, targets]) => <WeekChoices key={week} week={week} targets={targets}
        groupId={groupId} selectedId={selectedId} suggestedId={suggestedId} used={used} disabled={disabled} onChange={choose} />)}
      </div>
    </div>}
  </fieldset>;
}

function WeekChoices({ week, targets, groupId, selectedId, suggestedId, used, disabled, onChange }: Omit<Props, 'label' | 'candidates'> & {
  week: string; targets: Targets; groupId: string;
}) {
  const panelId = useId();
  const hasSelection = targets.some(target => target.componentId === selectedId);
  const [open, setOpen] = useState(hasSelection);
  return <div className={styles.componentWeek}>
    <button type="button" id={`${panelId}-toggle`} className={styles.weekToggle} aria-expanded={open} aria-controls={panelId}
      disabled={disabled} onClick={() => setOpen(value => !value)}>
      <ChevronDown size={16} aria-hidden="true" />
      <span>{week || 'No week specified'}{' '}<small>{targets.length} {targets.length === 1 ? 'component' : 'components'}{hasSelection ? ' · Match selected' : ''}</small></span>
    </button>
    <div id={panelId} role="region" aria-labelledby={`${panelId}-toggle`} hidden={!open}>
      {open && <div className={styles.weekOptions}>{targets.map(target => <label key={target.componentId} className={styles.componentOption}>
        <input type="radio" name={groupId} value={target.componentId} checked={selectedId === target.componentId}
          disabled={disabled || used.has(target.componentId)} onChange={() => onChange(target.componentId)} />
        <span><strong>{target.title}</strong>{' '}<small>{target.type} · {target.componentId}</small>
          {target.componentId === suggestedId && <>{' '}<small className={styles.recommendedMatch}>Recommended</small></>}
          {used.has(target.componentId) && <>{' '}<small>Already matched to another old component</small></>}
        </span>
      </label>)}</div>}
    </div>
  </div>;
}

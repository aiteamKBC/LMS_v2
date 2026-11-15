import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { focusableIn, useFloatingPanel } from '@/components/ui/floatingPanel';

/** Keep week targets outside the course rail and Point clipping containers. */
export function MoveComponentButton({ label, moveNote, otherWeeks, onMoveToWeek }: {
  label: string;
  moveNote: string;
  otherWeeks: { id: string; label: string }[];
  onMoveToWeek: (weekId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const focusEdge = useRef<'first' | 'last'>('first');
  const dismiss = useCallback(() => setOpen(false), []);
  const { triggerRef, panelRef, style } = useFloatingPanel<HTMLButtonElement, HTMLDivElement>({
    open, onDismiss: dismiss, maxHeight: 256,
  });
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!open) return;
    const items = focusableIn(panelRef.current);
    (focusEdge.current === 'last' ? items.at(-1) : items[0])?.focus({ preventScroll: true });
  }, [open, panelRef]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = focusableIn(panelRef.current);
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Tab') {
      close();
    }
  };

  return <>
    <button ref={triggerRef} type="button" aria-label={`Move ${label} to another week`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={event => { event.stopPropagation(); focusEdge.current = 'first'; setOpen(previous => !previous); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          focusEdge.current = event.key === 'ArrowUp' ? 'last' : 'first';
          setOpen(true);
        } else if (event.key === 'Escape' && open) close();
      }}
      className="inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-[10px] font-semibold text-foreground-500 hover:bg-background-100 hover:text-primary-600">
      <AppIcon className="ri-drag-move-2-line text-[13px]" />
      Move
    </button>
    {open && createPortal(<div ref={panelRef} id={menuId} role="menu" aria-label={`Move ${label} to another week`}
      style={style} onClick={event => event.stopPropagation()} onKeyDown={onMenuKeyDown}
      className="z-[60] w-60 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-xl border border-background-200 bg-background-50 py-1 shadow-xl">
      <p className="px-3 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-wide text-foreground-400">Move to another week</p>
      {moveNote && <p data-testid="move-component-note" className="px-3 pb-1.5 text-[10px] leading-snug text-purple-700">{moveNote}</p>}
      {otherWeeks.map(week => <button key={week.id} type="button" role="menuitem"
        onClick={() => { close(); onMoveToWeek(week.id); }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold text-foreground-700 hover:bg-primary-50 hover:text-primary-700">
        <AppIcon className="ri-arrow-right-line text-[13px] text-foreground-400" />
        <span className="truncate">{week.label}</span>
      </button>)}
    </div>, document.body)}
  </>;
}

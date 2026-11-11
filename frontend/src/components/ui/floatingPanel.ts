import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * Shared placement for menus and popovers that must never be clipped.
 *
 * Panels are rendered in a portal with fixed positioning, so a card or table
 * with `overflow: hidden` cannot cut them off. They open below their trigger
 * when they fit, flip above when there is more room there, never leave the
 * viewport horizontally, and scroll internally when neither side has room.
 */
export type FloatingAlign = 'start' | 'end';
export type FloatingSide = 'top' | 'bottom';

export interface FloatingPlacement {
  top: number;
  left: number;
  maxHeight: number;
  side: FloatingSide;
  width?: number;
}

interface Rect { top: number; bottom: number; left: number; right: number; width: number }
interface Size { width: number; height: number }

export const FLOATING_GAP = 6;
export const FLOATING_MARGIN = 8;

export function placeFloating(anchor: Rect, panel: Size, viewport: Size, options: { align?: FloatingAlign; matchWidth?: boolean; maxHeight?: number } = {}): FloatingPlacement {
  const { align = 'end', matchWidth = false, maxHeight = Infinity } = options;
  const width = matchWidth ? anchor.width : panel.width;
  const wanted = Math.min(panel.height, maxHeight);
  const spaceBelow = Math.max(0, viewport.height - anchor.bottom - FLOATING_GAP - FLOATING_MARGIN);
  const spaceAbove = Math.max(0, anchor.top - FLOATING_GAP - FLOATING_MARGIN);
  // Prefer below; flip only when the panel does not fit and above is roomier.
  const side: FloatingSide = wanted <= spaceBelow || spaceBelow >= spaceAbove ? 'bottom' : 'top';
  const space = side === 'bottom' ? spaceBelow : spaceAbove;
  const height = Math.min(wanted, space);
  const preferredLeft = align === 'end' ? anchor.right - width : anchor.left;
  const maxLeft = Math.max(FLOATING_MARGIN, viewport.width - FLOATING_MARGIN - width);
  return {
    top: side === 'bottom' ? anchor.bottom + FLOATING_GAP : anchor.top - FLOATING_GAP - height,
    left: Math.min(Math.max(FLOATING_MARGIN, preferredLeft), maxLeft),
    maxHeight: Math.min(space, maxHeight),
    side,
    ...(matchWidth ? { width } : {}),
  };
}

// Layout effects place the panel before the first paint, and it must stay
// focusable meanwhile, so no visibility:hidden here.
const UNPLACED: CSSProperties = { position: 'fixed', top: 0, left: 0 };

/**
 * Positions `panelRef` against `triggerRef` while `open`, and dismisses it on
 * an outside pointer press, on focus moving elsewhere, or when the trigger is
 * scrolled out of view. Scrolling and resizing re-place the panel, as does any
 * change in the panel's own size (e.g. a row action showing inline status).
 */
export function useFloatingPanel<T extends HTMLElement, P extends HTMLElement>({ open, onDismiss, align = 'end', matchWidth = false, maxHeight }: {
  open: boolean; onDismiss: () => void; align?: FloatingAlign; matchWidth?: boolean; maxHeight?: number;
}) {
  const triggerRef = useRef<T>(null);
  const panelRef = useRef<P>(null);
  const [style, setStyle] = useState<CSSProperties>(UNPLACED);
  const [side, setSide] = useState<FloatingSide>('bottom');
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const inside = (target: EventTarget | null) => target instanceof Node && (trigger.contains(target) || panel.contains(target));
    const place = () => {
      const anchor = trigger.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) { dismissRef.current(); return; }
      // scrollHeight is the content height even while a previous maxHeight applies.
      const natural = { width: panel.offsetWidth, height: panel.scrollHeight + panel.offsetHeight - panel.clientHeight };
      const viewport = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
      const placement = placeFloating(anchor, natural, viewport, { align, matchWidth, maxHeight });
      setSide(placement.side);
      setStyle({ position: 'fixed', top: placement.top, left: placement.left, maxHeight: placement.maxHeight, width: placement.width });
    };
    place();
    const onScroll = (event: Event) => { if (!panel.contains(event.target as Node)) place(); };
    const onPointerDown = (event: PointerEvent) => { if (!inside(event.target)) dismissRef.current(); };
    const onFocusIn = (event: FocusEvent) => { if (!inside(event.target)) dismissRef.current(); };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place());
    observer?.observe(panel);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    // Capture before page controls can stop propagation; the first outside
    // mouse/touch/pen press dismisses without swallowing that control's action.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open, align, matchWidth, maxHeight]);

  return { triggerRef, panelRef, style, side };
}

export const focusableIn = (root: HTMLElement | null) => Array.from(root?.querySelectorAll<HTMLElement>(
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
) ?? []).filter(element => !element.closest('[hidden]'));

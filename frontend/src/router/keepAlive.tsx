import { Component, createRef, useRef, type ReactNode } from 'react';
import type { Location } from 'react-router-dom';

/** History state a page sets when it opens the learner preview over itself.
 * The value is the opener's path + search, checked against the page that was
 * actually on screen, so a copied or forwarded link keeps nothing alive. */
export const LEARNER_PREVIEW_FROM = 'learnerPreviewFrom';

const isLearnerPath = (pathname: string) => pathname.startsWith('/learner/');

/**
 * The location to keep mounted underneath a learner preview, or null.
 *
 * Keeps the opener's own Location object, so its hooks see an unchanged
 * location and nothing keyed on it re-runs. Released once navigation leaves
 * the learner pages, back to the opener or anywhere else.
 */
export function useKeptLocation(location: Location): Location | null {
  const kept = useRef<Location | null>(null);
  const previous = useRef(location);
  if (!isLearnerPath(location.pathname)) kept.current = null;
  else if (!kept.current) {
    const from = (location.state as Record<string, unknown> | null)?.[LEARNER_PREVIEW_FROM];
    const last = previous.current;
    if (typeof from === 'string' && last !== location && !isLearnerPath(last.pathname) && last.pathname + last.search === from) {
      kept.current = last;
    }
  }
  previous.current = location;
  return kept.current;
}

type Snapshot = { scroll: [Element, number, number][]; page: [number, number]; focus: HTMLElement | null };

/**
 * Hides its children without unmounting them. display:none drops scroll
 * offsets, so they are read before hiding and put back on reveal, with focus.
 */
export class KeepAliveSlot extends Component<{ hidden: boolean; children: ReactNode }> {
  private root = createRef<HTMLDivElement>();
  private saved: Snapshot | null = null;

  getSnapshotBeforeUpdate(previous: Readonly<{ hidden: boolean }>): Snapshot | null {
    const root = this.root.current;
    if (previous.hidden || !this.props.hidden || !root) return null;
    const scroll: Snapshot['scroll'] = [];
    root.querySelectorAll('*').forEach(element => {
      if (element.scrollTop || element.scrollLeft) scroll.push([element, element.scrollTop, element.scrollLeft]);
    });
    const active = document.activeElement;
    return { scroll, page: [window.scrollX, window.scrollY], focus: active instanceof HTMLElement && root.contains(active) ? active : null };
  }

  componentDidUpdate(previous: Readonly<{ hidden: boolean }>, _state: unknown, snapshot: Snapshot | null) {
    if (snapshot) this.saved = snapshot;
    if (!previous.hidden || this.props.hidden || !this.saved) return;
    const { scroll, page, focus } = this.saved;
    this.saved = null;
    scroll.forEach(([element, top, left]) => {
      if (!element.isConnected) return;
      element.scrollTop = top;
      element.scrollLeft = left;
    });
    if (window.scrollX !== page[0] || window.scrollY !== page[1]) window.scrollTo(page[0], page[1]);
    if (focus?.isConnected) focus.focus({ preventScroll: true });
  }

  render() {
    return <div ref={this.root} style={{ display: this.props.hidden ? 'none' : 'contents' }} aria-hidden={this.props.hidden || undefined}>
      {this.props.children}
    </div>;
  }
}

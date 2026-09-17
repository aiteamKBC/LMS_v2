import type { MouseEvent } from 'react';

/**
 * Show a clipped label's full text as the browser's own tooltip, on hover.
 *
 * `truncate` hides the end of a name but keeps it whole in the DOM, so the only
 * thing actually missing is a way to read it. A permanent `title` is the wrong
 * answer: it puts a tooltip on every short name that was already fully
 * readable, and a rail of twenty rows that all pop up a copy of the text they
 * are already showing is noise, not help.
 *
 * So the measurement is taken at the moment of hover. That is the only moment it
 * matters, and the only moment the element's real width is certainly known --
 * these rails resize with their panel and with the window, so a width measured
 * at render would be stale by the time anybody pointed at it, and re-measuring
 * on every resize would cost a ResizeObserver per row for an answer nobody had
 * asked for yet. `scrollWidth > clientWidth` is the element's own overflow,
 * which is exactly the question: is this name longer than the space it was
 * given?
 *
 * Attach it to the element carrying `truncate`. Its `textContent` is the full
 * label, because CSS clips the text rather than removing it, so nothing needs to
 * be passed in and the tooltip can never disagree with the row.
 */
export function showFullTextWhenTruncated(event: MouseEvent<HTMLElement>) {
  const node = event.currentTarget;
  const text = (node.textContent || '').trim();
  // A pixel of tolerance: widths are rounded, so text that fits exactly can
  // still report a scrollWidth one greater than its clientWidth.
  const clipped = node.scrollWidth > node.clientWidth + 1;
  // Written on every hover rather than once. These rows are reused as weeks are
  // reordered, renamed and re-expanded, so a title left behind by a previous
  // label would confidently name the wrong week.
  node.title = text && clipped ? text : '';
}

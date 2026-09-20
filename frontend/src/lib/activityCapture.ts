/**
 * Read actions, recorded across the whole LMS.
 *
 * Page visits are recorded by the router, which every workspace goes through.
 * Searches, filters and exports are not: they happen inside components, and the
 * only components that reported them were Curriculum Studio's own. Every other
 * workspace therefore showed real people opening real pages and never doing
 * anything on them — a silence that reads as "they looked and left" rather than
 * "nobody was listening".
 *
 * Two layers close that, and the split is deliberate:
 *
 * * **Named** — the two shared toolkits (Curriculum Studio's `EntityFilterBar`,
 *   the shared `FilterToolbar`) call the recorder themselves. They know what
 *   the filter is called and which option was chosen, so they record it by
 *   name. Their roots carry `data-audit="manual"`.
 * * **Generic** — this module, a delegated listener on the document, catches
 *   the rest: hand-rolled search boxes, native selects, export buttons. It
 *   reads what it can from the DOM and skips anything inside a `manual`
 *   subtree, so nothing is recorded twice.
 *
 * The generic layer is deliberately conservative. It records an input only when
 * that input is recognisably a search or filter — `type="search"`, or a name,
 * placeholder or label that says so. It never records a password, and never
 * anything inside `data-audit="off"`. A control it cannot identify is left
 * alone: an unrecorded action is a gap, but a mis-recorded one is a false
 * statement about what somebody did, and the second is worse.
 *
 * Nothing here needs a page to opt in, which is the point — a workspace built
 * next year is covered the day it ships, not the day somebody remembers to add
 * a call.
 */

import { recordAction, recordSearch, type ActivityKind } from './activityTrail';

/** Everything the recorder accepts except a page visit, which the router owns. */
type ReadActionKind = Exclude<ActivityKind, 'page_view'>;

/** Marks a subtree that reports its own actions. The generic layer defers to it. */
const MANUAL = '[data-audit="manual"]';
/** Marks a subtree that must never be recorded. */
const OFF = '[data-audit="off"]';

/** Inputs whose text is worth recording, identified by what they are called. */
const SEARCH_NAME = /(^|[^a-z])(search|filter|find|query|lookup)([^a-z]|$)/i;

/** Buttons whose label says they take data out of the LMS. */
const EXPORT_LABEL = /\b(export|download|csv|xlsx|excel|pdf)\b/i;
const PRINT_LABEL = /\bprint\b/i;

/** Never recorded, whatever it is called. */
const SECRET_TYPES = new Set(['password', 'hidden', 'file']);

function closestMatch(node: EventTarget | null, selector: string): Element | null {
  return node instanceof Element ? node.closest(selector) : null;
}

/** True when this element reports itself, or is off limits. */
function handledElsewhere(node: EventTarget | null): boolean {
  return Boolean(closestMatch(node, MANUAL) || closestMatch(node, OFF));
}

/** What a control is called, from whatever the markup actually provides. */
function nameOf(element: Element): string {
  const aria = element.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const label = element.ownerDocument?.getElementById(labelledBy)?.textContent;
    if (label?.trim()) return label.trim();
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
    const labels = element.labels;
    if (labels?.length && labels[0].textContent?.trim()) return labels[0].textContent.trim();
    const placeholder = element.getAttribute('placeholder');
    if (placeholder?.trim()) return placeholder.trim();
    if (element.name) return element.name;
  }

  return (element.textContent || '').trim().slice(0, 80);
}

/** Text shown on a control, used when it has no accessible name of its own. */
function labelOf(element: Element): string {
  return (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 80);
}

function isSearchInput(element: Element): element is HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) return false;
  const type = (element.type || 'text').toLowerCase();
  if (SECRET_TYPES.has(type)) return false;
  if (type === 'search') return true;
  if (type !== 'text') return false;
  // A plain text box is only a search box when something says it is. Recording
  // every text field would put half-typed names, notes and addresses into the
  // audit log under the word "search".
  return SEARCH_NAME.test([
    element.name,
    element.getAttribute('placeholder') || '',
    element.getAttribute('aria-label') || '',
    element.id,
  ].join(' '));
}

/** The action a clicked control represents, or nothing when it is not one. */
function actionForClick(element: Element): { kind: ReadActionKind; label: string } | null {
  const label = labelOf(element);
  if (!label) return null;
  if (EXPORT_LABEL.test(label)) {
    return { kind: /\bdownload\b/i.test(label) ? 'download' : 'export', label };
  }
  if (PRINT_LABEL.test(label)) return { kind: 'print', label };
  return null;
}

/**
 * Starts recording. Returns the function that stops it.
 *
 * Listeners are passive and on the capture phase, so they see an event even
 * when the component handling it stops propagation — a filter that closes its
 * own dropdown is still a filter somebody applied.
 */
export function installActivityCapture(target: Document | null = typeof document === 'undefined' ? null : document): () => void {
  if (!target) return () => {};

  const onInput = (event: Event) => {
    const element = event.target;
    if (!(element instanceof Element) || handledElsewhere(element)) return;
    if (!isSearchInput(element)) return;
    // Keyed by the box's own name so two search boxes on one page settle
    // separately instead of cancelling each other.
    recordSearch(element.value, nameOf(element) || 'search');
  };

  const onChange = (event: Event) => {
    const element = event.target;
    if (!(element instanceof Element) || handledElsewhere(element)) return;

    if (element instanceof HTMLSelectElement) {
      const chosen = element.selectedOptions[0];
      recordAction('filter', {
        filter: nameOf(element),
        value: (chosen?.textContent || element.value || '').trim().slice(0, 120),
      });
      return;
    }

    // A checkbox or radio inside a filter group is a filter too, but only when
    // it is named like one -- a consent tickbox on a form is not.
    if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
      const name = nameOf(element);
      if (!SEARCH_NAME.test(`${element.name} ${name}`)) return;
      recordAction('filter', { filter: name, value: element.checked ? 'on' : 'off' });
    }
  };

  const onClick = (event: Event) => {
    const element = event.target;
    if (!(element instanceof Element) || handledElsewhere(element)) return;

    // A custom dropdown: the listbox is the filter, the option is the value.
    const option = element.closest('[role="option"]');
    if (option) {
      const listbox = option.closest('[role="listbox"]');
      const trigger = listbox?.parentElement?.querySelector('[aria-haspopup="listbox"]');
      recordAction('filter', {
        filter: (trigger ? labelOf(trigger) : listbox ? nameOf(listbox) : '') || 'filter',
        value: labelOf(option),
      });
      return;
    }

    const tab = element.closest('[role="tab"]');
    if (tab) {
      recordAction('tab', { tab: labelOf(tab) });
      return;
    }

    const control = element.closest('button, a[href], [role="button"]');
    if (!control) return;
    const action = actionForClick(control);
    if (action) recordAction(action.kind, { format: action.label });
  };

  const options: AddEventListenerOptions = { capture: true, passive: true };
  target.addEventListener('input', onInput, options);
  target.addEventListener('change', onChange, options);
  target.addEventListener('click', onClick, options);

  return () => {
    target.removeEventListener('input', onInput, options);
    target.removeEventListener('change', onChange, options);
    target.removeEventListener('click', onClick, options);
  };
}

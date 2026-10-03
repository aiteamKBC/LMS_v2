/**
 * Stamps and spans, as the audit trail shows them.
 *
 * Shared by the People list and one person's activity page so the two never
 * disagree about what "Today 14:32" means. The change feed's own day grouping
 * stays in `page.tsx`, where it is the only thing that uses it.
 */

import type { CurriculumAuditEvent } from '@/lib/curriculumApi';

/**
 * The backend writes UTC. Whether the driver hands back a bare
 * `2026-09-09T10:00:00` or an offset-bearing `...+00:00` depends on the column
 * type, so the marker is only added when the string carries no zone of its own
 * — appending one unconditionally turns every offset stamp into an invalid date
 * and the whole time column silently blanks.
 */
export function parseActivityStamp(value: string): Date | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const parsed = new Date(zoned ? text : `${text}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `Today 14:32`, `Yesterday 09:05`, `16 Sep 2026 14:32`. Empty for no stamp. */
export function stampLabel(value: string): string {
  const parsed = parseActivityStamp(value);
  if (!parsed) return '';
  const time = parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfDay.getTime()) / 86_400_000);
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  return `${parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${time}`;
}

/** `14:32` alone, for a row already sitting under its own date. */
export function clockLabel(value: string): string {
  const parsed = parseActivityStamp(value);
  return parsed ? parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
}

/** Full context for a compact clock value: date, timezone and local-time note. */
export function timeMetaLabel(value: string): string {
  const parsed = parseActivityStamp(value);
  if (!parsed) return 'Time not recorded';
  const formatted = parsed.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  });
  return `${formatted} · your local time`;
}

/** Makes opaque audit identifiers readable while the raw value remains available in a tooltip. */
/**
 * A sensitive field records that it changed without recording what to: the
 * stored value is a digest of itself, so two different values differ and the
 * same value matches, and neither can be read back. See
 * `system_audit/records.py` for which fields those are and why.
 */
export const REDACTED_PREFIX = 'redacted:';

export function isRedacted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(REDACTED_PREFIX);
}

/**
 * The kinds of record an id can point at, and what to call them.
 *
 * Ordered, because the first pattern that matches every id in a list names the
 * list. Used by the single-value wording too, so "GROUP-" reads as a group in
 * both places rather than being spelled out twice and drifting.
 */
const RECORD_KINDS: Array<[RegExp, string]> = [
  [/^(?:APTEM-)?GROUP-/i, 'groups'],
  [/^(?:APTEM-)?MOD-/i, 'modules'],
  [/^(?:APTEM-)?(?:COMP|COMPONENT)-/i, 'components'],
  [/^(?:APTEM-)?WEEK-/i, 'weeks'],
  [/^(?:APTEM-)?COHORT-/i, 'cohorts'],
  [/^(?:APTEM-)?PROG(?:RAMME)?-/i, 'programmes'],
];

export function auditValueLabel(value: unknown): string {
  // Said plainly rather than shown as a digest. "Hidden" on both sides of a
  // diff is honest here in a way a count never is: the row above already says
  // the field changed, and this says the value is deliberately not recorded.
  if (isRedacted(value)) return 'Hidden — not recorded';
  if (value === null || value === undefined || value === '') return 'Empty';
  if (Array.isArray(value)) {
    const ids = value.filter(item => typeof item === 'string');
    if (ids.length === value.length && ids.length > 0) {
      for (const [pattern, noun] of RECORD_KINDS) {
        if (ids.every(item => pattern.test(item))) return `${value.length} linked ${noun}`;
      }
      // Any mixture of kinds, including ones with no noun of their own. The
      // catch-all matters more than it looks: without it a list of cohort or
      // programme ids fell through to JSON and printed the identifiers.
      if (ids.every(item => RECORD_ID.test(item))) return `${value.length} linked records`;
    }
    try { return JSON.stringify(value); } catch { return '[value unavailable]'; }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return auditValueLabel(JSON.parse(trimmed)); } catch { /* keep the original text */ }
    }
    // A list the log cut short never closes its bracket, so it cannot be
    // parsed and used to be printed raw -- identifiers and all. Summarised
    // from the ids that survived the cut instead, and marked as a floor.
    if (trimmed.startsWith('[') && !trimmed.endsWith(']')) {
      const { ids } = auditIdListInfo(trimmed);
      if (ids.length) {
        const summary = auditValueLabel(ids);
        return `At least ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;
      }
    }
    for (const [pattern, noun] of RECORD_KINDS) {
      if (pattern.test(trimmed)) return `Internal ${noun.replace(/s$/, '')} reference`;
    }
    if (RECORD_ID.test(trimmed)) return 'Internal record reference';
  }
  if (typeof value === 'object') {
    try {
      return Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => `${key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase())}: ${auditValueLabel(item)}`)
        .join(' · ');
    } catch { return '[value unavailable]'; }
  }
  return String(value);
}

type AuditFieldValue = {
  label: string;
  before?: unknown;
  after?: unknown;
};

function parseAuditList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

/** An id the LMS minted, in any of the shapes the authoring tables use. */
export const RECORD_ID = /^(?:APTEM-)?(?:MOD|GROUP|COMP|COMPONENT|WEEK|COHORT|PROG(?:RAMME)?)-/i;

/**
 * The ids inside a recorded list field, and whether the log had to cut it.
 *
 * A value too long for the diff is stored cut off mid-list, so it never closes
 * its bracket and cannot be parsed as JSON at all. Until this salvaged them,
 * every shortened link field fell past both the lookup and the readable
 * summary and printed its raw ids on screen — which is exactly what a reader
 * cannot use. The ids before the cut are whole and nameable; `cut` is what
 * stops the shortened list from being written out as if it were the whole one.
 */
export function auditIdListInfo(value: unknown): { ids: string[]; cut: boolean } {
  const parsed = parseAuditList(value);
  if (parsed) {
    return {
      ids: parsed.filter(item => typeof item === 'string').map(item => String(item).trim()).filter(Boolean),
      cut: false,
    };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && !trimmed.endsWith(']')) {
      // Only the quoted runs that closed. A final id severed mid-way has no
      // closing quote, so it is left out rather than named from half of itself.
      const ids = [...trimmed.matchAll(/"([^"\\]*)"/g)]
        .map(match => match[1].trim())
        .filter(Boolean);
      return { ids, cut: true };
    }
  }
  return { ids: [], cut: false };
}

/** The string ids inside a recorded list field, in the order they were saved. */
export function auditIdList(value: unknown): string[] {
  return auditIdListInfo(value).ids;
}

/**
 * A list of ids written out as the records they point at.
 *
 * Returns `''` when not one name could be found, so the caller can fall back to
 * the count summary rather than printing identifiers. An id that resolves to
 * nothing is counted, never shown: a reader cannot do anything with
 * `APTEM-GROUP-8172be55ba04030ef4719b1f6d15ab94`, but "and 2 more that could
 * not be named" still tells them the side is longer than what they can see, so
 * the evidence is not quietly shortened. The raw value stays in the tooltip.
 */
function namedIdList(ids: string[], names?: ReadonlyMap<string, string>): string {
  const named: string[] = [];
  let unnamed = 0;
  for (const id of ids) {
    const name = names?.get(id.toLowerCase());
    if (name) named.push(name);
    else unnamed += 1;
  }
  if (!named.length) return '';
  if (!unnamed) return named.join(', ');
  return `${named.join(', ')}, and ${unnamed} more that could not be named`;
}

/**
 * Uses the friendly name field recorded in the same save when an audit event
 * also contains a technical ID field. The ID remains available through the
 * value tooltip, while the visible value is useful to a person reading the
 * history.
 *
 * When the save recorded no names of its own, `names` resolves the ids against
 * the live records. An id that resolves to nothing keeps its own text: a name
 * that cannot be found is a gap in the lookup, not evidence that the record was
 * never in the list, and dropping it would make a side of the diff shorter than
 * what was actually saved.
 */
export function auditFieldValueLabel(
  fieldLabel: string,
  value: unknown,
  fields: AuditFieldValue[],
  side: 'before' | 'after',
  names?: ReadonlyMap<string, string>,
): string {
  const namesLabel = /module\s+ids?/i.test(fieldLabel)
    ? /module\s+names?/i
    : /group\s+ids?/i.test(fieldLabel)
      ? /group\s+names?/i
      : null;
  if (namesLabel) {
    const namesField = fields.find(field => namesLabel.test(field.label));
    const rawNames = namesField?.[side];
    let names: unknown = rawNames;
    if (typeof rawNames === 'string') {
      const trimmed = rawNames.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try { names = JSON.parse(trimmed); } catch { /* keep the recorded text */ }
      }
    }
    if (Array.isArray(names) && names.length > 0 && names.every(name => typeof name === 'string' && name.trim())) {
      return names.map(name => String(name).trim()).join(', ');
    }
    if (typeof names === 'string' && names.trim()) return names.trim();
  }
  // Any field that carries record ids, not only the two spelled "module ids"
  // and "group ids". The same identifiers turn up under names the backend
  // derives from the column, and a reader does not care what the column was
  // called -- they care that the screen says "Feb 2026 · Group A".
  const { ids, cut } = auditIdListInfo(value);
  if (ids.length) {
    const named = namedIdList(ids, names);
    // Cut lists say so. Without this a shortened four-of-nine list would read
    // as the whole of what was saved.
    if (named) return cut ? `${named}, …` : named;
    // Nothing could be named. The count summary is built from the ids that
    // were salvaged rather than from the raw text, so a shortened value gets
    // "At least 4 linked groups" instead of a wall of identifiers.
    const summary = auditValueLabel(ids);
    return cut ? `At least ${summary.charAt(0).toLowerCase()}${summary.slice(1)}` : summary;
  }

  // One id on its own, e.g. a parent that moved.
  if (typeof value === 'string' && RECORD_ID.test(value.trim())) {
    const name = names?.get(value.trim().toLowerCase());
    if (name) return name;
  }

  return auditValueLabel(value);
}

/**
 * A changed field's name, with the plumbing taken off the end.
 *
 * The backend derives a label from the column when it has no better one, so a
 * link column arrives as "Group ids". Now that the values beneath it are the
 * groups themselves rather than their identifiers, the heading saying "ids" is
 * the only thing left on the panel describing the storage rather than the
 * record. A label the backend named explicitly comes through untouched.
 */
export function auditFieldLabel(label: string): string {
  const text = String(label || '').trim();
  const list = text.match(/^(.*?)\s+ids$/i);
  if (list) return `${list[1]}s`;
  const single = text.match(/^(.*?)\s+id$/i);
  if (single) return single[1];
  return text;
}

export function auditValueTitle(value: unknown): string {
  // No raw value in the tooltip either -- the tooltip is where the unredacted
  // value normally lives, so it is the one place a redaction could leak.
  if (isRedacted(value)) return 'This field is audited but its value is not recorded';
  if (value === null || value === undefined || value === '') return 'Empty';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

/**
 * Opens authored components at their exact week in Module Builder. Revision
 * events carry the module and week ancestry; older timestamp events do not,
 * so those keep their original destination instead of guessing.
 */
export function auditEventHref(event: CurriculumAuditEvent): string {
  const componentId = String(event.entity === 'component' ? event.entityId || '' : '').trim();
  const moduleId = String(event.moduleCatalogueId || (event.entity === 'module' ? event.entityId : '') || '').trim();
  const archived = event.action === 'archived' || String(event.contentStatus || '').toLowerCase() === 'archived';
  // An archived module is not in the catalogue to open, and the Module Builder
  // no longer carries an archive of its own: the Curriculum archive is where
  // every archived record is read, so the link names the module it means there.
  if (archived && moduleId) {
    const params = new URLSearchParams({ type: 'module', q: moduleId });
    return `/curriculum/archive?${params.toString()}`;
  }
  const weekId = String(event.parentId || '').trim();
  if (!componentId || !moduleId) return event.href;

  const params = new URLSearchParams({ module: moduleId, component: componentId, focus: 'component' });
  if (weekId) params.set('week', weekId);
  return `/curriculum/module-builder?${params.toString()}`;
}

/**
 * How long a page was open.
 *
 * `null` is not zero and must not read as it: a tab closed before the duration
 * could be reported is an unknown, and the caller shows it as such rather than
 * printing "0s" against a page somebody spent ten minutes on.
 */
export function durationLabel(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/** The span between two stamps, for a whole visit. */
export function spanLabel(from: string, to: string): string {
  const start = parseActivityStamp(from);
  const end = parseActivityStamp(to);
  if (!start || !end) return '';
  return durationLabel(Math.max(0, end.getTime() - start.getTime()));
}

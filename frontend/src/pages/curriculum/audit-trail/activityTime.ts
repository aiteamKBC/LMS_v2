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
export function auditValueLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Empty';
  if (Array.isArray(value)) {
    const ids = value.filter(item => typeof item === 'string');
    if (ids.length === value.length && ids.every(item => /^(?:APTEM-)?GROUP-/i.test(item))) return `${value.length} linked groups`;
    if (ids.length === value.length && ids.every(item => /^(?:APTEM-)?MOD-/i.test(item))) return `${value.length} linked modules`;
    if (ids.length === value.length && ids.every(item => /^(?:APTEM-)?(?:COMP|COMPONENT)-/i.test(item))) return `${value.length} linked components`;
    if (ids.length === value.length && ids.every(item => /^(?:APTEM-|MOD-|GROUP-|COMP(?:ONENT)?-|WEEK-)/i.test(item))) return `${value.length} linked records`;
    try { return JSON.stringify(value); } catch { return '[value unavailable]'; }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return auditValueLabel(JSON.parse(trimmed)); } catch { /* keep the original text */ }
    }
    if (/^(?:APTEM-)?GROUP-/i.test(trimmed)) return 'Internal group reference';
    if (/^(?:APTEM-)?MOD-/i.test(trimmed)) return 'Internal module reference';
    if (/^(?:APTEM-)?(?:COMP|COMPONENT)-/i.test(trimmed)) return 'Internal component reference';
    if (/^APTEM-/i.test(trimmed)) return 'Internal record reference';
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

export function auditModuleIds(value: unknown): string[] {
  return (parseAuditList(value) || [])
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * Uses the friendly name field recorded in the same save when an audit event
 * also contains a technical ID field. The ID remains available through the
 * value tooltip, while the visible value is useful to a person reading the
 * history.
 */
export function auditFieldValueLabel(
  fieldLabel: string,
  value: unknown,
  fields: AuditFieldValue[],
  side: 'before' | 'after',
  moduleTitles?: ReadonlyMap<string, string>,
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
  if (/module\s+ids?/i.test(fieldLabel) && moduleTitles) {
    const ids = parseAuditList(value)?.filter(item => typeof item === 'string') as string[] | undefined;
    const titles = ids?.map(id => moduleTitles.get(id.trim().toLowerCase())).filter(Boolean) as string[] | undefined;
    if (titles?.length) return titles.join(', ');
  }
  return auditValueLabel(value);
}

export function auditValueTitle(value: unknown): string {
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
  if (archived && moduleId) {
    const params = new URLSearchParams({ view: 'archive', archiveModule: moduleId });
    return `/curriculum/module-builder?${params.toString()}`;
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

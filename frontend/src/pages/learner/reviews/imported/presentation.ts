import type { ImportedReviewField, ImportedReviewSection } from '@/api/reviewHistory';
import type { ReviewFieldDefinition, ReviewSectionDefinition } from '@/api/reviewInstances';

export const keyOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
export const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const labels: Record<string, string> = {
  programmestartdate: 'Programme Start Date', programmeplannedenddate: 'Programme Planned End Date',
  learningplannedenddate: 'Learning Planned End Date', apprenticeshipenddate: 'Apprenticeship End Date',
  programmestatus: 'Programme Status', plannedstartdatetime: 'Planned Start Date and Time',
  plannedenddatetime: 'Planned End Date and Time', currentraglevel: 'Current RAG Level',
};

export function displayLabel(value: string): string {
  const label = value.trim().replace(/:$/, '');
  if (labels[keyOf(label)]) return labels[keyOf(label)];
  const spaced = label.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  const sentence = spaced === spaced.toUpperCase() && spaced.length > 6 ? spaced.toLowerCase() : spaced;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function isTechnical(label: string): boolean {
  // Explicit metadata only; numeric answers, business codes and assessment levels remain visible.
  return /^(id|.*Id|.*_id)$/.test(label) || /^(id|aptemreviewid|reviewid|learnerid|ownerid|eventkey|formeventkey|sourcekey|source|readonly|hasprevprogress|haspreprogress|progresstype|fundmodel|programtype|color|serializationmetadata)$/i.test(keyOf(label));
}

export function isEmpty(value: unknown): boolean {
  return value == null || (typeof value === 'string' && (!value.trim() || value === 'EMPTY_STRING'))
    || (Array.isArray(value) && value.length === 0) || (record(value) !== null && Object.keys(value as object).length === 0);
}

/** Calendar components are intentionally formatted verbatim: no browser timezone conversion. */
export function calendarLabel(value: string, withTime = false): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (m < 1 || m > 12 || d < 1 || d > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    || (hour && (Number(hour) > 23 || Number(minute) > 59))) return null;
  return `${day}/${month}/${year}${withTime && hour ? ` at ${hour}:${minute}` : ''}`;
}

export function decodeStructured(value: unknown): { value: unknown; malformed: boolean } {
  if (typeof value !== 'string' || !/^\s*(?:\{\s*["}]|\[\s*(?:[\[\{"\]\d-]|true\b|false\b|null\b))/.test(value)) return { value, malformed: false };
  try { return { value: JSON.parse(value), malformed: false }; }
  catch { return { value: null, malformed: true }; }
}

export function numberValue(value: unknown): number | null {
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
const numeric = (item: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) { const n = numberValue(item[key]); if (n !== null) return n; }
  return null;
};
export const percentage = (current: number | null, total: number | null) => current !== null && total !== null && total > 0 ? current / total * 100 : null;

export type ProgressCard =
  | { kind: 'activities'; completed: number | null; submitted: number | null; remaining: number | null; total: number | null; target: number | null }
  | { kind: 'standard'; title: string; current: number | null; target: number | null; max: number | null; status: 'Behind' | 'On track' | 'Ahead' | null }
  | { kind: 'hours'; minimum: number | null; planned: number | null; completed: number | null; forecast: number | null; percentage: number | null }
  | { kind: 'timeline'; dates: { label: string; value: string }[] }
  | { kind: 'other'; value: unknown };

export function normalizeImportedProgress(raw: unknown): ProgressCard[] {
  const decoded = decodeStructured(raw);
  if (decoded.malformed || isEmpty(decoded.value)) return [];
  const object = record(decoded.value);
  const items = Array.isArray(decoded.value) ? decoded.value : object?.progress && Array.isArray(object.progress) ? object.progress : object ? [object] : [];
  return items.flatMap((value): ProgressCard[] => {
    const item = record(value);
    if (!item) return [{ kind: 'other', value }];
    const type = numberValue(item.progressType);
    if (type === 2 || ('completedCount' in item && 'totalCount' in item)) {
      const completed = numeric(item, 'completedCount');
      const submitted = numeric(item, 'submittedCount', 'submitted');
      const total = numeric(item, 'totalCount', 'max');
      // An absent submitted count is unknown, not zero. The source's remaining
      // activities include everything not completed, matching its completed/total ring.
      const remaining = numeric(item, 'remainingCount') ?? (total !== null && completed !== null ? Math.max(0, total - completed - (submitted ?? 0)) : null);
      return [{ kind: 'activities', completed, submitted, total, remaining, target: numeric(item, 'targetCount', 'target') }];
    }
    if (type === 4) {
      const current = numeric(item, 'current'), target = numeric(item, 'target', 'minTarget');
      return [{ kind: 'standard', title: typeof item.title === 'string' ? item.title : 'Programme progress', current, target, max: numeric(item, 'max'),
        status: current === null || target === null ? null : current < target ? 'Behind' : current > target ? 'Ahead' : 'On track' }];
    }
    if (type === 6 || 'completedTime' in item) {
      // Aptem *Time metrics are minutes (57394 / 60 = 956.57h); plannedHours is hours.
      const hours = (key: string) => { const n = numeric(item, key); return n === null ? null : n / 60; };
      const completed = hours('completedTime') ?? hours('current'), planned = numeric(item, 'plannedHours');
      return [{ kind: 'hours', completed, planned, minimum: hours('minimumRequiredTime'), forecast: hours('forecastTime'), percentage: percentage(completed, planned) }];
    }
    if (type === 7 || 'startDate' in item) {
      const dates = [['Programme start', 'startDate'], ['Review snapshot', 'currentDate'], ['Gateway / planned end', 'plannedEndDate'], ['Apprenticeship end', 'expectedEndDate']]
        .flatMap(([label, key]) => typeof item[key] === 'string' && calendarLabel(item[key] as string) ? [{ label, value: item[key] as string }] : []);
      return [{ kind: 'timeline', dates }];
    }
    return [{ kind: 'other', value: item }];
  });
}

export interface PresentationField extends ImportedReviewField { required?: boolean; fieldType?: string }
export interface PresentationSection { name: string; fields: PresentationField[]; tables: unknown[][][]; rawText: string }

export function adaptHistorySection(section: ImportedReviewSection): PresentationSection {
  return { name: section.name, fields: section.fields, tables: section.tables.map(table => table.rows || []), rawText: section.rawText };
}

export function adaptDefinitionSection(section: ReviewSectionDefinition, answers: Record<string, unknown>): PresentationSection {
  const fields: PresentationField[] = [], tables: unknown[][][] = [];
  let rawText = '';
  section.fields.forEach((field: ReviewFieldDefinition) => {
    const config = field.configuration;
    if (config.importedTable) {
      const rows = decodeStructured(config.importedTable).value;
      if (Array.isArray(rows)) tables.push(rows);
    } else if (field.id.startsWith('aptem-text:')) {
      rawText = typeof config.description === 'string' ? config.description : '';
    } else {
      fields.push({ label: field.title, value: Object.prototype.hasOwnProperty.call(answers, field.id) ? answers[field.id] : field.answer ?? (field.fieldType === 'title_description' ? config.description : undefined),
        description: field.fieldType === 'title_description' ? undefined : typeof config.description === 'string' ? config.description : undefined,
        required: field.required, fieldType: field.fieldType });
    }
  });
  return { name: section.title, fields, tables, rawText };
}

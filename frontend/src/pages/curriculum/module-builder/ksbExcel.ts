import { makeAuthoringId, type KsbMapping, type KsbWeightClass, type ModuleCatalogueItem, type ModuleComponent } from './moduleAuthoringData';
import type { KsbMappingType } from './componentAuthoringModel';

// The round-trip contract between the Module Builder and ChatGPT.
//
// We export one row per component — its title and description are what ChatGPT
// reads to decide the KSBs — and the operator pastes codes back into the `KSBs`
// column, then re-uploads the same file. `Component ID` is the join key that
// survives the trip. Across copies, a unique week/title/type match may be
// suggested, but only applied after review. Row position is never a join key.
const DATA_SHEET = 'Components';
const GUIDE_SHEET = 'How to fill';

const COL_WEEK = 'Week';
const COL_WEEK_TITLE = 'Week Title';
const COL_COMPONENT_ID = 'Component ID';
const COL_TYPE = 'Type';
const COL_TITLE = 'Component Title';
const COL_DESCRIPTION = 'Description';
const COL_CURRENT = 'Current KSBs';
const COL_KSBS = 'KSBs';

/** A single KSB the operator (or ChatGPT) wrote into the `KSBs` cell. */
interface ParsedKsb {
  code: string;
  type: KsbMappingType;
  weight: number;
}

export interface KsbImportSummary {
  /** Rows in the sheet that carried at least one KSB code. */
  rowsWithKsbs: number;
  /** Components updated by ID or by a reviewed, unambiguous suggestion. */
  componentsUpdated: number;
  /** Total KSB codes applied across all matched components. */
  codesApplied: number;
  /** Filled `Component ID`s the module no longer has (deleted since export). */
  unmatchedIds: string[];
  /** Malformed tokens skipped, e.g. `X9` or an empty code. */
  skippedTokens: string[];
  /** Rows skipped because their identity or destination was not unique. */
  ambiguousIds?: string[];
  suggestedMatches?: number;
}

export interface KsbImportResult {
  module: ModuleCatalogueItem;
  summary: KsbImportSummary;
  cancelled?: boolean;
}

interface KsbWorkbookRow {
  rowNumber: number;
  sourceId: string;
  weekNumber: string;
  weekTitle: string;
  title: string;
  type: string;
  ksbs: ParsedKsb[];
}

export interface KsbImportPreviewRow extends KsbWorkbookRow {
  status: 'id' | 'suggested' | 'ambiguous' | 'unmatched';
  target?: {
    componentId: string;
    weekNumber: string;
    weekTitle: string;
    title: string;
    type: string;
    currentKsbs: string;
  };
}

export interface KsbImportPreview {
  rows: KsbImportPreviewRow[];
  skippedTokens: string[];
}

interface KsbImportOptions {
  /** Without a reviewer, import only exact IDs; suggestions never auto-apply. */
  review?: (preview: KsbImportPreview) => Promise<boolean>;
  /** Abort if the destination changed while reading the file or reviewing it. */
  isCurrent?: () => boolean;
  /** A standalone week has a title but no module week number. */
  weekTitle?: string;
}

/** The KSB source the imported sheet was authored against. */
export interface KsbImportSource {
  sourceType: string;
  sourceId: string;
  /** Codes exposed by the selected source. Imported rows are restricted to this list. */
  allowedCodes?: string[];
}

/** One KSB available to map — the profile ChatGPT must map strictly within. */
export interface KsbProfileEntry {
  code: string;
  description: string;
  /** 'knowledge' | 'skill' | 'behaviour', or a K/S/B prefix — either is accepted. */
  type?: string;
}

const KSB_GROUPS: Array<{ prefix: string; heading: string }> = [
  { prefix: 'K', heading: 'KNOWLEDGE (K)' },
  { prefix: 'S', heading: 'SKILLS (S)' },
  { prefix: 'B', heading: 'BEHAVIOURS (B)' },
];

// Sort K1, K2, K10 numerically rather than lexically so the profile reads in the
// order a person expects, and K1.2 sits under K1.
function compareKsbCodes(a: string, b: string): number {
  const na = a.replace(/[^0-9.]/g, '').split('.').map(Number);
  const nb = b.replace(/[^0-9.]/g, '').split('.').map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i += 1) {
    const diff = (na[i] || 0) - (nb[i] || 0);
    if (diff) return diff;
  }
  return a.localeCompare(b);
}

function formatProfile(profile: KsbProfileEntry[]): string {
  const byPrefix = new Map<string, KsbProfileEntry[]>();
  for (const entry of profile) {
    const prefix = (entry.code || '').trim().charAt(0).toUpperCase();
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix)!.push(entry);
  }
  const sections = KSB_GROUPS.flatMap(({ prefix, heading }) => {
    const entries = (byPrefix.get(prefix) || []).slice().sort((a, b) => compareKsbCodes(a.code, b.code));
    if (!entries.length) return [];
    const lines = entries.map(entry => `  ${entry.code.trim().toUpperCase()} — ${entry.description.trim()}`);
    return [`${heading}\n${lines.join('\n')}`];
  });
  return sections.join('\n\n');
}

/**
 * The instruction a curriculum worker pastes into ChatGPT alongside the exported
 * sheet. It pins the exact profile ChatGPT may map within, the cell format the
 * importer parses back, and the classification/weight behaviour — so the file
 * that returns imports cleanly and maps only codes this standard actually has.
 */
export function buildKsbMappingPrompt(context: { title: string; profile: KsbProfileEntry[] }): string {
  const profile = context.profile.filter(entry => (entry.code || '').trim() && (entry.description || '').trim());
  const label = context.title.trim() || 'this module';
  const profileBlock = profile.length
    ? formatProfile(profile)
    : '(No KSB profile was attached to this module. Use ONLY the KSB codes that already appear in the sheet\'s "Current KSBs" column, and do not invent new ones.)';

  return `You are an expert UK apprenticeship curriculum designer. Your job is to map Knowledge, Skills and Behaviours (KSBs) to each learning component of "${label}".

I will give you a spreadsheet (also pasted below or attached). Each row is one learning component with a "${COL_TITLE}" and a "${COL_DESCRIPTION}". Read both and decide which KSBs that component genuinely develops or assesses.

═══════════════════════════════════════
ALLOWED KSBs — MAP STRICTLY WITHIN THIS LIST
═══════════════════════════════════════
Use ONLY the codes below. Never invent a code, never use a code that is not in this list, and never change a code's meaning.

${profileBlock}

═══════════════════════════════════════
HOW TO FILL THE SHEET
═══════════════════════════════════════
1. The "${COL_KSBS}" column is PRE-FILLED with each component's current KSBs. KEEP every current code that appears in the allowed list above and ADD any new applicable codes. REMOVE any current code that is not in the allowed list, even if it appears in the sheet. Only remove an allowed code if it genuinely does NOT apply to that component. Edit ONLY this column — leave every other column exactly as it is.
2. NEVER edit the "${COL_COMPONENT_ID}" column — each row is matched back to its component by that id. Do not add, remove, reorder, or renumber rows.
3. Each code in the "${COL_KSBS}" cell is written, separated by commas, as:
      CODE:classification:weight
   • CODE — copy a code from the allowed list above exactly, including every period. K1.1 and K11 are different codes: never remove a period, join digits, rewrite, or "simplify" a code.
   • classification — one of: main, secondary, possible.
   • weight — a whole number 0–100 for how strongly this component develops that KSB.
   Example cell: K1:main:40, S3.2:secondary:20, B2:possible:10
4. Classification & weight guidance:
   • main (weight ~40) — the component directly teaches or assesses this KSB; it is a core focus.
   • secondary (weight ~20) — the KSB is practised or reinforced, but is not the main focus.
   • possible (weight ~10) — the KSB is lightly touched or optional.
5. Keep it precise: most components map to 2–6 KSBs total (the ones already there plus any you add). Do not over-map — only include a KSB if the title/description clearly supports it. Copy every selected code exactly as written in the allowed list, including dotted child codes such as K1.1.
6. If a component's current KSBs are already correct and nothing needs adding, leave its "${COL_KSBS}" cell exactly as it is. A component with no applicable KSB keeps an empty cell.
7. Balance across the whole module: aim to give every KSB in the list at least one "main" mapping somewhere if the content supports it, so the standard is fully covered.

═══════════════════════════════════════
OUTPUT
═══════════════════════════════════════
Return the SAME spreadsheet with the "${COL_KSBS}" column updated — the pre-filled codes kept, plus any you added — in the same row order, ready to download as .xlsx (or .csv). Do not add commentary in the sheet. After the file, give a short summary of any codes you added or removed and why.`;
}

/** A one-line summary of what an import changed, for a toast or status line. */
export function describeKsbImport(summary: KsbImportSummary): string {
  const parts = [`Applied ${summary.codesApplied} KSB code${summary.codesApplied === 1 ? '' : 's'} across ${summary.componentsUpdated} component${summary.componentsUpdated === 1 ? '' : 's'}.`];
  if (summary.unmatchedIds.length) parts.push(`${summary.unmatchedIds.length} row${summary.unmatchedIds.length === 1 ? '' : 's'} matched no component uniquely here and ${summary.unmatchedIds.length === 1 ? 'was' : 'were'} skipped.`);
  if (summary.ambiguousIds?.length) parts.push(`${summary.ambiguousIds.length} skipped rows had duplicate IDs or conflicting matches.`);
  if (summary.suggestedMatches) parts.push(`${summary.suggestedMatches} components were matched by week, title and type after review.`);
  if (summary.skippedTokens.length) parts.push(`Ignored ${summary.skippedTokens.length} invalid code${summary.skippedTokens.length === 1 ? '' : 's'}: ${summary.skippedTokens.slice(0, 8).join(', ')}${summary.skippedTokens.length > 8 ? '…' : ''}.`);
  parts.push(summary.componentsUpdated ? 'Review the mappings, then save to persist them.' : 'No components were changed. Export a sheet from this destination or review the week, title and type columns.');
  return parts.join(' ');
}

export function ksbImportNotice(summary: KsbImportSummary): { title: string; text: string; icon: 'warning' | 'success' } {
  const warning = !summary.codesApplied || !summary.componentsUpdated || summary.unmatchedIds.length > 0 || summary.skippedTokens.length > 0;
  return {
    title: !summary.codesApplied ? 'No KSB codes applied' : warning ? 'KSB sheet partially imported' : 'KSB sheet imported',
    text: describeKsbImport(summary),
    icon: warning ? 'warning' : 'success',
  };
}

// main → hard, possible → possible, everything else soft: the same mapping the
// authoring model uses so an imported KSB is indistinguishable from a hand-added
// one after normalisation.
function weightClassForType(type: KsbMappingType): KsbWeightClass {
  if (type === 'main') return 'hard';
  if (type === 'possible') return 'possible';
  return 'soft';
}

function defaultWeightForType(type: KsbMappingType): number {
  if (type === 'main') return 40;
  if (type === 'secondary') return 20;
  return 10;
}

function normaliseType(value: string): KsbMappingType {
  const raw = value.trim().toLowerCase();
  if (raw === 'main' || raw === 'secondary' || raw === 'possible') return raw;
  if (raw === 'practice') return 'possible';
  return 'main';
}

// A KSB code is one letter K/S/B and a dotted number: K1, S3.2, B12. ChatGPT is
// asked to separate codes with commas, but people paste newlines, spaces and
// semicolons too, so any run of those splits the cell. `:type:weight` after a
// code is optional — `K1:secondary:20` — and falls back to a main mapping when
// omitted. A code never contains whitespace, so splitting on it is always safe.
function parseKsbCell(cell: string, skipped: string[]): ParsedKsb[] {
  const seen = new Set<string>();
  const parsed: ParsedKsb[] = [];
  for (const token of cell.split(/[\s,;]+/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const [rawCode, rawType, rawWeight] = trimmed.split(':');
    const code = rawCode.trim().toUpperCase();
    if (!/^[KSB]\d+(\.\d+)*$/.test(code)) {
      skipped.push(trimmed);
      continue;
    }
    if (seen.has(code)) continue;
    seen.add(code);
    const type = rawType ? normaliseType(rawType) : 'main';
    // Clamp to the 0–100 the app's KSB weights live in, so a stray "200" or a
    // negative from the sheet can't produce an out-of-range mapping.
    const weight = rawWeight && Number.isFinite(Number(rawWeight))
      ? Math.min(100, Math.max(0, Number(rawWeight)))
      : defaultWeightForType(type);
    parsed.push({ code, type, weight });
  }
  return parsed;
}

function componentCurrentCodes(mappings: KsbMapping[]): string {
  return mappings.map(mapping => mapping.code).filter(Boolean).join(', ');
}

// The editable `KSBs` column ships PRE-FILLED with the component's current
// mappings, written in the exact `CODE:type:weight` format the importer parses
// back. Because a filled row replaces the component outright on import, shipping
// the current set in the cell means keeping a code is the default and the sheet
// always carries the whole truth — the operator (or ChatGPT) edits only to add
// or remove, and existing KSBs are never silently dropped.
function componentCurrentCells(mappings: KsbMapping[]): string {
  return mappings
    .filter(mapping => mapping.code)
    .map(mapping => {
      const type = normaliseType(mapping.type || mapping.classification || 'main');
      const weight = Number.isFinite(mapping.weight) ? mapping.weight : defaultWeightForType(type);
      return `${mapping.code}:${type}:${weight}`;
    })
    .join(', ');
}

function slugify(value: string, fallback: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/** One export row — a component with the week it lives in for context. */
interface ExportRow {
  weekNumber: number | '';
  weekTitle: string;
  component: ModuleComponent;
}

// The whole write path — build the workbook, its guide sheet, and save it. Both
// the module and single-week exports funnel through here so the sheet layout and
// the ChatGPT instructions stay identical whichever screen produced the file.
async function writeKsbWorkbook(rows: ExportRow[], fileNameBase: string): Promise<{ rows: number; fileName: string }> {
  const XLSX = await import('xlsx');
  const data = rows.map(({ weekNumber, weekTitle, component }) => ({
    [COL_WEEK]: weekNumber,
    [COL_WEEK_TITLE]: weekTitle,
    [COL_COMPONENT_ID]: component.id,
    [COL_TYPE]: component.type,
    [COL_TITLE]: component.title,
    [COL_DESCRIPTION]: component.description || '',
    [COL_CURRENT]: componentCurrentCodes(component.ksbMappings),
    [COL_KSBS]: componentCurrentCells(component.ksbMappings),
  }));

  const dataSheet = XLSX.utils.json_to_sheet(data, {
    header: [COL_WEEK, COL_WEEK_TITLE, COL_COMPONENT_ID, COL_TYPE, COL_TITLE, COL_DESCRIPTION, COL_CURRENT, COL_KSBS],
  });
  dataSheet['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 26 }, { wch: 16 }, { wch: 34 }, { wch: 60 }, { wch: 20 }, { wch: 28 }];

  const guide = XLSX.utils.aoa_to_sheet([
    ['How to fill this sheet'],
    [''],
    [`1. Read each component's "${COL_TITLE}" and "${COL_DESCRIPTION}".`],
    [`2. The "${COL_KSBS}" column is PRE-FILLED with the component's current KSBs. Keep codes from the allowed list, remove codes outside that list, and add any new applicable codes — e.g. K1, S3.2, B2.`],
    ['3. Each code is written as CODE:type:weight — e.g. K1:main:40, K1.1:secondary:20, S3:secondary:20. Preserve periods exactly: K1.1 is not K11. Types are main, secondary or possible; weight is 0-100. Omit them to default to a main mapping.'],
    ['4. Remove an allowed code only if it genuinely does not apply. A blank cell removes all mappings for that component when imported, so leave the cell unchanged if it should keep its current valid KSBs.'],
    [`5. Do NOT edit the "${COL_COMPONENT_ID}" column — rows are matched back to components by that id.`],
    ['6. Save and re-upload this file where you exported it from.'],
  ]);
  guide['!cols'] = [{ wch: 110 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, DATA_SHEET);
  XLSX.utils.book_append_sheet(workbook, guide, GUIDE_SHEET);

  const fileName = `${fileNameBase}-ksb-mapping.xlsx`;
  XLSX.writeFile(workbook, fileName, { compression: true });
  return { rows: data.length, fileName };
}

// Keep individual rows and their context: duplicates must remain visible rather
// than silently becoming a last-row-wins overwrite.
async function readKsbWorkbook(file: File, source?: KsbImportSource): Promise<{ rows: KsbWorkbookRow[]; skippedTokens: string[] }> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames.includes(DATA_SHEET) ? DATA_SHEET : workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '' });

  // Guard against the wrong file: a sheet with data rows but no "Component ID"
  // column can't be a KSB mapping sheet (a picture, a different export, a random
  // spreadsheet). Fail loudly here rather than silently importing zero KSBs,
  // which reads as "the sheet was empty" and hides the real mistake.
  if (rows.length && !(COL_COMPONENT_ID in rows[0])) {
    throw new Error(`This file doesn't look like a KSB mapping sheet — it has no "${COL_COMPONENT_ID}" column. Export the sheet from here, fill the "${COL_KSBS}" column, then re-upload that same file.`);
  }

  const skippedTokens: string[] = [];
  const filledRows: KsbWorkbookRow[] = [];
  const allowedCodes = source?.allowedCodes
    ? new Set(source.allowedCodes.map(code => code.trim().toUpperCase()).filter(Boolean))
    : null;
  for (const [index, row] of rows.entries()) {
    const id = String(row[COL_COMPONENT_ID] ?? '').trim();
    const cell = String(row[COL_KSBS] ?? '').trim();
    if (!id || !cell) continue;
    const parsed = parseKsbCell(cell, skippedTokens);
    const valid = allowedCodes
      ? parsed.filter(item => {
        if (allowedCodes.has(item.code.trim().toUpperCase())) return true;
        skippedTokens.push(`${item.code} (not in selected KSB source)`);
        return false;
      })
      : parsed;
    // Keep a filled row even when all codes were invalid. Applying an empty
    // result clears stale mappings instead of leaving them to fail on save.
    filledRows.push({
      rowNumber: typeof row.__rowNum__ === 'number' ? row.__rowNum__ + 1 : index + 2,
      sourceId: id,
      weekNumber: String(row[COL_WEEK] ?? '').trim(),
      weekTitle: String(row[COL_WEEK_TITLE] ?? '').trim(),
      title: String(row[COL_TITLE] ?? '').trim(),
      type: String(row[COL_TYPE] ?? '').trim(),
      ksbs: valid,
    });
  }
  return { rows: filledRows, skippedTokens };
}

function matchText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function matchesContext(row: KsbWorkbookRow, target: ExportRow): boolean {
  if (!row.title || !row.type || (!row.weekNumber && !row.weekTitle)) return false;
  if (matchText(row.title) !== matchText(target.component.title) || matchText(row.type) !== matchText(target.component.type)) return false;
  if (row.weekNumber) {
    const number = Number(row.weekNumber);
    if (!Number.isInteger(number) || number < 1 || number !== target.weekNumber) return false;
  }
  return !row.weekTitle || matchText(row.weekTitle) === matchText(target.weekTitle);
}

function planKsbImport(rows: KsbWorkbookRow[], targets: ExportRow[]): KsbImportPreviewRow[] {
  const idCounts = new Map<string, number>();
  rows.forEach(row => idCounts.set(row.sourceId, (idCounts.get(row.sourceId) || 0) + 1));
  const exactIds = new Set(rows.map(row => row.sourceId));
  const planned = rows.map((row): KsbImportPreviewRow => {
    if (idCounts.get(row.sourceId)! > 1) return { ...row, status: 'ambiguous' };
    const exact = targets.filter(target => target.component.id === row.sourceId);
    const candidates = exact.length ? exact : targets.filter(target => matchesContext(row, target));
    if (!candidates.length) return { ...row, status: 'unmatched' };
    if (candidates.length !== 1 || (!exact.length && exactIds.has(candidates[0].component.id))) {
      return { ...row, status: 'ambiguous' };
    }
    const { component, weekNumber, weekTitle } = candidates[0];
    return {
      ...row,
      status: exact.length ? 'id' : 'suggested',
      target: {
        componentId: component.id,
        weekNumber: String(weekNumber),
        weekTitle,
        title: component.title,
        type: component.type,
        currentKsbs: componentCurrentCells(component.ksbMappings),
      },
    };
  });
  const claims = new Map<string, number>();
  planned.forEach(row => {
    if (row.target) claims.set(row.target.componentId, (claims.get(row.target.componentId) || 0) + 1);
  });
  return planned.map(row => row.target && claims.get(row.target.componentId)! > 1
    ? { ...row, target: undefined, status: 'ambiguous' }
    : row);
}

async function resolveKsbImport(file: File, targets: ExportRow[], source: KsbImportSource | undefined, options: KsbImportOptions) {
  const { rows, skippedTokens } = await readKsbWorkbook(file, source);
  const planned = planKsbImport(rows, targets);
  const assertCurrent = () => {
    if (options.isCurrent && !options.isCurrent()) {
      throw new Error('The destination changed while the KSB sheet was being reviewed. Import the file again to review the latest content.');
    }
  };
  assertCurrent();
  const needsReview = Boolean(options.review && planned.some(row => row.status !== 'id'));
  const cancelled = needsReview && !(await options.review!({ rows: planned, skippedTokens }));
  if (!cancelled) assertCurrent();
  const accepted = cancelled ? [] : planned.filter(row => row.status === 'id' || (needsReview && row.status === 'suggested'));
  const byId = new Map(accepted.map(row => [row.target!.componentId, row.ksbs]));
  const acceptedRows = new Set(accepted);
  const summary: KsbImportSummary = {
    rowsWithKsbs: rows.length,
    componentsUpdated: byId.size,
    codesApplied: accepted.reduce((count, row) => count + row.ksbs.length, 0),
    unmatchedIds: planned.filter(row => !acceptedRows.has(row)).map(row => row.sourceId),
    skippedTokens,
    ambiguousIds: planned.filter(row => row.status === 'ambiguous').map(row => row.sourceId),
    suggestedMatches: accepted.filter(row => row.status === 'suggested').length,
  };
  return { byId, summary, cancelled };
}

// Fold parsed KSBs onto one component. A filled row replaces the component's KSB
// mappings outright — the sheet is the AI's complete answer for that component,
// not an addition. The definition of any code the component already carried is
// kept, so re-importing never blanks descriptions the source had filled in.
function normaliseSource(source?: Pick<KsbMapping, 'sourceType' | 'sourceId'>) {
  let sourceType = String(source?.sourceType || '').trim().toLowerCase();
  let sourceId = String(source?.sourceId || '').trim();
  const separator = sourceId.indexOf(':');
  if (separator > 0) {
    const prefix = sourceId.slice(0, separator).toLowerCase();
    if (prefix === 'standard' || prefix === 'profile' || prefix === 'framework') {
      sourceType = prefix === 'standard' ? 'standard' : 'framework';
      sourceId = sourceId.slice(separator + 1).trim();
    }
  }
  if (sourceType === 'profile') sourceType = 'framework';
  return { sourceType, sourceId };
}

function sameSource(left?: Pick<KsbMapping, 'sourceType' | 'sourceId'>, right?: KsbImportSource) {
  if (!left || !right) return false;
  const a = normaliseSource(left);
  const b = normaliseSource(right);
  return a.sourceType === b.sourceType && a.sourceId.toLowerCase() === b.sourceId.toLowerCase();
}

function applyParsedToComponent(component: ModuleComponent, parsed: ParsedKsb[], source?: KsbImportSource): ModuleComponent {
  const existing = new Map(component.ksbMappings.map(mapping => [mapping.code, mapping]));
  const ksbMappings: KsbMapping[] = parsed.map(item => {
    const prior = existing.get(item.code);
    const weightClass = weightClassForType(item.type);
    const sourceMatches = !source || sameSource(prior, source);
    return {
      id: makeAuthoringId('ksb'),
      // A workbook is generated for one selected source. Never carry a stored
      // KSB id from another source into the imported mapping.
      ksbId: sourceMatches ? prior?.ksbId || '' : '',
      code: item.code,
      description: prior?.description || '',
      sourceType: source?.sourceType || prior?.sourceType,
      sourceId: source?.sourceId || prior?.sourceId,
      type: item.type,
      classification: item.type,
      weight: item.weight,
      weightClass,
      weight_class: weightClass,
    };
  });
  return { ...component, ksbMappings };
}

/**
 * Download the module as a KSB-authoring workbook: one row per component across
 * every week, plus a guide sheet. xlsx (~420 kB) is imported inside the shared
 * writer, so it never lands in the Module Builder's initial bundle.
 */
export function exportModuleKsbWorkbook(module: ModuleCatalogueItem, options: { fileNameSuffix?: string } = {}): Promise<{ rows: number; fileName: string }> {
  const rows = module.weekStructure.flatMap(week =>
    week.components.map(component => ({ weekNumber: week.weekNumber, weekTitle: week.title, component })),
  );
  return writeKsbWorkbook(rows, `${slugify(module.title, 'module')}${options.fileNameSuffix || ''}`);
}

/** Apply a filled sheet back onto the module's components, matching by id. */
export async function importModuleKsbWorkbook(file: File, module: ModuleCatalogueItem, source?: KsbImportSource, options: KsbImportOptions = {}): Promise<KsbImportResult> {
  const targets = module.weekStructure.flatMap(week => week.components.map(component => ({ weekNumber: week.weekNumber, weekTitle: week.title, component })));
  const { byId, summary, cancelled } = await resolveKsbImport(file, targets, source, options);
  if (!byId.size) return { module, summary, cancelled };
  const weekStructure = module.weekStructure.map(week => ({
    ...week,
    components: week.components.map(component => {
      const parsed = byId.get(component.id);
      if (!parsed) return component;
      return applyParsedToComponent(component, parsed, source);
    }),
  }));

  return {
    module: { ...module, weekStructure },
    summary,
    cancelled,
  };
}

/** Download a single week's components as a KSB-authoring workbook. */
export function exportWeekKsbWorkbook(weekTitle: string, components: ModuleComponent[]): Promise<{ rows: number; fileName: string }> {
  const rows = components.map(component => ({ weekNumber: '' as const, weekTitle, component }));
  return writeKsbWorkbook(rows, slugify(weekTitle, 'week'));
}

/** Apply a filled sheet back onto a single week's components, matching by id. */
export async function importWeekKsbWorkbook(file: File, components: ModuleComponent[], source?: KsbImportSource, options: KsbImportOptions = {}): Promise<{ components: ModuleComponent[]; summary: KsbImportSummary; cancelled?: boolean }> {
  const targets = components.map(component => ({ weekNumber: '' as const, weekTitle: options.weekTitle || '', component }));
  const { byId, summary, cancelled } = await resolveKsbImport(file, targets, source, options);
  if (!byId.size) return { components, summary, cancelled };
  const next = components.map(component => {
    const parsed = byId.get(component.id);
    if (!parsed) return component;
    return applyParsedToComponent(component, parsed, source);
  });

  return {
    components: next,
    summary,
    cancelled,
  };
}

import { makeAuthoringId, type KsbMapping, type KsbWeightClass, type ModuleCatalogueItem, type ModuleComponent } from './moduleAuthoringData';
import type { KsbMappingType } from './componentAuthoringModel';

// The round-trip contract between the Module Builder and ChatGPT.
//
// We export one row per component — its title and description are what ChatGPT
// reads to decide the KSBs — and the operator pastes codes back into the `KSBs`
// column, then re-uploads the same file. `Component ID` is the join key that
// survives the trip: rows are matched on it, never on title (which ChatGPT may
// rephrase) or position (which a reordered sheet would break).
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
  /** Components in the module that a filled row matched by id. */
  componentsUpdated: number;
  /** Total KSB codes applied across all matched components. */
  codesApplied: number;
  /** Filled `Component ID`s the module no longer has (deleted since export). */
  unmatchedIds: string[];
  /** Malformed tokens skipped, e.g. `X9` or an empty code. */
  skippedTokens: string[];
}

export interface KsbImportResult {
  module: ModuleCatalogueItem;
  summary: KsbImportSummary;
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
1. The "${COL_KSBS}" column is PRE-FILLED with each component's current KSBs. KEEP every code that is already there and ADD any new applicable codes. Only remove a code if it genuinely does NOT apply to that component. Edit ONLY this column — leave every other column exactly as it is.
2. NEVER edit the "${COL_COMPONENT_ID}" column — each row is matched back to its component by that id. Do not add, remove, reorder, or renumber rows.
3. Each code in the "${COL_KSBS}" cell is written, separated by commas, as:
      CODE:classification:weight
   • CODE — a code from the allowed list above (e.g. K1, S3.2, B2).
   • classification — one of: main, secondary, possible.
   • weight — a whole number 0–100 for how strongly this component develops that KSB.
   Example cell: K1:main:40, S3.2:secondary:20, B2:possible:10
4. Classification & weight guidance:
   • main (weight ~40) — the component directly teaches or assesses this KSB; it is a core focus.
   • secondary (weight ~20) — the KSB is practised or reinforced, but is not the main focus.
   • possible (weight ~10) — the KSB is lightly touched or optional.
5. Keep it precise: most components map to 2–6 KSBs total (the ones already there plus any you add). Do not over-map — only include a KSB if the title/description clearly supports it.
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
  if (summary.unmatchedIds.length) parts.push(`${summary.unmatchedIds.length} row${summary.unmatchedIds.length === 1 ? '' : 's'} matched no component here (deleted since export, or the sheet is from a different module) and ${summary.unmatchedIds.length === 1 ? 'was' : 'were'} skipped.`);
  if (summary.skippedTokens.length) parts.push(`Ignored ${summary.skippedTokens.length} invalid code${summary.skippedTokens.length === 1 ? '' : 's'}: ${summary.skippedTokens.slice(0, 8).join(', ')}${summary.skippedTokens.length > 8 ? '…' : ''}.`);
  parts.push('Review the mappings, then save to persist them.');
  return parts.join(' ');
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
    [`2. The "${COL_KSBS}" column is PRE-FILLED with the component's current KSBs. Keep them and add any new codes that apply, separated by commas — e.g. K1, S3.2, B2.`],
    ['3. Each code is written as CODE:type:weight — e.g. K1:main:40, S3:secondary:20. Types are main, secondary or possible; weight is 0-100. Omit them to default to a main mapping.'],
    ['4. Only remove a code if it genuinely does not apply. A blank cell leaves that component unchanged, so keep the cell as it is to keep the current KSBs.'],
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

// The read path — parse the sheet into componentId → filled KSBs. Shared by the
// module and week imports; the caller decides which components to fold it onto.
async function readKsbWorkbook(file: File): Promise<{ byId: Map<string, ParsedKsb[]>; rowsWithKsbs: number; skippedTokens: string[] }> {
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
  const byId = new Map<string, ParsedKsb[]>();
  let rowsWithKsbs = 0;
  for (const row of rows) {
    const id = String(row[COL_COMPONENT_ID] ?? '').trim();
    const cell = String(row[COL_KSBS] ?? '').trim();
    if (!id || !cell) continue;
    const parsed = parseKsbCell(cell, skippedTokens);
    if (!parsed.length) continue;
    rowsWithKsbs += 1;
    byId.set(id, parsed);
  }
  return { byId, rowsWithKsbs, skippedTokens };
}

// Fold parsed KSBs onto one component. A filled row replaces the component's KSB
// mappings outright — the sheet is the AI's complete answer for that component,
// not an addition. The definition of any code the component already carried is
// kept, so re-importing never blanks descriptions the source had filled in.
function applyParsedToComponent(component: ModuleComponent, parsed: ParsedKsb[]): ModuleComponent {
  const existing = new Map(component.ksbMappings.map(mapping => [mapping.code, mapping]));
  const ksbMappings: KsbMapping[] = parsed.map(item => {
    const prior = existing.get(item.code);
    const weightClass = weightClassForType(item.type);
    return {
      id: makeAuthoringId('ksb'),
      ksbId: prior?.ksbId || '',
      code: item.code,
      description: prior?.description || '',
      sourceType: prior?.sourceType,
      sourceId: prior?.sourceId,
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
export function exportModuleKsbWorkbook(module: ModuleCatalogueItem): Promise<{ rows: number; fileName: string }> {
  const rows = module.weekStructure.flatMap(week =>
    week.components.map(component => ({ weekNumber: week.weekNumber, weekTitle: week.title, component })),
  );
  return writeKsbWorkbook(rows, slugify(module.title, 'module'));
}

/** Apply a filled sheet back onto the module's components, matching by id. */
export async function importModuleKsbWorkbook(file: File, module: ModuleCatalogueItem): Promise<KsbImportResult> {
  const { byId, rowsWithKsbs, skippedTokens } = await readKsbWorkbook(file);

  const matchedIds = new Set<string>();
  let componentsUpdated = 0;
  let codesApplied = 0;
  const weekStructure = module.weekStructure.map(week => ({
    ...week,
    components: week.components.map(component => {
      const parsed = byId.get(component.id);
      if (!parsed) return component;
      matchedIds.add(component.id);
      componentsUpdated += 1;
      codesApplied += parsed.length;
      return applyParsedToComponent(component, parsed);
    }),
  }));

  const unmatchedIds = [...byId.keys()].filter(id => !matchedIds.has(id));
  return {
    module: { ...module, weekStructure },
    summary: { rowsWithKsbs, componentsUpdated, codesApplied, unmatchedIds, skippedTokens },
  };
}

/** Download a single week's components as a KSB-authoring workbook. */
export function exportWeekKsbWorkbook(weekTitle: string, components: ModuleComponent[]): Promise<{ rows: number; fileName: string }> {
  const rows = components.map(component => ({ weekNumber: '' as const, weekTitle, component }));
  return writeKsbWorkbook(rows, slugify(weekTitle, 'week'));
}

/** Apply a filled sheet back onto a single week's components, matching by id. */
export async function importWeekKsbWorkbook(file: File, components: ModuleComponent[]): Promise<{ components: ModuleComponent[]; summary: KsbImportSummary }> {
  const { byId, rowsWithKsbs, skippedTokens } = await readKsbWorkbook(file);

  const matchedIds = new Set<string>();
  let componentsUpdated = 0;
  let codesApplied = 0;
  const next = components.map(component => {
    const parsed = byId.get(component.id);
    if (!parsed) return component;
    matchedIds.add(component.id);
    componentsUpdated += 1;
    codesApplied += parsed.length;
    return applyParsedToComponent(component, parsed);
  });

  const unmatchedIds = [...byId.keys()].filter(id => !matchedIds.has(id));
  return {
    components: next,
    summary: { rowsWithKsbs, componentsUpdated, codesApplied, unmatchedIds, skippedTokens },
  };
}

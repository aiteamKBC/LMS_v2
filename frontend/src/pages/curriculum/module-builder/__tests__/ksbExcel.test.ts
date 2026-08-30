import { describe, it, expect, vi, beforeEach } from 'vitest';

// The export path ends in XLSX.writeFile, which would hit the filesystem/DOM.
// Keep every other XLSX util real (tests build and read real workbooks) and spy
// only on writeFile so an export can be inspected without writing a file.
const writeFileMock = vi.fn();
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>();
  return { ...actual, writeFile: (...args: unknown[]) => writeFileMock(...args) };
});

import * as XLSX from 'xlsx';
import {
  buildKsbMappingPrompt,
  describeKsbImport,
  exportModuleKsbWorkbook,
  exportWeekKsbWorkbook,
  importModuleKsbWorkbook,
  importWeekKsbWorkbook,
  type KsbProfileEntry,
} from '../ksbExcel';
import type { KsbMapping, ModuleCatalogueItem, ModuleComponent, ModuleWeek } from '../moduleAuthoringData';

// --- builders ---------------------------------------------------------------

function mapping(code: string, extra: Partial<KsbMapping> = {}): KsbMapping {
  return {
    id: `KSBMAP-${code}`,
    ksbId: '',
    code,
    description: '',
    type: 'main',
    classification: 'main',
    weight: 40,
    weightClass: 'hard',
    ...extra,
  };
}

function component(id: string, extra: Partial<ModuleComponent> = {}): ModuleComponent {
  return {
    id,
    weekId: 'WEEK-1',
    type: 'reading',
    title: `Component ${id}`,
    description: `Description for ${id}`,
    expectedOtjh: 1,
    points: 10,
    reflectionRequired: false,
    // Required on ModuleComponent since the reflection question was added; empty
    // is the "no question authored" case these rows stand for.
    reflectionQuestion: '',
    workplaceEvidenceRequired: false,
    tutorValidationRequired: false,
    ksbMappings: [],
    settings: {} as ModuleComponent['settings'],
    ...extra,
  };
}

function week(weekNumber: number, components: ModuleComponent[], extra: Partial<ModuleWeek> = {}): ModuleWeek {
  return {
    id: `WEEK-${weekNumber}`,
    moduleId: 'MOD-1',
    weekNumber,
    title: `Week ${weekNumber}`,
    summary: '',
    learningOutcomes: [],
    components,
    ksbMappings: [],
    ...extra,
  };
}

function moduleWith(weekStructure: ModuleWeek[], title = 'Test Module'): ModuleCatalogueItem {
  return {
    id: 'MOD-1',
    catalogueId: 'MOD-1',
    programmeId: 'p1',
    programmeName: 'Programme',
    title,
    description: '',
    status: 'draft',
    weeks: weekStructure.length,
    totalOtjh: 0,
    ksbCount: 0,
    lessonCount: 0,
    quizCount: 0,
    qualityScore: 0,
    moduleKsbMappings: [],
    completionCriteria: {
      quizzesCompletedRequired: false,
      checkpointsCompletedRequired: false,
      averageScoreRequiredEnabled: false,
      averageScoreRequired: 70,
      totalScoreRequiredEnabled: false,
      totalScoreRequired: 100,
      additionalNotes: '',
    },
    advancedDetails: { intent: '', learnerBenefit: '', employerBenefit: '', sequencePurpose: '' },
    background: '',
    epaRequirements: [],
    qualificationOutcomes: [],
    weekStructure,
  };
}

/** Build a real .xlsx File whose rows carry a Component ID + KSBs cell. */
function sheetFile(rows: Array<Record<string, unknown>>, sheetName = 'Components'): File {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
  return new File([bytes], 'filled.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

beforeEach(() => writeFileMock.mockClear());

// --- buildKsbMappingPrompt --------------------------------------------------

describe('buildKsbMappingPrompt', () => {
  const profile: KsbProfileEntry[] = [
    { code: 'K10', description: 'Tenth knowledge', type: 'knowledge' },
    { code: 'K2', description: 'Second knowledge', type: 'knowledge' },
    { code: 'S1', description: 'First skill', type: 'skill' },
    { code: 'B1', description: 'First behaviour', type: 'behaviour' },
  ];

  it('lists the profile grouped by K/S/B with descriptions', () => {
    const prompt = buildKsbMappingPrompt({ title: 'Marketing', profile });
    expect(prompt).toContain('KNOWLEDGE (K)');
    expect(prompt).toContain('SKILLS (S)');
    expect(prompt).toContain('BEHAVIOURS (B)');
    expect(prompt).toContain('K2 — Second knowledge');
    expect(prompt).toContain('S1 — First skill');
    expect(prompt).toContain('Marketing');
  });

  it('sorts codes numerically, not lexically (K2 before K10)', () => {
    const prompt = buildKsbMappingPrompt({ title: 'M', profile });
    expect(prompt.indexOf('K2 —')).toBeLessThan(prompt.indexOf('K10 —'));
  });

  it('pins the cell format and protects the Component ID column', () => {
    const prompt = buildKsbMappingPrompt({ title: 'M', profile });
    expect(prompt).toContain('CODE:classification:weight');
    expect(prompt).toMatch(/NEVER edit the "Component ID"/i);
    expect(prompt).toMatch(/main|secondary|possible/);
  });

  it('falls back to the sheet’s Current KSBs when no profile is attached', () => {
    const prompt = buildKsbMappingPrompt({ title: '', profile: [] });
    expect(prompt).toContain('Current KSBs');
    expect(prompt).toContain('this module');
  });

  it('drops profile entries missing a code or description', () => {
    const prompt = buildKsbMappingPrompt({
      title: 'M',
      profile: [{ code: 'K1', description: '' }, { code: '', description: 'orphan' }, { code: 'K1', description: 'Real' }],
    });
    expect(prompt).toContain('K1 — Real');
    expect(prompt).not.toContain('orphan');
  });
});

// --- export -----------------------------------------------------------------

describe('exportModuleKsbWorkbook', () => {
  it('writes one row per component across weeks with the expected columns', async () => {
    const module = moduleWith([
      week(1, [component('C1', { title: 'Intro', description: 'Read this', ksbMappings: [mapping('K1'), mapping('S2')] })]),
      week(2, [component('C2', { weekId: 'WEEK-2', title: 'Deep dive', description: '' })]),
    ]);

    const result = await exportModuleKsbWorkbook(module);
    expect(result.rows).toBe(2);
    expect(result.fileName).toBe('test-module-ksb-mapping.xlsx');
    expect(writeFileMock).toHaveBeenCalledTimes(1);

    const workbook = writeFileMock.mock.calls[0][0] as XLSX.WorkBook;
    expect(workbook.SheetNames).toContain('Components');
    expect(workbook.SheetNames).toContain('How to fill');

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Components, { defval: '' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      Week: 1,
      'Week Title': 'Week 1',
      'Component ID': 'C1',
      Type: 'reading',
      'Component Title': 'Intro',
      Description: 'Read this',
      'Current KSBs': 'K1, S2',
      // The editable column ships pre-filled with the current mappings in the
      // CODE:type:weight format the importer reads, so nothing is lost by default.
      KSBs: 'K1:main:40, S2:main:40',
    });
    expect(rows[1]).toMatchObject({ Week: 2, 'Component ID': 'C2', 'Current KSBs': '', KSBs: '' });
  });

  it('pre-fills the KSBs column with each code\'s classification and weight', async () => {
    const module = moduleWith([week(1, [component('C1', {
      ksbMappings: [
        mapping('K1', { type: 'secondary', classification: 'secondary', weight: 25 }),
        mapping('S3', { type: 'possible', classification: 'possible', weight: 10 }),
      ],
    })])]);
    await exportModuleKsbWorkbook(module);
    const workbook = writeFileMock.mock.calls[0][0] as XLSX.WorkBook;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Components, { defval: '' });
    expect(rows[0].KSBs).toBe('K1:secondary:25, S3:possible:10');
  });

  it('reports zero rows for a module with no components', async () => {
    const result = await exportModuleKsbWorkbook(moduleWith([week(1, [])]));
    expect(result.rows).toBe(0);
  });
});

describe('exportWeekKsbWorkbook', () => {
  it('exports a single week’s components with a blank Week column', async () => {
    const result = await exportWeekKsbWorkbook('Onboarding Week', [component('C1'), component('C2')]);
    expect(result.rows).toBe(2);
    expect(result.fileName).toBe('onboarding-week-ksb-mapping.xlsx');
    const workbook = writeFileMock.mock.calls[0][0] as XLSX.WorkBook;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Components, { defval: '' });
    expect(rows[0].Week).toBe('');
    expect(rows[0]['Component ID']).toBe('C1');
  });
});

// --- import: module ---------------------------------------------------------

describe('importModuleKsbWorkbook', () => {
  const baseModule = () => moduleWith([
    week(1, [component('C1'), component('C2')]),
    week(2, [component('C3', { weekId: 'WEEK-2' })]),
  ]);

  it('applies filled KSBs to the matched component and leaves others untouched', async () => {
    const file = sheetFile([
      { 'Component ID': 'C1', KSBs: 'K1, S2' },
      { 'Component ID': 'C2', KSBs: '' },
      { 'Component ID': 'C3', KSBs: 'B1' },
    ]);
    const { module, summary } = await importModuleKsbWorkbook(file, baseModule());

    const c1 = module.weekStructure[0].components[0];
    const c2 = module.weekStructure[0].components[1];
    const c3 = module.weekStructure[1].components[0];
    expect(c1.ksbMappings.map(m => m.code)).toEqual(['K1', 'S2']);
    expect(c2.ksbMappings).toEqual([]); // empty cell → untouched
    expect(c3.ksbMappings.map(m => m.code)).toEqual(['B1']);

    expect(summary).toMatchObject({ rowsWithKsbs: 2, componentsUpdated: 2, codesApplied: 3, unmatchedIds: [], skippedTokens: [] });
  });

  it('replaces existing mappings but carries over the description of a kept code', async () => {
    const module = moduleWith([week(1, [component('C1', {
      ksbMappings: [mapping('K1', { description: 'Existing K1 definition', ksbId: 'ksb-99', sourceId: 'std:1', sourceType: 'standard' })],
    })])]);
    const file = sheetFile([{ 'Component ID': 'C1', KSBs: 'K1:secondary:25, S9' }]);
    const { module: next } = await importModuleKsbWorkbook(file, module);

    const [k1, s9] = next.weekStructure[0].components[0].ksbMappings;
    expect(k1).toMatchObject({ code: 'K1', description: 'Existing K1 definition', ksbId: 'ksb-99', sourceId: 'std:1', type: 'secondary', classification: 'secondary', weight: 25, weightClass: 'soft' });
    expect(s9).toMatchObject({ code: 'S9', description: '', type: 'main', weight: 40, weightClass: 'hard' });
  });

  it('parses classification and weight, defaulting when omitted', async () => {
    const file = sheetFile([{ 'Component ID': 'C1', KSBs: 'K1:main:40, S2:secondary:20, B3:possible:10, K4' }]);
    const { module } = await importModuleKsbWorkbook(file, baseModule());
    const mappings = module.weekStructure[0].components[0].ksbMappings;
    expect(mappings).toEqual([
      expect.objectContaining({ code: 'K1', type: 'main', weight: 40, weightClass: 'hard' }),
      expect.objectContaining({ code: 'S2', type: 'secondary', weight: 20, weightClass: 'soft' }),
      expect.objectContaining({ code: 'B3', type: 'possible', weight: 10, weightClass: 'possible' }),
      expect.objectContaining({ code: 'K4', type: 'main', weight: 40, weightClass: 'hard' }),
    ]);
  });

  it('splits on commas, spaces, newlines and semicolons alike', async () => {
    const file = sheetFile([{ 'Component ID': 'C1', KSBs: 'K1, S2 S3\nB4;K5' }]);
    const { module } = await importModuleKsbWorkbook(file, baseModule());
    expect(module.weekStructure[0].components[0].ksbMappings.map(m => m.code)).toEqual(['K1', 'S2', 'S3', 'B4', 'K5']);
  });

  it('uppercases codes and dedupes within a cell (first wins)', async () => {
    const file = sheetFile([{ 'Component ID': 'C1', KSBs: 'k1:secondary:20, K1:main:40, s2' }]);
    const { module } = await importModuleKsbWorkbook(file, baseModule());
    const mappings = module.weekStructure[0].components[0].ksbMappings;
    expect(mappings.map(m => m.code)).toEqual(['K1', 'S2']);
    expect(mappings[0]).toMatchObject({ type: 'secondary', weight: 20 });
  });

  it('skips invalid codes and reports them without dropping the valid ones', async () => {
    const file = sheetFile([{ 'Component ID': 'C1', KSBs: 'K1, X9, banana, S2, 42' }]);
    const { module, summary } = await importModuleKsbWorkbook(file, baseModule());
    expect(module.weekStructure[0].components[0].ksbMappings.map(m => m.code)).toEqual(['K1', 'S2']);
    expect(summary.skippedTokens).toEqual(['X9', 'banana', '42']);
    expect(summary.codesApplied).toBe(2);
  });

  it('clamps weights into 0–100', async () => {
    const file = sheetFile([{ 'Component ID': 'C1', KSBs: 'K1:main:250, S2:secondary:-5' }]);
    const { module } = await importModuleKsbWorkbook(file, baseModule());
    const mappings = module.weekStructure[0].components[0].ksbMappings;
    expect(mappings[0].weight).toBe(100);
    expect(mappings[1].weight).toBe(0);
  });

  it('reports rows whose Component ID no longer exists in the module', async () => {
    const file = sheetFile([
      { 'Component ID': 'C1', KSBs: 'K1' },
      { 'Component ID': 'GHOST', KSBs: 'S2' },
    ]);
    const { summary } = await importModuleKsbWorkbook(file, baseModule());
    expect(summary.unmatchedIds).toEqual(['GHOST']);
    expect(summary.componentsUpdated).toBe(1);
  });

  it('regenerates a fresh mapping id for every applied code', async () => {
    const file = sheetFile([{ 'Component ID': 'C1', KSBs: 'K1, S2' }]);
    const { module } = await importModuleKsbWorkbook(file, baseModule());
    const ids = module.weekStructure[0].components[0].ksbMappings.map(m => m.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every(id => id.startsWith('KSBMAP-') || id.startsWith('KSB'))).toBe(true);
  });

  it('does not mutate the original module', async () => {
    const module = baseModule();
    const file = sheetFile([{ 'Component ID': 'C1', KSBs: 'K1' }]);
    await importModuleKsbWorkbook(file, module);
    expect(module.weekStructure[0].components[0].ksbMappings).toEqual([]);
  });

  it('reads the first sheet when the expected one is absent', async () => {
    const file = sheetFile([{ 'Component ID': 'C1', KSBs: 'K1' }], 'RandomName');
    const { summary } = await importModuleKsbWorkbook(file, baseModule());
    expect(summary.componentsUpdated).toBe(1);
  });

  it('reports nothing applied for an entirely blank sheet', async () => {
    const file = sheetFile([{ 'Component ID': 'C1', KSBs: '' }, { 'Component ID': 'C2', KSBs: '  ' }]);
    const { summary } = await importModuleKsbWorkbook(file, baseModule());
    expect(summary).toMatchObject({ rowsWithKsbs: 0, componentsUpdated: 0, codesApplied: 0 });
  });

  it('rejects a wrong file that has rows but no Component ID column', async () => {
    const file = sheetFile([{ Name: 'Alice', Score: 90 }, { Name: 'Bob', Score: 80 }]);
    await expect(importModuleKsbWorkbook(file, baseModule())).rejects.toThrow(/doesn't look like a KSB mapping sheet/i);
  });

  it('treats a sheet from a different module as unmatched rows, not a crash', async () => {
    const file = sheetFile([{ 'Component ID': 'OTHER-1', KSBs: 'K1' }, { 'Component ID': 'OTHER-2', KSBs: 'S2' }]);
    const { module, summary } = await importModuleKsbWorkbook(file, baseModule());
    expect(summary).toMatchObject({ rowsWithKsbs: 2, componentsUpdated: 0, codesApplied: 0 });
    expect(summary.unmatchedIds).toEqual(['OTHER-1', 'OTHER-2']);
    expect(module.weekStructure[0].components[0].ksbMappings).toEqual([]);
  });
});

// --- import: week -----------------------------------------------------------

describe('importWeekKsbWorkbook', () => {
  it('applies KSBs to the matching components and returns a summary', async () => {
    const components = [component('C1'), component('C2')];
    const file = sheetFile([
      { 'Component ID': 'C1', KSBs: 'K1, S2' },
      { 'Component ID': 'C2', KSBs: '' },
    ]);
    const { components: next, summary } = await importWeekKsbWorkbook(file, components);
    expect(next[0].ksbMappings.map(m => m.code)).toEqual(['K1', 'S2']);
    expect(next[1].ksbMappings).toEqual([]);
    expect(summary).toMatchObject({ componentsUpdated: 1, codesApplied: 2, unmatchedIds: [] });
  });

  it('reports unmatched ids for a week that lost the component', async () => {
    const file = sheetFile([{ 'Component ID': 'MISSING', KSBs: 'K1' }]);
    const { summary } = await importWeekKsbWorkbook(file, [component('C1')]);
    expect(summary.unmatchedIds).toEqual(['MISSING']);
    expect(summary.componentsUpdated).toBe(0);
  });
});

// --- describeKsbImport ------------------------------------------------------

describe('describeKsbImport', () => {
  it('summarises a clean import', () => {
    const text = describeKsbImport({ rowsWithKsbs: 2, componentsUpdated: 2, codesApplied: 5, unmatchedIds: [], skippedTokens: [] });
    expect(text).toContain('Applied 5 KSB codes across 2 components');
    expect(text).not.toMatch(/skipped|Ignored/);
  });

  it('mentions unmatched rows and invalid codes when present', () => {
    const text = describeKsbImport({ rowsWithKsbs: 3, componentsUpdated: 1, codesApplied: 1, unmatchedIds: ['A', 'B'], skippedTokens: ['X9'] });
    expect(text).toContain('2 rows matched no component');
    expect(text).toContain('Ignored 1 invalid code: X9');
  });

  it('uses singular wording for a single code and component', () => {
    const text = describeKsbImport({ rowsWithKsbs: 1, componentsUpdated: 1, codesApplied: 1, unmatchedIds: [], skippedTokens: [] });
    expect(text).toContain('Applied 1 KSB code across 1 component.');
  });
});

// --- round trip -------------------------------------------------------------

describe('export → import round trip', () => {
  it('an exported sheet, once filled, imports back onto the same components', async () => {
    const module = moduleWith([
      week(1, [component('C1', { ksbMappings: [mapping('K1', { description: 'Kept K1' })] })]),
      week(2, [component('C2', { weekId: 'WEEK-2' })]),
    ]);
    await exportModuleKsbWorkbook(module);
    const exported = writeFileMock.mock.calls[0][0] as XLSX.WorkBook;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(exported.Sheets.Components, { defval: '' });

    // The worker fills the KSBs column ChatGPT returned, ids untouched.
    rows[0].KSBs = 'K1:main:40, S3';
    rows[1].KSBs = 'B2';
    const file = sheetFile(rows);

    const { module: next, summary } = await importModuleKsbWorkbook(file, module);
    expect(next.weekStructure[0].components[0].ksbMappings.map(m => m.code)).toEqual(['K1', 'S3']);
    expect(next.weekStructure[0].components[0].ksbMappings[0].description).toBe('Kept K1');
    expect(next.weekStructure[1].components[0].ksbMappings.map(m => m.code)).toEqual(['B2']);
    expect(summary.codesApplied).toBe(3);
  });

  // The reported bug: adding a KSB must not wipe the current ones. With the KSBs
  // column pre-filled on export, ChatGPT appends to it, so re-importing the sheet
  // keeps the current codes and adds the new one — nothing is rewritten.
  it('keeps current KSBs and adds new ones when the pre-filled cell is appended to', async () => {
    const module = moduleWith([week(1, [component('C1', {
      ksbMappings: [
        mapping('K1', { type: 'main', classification: 'main', weight: 40, description: 'Kept K1' }),
        mapping('K2', { type: 'secondary', classification: 'secondary', weight: 20, weightClass: 'soft' }),
      ],
    })])]);

    await exportModuleKsbWorkbook(module);
    const exported = writeFileMock.mock.calls[0][0] as XLSX.WorkBook;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(exported.Sheets.Components, { defval: '' });

    // The pre-fill carries the whole current set into the editable column...
    expect(rows[0].KSBs).toBe('K1:main:40, K2:secondary:20');
    // ...and ChatGPT appends the new code, leaving the current ones in place.
    rows[0].KSBs = `${rows[0].KSBs}, K3:possible:10`;

    const { module: next } = await importModuleKsbWorkbook(sheetFile(rows), module);
    const mappings = next.weekStructure[0].components[0].ksbMappings;
    expect(mappings.map(m => m.code)).toEqual(['K1', 'K2', 'K3']);
    expect(mappings[0].description).toBe('Kept K1'); // definition of a kept code survives
    expect(mappings[1]).toMatchObject({ code: 'K2', type: 'secondary', weight: 20 });
    expect(mappings[2]).toMatchObject({ code: 'K3', type: 'possible', weight: 10 });
  });

  // The counterpart to "add": deleting a code from the pre-filled cell removes it,
  // so the sheet stays the single source of truth and removal is still possible.
  it('removes a KSB when its code is deleted from the pre-filled cell', async () => {
    const module = moduleWith([week(1, [component('C1', {
      ksbMappings: [mapping('K1'), mapping('K2'), mapping('K3')],
    })])]);

    await exportModuleKsbWorkbook(module);
    const exported = writeFileMock.mock.calls[0][0] as XLSX.WorkBook;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(exported.Sheets.Components, { defval: '' });

    expect(rows[0].KSBs).toBe('K1:main:40, K2:main:40, K3:main:40');
    // The worker drops K2 from the cell — it should be gone after import.
    rows[0].KSBs = 'K1:main:40, K3:main:40';

    const { module: next } = await importModuleKsbWorkbook(sheetFile(rows), module);
    expect(next.weekStructure[0].components[0].ksbMappings.map(m => m.code)).toEqual(['K1', 'K3']);
  });

  // Safety net: blanking a cell that had KSBs leaves the component untouched
  // rather than wiping it, so an accidental clear can't destroy current mappings.
  it('leaves current KSBs unchanged when a pre-filled cell is blanked entirely', async () => {
    const module = moduleWith([week(1, [component('C1', {
      ksbMappings: [mapping('K1', { description: 'Kept K1' }), mapping('K2')],
    })])]);

    await exportModuleKsbWorkbook(module);
    const exported = writeFileMock.mock.calls[0][0] as XLSX.WorkBook;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(exported.Sheets.Components, { defval: '' });

    rows[0].KSBs = ''; // cleared by hand
    const { module: next, summary } = await importModuleKsbWorkbook(sheetFile(rows), module);

    const mappings = next.weekStructure[0].components[0].ksbMappings;
    expect(mappings.map(m => m.code)).toEqual(['K1', 'K2']); // untouched, not wiped
    expect(mappings[0].description).toBe('Kept K1');
    expect(summary).toMatchObject({ rowsWithKsbs: 0, componentsUpdated: 0, codesApplied: 0 });
  });
});

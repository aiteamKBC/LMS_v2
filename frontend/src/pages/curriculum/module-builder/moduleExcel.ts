import { makeAuthoringId, type KsbMapping, type KsbWeightClass, type ModuleCatalogueItem, type ModuleComponent } from './moduleAuthoringData';
import { getComponentDefinition, normaliseComponentSettings, type ComponentSettings, type ModuleComponentType } from './componentAuthoringModel';

const HEADERS = [
  'Week Number', 'Week Name', 'Component ID', 'Activity Name', 'Expected OTJH Hours', 'Expected OTJH Minutes',
  'Points', 'KSBs', 'Description', 'Activity Type', 'Assurance', 'Source Type',
  'Link', 'Component Duration', 'Required Progress',
] as const;
type Header = typeof HEADERS[number];

const ASSURANCE_KEYS = [
  ['Reflection required', 'reflectionRequired'],
  ['Workplace evidence required', 'workplaceEvidenceRequired'],
  ['Tutor validation required', 'tutorValidationRequired'],
  ['Coach validation required', 'coachValidationRequired'],
] as const;

export interface ModuleImportSummary {
  rowsRead: number;
  componentsUpdated: number;
  weeksUpdated: number;
  unmatchedIds: string[];
  invalidRows: string[];
}

export interface ModuleImportResult {
  module: ModuleCatalogueItem;
  summary: ModuleImportSummary;
}

function slug(value: string, fallback: string) {
  const result = String(value || '').trim().replace(/[^a-zA-Z0-9 _-]+/g, '').replace(/\s+/g, ' ').slice(0, 28);
  return result || fallback;
}

function value(settings: ComponentSettings, ...keys: string[]) {
  for (const key of keys) {
    const candidate = settings[key];
    if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') return candidate;
  }
  return '';
}

function sourceType(component: ModuleComponent) {
  return String(value(component.settings, 'sourceType', 'provider', 'podcastSource', 'readingSource') || '');
}

function link(component: ModuleComponent) {
  return String(value(component.settings, 'videoUrl', 'podcastUrl', 'resourceUrl', 'presentationUrl', 'uploadedFileUrl', 'assignmentFileUrl', 'liveSessionUrl') || '');
}

function duration(component: ModuleComponent) {
  return value(component.settings, 'durationMinutes', 'estimatedReadingTime');
}

function otjhParts(component: ModuleComponent) {
  const totalMinutes = Math.max(0, Math.round(Number(component.expectedOtjh || 0) * 60));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

function assurance(component: ModuleComponent) {
  return ASSURANCE_KEYS.filter(([, key]) => Boolean(component[key as keyof ModuleComponent])).map(([label]) => label).join('; ');
}

function ksbCell(component: ModuleComponent) {
  return component.ksbMappings.filter(item => item.code).map(item => `${item.code}:${item.type || item.classification || 'main'}:${Number.isFinite(item.weight) ? item.weight : 0}`).join(', ');
}

function rowFor(week: { weekNumber: number; title: string }, component: ModuleComponent): Record<Header, string | number> {
  const otjh = otjhParts(component);
  return {
    'Week Number': week.weekNumber,
    'Week Name': week.title || '',
    'Component ID': component.id,
    'Activity Name': component.title || '',
    'Expected OTJH Hours': otjh.hours,
    'Expected OTJH Minutes': otjh.minutes,
    Points: Number(component.points || 0),
    KSBs: ksbCell(component),
    Description: component.description || '',
    'Activity Type': component.type,
    Assurance: assurance(component),
    'Source Type': sourceType(component),
    Link: link(component),
    'Component Duration': duration(component) as string | number,
    'Required Progress': value(component.settings, 'requiredProgressPercentage') as string | number,
  };
}

/** Download a complete module authoring template. Each component type has its own sheet. */
export async function exportModuleTemplate(module: ModuleCatalogueItem): Promise<{ rows: number; fileName: string }> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const byType = new Map<string, Array<Record<Header, string | number>>>();
  module.weekStructure.forEach(week => week.components.forEach(component => {
    const rows = byType.get(component.type) || [];
    rows.push(rowFor(week, component));
    byType.set(component.type, rows);
  }));
  if (!byType.size) throw new Error('This module has no components to export yet.');
  const used = new Set<string>();
  byType.forEach((rows, type) => {
    const label = getComponentDefinition(type as ModuleComponentType).label || type;
    let sheetName = slug(label, type).slice(0, 31);
    let suffix = 2;
    while (used.has(sheetName)) sheetName = `${slug(label, type).slice(0, 28)} ${suffix++}`;
    used.add(sheetName);
    const sheet = XLSX.utils.json_to_sheet(rows, { header: [...HEADERS] });
    sheet['!cols'] = [6, 24, 28, 34, 18, 20, 10, 35, 62, 20, 56, 20, 55, 18, 18].map(wch => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  });
  const guide = XLSX.utils.aoa_to_sheet([
    ['Module authoring template'], [''],
    ['Edit the yellow/input cells in the component sheets, then upload this same workbook.'],
    ['Do not change Component ID, add rows, or move a row between sheets.'],
    ['KSBs format: CODE:type:weight, for example K1:main:40, S2:secondary:20.'],
    ['Assurance values are separated by semicolons: Reflection required; Tutor validation required; Coach validation required; Workplace evidence required.'],
    ['Expected OTJH is edited as separate whole Hours and Minutes columns (minutes must be 0-59). Source Type, Link, Component Duration and Required Progress are applied to the matching component settings when present.'],
    ['Save in .xlsx format. CSV cannot contain multiple sheets.'],
  ]);
  guide['!cols'] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(workbook, guide, 'How to use');
  const fileName = `${slug(module.title, 'module')}-template.xlsx`;
  XLSX.writeFile(workbook, fileName, { compression: true });
  return { rows: [...byType.values()].reduce((total, rows) => total + rows.length, 0), fileName };
}

function parseBoolean(value: unknown, fallback: boolean) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['true', 'yes', 'y', '1', 'on', 'required'].includes(text)) return true;
  if (['false', 'no', 'n', '0', 'off', 'optional'].includes(text)) return false;
  return fallback;
}

function number(value: unknown, fallback: number) {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function expectedOtjhFromRow(row: Record<string, unknown>, fallback: number) {
  const hasHours = Object.prototype.hasOwnProperty.call(row, 'Expected OTJH Hours');
  const hasMinutes = Object.prototype.hasOwnProperty.call(row, 'Expected OTJH Minutes');
  if (hasHours || hasMinutes) {
    const fallbackMinutes = Math.max(0, Math.round((Number(fallback) || 0) * 60));
    const hours = number(row['Expected OTJH Hours'], Math.floor(fallbackMinutes / 60));
    const minutes = Math.min(59, number(row['Expected OTJH Minutes'], fallbackMinutes % 60));
    return hours + minutes / 60;
  }
  // Compatibility with the first template version.
  return number(row['Expected OTJH'] ?? row['Expected OTH'], fallback);
}

function ksbMappings(cell: unknown, component: ModuleComponent) {
  const existing = new Map(component.ksbMappings.map(item => [item.code.toUpperCase(), item]));
  const seen = new Set<string>();
  const mappings = String(cell ?? '').split(/[;,\n]+/).map(token => token.trim()).filter(Boolean).flatMap(token => {
    const [rawCode, rawType, rawWeight] = token.split(':');
    const code = String(rawCode || '').trim().toUpperCase();
    if (!/^[KSB]\d+(\.\d+)*$/.test(code) || seen.has(code)) return [];
    seen.add(code);
    const type = ['main', 'secondary', 'possible'].includes(String(rawType).toLowerCase()) ? String(rawType).toLowerCase() as 'main' | 'secondary' | 'possible' : 'main';
    const weight = number(rawWeight, type === 'main' ? 40 : type === 'secondary' ? 20 : 10);
    const prior = existing.get(code);
    const weightClass: KsbWeightClass = type === 'main' ? 'hard' : type === 'possible' ? 'possible' : 'soft';
    return [{ id: makeAuthoringId('ksb'), ksbId: prior?.ksbId || '', code, description: prior?.description || '', sourceType: prior?.sourceType, sourceId: prior?.sourceId, type, classification: type, weight, weightClass, weight_class: weightClass } satisfies KsbMapping];
  });
  return mappings;
}

function applyRow(component: ModuleComponent, row: Record<string, unknown>) {
  const requestedType = String(row['Activity Type'] ?? '').trim() as ModuleComponentType;
  const type = requestedType && getComponentDefinition(requestedType).type === requestedType ? requestedType : component.type;
  const settings = { ...component.settings };
  const source = String(row['Source Type'] ?? '').trim();
  const rowLink = String(row.Link ?? '').trim();
  if (Object.prototype.hasOwnProperty.call(row, 'Source Type')) {
    if (type === 'podcast') settings.podcastSource = source;
    else if (type === 'reading') settings.readingSource = source;
    else settings.sourceType = source;
  }
  if (Object.prototype.hasOwnProperty.call(row, 'Link')) {
    const key = type === 'video' ? 'videoUrl' : type === 'podcast' ? 'podcastUrl' : type === 'reading' ? 'resourceUrl' : type === 'powerpoint' ? 'presentationUrl' : type === 'assignment' ? 'assignmentFileUrl' : type === 'live-session' ? 'liveSessionUrl' : 'resourceUrl';
    settings[key] = rowLink;
  }
  if (String(row['Component Duration'] ?? '').trim()) settings.durationMinutes = number(row['Component Duration'], Number(value(settings, 'durationMinutes', 'estimatedReadingTime') || 0));
  if (String(row['Required Progress'] ?? '').trim()) settings.requiredProgressPercentage = number(row['Required Progress'], Number(value(settings, 'requiredProgressPercentage') || 0));
  const assuranceTokens = String(row.Assurance ?? '').split(/[;,\n]+/).map(token => token.trim().toLowerCase()).filter(Boolean);
  const hasAssurance = Object.prototype.hasOwnProperty.call(row, 'Assurance');
  const next: ModuleComponent = { ...component, type, title: String(row['Activity Name'] ?? component.title).trim(), description: String(row.Description ?? component.description), expectedOtjh: expectedOtjhFromRow(row, component.expectedOtjh), points: number(row.Points, component.points), ksbMappings: Object.prototype.hasOwnProperty.call(row, 'KSBs') ? ksbMappings(row.KSBs, component) : component.ksbMappings, settings: normaliseComponentSettings(type, settings) };
  if (hasAssurance) {
    const assuranceState = Object.fromEntries(ASSURANCE_KEYS.map(([label, key]) => [key, assuranceTokens.some(token => token === label.toLowerCase() || token.includes(label.toLowerCase().replace(' required', '')))])) as Pick<ModuleComponent, 'reflectionRequired' | 'workplaceEvidenceRequired' | 'tutorValidationRequired' | 'coachValidationRequired'>;
    Object.assign(next, assuranceState);
  }
  return next;
}

/** Apply edits from every component sheet, matching rows by Component ID. */
export async function importModuleTemplate(file: File, module: ModuleCatalogueItem): Promise<ModuleImportResult> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rowsById = new Map<string, Record<string, unknown>>();
  const invalidRows: string[] = [];
  workbook.SheetNames.filter(name => name !== 'How to use').forEach(name => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], { defval: '' });
    rows.forEach((row, index) => {
      const id = String(row['Component ID'] ?? '').trim();
      if (!id) { if (Object.values(row).some(Boolean)) invalidRows.push(`${name} row ${index + 2}: missing Component ID`); return; }
      const activityType = String(row['Activity Type'] ?? '').trim();
      if (activityType && getComponentDefinition(activityType).type !== activityType) invalidRows.push(`${name} row ${index + 2}: unknown Activity Type`);
      rowsById.set(id, row);
    });
  });
  if (!rowsById.size) throw new Error('This file has no component rows. Export a module template first, then edit and upload that .xlsx file.');
  const matched = new Set<string>();
  const weekNames = new Map<number, string>();
  let componentsUpdated = 0;
  const weekStructure = module.weekStructure.map(week => {
    const weekRows = week.components.map(component => {
      const row = rowsById.get(component.id);
      if (!row) return component;
      matched.add(component.id); componentsUpdated += 1;
      const weekNumber = number(row['Week Number'], week.weekNumber);
      const weekName = String(row['Week Name'] ?? '').trim();
      if (weekName) weekNames.set(weekNumber, weekName);
      return applyRow(component, row);
    });
    const nextWeekNumber = week.weekNumber;
    return { ...week, title: weekNames.get(nextWeekNumber) || week.title, components: weekRows };
  });
  const unmatchedIds = [...rowsById.keys()].filter(id => !matched.has(id));
  return { module: { ...module, weekStructure }, summary: { rowsRead: rowsById.size, componentsUpdated, weeksUpdated: weekNames.size, unmatchedIds, invalidRows } };
}

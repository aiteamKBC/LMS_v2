import { type CurriculumStandard, type CurriculumKsbSet, type CurriculumProgramme } from '@/lib/curriculumApi';
import {
  type KsbOption,
  flattenKsbEntries,
  type ModuleCatalogueItem,
  type KsbMapping,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { normaliseDeepLinkValue } from '@/features/curriculum/module-authoring/model/draftTransforms';
import type { ModuleBuilderListItem } from '@/features/curriculum/module-authoring/model/catalogueTypes';


export function standardToKsbOptions(standard: CurriculumStandard): KsbOption[] {
  return (standard.ksbs || []).map(ksb => ({
    id: `${standard.id}-${ksb.id || ksb.code}`,
    code: ksb.code,
    description: ksb.description,
    type: ksb.type,
    title: ksb.code,
    sourceType: 'standard',
    sourceId: ksbStandardSourceId(standard),
  }));
}


export function ksbStandardSourceId(standard: CurriculumStandard) {
  return `standard:${standard.id}`;
}


export function ksbSetSourceId(set: CurriculumKsbSet) {
  const key = set.frameworkId || set.ksbProfileId || set.profileId || set.programmeId || set.standard || set.programmeName;
  return String(key || 'ksb-set').trim();
}


export function ksbSourceIdAliases(value?: string) {
  const raw = String(value || '').trim();
  const cleaned = cleanKsbSourceId(raw);
  const aliases = new Set<string>();
  [raw, cleaned].forEach(source => {
    const id = String(source || '').trim();
    if (!id) return;
    aliases.add(id);
    aliases.add(id.replace(/^profile:/, ''));
    if (!id.startsWith('standard:')) aliases.add(`profile:${id.replace(/^profile:/, '')}`);
    if (/^ksb-\d+$/i.test(id)) aliases.add(id.replace(/^ksb-/i, ''));
    if (/^\d+$/.test(id)) {
      aliases.add(`ksb-${id}`);
      aliases.add(`KSBP-${id}`);
      aliases.add(`profile:KSBP-${id}`);
    }
  });
  return Array.from(aliases).filter(Boolean);
}


export function ksbSourceIdsMatch(left?: string, right?: string) {
  const leftAliases = ksbSourceIdAliases(left).map(normaliseDeepLinkValue).filter(Boolean);
  const rightAliases = new Set(ksbSourceIdAliases(right).map(normaliseDeepLinkValue).filter(Boolean));
  return leftAliases.some(alias => rightAliases.has(alias));
}


export function ksbSetSourceAliases(set: CurriculumKsbSet) {
  return [
    ksbSetSourceId(set),
    set.frameworkId,
    set.ksbProfileId,
    set.profileId,
    set.profileId ? `KSBP-${set.profileId}` : '',
    set.programmeId,
    set.standard,
    set.programmeName,
    ...(set.programmeIds || []),
  ].flatMap(value => ksbSourceIdAliases(String(value || '').trim())).filter(Boolean);
}


export function cleanKsbSourceId(value?: string) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('profile:')) return text.replace(/^profile:/, '');
  return text;
}


export function ksbSourceOptions(ksbSets: CurriculumKsbSet[], standards: CurriculumStandard[]) {
  const seen = new Set<string>();
  const profileOptions = ksbSets
    .map(set => {
      const id = ksbSetSourceId(set);
      const title = ksbSetDisplayTitle(set);
      return {
        id,
        label: title,
      };
    });
  const standardOptions = standards
    .map(standard => ({
      id: ksbStandardSourceId(standard),
      label: standard.name || standard.code || standard.standardRef || standard.id,
    }));
  return [...profileOptions, ...standardOptions].filter(option => {
      if (seen.has(option.id)) return false;
      seen.add(option.id);
      return true;
    });
}


export function ksbMapSourceOptions(ksbSets: CurriculumKsbSet[], standards: CurriculumStandard[]): KsbSourceOption[] {
  const profileOptions = ksbSets.map(set => {
    const id = ksbSetSourceId(set);
    const options = flattenKsbEntries(set.ksbs).map(option => ({ ...option, sourceType: 'framework', sourceId: id }));
    const name = ksbSetDisplayTitle(set);
    return {
      id,
      label: `${name} - ${options.length} KSBs`,
      title: name,
      subtitle: set.programmeName || set.standard || '',
      options,
    };
  });
  const standardOptions = standards.map(standard => {
    const options = standardToKsbOptions(standard);
    const name = `${standard.code || standard.standardRef || standard.id} - ${standard.name}`;
    return {
      id: ksbStandardSourceId(standard),
      label: `Standard: ${name} - ${options.length || standard.total} KSBs`,
      title: standard.name || standard.code || 'Standard',
      subtitle: standard.code || standard.standardRef || '',
      options,
    };
  });
  const seen = new Set<string>();
  return [...profileOptions, ...standardOptions].filter(option => {
    if (seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });
}


export function ksbSourceMatchesModule(sourceId: string, ksbSets: CurriculumKsbSet[], standards: CurriculumStandard[], module: ModuleCatalogueItem | null, programmes: CurriculumProgramme[]) {
  const selectedSource = cleanKsbSourceId(sourceId);
  if (!selectedSource) return false;
  if (ksbSourceOptions(ksbSets, standards).some(option => ksbSourceIdsMatch(option.id, selectedSource))) return true;
  if (ksbSets.some(set => ksbSetSourceAliases(set).some(alias => ksbSourceIdsMatch(alias, selectedSource)))) return true;
  if (!module) return false;
  const matchedSet = ksbSetForModule(ksbSets, module, programmes);
  const matchedStandard = standardForModule(standards, module, programmes);
  return Boolean(
    (matchedSet && ksbSetSourceAliases(matchedSet).some(alias => ksbSourceIdsMatch(alias, selectedSource)))
    || (matchedStandard && ksbSourceIdsMatch(ksbStandardSourceId(matchedStandard), selectedSource))
  );
}


export function valuesMatchAny(values: unknown[] | undefined, candidates: unknown[]) {
  const expected = (values || []).map(normaliseDeepLinkValue).filter(Boolean);
  if (!expected.length) return true;
  const actual = new Set(candidates.map(normaliseDeepLinkValue).filter(Boolean));
  return expected.some(value => actual.has(value));
}


export function ksbSetMatchesModule(set: CurriculumKsbSet, module: ModuleCatalogueItem | null, programmes: CurriculumProgramme[]) {
  if (!module) return false;
  const programmeCandidates = Array.from(moduleStandardCandidates(module, programmes));
  const moduleCandidates = [module.catalogueId, module.id, module.sourceId, module.sourceModule?.id, module.sourceModule?.sourceId];
  const cohortCandidates = [module.cohortId, module.cohort];
  const groupCandidates = [module.groupId, module.group];
  return valuesMatchAny(set.programmeIds?.length ? set.programmeIds : [set.programmeId], programmeCandidates)
    && valuesMatchAny(set.moduleCatalogueIds, moduleCandidates)
    && valuesMatchAny(set.cohortIds, cohortCandidates)
    && valuesMatchAny(set.groupIds, groupCandidates);
}


export function ksbSourceLabelMap(standards: CurriculumStandard[], ksbSets: CurriculumKsbSet[]) {
  const labels: Record<string, string> = {};
  standards.forEach(standard => {
    const label = `Skills standard: ${standard.code || standard.standardRef || standard.id} - ${standard.name}`;
    labels[ksbStandardSourceId(standard)] = label;
    labels[String(standard.id || '').trim()] = label;
  });
  ksbSets.forEach(set => {
    const label = readableKsbSetLabel(set);
    const prefixedSourceId = ksbSetSourceId(set);
    [
      prefixedSourceId,
      prefixedSourceId.replace(/^profile:/, ''),
      set.frameworkId,
      set.profileId,
      set.ksbProfileId,
      set.programmeId,
      ...(set.programmeIds || []),
    ].forEach(value => {
      const id = String(value || '').trim();
      if (!id) return;
      labels[id] = label;
      labels[`profile:${id}`] = label;
      const legacyNumeric = legacyKsbProfileNumericId(id);
      if (legacyNumeric) labels[`ksb-${legacyNumeric}`] = label;
    });
    [set.programmeName, set.standard].forEach(value => {
      const key = normaliseDeepLinkValue(value);
      if (key) labels[`programme:${key}`] = label;
    });
  });
  return labels;
}


export function readableKsbSetLabel(set: CurriculumKsbSet) {
  return ksbSetDisplayTitle(set);
}


export function ksbSetDisplayTitle(set: CurriculumKsbSet) {
  return String(set.standard || set.programmeName || set.ksbProfileId || set.profileId || set.frameworkId || 'KSB profile').trim();
}


export function legacyKsbProfileNumericId(value: string) {
  const match = String(value || '').match(/(?:KSBP-)?\d*?(\d{1,6})$/i);
  if (!match) return '';
  return String(Number(match[1]));
}


export function ksbSourceLabel(mapping: KsbMapping, sourceLabels: Record<string, string> = {}, fallbackProgrammeName = '') {
  const sourceId = String(mapping.sourceId || '').trim();
  if (sourceId && sourceLabels[sourceId]) return sourceLabels[sourceId];
  if (sourceId && sourceLabels[`profile:${sourceId}`]) return sourceLabels[`profile:${sourceId}`];
  const programmeLabel = sourceLabels[`programme:${normaliseDeepLinkValue(fallbackProgrammeName)}`];
  if (programmeLabel && /^ksb-\d+$/i.test(sourceId)) return programmeLabel;
  const sourceType = String(mapping.sourceType || '').trim().toLowerCase();
  if (sourceId && sourceId.startsWith('profile:')) return `KSB profile: ${sourceId.replace(/^profile:/, '')}`;
  if (sourceId && sourceId.startsWith('standard:')) return `Skills standard: ${sourceId.replace(/^standard:/, '')}`;
  if (sourceType === 'framework') return sourceId ? `KSB profile: ${sourceId}` : 'KSB profile';
  if (sourceType === 'standard') return sourceId ? `Skills standard: ${sourceId}` : 'Skills standard';
  return 'No source';
}


export function conciseKsbSourceLabel(label: string) {
  const text = String(label || '').trim();
  if (!text || text === 'No source') return 'No source';
  return text
    .replace(/^KSB profile:\s*/i, 'Profile - ')
    .replace(/^Skills standard:\s*/i, 'Standard - ');
}


export function standardForModule(standards: CurriculumStandard[], module: ModuleCatalogueItem | null, programmes: CurriculumProgramme[]) {
  if (!module || !standards.length) return null;
  const candidates = moduleStandardCandidates(module, programmes);
  if (!candidates.size) return null;
  return standards.find(standard => {
    const standardCandidates = [
      standard.id,
      standard.code,
      standard.standardRef,
      standard.name,
      standard.larsCode,
      `${standard.code} v${standard.version}`,
      `${standard.standardRef} v${standard.version}`,
    ].map(normaliseDeepLinkValue).filter(Boolean);
    return standardCandidates.some(candidate => candidates.has(candidate));
  }) || null;
}


export function ksbSetForModule(ksbSets: CurriculumKsbSet[], module: ModuleCatalogueItem | null, programmes: CurriculumProgramme[]) {
  if (!module || !ksbSets.length) return null;
  const candidates = moduleStandardCandidates(module, programmes);
  if (!candidates.size) return null;
  return ksbSets.find(set => {
    if (!ksbSetMatchesModule(set, module, programmes)) return false;
    const setCandidates = [
      set.frameworkId,
      set.profileId,
      set.programmeId,
      ...(set.programmeIds || []),
      set.programmeName,
      set.standard,
    ].map(normaliseDeepLinkValue).filter(Boolean);
    return setCandidates.some(candidate => candidates.has(candidate));
  }) || null;
}


export function moduleStandardCandidates(module: ModuleCatalogueItem, programmes: CurriculumProgramme[]) {
  const rawCandidates = [
    module.programmeId,
    module.programmeName,
    module.sourceModule?.programmeId,
    module.sourceModule?.programme,
    ...((module as ModuleBuilderListItem).deliveryUsages || []).flatMap(usage => [usage.programmeId, usage.programme]),
  ];
  const moduleKeys = new Set(rawCandidates.map(normaliseDeepLinkValue).filter(Boolean));
  programmes.forEach(programme => {
    const programmeKeys = [programme.id, programme.sourceId, programme.name].map(normaliseDeepLinkValue).filter(Boolean);
    if (programmeKeys.some(key => moduleKeys.has(key))) {
      rawCandidates.push(programme.standard);
    }
  });
  return new Set(rawCandidates.map(normaliseDeepLinkValue).filter(Boolean));
}


export type KsbSourceOption = {
  id: string;
  label: string;
  title: string;
  subtitle: string;
  options: KsbOption[];
};

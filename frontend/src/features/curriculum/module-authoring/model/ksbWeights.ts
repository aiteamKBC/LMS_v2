import {
  type KsbMappingType,
  type KsbWeightClass,
  type KsbMapping,
  type KsbOption,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';


export const DEFAULT_KSB_MAPPING_TYPE: KsbMappingType = 'main';

export const DEFAULT_KSB_WEIGHT_CLASS: KsbWeightClass = 'hard';

export const DEFAULT_KSB_WEIGHTS: Record<KsbWeightClass, number> = {
  hard: 50,
  soft: 30,
  possible: 20,
};


export function defaultKsbWeight(weightClass: KsbWeightClass = DEFAULT_KSB_WEIGHT_CLASS) {
  return DEFAULT_KSB_WEIGHTS[normaliseKsbWeightClass(weightClass)];
}


export function clampKsbWeight(value: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed * 100) / 100);
}


export function clampPositiveKsbWeight(value: number, weightClass: KsbWeightClass = DEFAULT_KSB_WEIGHT_CLASS) {
  const weight = clampKsbWeight(value);
  return weight > 0 ? weight : defaultKsbWeight(weightClass);
}


export function normaliseKsbMappingType(value?: string): KsbMappingType {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'main' || raw === 'secondary' || raw === 'possible') return raw;
  if (raw === 'practice') return 'possible';
  return 'secondary';
}


export function normaliseKsbWeightClass(value?: string, fallbackClassification?: KsbMappingType): KsbWeightClass {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'hard' || raw === 'soft' || raw === 'possible') return raw;
  const legacy = normaliseKsbMappingType(fallbackClassification);
  if (legacy === 'main') return 'hard';
  if (legacy === 'possible') return 'possible';
  return 'soft';
}


export function ksbWeightClassLabel(value?: string) {
  const weightClass = normaliseKsbWeightClass(value);
  if (weightClass === 'hard') return 'Hard';
  if (weightClass === 'soft') return 'Soft';
  return 'Possible';
}


export function ksbMappingIdentity(value: Pick<KsbMapping, 'code' | 'sourceType' | 'sourceId'> | Pick<KsbOption, 'code' | 'sourceType' | 'sourceId'>) {
  return [
    String(value.code || '').trim().toUpperCase(),
    String(value.sourceType || '').trim().toLowerCase(),
    String(value.sourceId || '').trim().toLowerCase(),
  ].join('|');
}


export function ksbWeightSummary(mappings: KsbMapping[]) {
  return mappings.reduce(
    (summary, mapping) => {
      const weight = Number(mapping.weight || 0);
      const code = String(mapping.code || '').trim().toUpperCase();
      if (code.startsWith('K')) summary.knowledge += weight;
      else if (code.startsWith('S')) summary.skills += weight;
      else if (code.startsWith('B')) summary.behaviours += weight;
      summary.total += weight;
      return summary;
    },
    { knowledge: 0, skills: 0, behaviours: 0, total: 0 },
  );
}

import { ksbCodeChipClass, ksbVisualTone } from '../model/ksbPresentation';
import {
  ksbWeightSummary,
  normaliseKsbMappingType,
  normaliseKsbWeightClass,
  ksbWeightClassLabel,
  clampKsbWeight,
} from '@/features/curriculum/module-authoring/model/ksbWeights';
import { type KsbMapping, type KsbWeightClass } from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { AppIcon } from '@/components/feature/AppIcon';
import { ksbSourceLabel } from '@/features/curriculum/module-authoring/model/ksbSources';
import { SelectMenu } from '@/components/feature/SelectField';
import { WEIGHT_CLASS_OPTIONS } from '@/features/curriculum/module-authoring/components/ksbOptions';


export function KsbWeightSummary({ summary }: { summary: ReturnType<typeof ksbWeightSummary> }) {
  const items = [
    ['K', summary.knowledge],
    ['S', summary.skills],
    ['B', summary.behaviours],
    ['Total', summary.total],
  ] as const;
  return (
    <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-background-200 bg-background-100/35 p-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-background-50 px-2 py-1.5 text-center">
          <p className="text-[9px] font-bold uppercase text-foreground-400">{label}</p>
          <p className="text-[12px] font-heading font-bold text-foreground-900">{Number(value || 0)}%</p>
        </div>
      ))}
    </div>
  );
}


export function KsbCards({ title, mappings, sourceLabels = {}, onAdd, onRemove, onWeightChange, onWeightClassChange }: { title: string; mappings: KsbMapping[]; sourceLabels?: Record<string, string>; onAdd?: () => void; onRemove?: (mappingId: string) => void; onWeightChange?: (mappingId: string, weight: number) => void; onWeightClassChange?: (mappingId: string, weightClass: KsbWeightClass) => void }) {
  const totalWeight = mappings.reduce((total, mapping) => total + Number(mapping.weight || 0), 0);
  return (
    <div className="space-y-2 rounded-xl border border-background-200 bg-background-100/35 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase text-foreground-400">{title}</p>
          {!!mappings.length && <p className="mt-0.5 text-[10px] font-semibold text-foreground-500">{totalWeight}% total weight</p>}
        </div>
        {onAdd && (
          <button onClick={onAdd} className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-primary-500 px-2 text-[10px] font-semibold text-white transition-smooth hover:bg-primary-600">
            <AppIcon className="ri-add-line"></AppIcon>
            KSB
          </button>
        )}
      </div>
      <div className="space-y-2">
        {mappings.map(mapping => (
          <KsbCard
            key={mapping.id}
            mapping={mapping}
            sourceLabels={sourceLabels}
            onRemove={onRemove ? () => onRemove(mapping.id) : undefined}
            onWeightChange={onWeightChange ? weight => onWeightChange(mapping.id, weight) : undefined}
            onWeightClassChange={onWeightClassChange ? weightClass => onWeightClassChange(mapping.id, weightClass) : undefined}
          />
        ))}
        {!mappings.length && <p className="text-[11px] text-foreground-400">No KSBs mapped.</p>}
      </div>
    </div>
  );
}


export function KsbCard({ mapping, sourceLabels = {}, onRemove, onWeightChange, onWeightClassChange }: { mapping: KsbMapping; sourceLabels?: Record<string, string>; onRemove?: () => void; onWeightChange?: (weight: number) => void; onWeightClassChange?: (weightClass: KsbWeightClass) => void }) {
  const tone = ksbVisualTone(mapping.code, mapping.type);
  const classification = normaliseKsbMappingType(mapping.classification || mapping.type);
  const weightClass = normaliseKsbWeightClass(mapping.weightClass || mapping.weight_class, classification);
  const sourceLabel = ksbSourceLabel(mapping, sourceLabels);
  return (
    <div className={`rounded-lg border border-l-4 p-2 ${tone.row}`} title={mapping.description || `${mapping.code} applied`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${tone.iconClass}`}>
          <AppIcon className={`${tone.icon} text-[13px]`}></AppIcon>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <p className="truncate text-[11px] font-bold text-foreground-900">{mapping.code} applied</p>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tone.badgeClass}`}>{tone.label}</span>
            <span className="rounded-full bg-background-50 px-2 py-0.5 text-[9px] font-bold text-foreground-600">{ksbWeightClassLabel(weightClass)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tone.weightClass}`}>{Number(mapping.weight || 0)}%</span>
          </div>
          <p className="mt-1 truncate text-[10px] font-semibold text-foreground-400">{sourceLabel}</p>
          {(onWeightChange || onWeightClassChange) && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[112px_88px]">
              {onWeightClassChange && (
                <div className="text-[10px] font-semibold uppercase text-foreground-400">
                  Weight class
                  <div className="mt-1">
                    <SelectMenu
                      ariaLabel="Weight class"
                      value={weightClass}
                      onChange={value => onWeightClassChange(normaliseKsbWeightClass(value))}
                      options={WEIGHT_CLASS_OPTIONS}
                      size="sm"
                    />
                  </div>
                </div>
              )}
              {onWeightChange && (
                <label className="text-[10px] font-semibold uppercase text-foreground-400">
                  Weight
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={Number(mapping.weight || 0)}
                    onChange={event => onWeightChange(clampKsbWeight(Number(event.target.value)))}
                    className="mt-1 h-7 w-full rounded-md border border-foreground-200/60 bg-background-50 px-2 text-[12px] font-bold text-foreground-900 outline-none focus:border-primary-300"
                  />
                </label>
              )}
            </div>
          )}
          {Number(mapping.weight || 0) <= 0 && (
            <p className="mt-1 text-[10px] font-semibold text-amber-700">Set a positive weight before saving.</p>
          )}
        </div>
        {onRemove && <button onClick={onRemove} className="h-6 w-6 shrink-0 rounded-md text-red-500 hover:bg-red-50"><AppIcon className="ri-close-line text-xs"></AppIcon></button>}
      </div>
    </div>
  );
}


export function WeekKsbCodeSection({ mappings, sourceLabels }: { mappings: KsbMapping[]; sourceLabels: Record<string, string> }) {
  const groups = [
    { key: 'K', label: 'Knowledge', items: mappings.filter(mapping => String(mapping.code || '').toUpperCase().startsWith('K')) },
    { key: 'S', label: 'Skills', items: mappings.filter(mapping => String(mapping.code || '').toUpperCase().startsWith('S')) },
    { key: 'B', label: 'Behaviours', items: mappings.filter(mapping => String(mapping.code || '').toUpperCase().startsWith('B')) },
  ];
  return (
    <div className="space-y-2 rounded-xl border border-primary-100 bg-primary-50/35 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase text-primary-700">Week KSBs</p>
        {!!mappings.length && <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-primary-700">{mappings.length}</span>}
      </div>
      {mappings.length ? (
        <div className="space-y-2">
          {groups.map(group => group.items.length ? (
            <div key={group.key} className="space-y-1">
              <p className="text-[9px] font-bold uppercase text-foreground-400">{group.label}</p>
              <div className="flex flex-wrap gap-1">
                {group.items.map(mapping => <KsbCodeOnlyChip key={mapping.id} mapping={mapping} sourceLabels={sourceLabels} />)}
              </div>
            </div>
          ) : null)}
        </div>
      ) : (
        <p className="text-[11px] text-foreground-400">No KSBs mapped.</p>
      )}
    </div>
  );
}


export function KsbCodeOnlyChip({ mapping, sourceLabels }: { mapping: KsbMapping; sourceLabels: Record<string, string> }) {
  const sourceLabel = ksbSourceLabel(mapping, sourceLabels);
  return (
    <span
      title={`${mapping.description || mapping.code} - ${sourceLabel}`}
      className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold ${ksbCodeChipClass(mapping.code)}`}
    >
      <span>{mapping.code}</span>
      <span className="max-w-[140px] truncate rounded bg-white/70 px-1 text-[8px] font-semibold">{sourceLabel}</span>
    </span>
  );
}

import {
  type ModuleCatalogueItem,
  type ModuleWeek,
  type ModuleComponent,
  componentTypes,
  type KsbMapping,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { uniqueMappings } from '@/features/curriculum/module-authoring/model/ksbMappings';
import { AppIcon } from '@/components/feature/AppIcon';
import { EmptyState } from '@/features/curriculum/module-authoring/components/EditorPrimitives';
import { componentToneClasses } from '@/features/curriculum/module-authoring/model/componentSelection';
import { componentSessionTitle } from '@/pages/curriculum/shared/sessionDisplayTitle';
import { readableComponentTitle } from '@/features/curriculum/module-authoring/model/draftTransforms';
import { ksbSourceLabel } from '@/features/curriculum/module-authoring/model/ksbSources';
import {
  normaliseKsbMappingType,
  normaliseKsbWeightClass,
  ksbWeightClassLabel,
  clampKsbWeight,
} from '@/features/curriculum/module-authoring/model/ksbWeights';
import { ksbCodeChipClass } from '../model/ksbPresentation';


export function SessionKsbMappingModal({ module, sourceLabels, onClose }: {
  module: ModuleCatalogueItem;
  sourceLabels: Record<string, string>;
  onClose: () => void;
}) {
  const components = module.weekStructure.flatMap(week => week.components.map(component => ({ week, component })));
  const moduleMappings = uniqueMappings([
    ...module.moduleKsbMappings,
    ...module.weekStructure.flatMap(week => week.ksbMappings),
    ...components.flatMap(item => item.component.ksbMappings),
  ]);
  const uniqueMappedCount = moduleMappings.length;
  const occurrenceCount = module.moduleKsbMappings.length
    + module.weekStructure.reduce((total, week) => total + week.ksbMappings.length, 0)
    + components.reduce((total, item) => total + item.component.ksbMappings.length, 0);

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex flex-col gap-3 bg-primary-950 px-5 py-4 text-white lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-white/60">KSB Trace</p>
            <h3 className="mt-0.5 text-base font-heading font-bold text-white">Review Module KSBs</h3>
            <p className="mt-1 line-clamp-1 text-[12px] font-semibold text-white/70">{module.title}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MetricPill label="Components" value={String(components.length)} />
            <MetricPill label="KSB codes" value={String(uniqueMappedCount)} />
            <MetricPill label="Mappings" value={String(occurrenceCount)} />
            <button onClick={onClose} className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white transition-smooth hover:bg-white/20">
              <AppIcon className="ri-close-line"></AppIcon>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {moduleMappings.length ? (
            <div className="space-y-4">
              {!!module.moduleKsbMappings.length && (
                <ReviewKsbBand title="Module-level KSBs" mappings={uniqueMappings(module.moduleKsbMappings)} sourceLabels={sourceLabels} />
              )}
              {module.weekStructure.map(week => (
                <ReviewKsbWeekSection key={week.id} week={week} sourceLabels={sourceLabels} />
              ))}
            </div>
          ) : (
            <EmptyState text="No KSBs are mapped to this module yet." />
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] font-semibold text-foreground-500">
            Read-only review of module, week, and component KSB coverage.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-background-200 bg-background-50 px-4 py-2 text-[12px] font-semibold text-foreground-700 transition-smooth hover:bg-background-100">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


export function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white">
      <span className="text-white/60">{label}</span>
      <span>{value}</span>
    </span>
  );
}


export function ReviewKsbWeekSection({ week, sourceLabels }: { week: ModuleWeek; sourceLabels: Record<string, string> }) {
  const componentMappings = week.components.flatMap(component => component.ksbMappings);
  const weekMappedKsbs = uniqueMappings([...week.ksbMappings, ...componentMappings]);
  return (
    <section className="overflow-hidden rounded-2xl border border-background-200 bg-background-50">
      <div className="flex flex-col gap-2 border-b border-background-200 bg-background-100/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase text-primary-600">Week {week.weekNumber}</p>
          <h4 className="text-sm font-heading font-bold text-foreground-950">{week.title || `Week ${week.weekNumber}`}</h4>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-background-50 px-2.5 py-1 text-[10px] font-bold text-foreground-500">{week.components.length} components</span>
          <span className="rounded-full bg-background-50 px-2.5 py-1 text-[10px] font-bold text-foreground-500">{weekMappedKsbs.length} KSBs</span>
        </div>
      </div>
      <div className="space-y-3 p-4">
        {!!week.ksbMappings.length && (
          <ReviewKsbBand title="Week-level KSBs" mappings={uniqueMappings(week.ksbMappings)} sourceLabels={sourceLabels} />
        )}
        {week.components.map(component => (
          <ReviewKsbComponentRow key={component.id} week={week} component={component} sourceLabels={sourceLabels} />
        ))}
        {!week.ksbMappings.length && !week.components.length && (
          <EmptyState text="No KSBs or components in this week yet." />
        )}
      </div>
    </section>
  );
}


export function ReviewKsbComponentRow({ week, component, sourceLabels }: { week: ModuleWeek; component: ModuleComponent; sourceLabels: Record<string, string> }) {
  const meta = componentTypes.find(item => item.type === component.type);
  const tone = componentToneClasses(meta?.tone);
  const mappings = uniqueMappings(component.ksbMappings);
  return (
    <article className="rounded-xl border border-background-200 bg-background-100/35 p-3">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.soft} ${tone.text}`}>
            <AppIcon className={`${meta?.icon || 'ri-file-line'} text-sm`}></AppIcon>
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-bold text-foreground-950">{componentSessionTitle(component, week, readableComponentTitle(component.title))}</p>
            <p className="mt-0.5 text-[10px] font-semibold text-foreground-400">Week {week.weekNumber} - {meta?.label || component.type}</p>
          </div>
        </div>
        <span className="w-fit rounded-full bg-background-50 px-2 py-0.5 text-[10px] font-bold text-foreground-500">{mappings.length} KSB{mappings.length === 1 ? '' : 's'}</span>
      </div>
      {mappings.length ? (
        <div className="grid gap-2 lg:grid-cols-3">
          {(['knowledge', 'skill', 'behaviour'] as const).map(kind => (
            <ReviewKsbKindColumn
              key={kind}
              kind={kind}
              mappings={mappings.filter(mapping => sessionKsbKind(mapping.code) === kind)}
              sourceLabels={sourceLabels}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-background-300 bg-background-50 px-3 py-4 text-center text-[11px] font-semibold text-foreground-400">No KSBs mapped to this component.</p>
      )}
    </article>
  );
}


export function ReviewKsbBand({ title, mappings, sourceLabels }: { title: string; mappings: KsbMapping[]; sourceLabels: Record<string, string> }) {
  return (
    <div className="rounded-xl border border-primary-100 bg-primary-50/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase text-primary-700">{title}</p>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-bold text-primary-700">{mappings.length}</span>
      </div>
      <div className="grid gap-2 lg:grid-cols-3">
        {(['knowledge', 'skill', 'behaviour'] as const).map(kind => (
          <ReviewKsbKindColumn
            key={kind}
            kind={kind}
            mappings={mappings.filter(mapping => sessionKsbKind(mapping.code) === kind)}
            sourceLabels={sourceLabels}
          />
        ))}
      </div>
    </div>
  );
}


export function ReviewKsbKindColumn({ kind, mappings, sourceLabels }: {
  kind: 'knowledge' | 'skill' | 'behaviour';
  mappings: KsbMapping[];
  sourceLabels: Record<string, string>;
}) {
  const labels = {
    knowledge: 'Knowledge',
    skill: 'Skills',
    behaviour: 'Behaviours',
  };
  return (
    <div className="min-w-0 rounded-lg border border-background-200 bg-background-50 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[9px] font-bold uppercase text-foreground-400">{labels[kind]}</p>
        <span className="rounded-full bg-background-100 px-1.5 py-0.5 text-[9px] font-bold text-foreground-500">{mappings.length}</span>
      </div>
      <div className="space-y-1.5">
        {mappings.map(mapping => <ReviewKsbChip key={mapping.id} mapping={mapping} sourceLabels={sourceLabels} />)}
        {!mappings.length && <p className="text-[10px] font-semibold text-foreground-300">None</p>}
      </div>
    </div>
  );
}


export function ReviewKsbChip({ mapping, sourceLabels }: { mapping: KsbMapping; sourceLabels: Record<string, string> }) {
  const sourceLabel = ksbSourceLabel(mapping, sourceLabels);
  const classification = normaliseKsbMappingType(mapping.classification || mapping.type);
  const weightClass = normaliseKsbWeightClass(mapping.weightClass || mapping.weight_class, classification);
  return (
    <div title={mapping.description || mapping.code} className={`rounded-md border px-2 py-1.5 ${ksbCodeChipClass(mapping.code)}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-extrabold text-foreground-950">{mapping.code}</span>
        <span className="rounded bg-white/70 px-1 py-0.5 text-[8px] font-bold">{ksbWeightClassLabel(weightClass)}</span>
        <span className="rounded bg-white/70 px-1 py-0.5 text-[8px] font-bold">{clampKsbWeight(mapping.weight)}%</span>
      </div>
      {mapping.description && <p className="mt-1 line-clamp-2 text-[10px] font-semibold leading-relaxed text-foreground-700">{mapping.description}</p>}
      {sourceLabel && <p className="mt-1 truncate text-[9px] font-bold text-foreground-400">{sourceLabel}</p>}
    </div>
  );
}


function sessionKsbKind(code: string): 'knowledge' | 'skill' | 'behaviour' {
  const prefix = String(code || '').trim().toUpperCase().slice(0, 1);
  if (prefix === 'S') return 'skill';
  if (prefix === 'B') return 'behaviour';
  return 'knowledge';
}

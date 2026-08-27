import { Fragment, useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import { type CurriculumModule } from '@/lib/curriculumApi';
import { loadCurriculumScope } from './weekTemplateData';
import {
  copyComponentToWeek,
  loadModuleStructure,
  saveModuleStructure,
  type ModuleCatalogueItem,
  type ModuleComponent,
  type ModuleWeek,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';

type Step = 'module' | 'week' | 'place';

const norm = (value?: string) => String(value ?? '').trim().toLowerCase();
const catalogueIdOf = (module: CurriculumModule) => module.moduleCatalogueId || module.catalogueId || module.id;
const weekLabel = (week: ModuleWeek) => week.title || `Week ${week.weekNumber}`;

/**
 * Inline panel shown under an unassigned group in "Assigned groups": lets the
 * tutor pick which of that group's modules/weeks a copy of the component
 * being edited should land in, and exactly where in that week's rail.
 *
 * Always a snapshot copy (see copyComponentToWeek) — editing here never
 * reaches back into the original component. On success, the caller
 * (AssignedGroupsSection) marks the group as assigned.
 */
export interface PlacementResult {
  moduleCatalogueId: string;
  weekId: string;
  componentId: string;
}

export function GroupPlacementPanel({ component, groupName, programmeId, onClose, onPlaced }: {
  component: ModuleComponent;
  groupName: string;
  programmeId: string;
  onClose: () => void;
  onPlaced: (result: PlacementResult) => void;
}) {
  const [step, setStep] = useState<Step>('module');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modules, setModules] = useState<CurriculumModule[]>([]);
  const [targetModule, setTargetModule] = useState<CurriculumModule | null>(null);
  const [targetStructure, setTargetStructure] = useState<ModuleCatalogueItem | null>(null);
  const [targetWeek, setTargetWeek] = useState<ModuleWeek | null>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    loadCurriculumScope()
      .then(scope => {
        if (!active) return;
        setModules(scope.modules);
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load modules.');
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const groupModules = useMemo(
    () => modules.filter(module => norm(module.group) === norm(groupName) && (!programmeId || module.programmeId === programmeId)),
    [modules, groupName, programmeId],
  );

  const selectModule = async (module: CurriculumModule) => {
    setTargetModule(module);
    setLoading(true);
    setError('');
    try {
      const structure = await loadModuleStructure(catalogueIdOf(module));
      if (!structure) {
        setError('That module has no structure yet.');
        return;
      }
      setTargetStructure(structure);
      setStep('week');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load that module.');
    } finally {
      setLoading(false);
    }
  };

  const selectWeek = (week: ModuleWeek) => {
    setTargetWeek(week);
    setInsertIndex(week.components.length);
    setStep('place');
  };

  const place = async () => {
    if (!targetStructure || !targetWeek || insertIndex === null) return;
    setSaving(true);
    setError('');
    try {
      const catalogueId = targetStructure.catalogueId;
      // Re-fetch right before saving rather than reusing the snapshot from
      // when the module was opened: browsing to a week and picking a spot can
      // take a while, and this module's *other* weeks/components may have
      // been edited (by this tutor elsewhere, or someone else) in that time.
      // Saving the stale snapshot would silently revert those.
      const freshStructure = await loadModuleStructure(catalogueId);
      if (!freshStructure) { setError('That module no longer exists.'); return; }
      const freshWeek = freshStructure.weekStructure.find(week => week.id === targetWeek.id);
      if (!freshWeek) { setError('That week no longer exists — go back and pick another.'); return; }
      const clampedIndex = Math.min(insertIndex, freshWeek.components.length);
      const clone = copyComponentToWeek(component, freshWeek.id, catalogueId);
      const nextWeekStructure = freshStructure.weekStructure.map(week => {
        if (week.id !== freshWeek.id) return week;
        const nextComponents = [...week.components];
        nextComponents.splice(clampedIndex, 0, clone);
        return { ...week, components: nextComponents };
      });
      await saveModuleStructure(catalogueId, { ...freshStructure, weekStructure: nextWeekStructure });
      void showCurriculumAlert({
        title: 'Placed',
        text: `Copied into ${groupName}'s ${weekLabel(freshWeek)}.`,
        icon: 'success',
        timer: 2200,
      });
      onPlaced({ moduleCatalogueId: catalogueId, weekId: freshWeek.id, componentId: clone.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to place this component there.');
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    setError('');
    if (step === 'week') { setStep('module'); setTargetModule(null); setTargetStructure(null); }
    else if (step === 'place') { setStep('week'); setTargetWeek(null); setInsertIndex(null); }
  };

  const stepTitle: Record<Step, string> = {
    module: `${groupName}'s modules`,
    week: `${groupName} › ${targetModule?.name ?? ''}`,
    place: `${groupName} › ${targetModule?.name ?? ''} › ${targetWeek ? weekLabel(targetWeek) : ''}`,
  };

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-primary-200 bg-background-50 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-background-200 bg-primary-50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {step !== 'module' && (
            <button type="button" onClick={back} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-foreground-500 hover:bg-background-100 hover:text-foreground-800">
              <AppIcon className="ri-arrow-left-line text-[13px]"></AppIcon>
            </button>
          )}
          <span className="truncate text-[11px] font-bold text-foreground-800">{stepTitle[step]}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-foreground-400 hover:bg-background-100 hover:text-foreground-800">
          <AppIcon className="ri-close-line text-[13px]"></AppIcon>
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-foreground-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-background-300 border-t-primary-500" />
            Loading…
          </div>
        ) : step === 'module' ? (
          groupModules.length ? (
            <div className="space-y-1.5">
              {groupModules.map(module => (
                <button key={catalogueIdOf(module)} type="button" onClick={() => void selectModule(module)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-left transition-smooth hover:border-primary-300">
                  <span className="truncate text-[12px] font-bold text-foreground-900">{module.name}</span>
                  <AppIcon className="ri-arrow-right-s-line shrink-0 text-foreground-300"></AppIcon>
                </button>
              ))}
            </div>
          ) : <p className="py-8 text-center text-[12px] text-foreground-400">No modules for {groupName} in this programme.</p>
        ) : step === 'week' ? (
          targetStructure?.weekStructure.length ? (
            <div className="space-y-1.5">
              {targetStructure.weekStructure.map(week => (
                <button key={week.id} type="button" onClick={() => selectWeek(week)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-left transition-smooth hover:border-primary-300">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-bold text-foreground-900">{weekLabel(week)}</span>
                    <span className="mt-0.5 block text-[10px] text-foreground-400">{week.components.length} component{week.components.length === 1 ? '' : 's'}</span>
                  </span>
                  <AppIcon className="ri-arrow-right-s-line shrink-0 text-foreground-300"></AppIcon>
                </button>
              ))}
            </div>
          ) : <p className="py-8 text-center text-[12px] text-foreground-400">This module has no weeks yet.</p>
        ) : targetWeek ? (
          <div className="space-y-1">
            <PlacementGap index={0} active={insertIndex === 0} onPick={setInsertIndex} />
            {targetWeek.components.map((existing, index) => (
              <Fragment key={existing.id}>
                <div className="rounded-md border border-background-200 bg-background-100/60 px-3 py-1.5 text-[11px] font-semibold text-foreground-500">
                  {existing.title || existing.type}
                </div>
                <PlacementGap index={index + 1} active={insertIndex === index + 1} onPick={setInsertIndex} />
              </Fragment>
            ))}
          </div>
        ) : null}
        {error && <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</p>}
      </div>

      {step === 'place' && (
        <div className="flex items-center justify-between gap-3 border-t border-background-200 bg-background-100 px-4 py-2.5">
          <span className="text-[11px] font-semibold text-foreground-500">
            {insertIndex !== null ? `Landing at position ${insertIndex + 1}` : 'Pick a spot above'}
          </span>
          <button
            type="button"
            onClick={() => void place()}
            disabled={insertIndex === null || saving}
            className="rounded-lg bg-primary-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-primary-700 disabled:opacity-40"
          >
            {saving ? 'Placing…' : 'Place here'}
          </button>
        </div>
      )}
    </div>
  );
}

function PlacementGap({ index, active, onPick }: { index: number; active: boolean; onPick: (index: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(index)}
      className={`flex h-6 w-full items-center justify-center rounded-md border border-dashed text-[10px] font-bold uppercase tracking-wide transition-smooth ${active ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-transparent text-transparent hover:border-primary-200 hover:text-primary-500'}`}
    >
      {active ? 'Insert here ✓' : '+ Insert here'}
    </button>
  );
}

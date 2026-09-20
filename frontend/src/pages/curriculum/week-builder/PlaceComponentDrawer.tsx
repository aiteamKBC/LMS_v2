import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import { type CurriculumModule } from '@/lib/curriculumApi';
import { loadCurriculumScope } from './weekTemplateData';
import { modulesForGroup } from '../shared/entities/groupModuleMatch';
import {
  copyComponentToWeek,
  loadModuleStructure,
  saveModuleStructure,
  type ModuleCatalogueItem,
  type ModuleComponent,
  type ModuleWeek,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';

type Step = 'module' | 'week';

const catalogueIdOf = (module: CurriculumModule) => module.moduleCatalogueId || module.catalogueId || module.id;
const weekLabel = (week: ModuleWeek) => week.title || `Week ${week.weekNumber}`;

/**
 * Modal launched from an unassigned group in "Assigned groups": lets the
 * tutor pick which of that group's modules a copy of the component being
 * edited should land in, then which of that module's weeks — any number of
 * them — get a copy appended to their rail.
 *
 * A popup rather than an inline panel: the inline version rendered wherever
 * the group card sat in the (often long) group grid, so opening it silently
 * scrolled the picker out of view every time.
 *
 * Always a snapshot copy per week (see copyComponentToWeek) — editing here
 * never reaches back into the original component. On success, the caller
 * (AssignedGroupsSection) marks the group as assigned.
 */
export interface PlacementResult {
  moduleCatalogueId: string;
  weekId: string;
  componentId: string;
}

export function GroupPlacementPanel({ component, groupId, groupName, programmeId, onClose, onPlaced }: {
  component: ModuleComponent;
  groupId?: string;
  groupName: string;
  programmeId: string;
  onClose: () => void;
  onPlaced: (results: PlacementResult[]) => void;
}) {
  const [step, setStep] = useState<Step>('module');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modules, setModules] = useState<CurriculumModule[]>([]);
  const [targetModule, setTargetModule] = useState<CurriculumModule | null>(null);
  const [targetStructure, setTargetStructure] = useState<ModuleCatalogueItem | null>(null);
  const [selectedWeekIds, setSelectedWeekIds] = useState<Set<string>>(new Set());
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
    () => modulesForGroup(modules, { groupId, groupName, programmeId }),
    [groupId, modules, groupName, programmeId],
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
      setSelectedWeekIds(new Set());
      setStep('week');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load that module.');
    } finally {
      setLoading(false);
    }
  };

  const toggleWeek = (weekId: string) => {
    setSelectedWeekIds(current => {
      const next = new Set(current);
      if (next.has(weekId)) next.delete(weekId); else next.add(weekId);
      return next;
    });
  };

  const place = async () => {
    if (!targetStructure || selectedWeekIds.size === 0) return;
    setSaving(true);
    setError('');
    try {
      const catalogueId = targetStructure.catalogueId;
      // Re-fetch right before saving rather than reusing the snapshot from
      // when the module was opened: picking weeks can take a while, and this
      // module's *other* weeks/components may have been edited (by this
      // tutor elsewhere, or someone else) in that time. Saving the stale
      // snapshot would silently revert those.
      const freshStructure = await loadModuleStructure(catalogueId, { skipCache: true });
      if (!freshStructure) { setError('That module no longer exists.'); return; }
      const missing = Array.from(selectedWeekIds).filter(id => !freshStructure.weekStructure.some(week => week.id === id));
      if (missing.length) { setError('One of the selected weeks no longer exists — go back and pick again.'); return; }
      const results: PlacementResult[] = [];
      const nextWeekStructure = freshStructure.weekStructure.map(week => {
        if (!selectedWeekIds.has(week.id)) return week;
        const clone = copyComponentToWeek(component, week.id, catalogueId);
        results.push({ moduleCatalogueId: catalogueId, weekId: week.id, componentId: clone.id });
        return { ...week, components: [...week.components, clone] };
      });
      await saveModuleStructure(catalogueId, { ...freshStructure, weekStructure: nextWeekStructure });
      void showCurriculumAlert({
        title: 'Placed',
        text: `Copied into ${groupName}'s ${results.length} week${results.length === 1 ? '' : 's'}.`,
        icon: 'success',
        timer: 2200,
      });
      onPlaced(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to place this component there.');
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    setError('');
    setStep('module');
    setTargetModule(null);
    setTargetStructure(null);
    setSelectedWeekIds(new Set());
  };

  const close = () => { if (!saving) onClose(); };

  const stepTitle = step === 'module' ? `${groupName}'s modules` : `${groupName} › ${targetModule?.name ?? ''}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground-950/50 backdrop-blur-sm" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="place-component-title" className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-background-200 bg-primary-50 px-4 py-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {step !== 'module' && (
              <button type="button" onClick={back} disabled={saving} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-foreground-500 hover:bg-background-100 hover:text-foreground-800 disabled:opacity-50">
                <AppIcon className="ri-arrow-left-line text-[13px]"></AppIcon>
              </button>
            )}
            <span id="place-component-title" className="truncate text-[12px] font-bold text-foreground-800">{stepTitle}</span>
          </div>
          <button type="button" onClick={close} disabled={saving} aria-label="Close" className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-foreground-400 hover:bg-background-100 hover:text-foreground-800 disabled:opacity-50">
            <AppIcon className="ri-close-line text-[13px]"></AppIcon>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
          ) : targetStructure?.weekStructure.length ? (
            <div className="space-y-1.5">
              {targetStructure.weekStructure.map(week => {
                const checked = selectedWeekIds.has(week.id);
                return (
                  <div
                    key={week.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleWeek(week.id)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleWeek(week.id); } }}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left cursor-pointer transition-colors ${checked ? 'border-primary-300 bg-primary-50' : 'border-background-200 bg-background-50 hover:border-primary-200'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onClick={event => event.stopPropagation()}
                      onChange={() => toggleWeek(week.id)}
                      className="shrink-0 accent-primary-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-bold text-foreground-900">{weekLabel(week)}</span>
                      <span className="mt-0.5 block text-[10px] text-foreground-400">{week.components.length} component{week.components.length === 1 ? '' : 's'}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : <p className="py-8 text-center text-[12px] text-foreground-400">This module has no weeks yet.</p>}
          {error && <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</p>}
        </div>

        {step === 'week' && (
          <div className="flex items-center justify-between gap-3 border-t border-background-200 bg-background-100 px-4 py-3">
            <span className="text-[11px] font-semibold text-foreground-500">
              {selectedWeekIds.size > 0 ? `${selectedWeekIds.size} week${selectedWeekIds.size === 1 ? '' : 's'} selected` : 'Pick one or more weeks above'}
            </span>
            <button
              type="button"
              onClick={() => void place()}
              disabled={selectedWeekIds.size === 0 || saving}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-primary-700 disabled:opacity-40"
            >
              {saving ? 'Placing…' : `Place in ${selectedWeekIds.size || ''} week${selectedWeekIds.size === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

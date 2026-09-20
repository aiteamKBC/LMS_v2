import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import type { CurriculumModule } from '@/lib/curriculumApi';
import { loadCurriculumScope } from '../week-builder/weekTemplateData';
import { modulesForGroup } from '../shared/entities/groupModuleMatch';
import {
  copyWeekToModule,
  loadModuleStructure,
  recalculateModule,
  saveModuleStructure,
  type ModuleWeek,
} from './moduleAuthoringData';

const catalogueIdOf = (module: CurriculumModule) => module.moduleCatalogueId || module.catalogueId || module.id;

/** Places an entire authored week at the end of a module in the selected group. */
export function PlaceWeekDrawer({ week, groupId, groupName, programmeId, onClose, onPlaced }: {
  week: ModuleWeek;
  groupId?: string;
  groupName: string;
  programmeId: string;
  onClose: () => void;
  onPlaced: (target: { moduleCatalogueId: string; weekId: string }) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [modules, setModules] = useState<CurriculumModule[]>([]);

  useEffect(() => {
    let active = true;
    loadCurriculumScope()
      .then(scope => { if (active) setModules(scope.modules); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Unable to load modules.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const groupModules = useMemo(
    () => modulesForGroup(modules, { groupId, groupName, programmeId }),
    [groupId, groupName, modules, programmeId],
  );

  const place = async (target: CurriculumModule) => {
    const catalogueId = catalogueIdOf(target);
    if (!catalogueId || savingId) return;
    setSavingId(catalogueId);
    setError('');
    try {
      // The write replaces a whole module structure, so always copy into a
      // current target rather than the compact list's stale summary.
      const fresh = await loadModuleStructure(catalogueId, { skipCache: true });
      if (!fresh) throw new Error('That module no longer exists.');
      const copy = copyWeekToModule(week, catalogueId, fresh.weekStructure.length + 1);
      await saveModuleStructure(catalogueId, recalculateModule({
        ...fresh,
        weekStructure: [...fresh.weekStructure, copy],
      }));
      await showCurriculumAlert({
        title: 'Week placed',
        text: `A full copy was added to ${target.name}. Any live sessions need a new Teams meeting.`,
        icon: 'success',
        timer: 2400,
      });
      onPlaced({ moduleCatalogueId: catalogueId, weekId: copy.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to place this week.');
    } finally {
      setSavingId('');
    }
  };

  const close = () => { if (!savingId) onClose(); };
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-foreground-950/50 p-4 backdrop-blur-sm" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="place-week-title" className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b border-background-200 bg-primary-50 px-4 py-3">
          <div className="min-w-0">
            <h3 id="place-week-title" className="truncate text-[13px] font-bold text-foreground-900">Place Week {week.weekNumber} in {groupName}</h3>
            <p className="mt-0.5 text-[10px] text-foreground-500">Choose a module. The week is added to the end of its course structure.</p>
          </div>
          <button type="button" onClick={close} disabled={Boolean(savingId)} aria-label="Close" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-foreground-400 hover:bg-background-100 disabled:opacity-50"><AppIcon className="ri-close-line" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? <p className="py-8 text-center text-[12px] text-foreground-500">Loading modules...</p>
            : groupModules.length ? <div className="space-y-2">{groupModules.map(module => {
              const id = catalogueIdOf(module);
              const saving = savingId === id;
              return <div key={id} className="flex items-center justify-between gap-3 rounded-xl border border-background-200 bg-background-50 p-3">
                <div className="min-w-0"><p className="truncate text-[12px] font-bold text-foreground-900">{module.name}</p><p className="mt-0.5 text-[10px] text-foreground-500">{module.weeks || 0} existing weeks</p></div>
                <button type="button" onClick={() => void place(module)} disabled={Boolean(savingId)} className="shrink-0 rounded-lg bg-primary-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-primary-700 disabled:opacity-50">{saving ? 'Placing...' : 'Add week'}</button>
              </div>;
            })}</div> : <p className="py-8 text-center text-[12px] text-foreground-400">No modules for {groupName} in this programme.</p>}
          {error && <p role="alert" className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}

import type { AssignmentLearner } from '@/api/curriculumLearnerAssignments';
import { AppIcon } from '@/components/feature/AppIcon';
import type { Tab } from './selection';

export function LearnerRows({ visible, tab, toAdd, toRemove, canUnassign, saving, toggleRemove, toggleAdd }: {
  visible: AssignmentLearner[];
  tab: Tab;
  toAdd: Set<string>;
  toRemove: Set<string>;
  canUnassign: boolean;
  saving: boolean;
  toggleRemove: (id: string) => void;
  toggleAdd: (id: string) => void;
}) {
  return (<div className="max-h-[42vh] overflow-auto">
    {visible.length === 0 ? (
      <p className="p-8 text-center text-[12px] text-foreground-500">
        {tab === 'available'
          ? 'No unassigned learners match these filters.'
          : 'No assigned learners match these filters.'}
      </p>
    ) : visible.map(learner => {
      const marked = tab === 'available' ? toAdd.has(learner.id) : toRemove.has(learner.id);
      const facts = [learner.programme, learner.company, learner.programmeStatus].filter(Boolean).join(' · ') || 'No programme or company recorded';
      if (tab === 'assigned') {
        return (
          <div key={learner.id} className={`flex items-start gap-3 border-b border-foreground-100 p-4 last:border-0 ${marked ? 'bg-rose-50/60' : ''}`}>
            <span className="min-w-0 flex-1 text-[12px]">
              <span className="block font-bold text-foreground-900">{learner.name}</span>
              <span className="block break-all text-foreground-500">{learner.email}</span>
              <span className="mt-1 block text-foreground-600">{facts}</span>
            </span>
            {marked && <span className="shrink-0 rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700"><AppIcon className="ri-close-line mr-1" />Will be removed</span>}
            {canUnassign && (
              <button type="button" disabled={saving} onClick={() => toggleRemove(learner.id)}
                className={`shrink-0 rounded-lg border px-3 py-1 text-[11px] font-bold ${marked
                  ? 'border-foreground-300 text-foreground-700'
                  : 'border-rose-300 text-rose-700 hover:bg-rose-50'}`}>
                {marked ? `Keep ${learner.name.split(' ')[0] || 'learner'}` : 'Remove'}
              </button>
            )}
          </div>
        );
      }
      return (
        <label key={learner.id} className={`flex items-start gap-3 border-b border-foreground-100 p-4 last:border-0 ${marked ? 'bg-primary-50/50' : 'hover:bg-primary-50/40'}`}>
          <input className="mt-1" type="checkbox" aria-label={`Select ${learner.name}`}
            checked={marked} disabled={saving} onChange={() => toggleAdd(learner.id)} />
          <span className="min-w-0 flex-1 text-[12px]">
            <span className="block font-bold text-foreground-900">{learner.name}</span>
            <span className="block break-all text-foreground-500">{learner.email}</span>
            <span className="mt-1 block text-foreground-600">{facts}</span>
          </span>
          {marked && <span className="shrink-0 rounded-full bg-primary-50 px-2 py-1 text-[10px] font-bold text-primary-800"><AppIcon className="ri-check-line mr-1" />Will be added</span>}
        </label>
      );
    })}
  </div>);
}

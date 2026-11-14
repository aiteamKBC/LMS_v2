import { useEffect, useId, useState, type ReactNode } from 'react';
import { authoredWeekPoints } from '@/api/webWeekPoints';
import { componentAuthoringDefinitions } from './componentAuthoringModel';
import type { ModuleComponent } from './moduleAuthoringData';
import type { WeekPointDrafts } from './useWeekPointDrafts';

/** Navigation shares the editor's draft; expanding a Point never saves it. */
export function WeekPointsNavigation({ moduleId, weekId, drafts, components, selectedId, onSelect, renderActivity, expandAll = false, revealComponentId = '' }: {
  moduleId: string;
  weekId: string;
  drafts: WeekPointDrafts;
  components: Pick<ModuleComponent, 'id' | 'title' | 'type'>[];
  selectedId: string | null;
  onSelect: (componentId: string) => void;
  renderActivity?: (componentId: string) => ReactNode;
  expandAll?: boolean;
  revealComponentId?: string;
}) {
  const draft = drafts.get(moduleId, weekId);
  const loaded = Boolean(draft);
  const { install } = drafts;
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const regionId = useId();

  useEffect(() => {
    if (loaded) return;
    let active = true;
    setError('');
    authoredWeekPoints(moduleId, weekId).then(data => {
      if (active) install(data);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load Points.');
    });
    return () => { active = false; };
  }, [moduleId, weekId, loaded, install, retry]);

  const renderActivities = (activities: typeof components) => <ul className="space-y-1">
    {activities.map(activity => {
      const rendered = renderActivity?.(activity.id);
      // A recording may already appear inside its live session's card.
      if (renderActivity && rendered == null) return null;
      return <li key={activity.id}>
        {renderActivity ? rendered :
          <button type="button" onClick={() => onSelect(activity.id)} aria-current={selectedId === activity.id ? 'true' : undefined}
            className={`w-full rounded-md px-2 py-2 text-left focus-visible:outline-primary-500 ${selectedId === activity.id ? 'bg-primary-100 text-primary-900' : 'text-foreground-800 hover:bg-primary-50'}`}>
            <span className="block break-words text-[11px] font-medium [overflow-wrap:anywhere]">{activity.title || 'Untitled activity'}</span>
            <span className="mt-0.5 block text-[10px] text-primary-600">{componentAuthoringDefinitions.find(item => item.type === activity.type)?.label || activity.type}</span>
          </button>}
      </li>;
    })}
  </ul>;

  // Points only group activities. A failed or pending grouping read must not
  // hide components already loaded by the authoring workspace. Do not install
  // an empty draft: the saved membership is still unknown and must survive.
  if (!draft) return <div className="mb-3 space-y-2">
    <div className="text-[11px] text-foreground-500">
      {error ? <>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => setRetry(value => value + 1)} className="mt-1 text-primary-700 underline">Retry loading Points</button>
      </> : <p role="status">Loading Points…</p>}
    </div>
    {components.length > 0 && renderActivities(components)}
  </div>;
  if (!draft.points.length && !components.length) return null;

  const byId = new Map(components.map(component => [component.id, component]));
  const assignedIds = new Set(draft.points.flatMap(point => point.componentIds));
  const groups = draft.points.map((point, index) => ({
    id: `point-${point.id}`,
    title: point.title || `Point ${index + 1}`,
    // The editable rail keeps the week's order so its reorder controls retain
    // their meaning. The standalone navigation follows the Point's own order.
    activities: renderActivity ? components.filter(component => point.componentIds.includes(component.id))
      : point.componentIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []),
  }));
  groups.push({ id: 'other-components', title: 'Other components', activities: components.filter(component => !assignedIds.has(component.id)) });
  return <nav aria-label="Week Points navigation" className="mb-3 space-y-1.5">
    {draft.points.length > 0 && <h4 className="px-1 text-[10px] font-bold uppercase tracking-wide text-primary-700">Week Points</h4>}
    {groups.map(point => {
      const { activities } = point;
      const open = expandAll || expanded.has(point.id) || activities.some(activity => activity.id === revealComponentId);
      const panelId = `${regionId}-${point.id}`;
      return <div key={point.id} className="overflow-hidden rounded-lg border border-primary-100 bg-background-50">
        <button type="button" aria-expanded={open} aria-controls={panelId}
          aria-label={`${point.title}, ${activities.length} ${activities.length === 1 ? 'activity' : 'activities'}`}
          onClick={() => setExpanded(previous => {
            const next = new Set(previous);
            if (next.has(point.id)) next.delete(point.id); else next.add(point.id);
            return next;
          })}
          className="flex w-full items-start gap-2 px-2.5 py-2 text-left text-[11px] font-semibold text-primary-900 hover:bg-primary-50 focus-visible:outline-primary-500">
          <svg aria-hidden="true" viewBox="0 0 20 20" className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${open ? '' : '-rotate-90'}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 7 5 5 5-5" /></svg>
          <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{point.title}</span>
          <span className="shrink-0 text-[10px] font-normal text-foreground-500">{activities.length}</span>
        </button>
        <div id={panelId} hidden={!open} className="border-t border-primary-100 px-2 py-1">
          {activities.length ? renderActivities(activities) : <p className="px-2 py-2 text-[11px] text-foreground-500">No activities to show.</p>}
        </div>
      </div>;
    })}
  </nav>;
}

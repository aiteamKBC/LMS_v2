import { Fragment, useEffect, useId, useState, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { authoredWeekPoints, type WebPoint } from '@/api/webWeekPoints';
import { reorderWeekPoints } from './weekPointStructure';
import { componentAuthoringDefinitions } from './componentAuthoringModel';
import type { ModuleComponent } from './moduleAuthoringData';
import type { WeekPointDrafts } from './useWeekPointDrafts';

/** Navigation shares the editor's draft; expanding a Point never saves it. */
export function WeekPointsNavigation({ moduleId, weekId, drafts, components, selectedId, onSelect, renderActivity, onAddComponent, readOnly = false, expandAll = false, revealComponentId = '' }: {
  moduleId: string;
  weekId: string;
  drafts: WeekPointDrafts;
  components: Pick<ModuleComponent, 'id' | 'title' | 'type'>[];
  selectedId: string | null;
  onSelect: (componentId: string) => void;
  renderActivity?: (componentId: string) => ReactNode;
  onAddComponent?: (pointId: string) => void;
  readOnly?: boolean;
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

  const pointsStatus = !draft ? <div className="mb-3 text-[11px] text-foreground-500">
    {error ? <>
      <p role="alert">{error}</p>
      <button type="button" onClick={() => setRetry(value => value + 1)} className="mt-1 text-primary-700 underline">Retry loading Points</button>
    </> : <p role="status">Loading Points…</p>}
  </div> : null;

  if (renderActivity) return <>
    {pointsStatus}
    {draft?.notice && <p role="status" className="mb-2 text-[11px] text-amber-700">{draft.notice}</p>}
    <WeekPointSections weekId={weekId} points={draft?.points || []} components={components} selectedId={selectedId}
      renderActivity={renderActivity} onAddComponent={onAddComponent} expandAll={expandAll} revealComponentId={revealComponentId}
      readOnly={readOnly || !draft} onChange={next => { if (!readOnly) drafts.update(moduleId, weekId, () => next); }} />
  </>;
  if (!draft) return pointsStatus;
  if (!draft.points.length && !components.length) return null;

  const byId = new Map(components.map(component => [component.id, component]));
  const assignedIds = new Set(draft.points.flatMap(point => point.componentIds));
  const groups = draft.points.map((point, index) => ({
    id: `point-${point.id}`,
    title: point.title || `Point ${index + 1}`,
    activities: point.componentIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []),
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
          {activities.length ? <ul className="space-y-1">
            {activities.map(activity => <li key={activity.id}>
              <button type="button" onClick={() => onSelect(activity.id)} aria-current={selectedId === activity.id ? 'true' : undefined}
                className={`w-full rounded-md px-2 py-2 text-left focus-visible:outline-primary-500 ${selectedId === activity.id ? 'bg-primary-100 text-primary-900' : 'text-foreground-800 hover:bg-primary-50'}`}>
                <span className="block break-words text-[11px] font-medium [overflow-wrap:anywhere]">{activity.title || 'Untitled activity'}</span>
                <span className="mt-0.5 block text-[10px] text-primary-600">{componentAuthoringDefinitions.find(item => item.type === activity.type)?.label || activity.type}</span>
              </button>
            </li>)}
          </ul> : <p className="px-2 py-2 text-[11px] text-foreground-500">No activities to show.</p>}
        </div>
      </div>;
    })}
  </nav>;
}

function PointDropRegion({ weekId, pointId, enabled, children }: { weekId: string; pointId: string | null; enabled: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: pointId === null ? `week-point-outside:${weekId}` : `week-point-target:${weekId}:${pointId}`,
    data: { kind: 'week-point-target', pointId }, disabled: !enabled });
  return <div ref={setNodeRef} className={`min-w-0 rounded-lg ${isOver ? 'ring-2 ring-primary-400 bg-primary-50' : ''}`}>{children}</div>;
}

function WeekPointSections({ weekId, points, components, selectedId, renderActivity, onAddComponent, onChange, readOnly, expandAll, revealComponentId }: {
  weekId: string; points: WebPoint[]; components: Pick<ModuleComponent, 'id' | 'title' | 'type'>[]; selectedId: string | null;
  renderActivity: (id: string) => ReactNode; onAddComponent?: (pointId: string) => void;
  onChange: (points: WebPoint[]) => void; readOnly: boolean; expandAll: boolean; revealComponentId: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draggedPoint, setDraggedPoint] = useState<string | null>(null);
  const regionId = useId();
  const selectedPointId = points.find(point => point.componentIds.includes(selectedId || ''))?.id;
  useEffect(() => {
    if (selectedPointId) setExpanded(previous => new Set(previous).add(selectedPointId));
  }, [selectedPointId]);
  const renderRows = (items: typeof components) => items.map(activity => <Fragment key={activity.id}>{renderActivity(activity.id)}</Fragment>);
  const assigned = new Set(points.flatMap(point => point.componentIds));
  const reorder = (source: string, target: string) => { if (!readOnly) onChange(reorderWeekPoints(points, source, target)); };
  return <section aria-label="Week components" className="min-w-0 space-y-2">
    {points.map((point, index) => {
      const title = point.title || `Point ${index + 1}`;
      const activities = components.filter(component => point.componentIds.includes(component.id));
      const open = expandAll || expanded.has(point.id) || activities.some(activity => activity.id === revealComponentId);
      const panelId = `${regionId}-${point.id}`;
      return <PointDropRegion key={point.id} weekId={weekId} pointId={point.id} enabled={Boolean(onAddComponent) && !readOnly}>
        <div className={`rounded-lg border border-primary-200 bg-background-50 ${draggedPoint === point.id ? 'opacity-50' : ''}`}
          onDragOver={event => { if (draggedPoint && !readOnly) event.preventDefault(); }}
          onDrop={event => { if (!draggedPoint || readOnly) return; event.preventDefault(); event.stopPropagation(); reorder(draggedPoint, point.id); setDraggedPoint(null); }}>
          <div className="flex items-start gap-1 p-1.5">
            <button type="button" draggable={!readOnly} disabled={readOnly} aria-label={`Drag ${title} to reorder Points`}
              onDragStart={event => { if (readOnly || event.currentTarget.matches(':disabled')) { event.preventDefault(); return; }
                event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', point.id); setDraggedPoint(point.id); }}
              onDragEnd={() => setDraggedPoint(null)} className="grid h-8 w-5 shrink-0 cursor-grab place-items-center text-primary-400 active:cursor-grabbing">
              <svg aria-hidden="true" width="12" height="20" viewBox="0 0 12 20" fill="currentColor">{[5, 10, 15].flatMap(y => [4, 8].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />))}</svg>
            </button>
            <button type="button" aria-expanded={open} aria-controls={panelId} aria-label={`${title}, ${activities.length} ${activities.length === 1 ? 'activity' : 'activities'}`}
              onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(point.id)) next.delete(point.id); else next.add(point.id); return next; })}
              className="flex min-h-8 min-w-0 flex-1 items-start gap-1.5 py-1 text-left text-[11px] font-semibold text-primary-900">
              <svg aria-hidden="true" viewBox="0 0 20 20" className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${open ? '' : '-rotate-90'}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 7 5 5 5-5" /></svg>
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]"><span className="mr-1 text-primary-400">{index + 1}.</span>{title}</span>
              <span className="shrink-0 font-normal text-foreground-500">{activities.length}</span>
            </button>
            <div className="flex shrink-0">
              <button type="button" disabled={readOnly || index === 0} aria-label={`Move ${title} up`} onClick={() => reorder(point.id, points[index - 1].id)} className="h-8 w-5 text-primary-600 disabled:opacity-25">↑</button>
              <button type="button" disabled={readOnly || index === points.length - 1} aria-label={`Move ${title} down`} onClick={() => reorder(point.id, points[index + 1].id)} className="h-8 w-5 text-primary-600 disabled:opacity-25">↓</button>
            </div>
          </div>
          <div id={panelId} role="group" aria-label={`${title} components`} hidden={!open} className="border-t border-primary-100 px-1.5 py-2">
            {activities.length ? renderRows(activities) : <p className="px-2 py-2 text-[11px] text-foreground-500">No components in this Point.</p>}
            {onAddComponent && <button type="button" disabled={readOnly} onClick={() => onAddComponent(point.id)}
              className="mt-1 min-h-8 w-full rounded-md border border-dashed border-primary-200 px-2 py-1 text-[11px] font-semibold text-primary-700 hover:bg-primary-50">Add component to {title}</button>}
          </div>
        </div>
      </PointDropRegion>;
    })}
    <PointDropRegion weekId={weekId} pointId={null} enabled={Boolean(onAddComponent) && !readOnly}>
      {points.length > 0 && <p className="rounded-md border border-dashed border-background-300 px-2 py-2 text-[10px] font-semibold text-foreground-500">Week components — outside Points</p>}
      {renderRows(components.filter(component => !assigned.has(component.id)))}
    </PointDropRegion>
    <button type="button" disabled={readOnly || points.length >= 100} onClick={() => {
      const id = crypto.randomUUID();
      onChange([...points, { id, title: `Point ${points.length + 1}`, componentIds: [] }]);
      setExpanded(previous => new Set(previous).add(id));
    }} className="min-h-8 w-full rounded-lg border border-primary-200 px-2 py-1.5 text-[11px] font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-40">Add Point</button>
  </section>;
}

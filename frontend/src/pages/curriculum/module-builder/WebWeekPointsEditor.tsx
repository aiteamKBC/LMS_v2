import { useEffect, useState } from 'react';
import { authoredWeekPoints, type WebPoint } from '@/api/webWeekPoints';

import type { WeekPointDrafts } from './useWeekPointDrafts';

export function WebWeekPointsEditor({ moduleId, weekId, drafts, busy = false }: {
  moduleId: string; weekId: string; drafts: WeekPointDrafts; busy?: boolean;
}) {
  const draft = drafts.get(moduleId, weekId);
  const data = draft?.data;
  const points = draft?.points || [];
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const dirty = !!data && JSON.stringify(points) !== JSON.stringify(data.points);
  const { install, update } = drafts;
  useEffect(() => {
    let active = true;
    setError('');
    authoredWeekPoints(moduleId, weekId).then(result => {
      if (active) install(result);
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load Points.'); });
    return () => { active = false; };
  }, [moduleId, weekId, reload, install]);
  const setPoints = (updater: (previous: WebPoint[]) => WebPoint[]) => update(moduleId, weekId, updater);
  const change = (index: number, patch: Partial<WebPoint>) => {
    setPoints(previous => previous.map((point, at) => at === index ? { ...point, ...patch } : point));
  };
  const move = (index: number, offset: number) => setPoints(previous => {
    const next = [...previous];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    return next;
  });
  return <section aria-label="Week Points" className="space-y-4 rounded-2xl border border-primary-200 bg-background-50 p-5">
    <div><h3 className="font-bold text-primary-900">Week Points</h3>
      <p className="mt-1 text-sm text-foreground-500">Create a Point, give it a name and select activities from this week. Selected activities appear inside the Point for learners. Other activities stay visible in the week. Points do not restrict activity access.</p></div>
    {error && <div role="alert" className="text-sm text-red-700">{error}</div>}
    {draft?.notice && <p role="status" className="text-sm text-amber-700">{draft.notice}</p>}
    {!data && !error && <p role="status">Loading Points…</p>}
    <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)} className="text-sm text-primary-700 underline">Reload saved activities and Points</button>
    {data && <fieldset disabled={busy} className="space-y-4">
      {points.map((point, index) => <fieldset key={point.id} aria-label={`Point ${index + 1}`} className="rounded-xl border border-background-300 p-4">
        <legend className="px-1 text-sm font-semibold">
          <button type="button" aria-expanded={!collapsed.has(point.id)} aria-controls={`point-fields-${point.id}`}
            aria-label={`${collapsed.has(point.id) ? 'Expand' : 'Collapse'} Point ${index + 1}`}
            className="flex items-center gap-2 py-1 text-primary-900"
            onClick={() => setCollapsed(previous => {
              const next = new Set(previous);
              if (next.has(point.id)) next.delete(point.id); else next.add(point.id);
              return next;
            })}>
            <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 transition-transform ${collapsed.has(point.id) ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 7 5 5 5-5" /></svg>
            <span>{point.title || `Point ${index + 1}`}</span>
            <span className="text-xs font-normal text-foreground-500">{point.componentIds.length} activities</span>
          </button>
        </legend>
        <div id={`point-fields-${point.id}`} hidden={collapsed.has(point.id)}>
        <label className="block text-sm">Point name<input aria-label={`Point ${index + 1} name`} maxLength={120}
          value={point.title} onChange={event => change(index, { title: event.target.value })}
          className="mt-1 block w-full rounded-lg border border-background-300 bg-white px-3 py-2" /></label>
        <div className="my-3 flex flex-wrap gap-3 text-sm">
          <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>Move up</button>
          <button type="button" disabled={index === points.length - 1} onClick={() => move(index, 1)}>Move down</button>
          <button type="button" onClick={() => setPoints(previous => previous.filter(item => item.id !== point.id))}>Remove Point</button>
        </div>
        <p className="mb-2 text-xs text-foreground-500">{point.componentIds.length} activities selected</p>
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {data.activities.map(activity => {
            const elsewhere = points.some(other => other.id !== point.id && other.componentIds.includes(activity.id));
            return <label key={activity.id} className="flex cursor-pointer items-start gap-2 py-1 text-sm">
              <input type="checkbox" className="mt-0.5 !h-4 !min-h-0 !w-4 shrink-0 !rounded !p-0 accent-primary-600" disabled={elsewhere} checked={point.componentIds.includes(activity.id)}
                onChange={event => change(index, { componentIds: event.target.checked
                  ? [...point.componentIds, activity.id] : point.componentIds.filter(id => id !== activity.id) })} />
              <span>{activity.title || activity.type}{elsewhere && <span className="ml-1 text-xs text-foreground-500">(in another Point)</span>}</span>
            </label>;
          })}
          {point.componentIds.filter(id => !data.activities.some(activity => activity.id === id)).map(id =>
            <label key={id} className="flex cursor-pointer items-start gap-2 py-1 text-sm text-amber-700"><input type="checkbox" className="mt-0.5 !h-4 !min-h-0 !w-4 shrink-0 !rounded !p-0 accent-primary-600" checked onChange={() => change(index, { componentIds: point.componentIds.filter(value => value !== id) })} />Activity removed from this week — uncheck to remove it from this Point.</label>)}
          {!data.activities.length && <p className="text-sm text-foreground-500">Save activities in this week to select them here.</p>}
        </div>
        </div>
      </fieldset>)}
      <div className="flex items-center gap-3">
        <button type="button" disabled={points.length >= 100} onClick={() => setPoints(previous => [...previous, { id: crypto.randomUUID(), title: `Point ${previous.length + 1}`, componentIds: [] }])}
          className="rounded-lg border border-primary-300 px-3 py-2 text-sm font-semibold text-primary-700">Add Point</button>
        {dirty && <span className="text-xs text-amber-700">Unsaved Points changes — use Save module below</span>}
      </div>
    </fieldset>}
  </section>;
}

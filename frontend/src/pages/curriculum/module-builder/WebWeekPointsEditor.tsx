import { useEffect, useState } from 'react';
import { authoredWeekPoints, type AuthoredWeekPoints, type WebPoint } from '@/api/webWeekPoints';

export function WebWeekPointsEditor({ moduleId, weekId }: { moduleId: string; weekId: string }) {
  const [data, setData] = useState<AuthoredWeekPoints | null>(null);
  const [points, setPoints] = useState<WebPoint[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const draftPrefix = `web-week-points:${moduleId}:${weekId}:`;
  const draftKey = `${draftPrefix}${data?.editorId || ''}`;
  const dirty = !!data && JSON.stringify(points) !== JSON.stringify(data.points);
  useEffect(() => {
    let active = true;
    setData(null); setError(''); setNotice('');
    authoredWeekPoints(moduleId, weekId).then(result => {
      if (!active) return;
      setData(result); setPoints(result.points);
      try {
        const raw = sessionStorage.getItem(`${draftPrefix}${result.editorId}`);
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft.revision === result.revision && Array.isArray(draft.points)) {
            setPoints(draft.points); setNotice('Your unsaved Points changes have been restored.');
          } else setNotice('A previous draft is out of date. The latest saved Points are shown.');
        }
      } catch { setError('Your saved draft could not be restored. The latest server version is shown.'); }
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load Points.'); });
    return () => { active = false; };
  }, [moduleId, weekId, reload, draftPrefix]);
  useEffect(() => {
    if (!data || data.weekId !== weekId) return;
    try {
      if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({ revision: data.revision, points }));
      else sessionStorage.removeItem(draftKey);
    } catch { setError('Your browser cannot retain this draft. Save Points before leaving this week.'); }
  }, [data, dirty, draftKey, points, weekId]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = (index: number, patch: Partial<WebPoint>) => {
    setPoints(previous => previous.map((point, at) => at === index ? { ...point, ...patch } : point));
    setNotice('');
  };
  const move = (index: number, offset: number) => setPoints(previous => {
    const next = [...previous];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    return next;
  });
  const save = async () => {
    if (!data || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await authoredWeekPoints(moduleId, weekId, { ...data, points });
      setData(result); setPoints(result.points); setNotice('Week Points saved.');
      try { sessionStorage.removeItem(draftKey); }
      catch { setNotice('Week Points saved. The browser could not clear the older local draft.'); }
      window.dispatchEvent(new Event('web-points-updated'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save Points.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Week Points" className="space-y-4 rounded-2xl border border-primary-200 bg-background-50 p-5">
    <div><h3 className="font-bold text-primary-900">Week Points</h3>
      <p className="mt-1 text-sm text-foreground-500">Create a Point, give it a name and select activities from this week. Selected activities appear inside the Point for learners. Other activities stay visible in the week. Points do not restrict activity access.</p></div>
    {error && <div role="alert" className="text-sm text-red-700">{error}</div>}
    {!data && !error && <p role="status">Loading Points…</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)} className="text-sm text-primary-700 underline">Reload saved activities and Points</button>
    {data && <fieldset disabled={busy} className="space-y-4">
      {points.map((point, index) => <fieldset key={point.id} className="rounded-xl border border-background-300 p-4">
        <legend className="px-1 text-sm font-semibold">Point {index + 1}</legend>
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
            return <label key={activity.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" disabled={elsewhere} checked={point.componentIds.includes(activity.id)}
                onChange={event => change(index, { componentIds: event.target.checked
                  ? [...point.componentIds, activity.id] : point.componentIds.filter(id => id !== activity.id) })} />
              <span>{activity.title || activity.type}{elsewhere && <span className="ml-1 text-xs text-foreground-500">(in another Point)</span>}</span>
            </label>;
          })}
          {point.componentIds.filter(id => !data.activities.some(activity => activity.id === id)).map(id =>
            <label key={id} className="flex gap-2 text-sm text-amber-700"><input type="checkbox" checked onChange={() => change(index, { componentIds: point.componentIds.filter(value => value !== id) })} />Activity removed from this week — uncheck to remove it from this Point.</label>)}
          {!data.activities.length && <p className="text-sm text-foreground-500">Save activities in this week to select them here.</p>}
        </div>
      </fieldset>)}
      <div className="flex items-center gap-3">
        <button type="button" disabled={points.length >= 100} onClick={() => setPoints(previous => [...previous, { id: crypto.randomUUID(), title: `Point ${previous.length + 1}`, componentIds: [] }])}
          className="rounded-lg border border-primary-300 px-3 py-2 text-sm font-semibold text-primary-700">Add Point</button>
        <button type="button" disabled={!dirty || points.some(point => !point.title.trim())} onClick={save}
          className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save Points'}</button>
        {dirty && <span className="text-xs text-amber-700">Unsaved Points changes</span>}
      </div>
    </fieldset>}
  </section>;
}

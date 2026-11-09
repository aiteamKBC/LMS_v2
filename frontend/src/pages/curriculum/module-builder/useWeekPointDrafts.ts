import { useCallback, useRef, useState } from 'react';
import { authoredWeekPoints, type AuthoredWeekPoints, type WebPoint } from '@/api/webWeekPoints';

type Draft = { data: AuthoredWeekPoints; points: WebPoint[]; notice?: string };
const keyOf = (moduleId: string, weekId: string) => `${moduleId}:${weekId}`;
const storageKey = (data: AuthoredWeekPoints) => `web-week-points:${data.moduleId}:${data.weekId}:${data.editorId}`;
const changed = (draft: Draft) => JSON.stringify(draft.points) !== JSON.stringify(draft.data.points);

/** Owned by the module workspace, so changing the selected week cannot lose a draft. */
export function useWeekPointDrafts(moduleId: string, weekIds: string[]) {
  const drafts = useRef<Record<string, Draft>>({});
  const [, render] = useState(0);
  const publish = useCallback((key: string, draft: Draft) => {
    try {
      if (changed(draft)) sessionStorage.setItem(storageKey(draft.data), JSON.stringify({ revision: draft.data.revision, points: draft.points }));
      else sessionStorage.removeItem(storageKey(draft.data));
    } catch { draft = { ...draft, notice: 'Your browser cannot retain this draft after closing the page. Use Save module before leaving.' }; }
    drafts.current[key] = draft;
    render(value => value + 1);
  }, []);
  const install = useCallback((data: AuthoredWeekPoints) => {
    const key = keyOf(data.moduleId, data.weekId);
    const existing = drafts.current[key];
    if (existing?.data.editorId === data.editorId && changed(existing)) {
      publish(key, { ...existing, data: { ...existing.data, activities: data.activities }, notice: data.revision !== existing.data.revision
        ? 'These Points changed on the server. Your unsaved edits are retained.' : existing.notice });
      return;
    }
    let points = data.points;
    let notice = '';
    try {
      const raw = sessionStorage.getItem(storageKey(data));
      const stored = raw ? JSON.parse(raw) : null;
      if (stored?.revision === data.revision && Array.isArray(stored.points)) {
        points = stored.points;
        notice = 'Your unsaved Points changes have been restored.';
      } else if (stored) notice = 'A previous draft is out of date. The latest saved Points are shown.';
    } catch { notice = 'Your saved draft could not be restored. The latest server version is shown.'; }
    publish(key, { data, points, notice });
  }, [publish]);
  const update = useCallback((module: string, week: string, updater: (points: WebPoint[]) => WebPoint[]) => {
    const key = keyOf(module, week);
    const draft = drafts.current[key];
    if (draft) publish(key, { ...draft, points: updater(draft.points) });
  }, [publish]);
  const discard = useCallback((module: string) => {
    Object.entries(drafts.current).forEach(([key, draft]) => {
      if (draft.data.moduleId === module) publish(key, { ...draft, points: draft.data.points });
    });
  }, [publish]);
  const save = useCallback(async (module: string, savedWeekIds: string[]) => {
    const pending = Object.entries(drafts.current).filter(([, draft]) =>
      draft.data.moduleId === module && savedWeekIds.includes(draft.data.weekId) && changed(draft));
    for (const [key, sent] of pending) {
      try {
        if (sent.points.some(point => !point.title.trim())) throw new Error('Give every Point a name.');
        const data = await authoredWeekPoints(module, sent.data.weekId, { ...sent.data, points: sent.points });
        const current = drafts.current[key];
        // A reply acknowledges only the submitted version, never newer typing.
        publish(key, { data, points: current === sent ? data.points : current.points });
        window.dispatchEvent(new Event('web-points-updated'));
      } catch (error) {
        throw new Error(`Module changes saved, but Week Points could not be saved. Your remaining Points edits are retained. ${error instanceof Error ? error.message : 'Please try again.'}`);
      }
    }
  }, [publish]);
  const active = Object.values(drafts.current).filter(draft => draft.data.moduleId === moduleId && weekIds.includes(draft.data.weekId) && changed(draft));
  return {
    install, update, discard, save,
    signature: active.length ? JSON.stringify(active.map(draft => [draft.data.weekId, draft.points])) : '',
    get: (module: string, week: string) => drafts.current[keyOf(module, week)],
  };
}

export type WeekPointDrafts = ReturnType<typeof useWeekPointDrafts>;

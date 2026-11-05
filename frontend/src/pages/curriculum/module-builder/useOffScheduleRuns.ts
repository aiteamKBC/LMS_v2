import { useEffect, useMemo, useState } from 'react';
import type { OffScheduleRun } from '../teams-meetings/offScheduleRuns';
import { loadTeamsOffScheduleRuns, type TeamsOffScheduleRunsResult } from './moduleAuthoringData';

interface WeekLike {
  id: string;
  components?: Array<{ type: string; settings?: Record<string, unknown> }>;
}

export interface WeekOffScheduleRuns {
  runs: OffScheduleRun[];
  timeZone: string;
}

const CACHE_MS = 60000;
const cache = new Map<string, { at: number; request: Promise<TeamsOffScheduleRunsResult | null> }>();

function cachedLoad(liveSessionId: string) {
  const hit = cache.get(liveSessionId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.request;
  // The notes only explain; a calendar whose log cannot be read shows none
  // rather than holding up the builder.
  const request = loadTeamsOffScheduleRuns(liveSessionId).catch(() => null);
  cache.set(liveSessionId, { at: Date.now(), request });
  return request;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * The Teams calls on each week's live-session link that were not that week's
 * session -- the link tried before it, another day's use -- by week id. Read
 * from the module's own calendars, matched by the occurrence each live-session
 * component already carries.
 */
export function useOffScheduleRuns(module: { weekStructure?: WeekLike[] } | null | undefined) {
  const weeks = module?.weekStructure;
  const ids = useMemo(() => [...new Set((weeks || []).flatMap(week => (week.components || [])
    .filter(component => component.type === 'live-session')
    .map(component => text(component.settings?.teamsLiveSessionId))
    .filter(Boolean)))].sort(), [weeks]);
  const key = ids.join('|');
  const [loaded, setLoaded] = useState<Record<string, TeamsOffScheduleRunsResult>>({});
  useEffect(() => {
    let live = true;
    if (!ids.length) {
      setLoaded({});
      return undefined;
    }
    void Promise.all(ids.map(id => cachedLoad(id))).then(results => {
      if (!live) return;
      setLoaded(Object.fromEntries(results.flatMap((result, index) => (result ? [[ids[index], result]] : []))));
    });
    return () => { live = false; };
    // `key` names `ids`: the read repeats only when the module's calendars change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useMemo(() => {
    const byWeek = new Map<string, WeekOffScheduleRuns>();
    for (const week of weeks || []) {
      for (const component of week.components || []) {
        if (component.type !== 'live-session') continue;
        const calendar = loaded[text(component.settings?.teamsLiveSessionId)];
        const runs = calendar?.occurrences[text(component.settings?.teamsOccurrenceId)] || [];
        if (!runs.length) continue;
        const entry = byWeek.get(week.id) || { runs: [], timeZone: calendar.timeZoneIana || 'Europe/London' };
        entry.runs.push(...runs);
        byWeek.set(week.id, entry);
      }
    }
    return byWeek;
  }, [weeks, loaded]);
}

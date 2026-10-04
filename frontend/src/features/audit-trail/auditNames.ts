/**
 * Names for the identifiers a saved change refers to.
 *
 * A revision stores what the row actually held, which for a link field is a
 * list of ids. Rendered as-is that is unreadable, and summarised as a count it
 * is worse than unreadable: "2 linked groups" before and "2 linked groups"
 * after describes a real change as if nothing happened. So the ids are looked
 * up and shown by name.
 *
 * Nothing is fetched unless the events on screen actually contain ids of that
 * kind, and an id that cannot be named keeps its own text rather than being
 * dropped — a lookup miss must not quietly shorten the evidence.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  fetchArchivedCurriculumGroups,
  fetchCurriculumGroups,
  fetchCurriculumOverview,
} from '@/lib/curriculumApi';
import type { CurriculumAuditEvent } from '@/lib/curriculumApi';
import { auditIdList, RECORD_ID } from './activityTime';

/**
 * Every record id the events on screen refer to, from both sides of each diff.
 *
 * Gathered from the values rather than from the field names. The labels the
 * backend derives from a column are not a reliable index of where ids live —
 * it only ever looked at fields spelled "module ids" and "group ids", so a
 * link column under any other name was never looked up, and its values were
 * written out as raw identifiers.
 */
function recordIdsIn(events: CurriculumAuditEvent[]): string[] {
  const found = new Set<string>();
  for (const event of events) {
    for (const field of event.changes || []) {
      for (const side of [field.before, field.after]) {
        for (const id of auditIdList(side)) {
          if (RECORD_ID.test(id)) found.add(id);
        }
        if (typeof side === 'string' && RECORD_ID.test(side.trim())) found.add(side.trim());
      }
    }
  }
  return [...found];
}

const MODULE_ID = /^(?:APTEM-)?MOD-/i;
const GROUP_ID = /^(?:APTEM-)?GROUP-/i;

export function useAuditRecordNames(events: CurriculumAuditEvent[]): ReadonlyMap<string, string> {
  const [moduleTitles, setModuleTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [groupNames, setGroupNames] = useState<ReadonlyMap<string, string>>(new Map());

  // Still nothing fetched unless ids of that kind are actually on screen: the
  // two reads are keyed on the ids they would resolve, so a page of edits that
  // links nothing makes no extra request at all.
  const referenced = useMemo(() => recordIdsIn(events), [events]);
  const moduleIdKey = useMemo(() => referenced.filter(id => MODULE_ID.test(id)).join('|'), [referenced]);
  const groupIdKey = useMemo(() => referenced.filter(id => GROUP_ID.test(id)).join('|'), [referenced]);

  useEffect(() => {
    if (!moduleIdKey) return undefined;
    const controller = new AbortController();
    fetchCurriculumOverview(controller.signal, { compact: true })
      .then(overview => {
        if (controller.signal.aborted) return;
        const next = new Map<string, string>();
        for (const module of overview.modules || []) {
          const title = String(module.name || '').trim();
          if (!title) continue;
          for (const identity of [module.id, module.moduleId, module.moduleCatalogueId, module.catalogueId]) {
            const key = String(identity || '').trim().toLowerCase();
            if (key) next.set(key, title);
          }
        }
        setModuleTitles(next);
      })
      .catch(() => { /* audit values keep their readable fallback */ });
    return () => controller.abort();
  }, [moduleIdKey]);

  useEffect(() => {
    if (!groupIdKey) return undefined;
    const controller = new AbortController();
    const wanted = groupIdKey.split('|').map(id => id.toLowerCase());

    const collect = (rows: Array<{ id?: string; name?: string }>, into: Map<string, string>) => {
      for (const row of rows || []) {
        const name = String(row.name || '').trim();
        const key = String(row.id || '').trim().toLowerCase();
        if (name && key) into.set(key, name);
      }
    };

    fetchCurriculumGroups(controller.signal)
      .then(async rows => {
        if (controller.signal.aborted) return;
        const next = new Map<string, string>();
        collect(rows, next);
        // A group that was unlinked has usually been archived since, and the
        // "before" side of the very diff being read is where its name is
        // needed. The archive is only opened when the live list came up short,
        // because it is the more expensive of the two reads.
        if (wanted.some(id => !next.has(id))) {
          try {
            const archived = await fetchArchivedCurriculumGroups(controller.signal);
            if (controller.signal.aborted) return;
            collect(archived, next);
          } catch { /* the unresolved ids keep their own text */ }
        }
        setGroupNames(next);
      })
      .catch(() => { /* audit values keep their readable fallback */ });
    return () => controller.abort();
  }, [groupIdKey]);

  return useMemo(() => {
    const merged = new Map<string, string>(moduleTitles);
    for (const [key, value] of groupNames) merged.set(key, value);
    return merged;
  }, [moduleTitles, groupNames]);
}

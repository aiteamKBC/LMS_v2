import type { OverviewModule } from '@/api/dashboardTabs';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { overviewModulesForDisplay } from '@/pages/workspace/learner/overviewFacts';
import { learnerKey } from './employerDashboardData';
import { moduleDate } from './employerModuleTimelineData';
import type { EmployerLearningRecords } from './useEmployerLearningSummary';

export type JourneyEntry = {
  id: string; title: string; percent: number | null; start: string; end: string; facts?: OverviewModule;
};
export type JourneyPin = JourneyEntry & {
  state: 'current' | 'next' | 'skipped' | 'complete' | 'unplaced' | 'parallel';
  label: string; ahead?: string; parallelWith?: JourneyEntry[];
};
export type JourneyModule = {
  id: string; title: string; start: string; end: string; hue: number;
  programmes: Set<string>; entries: JourneyEntry[];
};

const progressLabel = (entry: JourneyEntry) => entry.percent == null ? 'Progress unavailable'
  : entry.percent >= 100 ? 'Completed' : entry.percent > 0 ? 'In progress' : 'Not started';
const inProgress = (entry: JourneyEntry) => entry.percent != null && entry.percent > 0 && entry.percent < 100;
const overlaps = (a: JourneyEntry, b: JourneyEntry) => a.start && a.end && b.start && b.end
  && a.start <= a.end && b.start <= b.end && a.start <= b.end && b.start <= a.end;

/** Schedule dates establish sequence. Percentages never establish an activity timestamp. */
export function journeyPins(entries: JourneyEntry[]): JourneyPin[] {
  const dated = entries.filter(entry => entry.start).sort((a, b) => a.start.localeCompare(b.start)
    || a.end.localeCompare(b.end) || a.id.localeCompare(b.id));
  const undated = entries.filter(entry => !entry.start);
  const unplaced = undated.find(entry => entry.percent != null && entry.percent > 0 && entry.percent < 100)
    || [...undated].reverse().find(entry => entry.percent != null && entry.percent > 0) || undated[0];
  if (!dated.length) return unplaced ? [{ ...unplaced, state: 'unplaced', label: progressLabel(unplaced) }] : [];
  const pins: JourneyPin[] = [];
  let lastProgress = -1;
  dated.forEach((entry, index) => { if (entry.percent != null && entry.percent > 0) lastProgress = index; });
  const last = dated[lastProgress];
  // Missing dates cannot justify extra markers or an inferred skip.
  if (!last && unplaced?.percent != null && unplaced.percent > 0) {
    return [{ ...unplaced, state: 'unplaced', label: progressLabel(unplaced) }];
  }
  // Completing one parallel module must not move the learner past a partner
  // module that is still in progress during the same scheduled period.
  const ongoing = last?.percent === 100 ? dated.filter(entry => inProgress(entry) && overlaps(entry, last)).at(-1) : undefined;
  const frontier = ongoing ? dated.indexOf(ongoing)
    : last?.percent === 100 ? Math.min(lastProgress + 1, dated.length - 1) : Math.max(0, lastProgress);
  const current = dated[frontier];
  // Equal/overlapping schedules cannot prove that a learner has skipped a module.
  for (const entry of dated.slice(0, Math.max(0, lastProgress))) {
    if (entry.id !== current.id && entry.percent != null && entry.percent < 100 && entry.end && entry.end < current.start) {
      pins.push({ ...entry, state: 'skipped', label: 'Skipped ahead', ahead: current.title });
    }
  }
  pins.push({ ...current, state: current.percent === 100 ? 'complete' : frontier > lastProgress && lastProgress >= 0 ? 'next' : 'current',
    label: current.percent === 100 ? 'Completed' : frontier > lastProgress && lastProgress >= 0 ? 'Next module' : progressLabel(current) });
  return pins;
}

/** Extra lanes represent independently progressing modules with known overlapping schedules. */
export function journeyParallelPins(entries: JourneyEntry[], pins: JourneyPin[]): JourneyPin[] {
  const primary = pins.find(pin => pin.state !== 'skipped' && inProgress(pin));
  if (!primary) return [];
  const partners = entries.filter(entry => entry.id !== primary.id && inProgress(entry) && overlaps(entry, primary))
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return partners.map(entry => ({ ...entry, state: 'parallel', label: 'In progress · parallel study',
    parallelWith: [primary, ...partners.filter(partner => partner.id !== entry.id)].map(partner => {
      const { id, title, percent, start, end } = partner;
      return { id, title, percent, start, end };
    }) }));
}

export function buildJourneyTimeline(allLearners: EmployerLearnerCard[], learners: EmployerLearnerCard[], records: EmployerLearningRecords) {
  // Assign colours before filtering so a module keeps its colour across learner/module filters.
  const ids = [...new Set(allLearners.flatMap(learner => records[learnerKey(learner)]?.data?.programme.map(row => row.id) || []))].sort();
  const hues = new Map(ids.map((id, index) => [id, Math.round((270 + index * 137.508) % 360)]));
  const modules = new Map<string, JourneyModule>();
  const rows = learners.map(learner => {
    const resource = records[learnerKey(learner)];
    const facts = new Map(overviewModulesForDisplay(resource?.data?.modules || []).map(module => [module.id, module]));
    const entries = [...new Map((resource?.data?.programme || []).map(row => [row.id, row])).values()].map(row => {
      const fact = facts.get(row.id);
      const entry: JourneyEntry = { ...row, percent: row.percent != null && Number.isFinite(row.percent)
        ? Math.max(0, Math.min(100, row.percent)) : null,
        start: moduleDate(fact?.start), end: moduleDate(fact?.end), facts: fact };
      const group = modules.get(row.id) || { id: row.id, title: row.title, start: '', end: '',
        hue: hues.get(row.id) ?? 270, programmes: new Set<string>(), entries: [] };
      if (entry.start && (!group.start || entry.start < group.start)) group.start = entry.start;
      if (entry.end && (!group.end || entry.end > group.end)) group.end = entry.end;
      if (learner.programme) group.programmes.add(learner.programme);
      group.entries.push(entry);
      modules.set(row.id, group);
      return entry;
    });
    const pins = journeyPins(entries);
    const parallelPins = journeyParallelPins(entries, pins);
    if (parallelPins.length) pins.find(pin => pin.state !== 'skipped')!.parallelWith = parallelPins;
    return { learner, status: resource?.status || 'loading', entries, pins, parallelPins };
  });
  const compare = (a: JourneyModule, b: JourneyModule) => (a.start || '9999').localeCompare(b.start || '9999')
    || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  // Cohorts can have different dates. Preserve each known non-overlapping sequence
  // instead of letting one cohort's early start reverse everyone else's module order.
  const following = new Map([...modules.keys()].map(id => [id, new Set<string>()]));
  const incoming = new Map([...modules.keys()].map(id => [id, 0]));
  for (const { entries } of rows) {
    for (const before of entries) for (const after of entries) {
      if (before.id === after.id || !before.start || !before.end || !after.start || before.end >= after.start) continue;
      if (!following.get(before.id)!.has(after.id)) {
        following.get(before.id)!.add(after.id);
        incoming.set(after.id, incoming.get(after.id)! + 1);
      }
    }
  }
  const remaining = new Map(modules);
  const ordered: JourneyModule[] = [];
  while (remaining.size) {
    const available = [...remaining.values()].filter(module => incoming.get(module.id) === 0).sort(compare);
    // Conflicting learner schedules have no shared sequence; dates break the tie.
    const next = available[0] || [...remaining.values()].sort(compare)[0];
    ordered.push(next);
    remaining.delete(next.id);
    for (const id of following.get(next.id)!) incoming.set(id, incoming.get(id)! - 1);
  }
  return { rows, modules: ordered };
}

import { Fragment, useId, useMemo, useState } from 'react';
import styles from './programmes.module.css';
import { ProgrammeTimelineModule, type ProgrammeTimelineDetails } from './ProgrammeTimelineModule';

export interface ProgrammeTimelineRun extends ProgrammeTimelineDetails {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  groupId?: string;
  group?: string;
  cohortId?: string;
  cohort?: string;
  href: string;
}

// Calendar dates are positions, not instants in the viewer's time zone. No
// placement is inferred from a cohort start, week count or another module.
function day(value?: string): number | null {
  const text = value?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === text ? parsed : null;
}

const DAY = 86_400_000;
const label = (value: number) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function ProgrammeDeliveryTimeline({ runs, programmeColor }: { runs: ProgrammeTimelineRun[]; programmeName?: string; programmeColor?: string }) {
  const [scale, setScale] = useState<'year' | 'month' | 'week' | 'day'>('year');
  const [expandedCohorts, setExpandedCohorts] = useState<Set<string>>(() => new Set());
  const treeId = useId();
  const dated = useMemo(() => runs.flatMap(run => {
    const start = day(run.startDate), end = day(run.endDate);
    return start !== null && end !== null && end >= start ? [{ ...run, start, end }] : [];
  }), [runs]);
  const cohorts = useMemo(() => {
    type GroupRow = { id: string; label: string; runs: typeof dated; total: number };
    const grouped = new Map<string, { id: string; label: string; groups: Map<string, GroupRow> }>();
    const placements = new Map(dated.map(run => [run.id, run]));
    runs.forEach(run => {
      // Parent IDs define the hierarchy. Display names never join records.
      const cohortKey = run.cohortId ? `cohort:${run.cohortId}` : 'unassigned';
      const cohort = grouped.get(cohortKey) ?? { id: cohortKey, label: run.cohortId ? run.cohort || 'Unnamed cohort' : 'No cohort assigned', groups: new Map<string, GroupRow>() };
      const groupKey = run.groupId ? `group:${run.groupId}` : `unassigned:${run.id}`;
      const group = cohort.groups.get(groupKey) ?? { id: groupKey, label: run.groupId ? run.group || 'Unnamed group' : 'No group assigned', runs: [], total: 0 };
      const placement = placements.get(run.id);
      if (placement) group.runs.push(placement);
      group.total += 1;
      cohort.groups.set(groupKey, group);
      grouped.set(cohortKey, cohort);
    });
    return [...grouped.values()];
  }, [dated, runs]);
  const start = dated.length ? Math.min(...dated.map(run => run.start)) : 0;
  const end = dated.length ? Math.max(...dated.map(run => run.end)) + DAY : DAY;
  const span = Math.max(DAY, end - start);
  const width = Math.max(800, Math.min(24000, span / DAY * ({ year: 3, month: 8, week: 22, day: 60 }[scale])));

  return <section className={styles.timeline} aria-labelledby="programme-delivery-timeline">
    <div className={styles.sectionHeading}>
      <div><h3 id="programme-delivery-timeline">Delivery timeline</h3><p>Recorded module placement dates · {dated.length} dated module runs</p></div>
      <div className={styles.timelineControls}>
        <div role="group" aria-label="Timeline scale">{(['year', 'month', 'week', 'day'] as const).map(value => <button key={value} type="button" aria-pressed={scale === value} onClick={() => setScale(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      </div>
    </div>
    {runs.length > 0 && <div className={styles.timelineScroll} tabIndex={0} role="region" aria-label="Programme module placement timeline">
      <div style={{ minWidth: width + 180 }}>
        <div className={styles.timelineRow}><div className={styles.timelineGroup}>Cohorts</div><div className={styles.timelineAxis}>{dated.length ? Array.from({ length: 7 }, (_, index) => <span key={index}>{label(start + span * index / 6)}</span>) : 'No recorded date range'}</div></div>
        {cohorts.map((cohort, cohortIndex) => {
          const expanded = expandedCohorts.has(cohort.id);
          const childrenId = `${treeId}-cohort-${cohortIndex}`;
          return <Fragment key={cohort.id}>
            <div className={styles.timelineRow}>
              <div className={styles.timelineGroup}>
                <button type="button" className={styles.timelineCohortToggle} aria-expanded={expanded} aria-controls={childrenId} onClick={() => setExpandedCohorts(current => {
                  const next = new Set(current);
                  if (next.has(cohort.id)) next.delete(cohort.id); else next.add(cohort.id);
                  return next;
                })}>
                  <span aria-hidden="true">{expanded ? '\u2304' : '\u203a'}</span>
                  <span><strong>{cohort.label}</strong>{' '}<small>{cohort.groups.size} {cohort.groups.size === 1 ? 'group' : 'groups'}</small></span>
                </button>
              </div>
              <div className={styles.timelineCohortSummary}>{expanded ? 'Groups in this cohort' : 'Expand cohort to view groups'}</div>
            </div>
            <div id={childrenId} hidden={!expanded}>
              {expanded && [...cohort.groups.values()].map(row => <div key={row.id} className={styles.timelineRow}>
                <div className={`${styles.timelineGroup} ${styles.timelineChildGroup}`}><strong>{row.label}</strong><small>{row.total} module {row.total === 1 ? 'run' : 'runs'}</small></div>
                <div className={styles.timelineTrack} style={{ height: Math.max(44, row.runs.length * 30 + 10) }}>
                  {row.runs.length === 0 && <p className={styles.timelineNoDates}>No complete module placement dates for this group.</p>}
                  {row.runs.map((run, index) => <ProgrammeTimelineModule key={run.id} run={run} color={programmeColor} className={styles.timelineRun} style={{ left: `${(run.start - start) / span * 100}%`, width: `${(run.end + DAY - run.start) / span * 100}%`, top: index * 30 + 7 }} dateDescription={`${label(run.start)} to ${label(run.end)}`} />)}
                </div>
              </div>)}
            </div>
          </Fragment>;
        })}
      </div>
    </div>}
    {dated.length === 0 && <p className={styles.timelineEmpty}>No complete module placement dates are available for this programme.</p>}
    {runs.length > dated.length && <p className={styles.timelineFootnote}>{runs.length - dated.length} module runs have missing or invalid placement dates and are not plotted. Open Modules to review them.</p>}
    <p className={styles.timelineFootnote}>Placement dates describe the plan. They do not confirm actual attendance or delivery.</p>
  </section>;
}

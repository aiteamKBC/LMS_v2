import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AttendanceLecture } from '@/api/attendanceLectures';
import { AppIcon } from '@/components/feature/AppIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { Panel } from '@/components/ui/Panel';
import { RowAction } from '@/components/ui/ActionRow';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { StatusTone } from '@/lib/statusTone';
import styles from '../attendance.module.css';

export type AttendanceFilter = 'all' | 'attended' | 'absent' | 'covered' | 'upcoming';
const STATUS: Record<AttendanceLecture['status'], { label: string; tone: StatusTone }> = {
  completed: { label: 'Attended', tone: 'positive' }, late: { label: 'Late', tone: 'caution' },
  absent: { label: 'Absent', tone: 'critical' }, upcoming: { label: 'Upcoming', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'info' }, pending: { label: 'Awaiting attendance', tone: 'neutral' },
};
const monthKey = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00`).getTime()) ? date.slice(0, 7) : 'undated';
const monthLabel = (month: string) => month === 'undated' ? 'Date not recorded' : new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

export default function AttendanceLectureList({ lectures, modules, moduleId, onModuleChange, filter, onFilterChange, tabs, onOpen, onReport }: {
  lectures: AttendanceLecture[];
  modules: { id: string; title: string }[];
  moduleId: string; onModuleChange: (id: string) => void;
  filter: AttendanceFilter; onFilterChange: (filter: AttendanceFilter) => void;
  tabs: PageTabItem[];
  onOpen: (lecture: AttendanceLecture) => void;
  onReport: (lecture: AttendanceLecture) => void;
}) {
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState('all');
  const [order, setOrder] = useState('newest');
  const [monthExpansion, setMonthExpansion] = useState<Record<string, boolean>>({});
  const months = useMemo(() => [...new Set(lectures.map(row => monthKey(row.date)))].sort((a, b) =>
    a === 'undated' ? 1 : b === 'undated' ? -1 : b.localeCompare(a)), [lectures]);
  const selectedMonth = months.includes(month) ? month : 'all';
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return lectures.filter(row => {
      const matches = filter === 'all' || (filter === 'attended' ? ['completed', 'late'].includes(row.status) :
        filter === 'covered' ? row.catchupStatus === 'completed' : row.status === filter);
      return matches && (selectedMonth === 'all' || monthKey(row.date) === selectedMonth) &&
        `${row.title} ${row.module} ${row.contentSummary} ${row.ksbs.join(' ')}`.toLowerCase().includes(query);
    }).sort((a, b) => {
      // Keep unknown dates last in both directions; sort the copy, never the cached response.
      const aUnknown = monthKey(a.date) === 'undated';
      const bUnknown = monthKey(b.date) === 'undated';
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
      const byDate = `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`);
      return (order === 'newest' ? -byDate : byDate) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
  }, [lectures, filter, selectedMonth, search, order]);
  const groups = useMemo(() => {
    const byMonth = new Map<string, AttendanceLecture[]>();
    for (const row of filtered) {
      const key = monthKey(row.date);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(row);
    }
    return [...byMonth];
  }, [filtered]);
  // Reveal matching sessions during search/status filtering, and keep the initial view compact.
  const expandedByDefault = !!search.trim() || filter !== 'all' || selectedMonth !== 'all';
  const isExpanded = (key: string) => monthExpansion[key] ?? (expandedByDefault || key === groups[0]?.[0]);
  const allExpanded = groups.every(([key]) => isExpanded(key));
  const hasFilters = moduleId !== 'all' || selectedMonth !== 'all' || filter !== 'all' || !!search;
  const clearFilters = () => {
    onModuleChange('all'); onFilterChange('all'); setMonth('all'); setSearch(''); setMonthExpansion({});
  };

  return <div className={styles.lectureList}>
    <Panel className={styles.filterPanel}>
      <div className={styles.listHeading}>
        <div><h2>Lectures by month</h2><p>Open a month to view its lectures, attendance and activities.</p></div>
        <Link to="/learner/my-learning">View all modules <span aria-hidden="true">→</span></Link>
      </div>
      <div className={styles.controls}>
        <label className={styles.searchField}><span>Search lectures</span>
          <span className={styles.searchInput}><AppIcon className="ri-search-line" />
            <input value={search} onChange={event => { setSearch(event.target.value); setMonthExpansion({}); }} placeholder="Lecture, content or KSB…" />
          </span>
        </label>
        <label className={styles.moduleField}><span>Module</span>
          <select aria-label="Module" value={moduleId} onChange={event => { onModuleChange(event.target.value); onFilterChange('all'); setMonth('all'); setMonthExpansion({}); }}>
            <option value="all">All modules</option>
            {modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}
          </select>
        </label>
        <label><span>Month</span><select aria-label="Month" value={selectedMonth} onChange={event => { setMonth(event.target.value); setMonthExpansion({}); }}>
          <option value="all">All months</option>{months.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}
        </select></label>
        <label><span>Sort by</span><select aria-label="Sort by" value={order} onChange={event => { setOrder(event.target.value); setMonthExpansion({}); }}>
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
        </select></label>
      </div>
      <div className={styles.filterFooter}>
        <PageTabs items={tabs} value={filter} onChange={value => { onFilterChange(value as AttendanceFilter); setMonthExpansion({}); }} label="Filter lectures" className={styles.statusFilters} />
        {hasFilters && <button type="button" onClick={clearFilters} className={styles.clearFilters}>Clear filters</button>}
      </div>
    </Panel>
    <div className={styles.resultsHeader} aria-label="Lecture results">
      <p role="status">{filtered.length} {filtered.length === 1 ? 'lecture' : 'lectures'}{groups.length > 0 && ` · ${groups.length} ${groups.length === 1 ? 'month' : 'months'}`}</p>
      {groups.length > 0 && <button type="button" className={styles.expandMonths}
        onClick={() => setMonthExpansion(Object.fromEntries(groups.map(([key]) => [key, !allExpanded])))}>
        <AppIcon className={allExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />{allExpanded ? 'Collapse all months' : 'Expand all months'}
      </button>}
    </div>
    {!filtered.length ? <Panel><EmptyState size="sm" title={hasFilters || lectures.length ? 'No lectures match this filter' : 'No lectures yet'}
      description={hasFilters || lectures.length ? 'Try another module, month, status or search.' : 'Your lectures will appear here when they are scheduled or recorded.'} />
      {hasFilters && <button type="button" className={styles.clearFilters} onClick={clearFilters}>Show all lectures</button>}
    </Panel> : <ol className={styles.monthList} aria-label="Lectures by month">
      {groups.map(([key, rows]) => <li key={key}><MonthGroup month={key} rows={rows} expanded={isExpanded(key)}
        onToggle={() => setMonthExpansion(previous => ({ ...previous, [key]: !isExpanded(key) }))} onOpen={onOpen} onReport={onReport} /></li>)}
    </ol>}
  </div>;
}

function MonthGroup({ month, rows, expanded, onToggle, onOpen, onReport }: {
  month: string; rows: AttendanceLecture[]; expanded: boolean; onToggle: () => void;
  onOpen: (row: AttendanceLecture) => void; onReport: (row: AttendanceLecture) => void;
}) {
  const contentId = useId();
  const label = monthLabel(month);
  const attended = rows.filter(row => row.status === 'completed' || row.status === 'late').length;
  const absent = rows.filter(row => row.status === 'absent').length;
  const upcoming = rows.filter(row => row.status === 'upcoming').length;
  return <Panel padding="none" className={styles.monthPanel}>
    <h3 className={styles.monthHeading}><button type="button" className={styles.monthToggle} aria-label={label}
      aria-expanded={expanded} aria-controls={contentId} onClick={onToggle}>
      <span className={styles.monthIdentity}><AppIcon className="ri-calendar-2-line" /><span>{label}<span className={styles.monthCount}>{rows.length} {rows.length === 1 ? 'lecture' : 'lectures'}</span></span></span>
      <span className={styles.monthSummary}>
        {attended > 0 && <span>{attended} attended</span>}
        {absent > 0 && <span className={styles.monthAbsent}>{absent} absent</span>}
        {upcoming > 0 && <span>{upcoming} upcoming</span>}
      </span>
      <AppIcon className={`ri-arrow-down-s-line ${styles.monthChevron}`} />
    </button></h3>
    <div id={contentId} hidden={!expanded}>
      {expanded && <ol aria-label={`${label} lectures`}>{rows.map(row => <li key={row.id}><LectureRow row={row} onOpen={onOpen} onReport={onReport} /></li>)}</ol>}
    </div>
  </Panel>;
}

function LectureRow({ row, onOpen, onReport }: { row: AttendanceLecture; onOpen: (row: AttendanceLecture) => void; onReport: (row: AttendanceLecture) => void }) {
  const titleId = useId();
  const date = monthKey(row.date) === 'undated' ? null : new Date(`${row.date}T00:00:00`);
  return <article aria-labelledby={titleId} className={styles.lectureRow} data-status={row.status}>
    <time dateTime={date ? row.date : undefined} className={styles.dateTile} aria-label={date?.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) || 'Date not recorded'}>
      <span>{date?.toLocaleDateString('en-GB', { month: 'short' }) || 'Date'}</span><strong>{date?.getDate().toString().padStart(2, '0') || '—'}</strong>
      <span>{date?.toLocaleDateString('en-GB', { weekday: 'short' }) || 'Not set'}</span>
    </time>
    <div className={styles.lectureInfo}>
      <h4 id={titleId}>{row.title}</h4>
      <p className={styles.moduleName}>{row.module}</p>
      <p className={styles.sessionTime}><AppIcon className="ri-time-line" />{row.startTime || 'Time not recorded'}{row.endTime ? ` – ${row.endTime}` : ''}</p>
      <KsbChips row={row} />
    </div>
    <div className={styles.lectureStatus}><StatusBadge {...STATUS[row.status]} />
      {row.catchupStatus && <StatusBadge tone={row.catchupStatus === 'completed' ? 'positive' : 'caution'} label={row.catchupStatus === 'completed' ? 'Catch-up completed' : 'Catch-up pending'} />}
      {row.absenceReport && <StatusBadge tone="neutral" label={`Absence ${row.absenceReport.status}`} />}
    </div>
    <div className={styles.lectureActions}>
      <RowAction label="Open Activities" icon="ri-arrow-right-line" onClick={() => onOpen(row)} />
      {row.canReportAbsence && <button type="button" className={styles.absenceLink} onClick={() => onReport(row)}>Report absence</button>}
    </div>
  </article>;
}

function KsbChips({ row }: { row: AttendanceLecture }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (!row.ksbs.length) return <p className={styles.unmapped}>KSBs not mapped</p>;
  return <div className={styles.ksbRow}>
    <span className={styles.ksbLabel} title={row.ksbScope === 'module' ? 'These KSBs are mapped to the module; a lecture-specific mapping is not available yet.' : undefined}>{row.ksbScope === 'module' ? 'Module KSBs' : 'KSBs'}</span>
    <span id={id} className={styles.ksbChips}>{(expanded ? row.ksbs : row.ksbs.slice(0, 3)).map((code, index) => <span key={`${code}-${index}`}>{code}</span>)}</span>
    {row.ksbs.length > 3 && <button type="button" aria-expanded={expanded} aria-controls={id}
      aria-label={`${expanded ? 'Show fewer KSBs' : `Show all ${row.ksbs.length} KSBs`} for ${row.title}`}
      onClick={() => setExpanded(value => !value)} className={styles.ksbToggle}>{expanded ? 'Show less' : `+${row.ksbs.length - 3}`}</button>}
  </div>;
}

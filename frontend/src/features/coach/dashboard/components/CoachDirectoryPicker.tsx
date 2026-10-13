import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Pagination } from '@/components/ui/Pagination';
import { AppIcon } from '@/components/feature/AppIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { fetchCoachDirectory, type DirectoryCoach } from '@/api/coachDirectory';
import styles from './CoachDirectoryPicker.module.css';

const EMPTY_VALUE = '--';
const PAGE_SIZE = 10;

function initials(name: string, email: string) {
  const source = name.trim() || email.split('@')[0].replace(/[._-]+/g, ' ');
  const parts = source.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return `${parts[0][0] || ''}${parts.length > 1 ? parts[parts.length - 1][0] || '' : ''}`.toUpperCase();
}

function matches(coach: DirectoryCoach, query: string) {
  const needle = query.trim().toLowerCase();
  return !needle || `${coach.name} ${coach.email}`.toLowerCase().includes(needle);
}

function shortName(name: string, email: string) {
  const value = name.trim() || email.split('@')[0];
  const parts = value.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : value;
}

function rateTone(rate: number | null) {
  if (rate === null) return undefined;
  if (rate >= 85) return 'positive';
  if (rate >= 70) return 'caution';
  return 'critical';
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return <div className={styles.metric}><span>{label}</span><strong data-tone={tone}>{value}</strong></div>;
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <section className={styles.chartPanel}><div><h3>{title}</h3><p>{subtitle}</p></div><div className={styles.chart}>{children}</div></section>;
}

const tooltipStyle = { border: '1px solid #e6e0f1', borderRadius: 10, boxShadow: '0 8px 22px rgba(35, 22, 70, .09)', fontSize: 12 };

/** Cross-coach performance view. Each card still opens that coach's read-only workspace. */
export function CoachDirectoryPicker({ onSelect, onDirectoryLoaded }: {
  onSelect: (coach: DirectoryCoach) => void;
  onDirectoryLoaded?: (coaches: DirectoryCoach[]) => void;
}) {
  const [coaches, setCoaches] = useState<DirectoryCoach[]>([]);
  const [countsAvailable, setCountsAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedCoach, setSelectedCoach] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchCoachDirectory(controller.signal)
      .then(directory => {
        if (controller.signal.aborted) return;
        setCoaches(directory.coaches);
        onDirectoryLoaded?.(directory.coaches);
        setCountsAvailable(directory.caseloadCountsAvailable);
      })
      .catch(loadError => {
        if (controller.signal.aborted) return;
        setCoaches([]);
        setError(loadError instanceof Error ? loadError.message : 'Unable to load coach performance.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [onDirectoryLoaded]);

  const filtered = useMemo(() => coaches.filter(coach => matches(coach, search)
    && (selectedCoach === 'all' || coach.email === selectedCoach)), [coaches, search, selectedCoach]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = useMemo(() => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [filtered, currentPage]);
  useEffect(() => { setPage(1); }, [search, selectedCoach]);

  const chartData = useMemo(() => visible.filter(coach => coach.performance?.available).map(coach => ({
    name: shortName(coach.name, coach.email),
    engagement: coach.performance?.attendanceRate,
    completedReviews: coach.performance?.completedReviews || 0,
    activeLearners: coach.activeLearnerCount,
    pendingMarking: coach.performance?.pendingMarking || 0,
    onTrack: coach.performance?.otjh.onTrack || 0,
    needAttention: coach.performance?.otjh.needAttention || 0,
    atRisk: coach.performance?.otjh.atRisk || 0,
    prRequired: coach.performance?.progressReviews.required || 0,
    prCompleted: coach.performance?.progressReviews.completed || 0,
    prOverdue: coach.performance?.progressReviews.overdue || 0,
    mcmRequired: coach.performance?.monthlyCoaching.required || 0,
    mcmCompleted: coach.performance?.monthlyCoaching.completed || 0,
    mcmOverdue: coach.performance?.monthlyCoaching.overdue || 0,
  })), [visible]);

  const commonChart = <><CartesianGrid stroke="#eeeaf4" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10, fill: '#817993' }} interval={0} angle={-25} textAnchor="end" height={48} /><YAxis tick={{ fontSize: 10, fill: '#817993' }} width={32} allowDecimals={false} /><Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f7f4fc' }} /></>;

  return (
    <section className={styles.dashboard} aria-label="Coaches performance dashboard">
      <div className={styles.toolbar}>
        <div className={styles.titleBlock}><h2>Coaches Performance</h2><p>Coaching caseload, engagement, review delivery and learner risk signals</p></div>
        <label className={styles.search}>
          <AppIcon className="ri-search-line" /><span className="sr-only">Search associate or coach</span>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search associate or coach" />
        </label>
      </div>

      {!loading && !error && coaches.length > 0 && <div className={styles.coachFilters} aria-label="Filter by coach">
        <button type="button" data-active={selectedCoach === 'all'} onClick={() => setSelectedCoach('all')}>All</button>
        {coaches.map(coach => <button key={coach.email} type="button" data-active={selectedCoach === coach.email} onClick={() => setSelectedCoach(coach.email)}>{coach.name || coach.email}</button>)}
      </div>}

      <div className={styles.sectionLabel}><span>COACHES</span></div>
      {loading && <div className={styles.cardGrid}>{Array.from({ length: 10 }, (_, key) => <div key={key} className={styles.skeleton} />)}</div>}
      {!loading && error && <div className={styles.error}>{error}</div>}
      {!loading && !error && !coaches.length && <EmptyState variant="empty" icon="ri-group-line" title="No coach accounts yet" description="Grant Coach access from the Users directory and they will appear here." />}
      {!loading && !error && coaches.length > 0 && !filtered.length && <EmptyState variant="no-matches" title="No coach matches your search" description={`Nobody matches "${search.trim()}". Try a different name or email.`} />}

      {!loading && !error && visible.length > 0 && <>
        <div className={styles.cardGrid}>
          {visible.map(coach => {
            const performance = coach.performance;
            const otjhTotal = performance ? performance.otjh.onTrack + performance.otjh.needAttention + performance.otjh.atRisk : 0;
            return <button key={coach.email} type="button" onClick={() => onSelect(coach)} className={styles.coachCard} aria-label={`Open ${coach.name || coach.email} workspace`}>
              <div className={styles.cardHeader}>
                <span className={styles.avatar}>{initials(coach.name, coach.email)}</span>
                <span className={styles.coachIdentity}><strong>{coach.name || coach.email}</strong><small>{countsAvailable ? `${coach.activeLearnerCount} learners` : 'Learner count unavailable'}</small></span>
                <AppIcon className="ri-arrow-right-line" />
              </div>
              <div className={styles.metricsGrid}>
                <Metric label="LEARNERS" value={countsAvailable ? coach.activeLearnerCount : EMPTY_VALUE} />
                <Metric label="ATTENDANCE" value={performance?.attendanceRate === null || !performance ? EMPTY_VALUE : `${performance.attendanceRate}%`} tone={rateTone(performance?.attendanceRate ?? null)} />
                <Metric label="PR RATE" value={performance?.progressReviewRate === null || performance?.progressReviewRate === undefined ? EMPTY_VALUE : `${performance.progressReviewRate}%`} tone={rateTone(performance?.progressReviewRate ?? null)} />
                <Metric label="OTJH RISK" value={performance?.otjh.atRisk ?? EMPTY_VALUE} tone={performance?.otjh.atRisk ? 'critical' : 'positive'} />
                <Metric label="PENDING" value={performance?.pendingMarking ?? EMPTY_VALUE} tone={performance?.pendingMarking ? 'caution' : 'positive'} />
              </div>
              <div className={styles.otjhLabel}>OTJH</div>
              <div className={styles.riskBar} aria-label={otjhTotal ? `${performance?.otjh.onTrack} on track, ${performance?.otjh.needAttention} need attention, ${performance?.otjh.atRisk} at risk` : 'OTJH status unavailable'}>
                {otjhTotal > 0 ? <><span className={styles.onTrack} style={{ flex: performance?.otjh.onTrack || 0 }} /><span className={styles.needAttention} style={{ flex: performance?.otjh.needAttention || 0 }} /><span className={styles.atRisk} style={{ flex: performance?.otjh.atRisk || 0 }} /></> : <span className={styles.unavailableBar} />}
              </div>
            </button>;
          })}
        </div>
        {totalPages > 1 && <Pagination page={currentPage} totalPages={totalPages} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} noun="coaches" className={styles.pagination} />}
        {!countsAvailable && <p className={styles.notice}>Caseload numbers are unavailable right now. The coach list itself is current.</p>}

        <div className={styles.sectionLabel}><span>ANALYTICS CHARTS</span></div>
        {chartData.length ? <div className={styles.chartGrid}>
          <ChartPanel title="Engagement by coach" subtitle="Average verified learner attendance"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}>{commonChart}<Bar dataKey="engagement" name="Engagement %" fill="#5546e8" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartPanel>
          <ChartPanel title="Completed reviews" subtitle="Completed progress and monthly coaching reviews"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}>{commonChart}<Bar dataKey="completedReviews" name="Completed reviews" fill="#1098ad" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartPanel>
          <ChartPanel title="OTJH risk spread" subtitle="On Track / Need Attention / At Risk by coach"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}>{commonChart}<Legend wrapperStyle={{ fontSize: 10 }} /><Bar dataKey="onTrack" name="On Track" stackId="otjh" fill="#18a558" /><Bar dataKey="needAttention" name="Need Attention" stackId="otjh" fill="#ef8b00" /><Bar dataKey="atRisk" name="At Risk" stackId="otjh" fill="#ed3434" /></BarChart></ResponsiveContainer></ChartPanel>
          <ChartPanel title="Current workload" subtitle="Active learners compared with evidence awaiting marking"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}>{commonChart}<Legend wrapperStyle={{ fontSize: 10 }} /><Bar dataKey="activeLearners" name="Active learners" fill="#1098ad" radius={[3, 3, 0, 0]} /><Bar dataKey="pendingMarking" name="Pending marking" fill="#ed3434" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></ChartPanel>
          <ChartPanel title="Progress review performance" subtitle="Required vs completed vs overdue · 12 weeks"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}>{commonChart}<Legend wrapperStyle={{ fontSize: 10 }} /><Bar dataKey="prRequired" name="Required" fill="#a9b4c7" /><Bar dataKey="prCompleted" name="Completed" fill="#18a558" /><Bar dataKey="prOverdue" name="Overdue" fill="#ed3434" /></BarChart></ResponsiveContainer></ChartPanel>
          <ChartPanel title="MCM performance" subtitle="Required vs completed vs overdue · 4 weeks"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}>{commonChart}<Legend wrapperStyle={{ fontSize: 10 }} /><Bar dataKey="mcmRequired" name="Required" fill="#a9b4c7" /><Bar dataKey="mcmCompleted" name="Completed" fill="#1098ad" /><Bar dataKey="mcmOverdue" name="Overdue" fill="#ed3434" /></BarChart></ResponsiveContainer></ChartPanel>
        </div> : <div className={styles.analyticsEmpty}>Performance charts will appear after coach dashboard snapshots are available.</div>}
      </>}
    </section>
  );
}

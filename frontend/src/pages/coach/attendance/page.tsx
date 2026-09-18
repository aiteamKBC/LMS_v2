import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import type { AbsenceReport } from '@/mocks/absence-reports';
import { absenceReportHealth, countLearnerAbsenceReports } from './attendanceOverview';
import styles from './attendanceOverview.module.css';

const coachNav = roleNavMap.coach;
const ATTENDANCE_ENDPOINT = '/coach_api/coach/attendance';
const ABSENCE_REPORTS_ENDPOINT = '/coach_api/coach/absence-reports';
const PAGE_SIZE = 8;

type RiskTone = 'red' | 'amber' | 'green' | null;

interface AttendanceLearner {
  id: string;
  learner: string;
  initials: string;
  email?: string | null;
  programme: string;
  cohort: string;
  group: string;
  employer: string;
  isOnBreak?: boolean;
  attendance: number | null;
  sessions: number | null;
  present: number | null;
  absent: number | null;
  lastSession: string;
  lastSessionDate?: string | null;
  risk: RiskTone;
  hasAttendance: boolean;
}

interface AttendanceResponse {
  learners?: AttendanceLearner[];
}

interface AbsenceReportsResponse {
  items?: AbsenceReport[];
}

const avatarPalette = [
  ['#eee9ff', '#6a36dc'],
  ['#ffe6eb', '#e22d55'],
  ['#dff2ff', '#1974bd'],
  ['#dff7ed', '#13865f'],
  ['#ffeadf', '#d45723'],
] as const;

function selectOptions(values: string[]) {
  return values.map(value => <option key={value} value={value}>{value}</option>);
}

function display(value?: string | null) {
  return value?.trim() || '--';
}

function countPercent(value: number, total: number) {
  return total ? `${Math.round((value / total) * 100)}% of learners` : 'No learners';
}

function avatarColours(value: string) {
  const score = [...value].reduce((total, char) => total + char.charCodeAt(0), 0);
  const [backgroundColor, color] = avatarPalette[score % avatarPalette.length];
  return { backgroundColor, color };
}

function dateRangeLabel(from: string, to: string) {
  if (!from && !to) return 'All dates';
  const format = (value: string) => value
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
    : 'Any date';
  return `${format(from)} – ${format(to)}`;
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export default function CoachAttendance() {
  const navigate = useNavigate();
  const coach = useCoachIdentity();
  const [learners, setLearners] = useState<AttendanceLearner[]>([]);
  const [reports, setReports] = useState<AbsenceReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cohort, setCohort] = useState('all');
  const [programme, setProgramme] = useState('all');
  const [employer, setEmployer] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!coach.isInitialized) return;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setLoadError(null);
      setReportsError(null);

      if (!coach.email) {
        setLearners([]);
        setReports([]);
        setLoadError('Coach access is required to load attendance data.');
        setLoading(false);
        return;
      }

      const [attendanceResult, reportsResult] = await Promise.allSettled([
        coachFetch(ATTENDANCE_ENDPOINT, { signal: controller.signal }),
        coachFetch(ABSENCE_REPORTS_ENDPOINT, { signal: controller.signal }),
      ]);

      if (controller.signal.aborted) return;

      try {
        if (attendanceResult.status === 'rejected') throw attendanceResult.reason;
        if (!attendanceResult.value.ok) throw new Error(`Attendance request failed with ${attendanceResult.value.status}`);
        const payload = await attendanceResult.value.json() as AttendanceResponse;
        if (controller.signal.aborted) return;
        setLearners(payload.learners || []);
      } catch (error) {
        setLearners([]);
        setLoadError(error instanceof Error ? error.message : 'Unable to load attendance data.');
      }

      try {
        if (reportsResult.status === 'rejected') throw reportsResult.reason;
        if (!reportsResult.value.ok) throw new Error(`Absence reports request failed with ${reportsResult.value.status}`);
        const payload = await reportsResult.value.json() as AbsenceReportsResponse;
        if (controller.signal.aborted) return;
        setReports(payload.items || []);
      } catch (error) {
        setReports([]);
        setReportsError(error instanceof Error ? error.message : 'Unable to load absence report totals.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [coach.email, coach.isInitialized]);

  const programmes = useMemo(() => [...new Set(learners.map(item => item.programme).filter(Boolean))].sort(), [learners]);
  const cohorts = useMemo(() => [...new Set(learners.map(item => item.cohort).filter(Boolean))].sort(), [learners]);
  const employers = useMemo(() => [...new Set(learners.map(item => item.employer).filter(Boolean))].sort(), [learners]);

  const filteredLearners = useMemo(() => learners.filter((learner) => {
    if (programme !== 'all' && learner.programme !== programme) return false;
    if (cohort !== 'all' && learner.cohort !== cohort) return false;
    if (employer !== 'all' && learner.employer !== employer) return false;
    if (dateFrom || dateTo) {
      const lastSessionDate = String(learner.lastSessionDate || '').slice(0, 10);
      if (!lastSessionDate) return false;
      if (dateFrom && lastSessionDate < dateFrom) return false;
      if (dateTo && lastSessionDate > dateTo) return false;
    }
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [learner.learner, learner.email, learner.programme, learner.cohort, learner.employer]
      .some(value => String(value || '').toLowerCase().includes(query));
  }), [cohort, dateFrom, dateTo, employer, learners, programme, search]);

  const totalPages = Math.max(1, Math.ceil(filteredLearners.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredLearners.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const changeFilter = (change: () => void) => {
    change();
    setPage(1);
  };

  const reportCount = (learner: AttendanceLearner) => countLearnerAbsenceReports(reports, learner, dateFrom, dateTo);

  const visibleSummary = useMemo(() => ({
    totalLearners: filteredLearners.length,
    onTrack: filteredLearners.filter(learner => !learner.isOnBreak && learner.risk === 'green').length,
    needsAttention: filteredLearners.filter(learner => !learner.isOnBreak && learner.risk === 'amber').length,
    atRisk: filteredLearners.filter(learner => !learner.isOnBreak && learner.risk === 'red').length,
  }), [filteredLearners]);

  const exportRows = () => {
    const header = ['Learner', 'Email', 'Programme', 'Cohort', 'Employer', 'Attended', 'Sessions', 'Absent', 'Absence reports', 'Last session'];
    const rows = filteredLearners.map(learner => [
      learner.learner,
      learner.email || '',
      learner.programme,
      learner.cohort,
      learner.employer,
      learner.present ?? '',
      learner.sessions ?? '',
      learner.absent ?? '',
      reportsError ? '' : reportCount(learner),
      learner.lastSession,
    ]);
    const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'learner-attendance-overview.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const metrics = [
    { label: 'Total Learners', value: visibleSummary.totalLearners, note: 'Active in selected period', icon: 'ri-group-line', tone: 'purple' },
    { label: 'On Track', value: visibleSummary.onTrack, note: countPercent(visibleSummary.onTrack, visibleSummary.totalLearners), icon: 'ri-checkbox-circle-line', tone: 'green' },
    { label: 'Below Target', value: visibleSummary.needsAttention, note: countPercent(visibleSummary.needsAttention, visibleSummary.totalLearners), icon: 'ri-bar-chart-grouped-line', tone: 'amber' },
    { label: 'Needs Support', value: visibleSummary.atRisk, note: countPercent(visibleSummary.atRisk, visibleSummary.totalLearners), icon: 'ri-error-warning-line', tone: 'red' },
  ];

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Attendance"
      pageSubtitle="Learner attendance overview"
      userName={coach.name}
      userRole="Progress Coach"
    >
      <main className={styles.page}>
        <section className={styles.hero} aria-labelledby="attendance-overview-title">
          <div className={styles.heroTitle}>
            <span className={styles.heroIcon}><AppIcon className="ri-calendar-check-line" /></span>
            <div>
              <h1 id="attendance-overview-title">My Learners – Attendance Overview</h1>
              <p>See how many sessions each learner attended and how many absence reports they submitted.</p>
            </div>
          </div>
          <div className={styles.heroFilters}>
            <label>
              <span>Programme</span>
              <select value={programme} onChange={event => changeFilter(() => setProgramme(event.target.value))}>
                <option value="all">All Programmes</option>
                {selectOptions(programmes)}
              </select>
            </label>
            <div className={styles.rangeSummary}>
              <span>Date Range</span>
              <strong><AppIcon className="ri-calendar-line" />{dateRangeLabel(dateFrom, dateTo)}</strong>
            </div>
          </div>
        </section>

        <section className={styles.metrics} aria-label="Attendance summary">
          {metrics.map(metric => (
            <article key={metric.label} className={styles.metric} data-tone={metric.tone}>
              <span className={styles.metricIcon}><AppIcon className={metric.icon} /></span>
              <div>
                <p>{metric.label}</p>
                <strong>{loading ? '--' : metric.value}</strong>
                <small>{metric.note}</small>
              </div>
            </article>
          ))}
        </section>

        <section className={styles.toolbar} aria-label="Attendance filters">
          <label className={styles.search}>
            <AppIcon className="ri-search-line" />
            <span className="sr-only">Search learners</span>
            <input
              type="search"
              value={search}
              onChange={event => changeFilter(() => setSearch(event.target.value))}
              placeholder="Search by learner, email, programme or employer..."
            />
          </label>
          <select aria-label="Filter by cohort" value={cohort} onChange={event => changeFilter(() => setCohort(event.target.value))}>
            <option value="all">All cohorts</option>
            {selectOptions(cohorts)}
          </select>
          <select aria-label="Filter by programme" value={programme} onChange={event => changeFilter(() => setProgramme(event.target.value))}>
            <option value="all">All programmes</option>
            {selectOptions(programmes)}
          </select>
          <select aria-label="Filter by employer" value={employer} onChange={event => changeFilter(() => setEmployer(event.target.value))}>
            <option value="all">All employers</option>
            {selectOptions(employers)}
          </select>
          <div className={styles.dateInputs}>
            <input aria-label="Attendance from date" type="date" value={dateFrom} onChange={event => changeFilter(() => setDateFrom(event.target.value))} />
            <span>→</span>
            <input aria-label="Attendance to date" type="date" value={dateTo} onChange={event => changeFilter(() => setDateTo(event.target.value))} />
          </div>
          <button type="button" className={styles.export} onClick={exportRows} disabled={!filteredLearners.length}>
            <AppIcon className="ri-download-2-line" />Export<AppIcon className="ri-arrow-down-s-line" />
          </button>
        </section>

        {reportsError && !loadError ? (
          <div className={styles.warning} role="status">
            <AppIcon className="ri-information-line" /> Attendance loaded, but absence report totals are currently unavailable.
          </div>
        ) : null}

        <section className={styles.tableCard} aria-labelledby="learner-attendance-title">
          <header className={styles.tableTitle}>
            <span><AppIcon className="ri-list-check-3" /></span>
            <h2 id="learner-attendance-title">Learner Attendance</h2>
          </header>
          <div className={styles.tableScroll}>
            <table>
              <caption className="sr-only">Attendance and absence report summary for the coach's learners</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Learner</th>
                  <th scope="col">Attended</th>
                  <th scope="col">Absent</th>
                  <th scope="col">Absence Reports</th>
                  <th scope="col">Last Session</th>
                  <th scope="col">Action</th>
                  <th scope="col"><span className="sr-only">More actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8}><RowsSkeleton rows={6} /></td></tr>
                ) : loadError || pageRows.length === 0 ? (
                  <tr><td colSpan={8}>
                    <EmptyState
                      icon={loadError ? 'ri-error-warning-line' : 'ri-user-search-line'}
                      title={loadError || 'No learners found'}
                      description={loadError ? 'Try again when attendance data is available.' : 'Adjust the filters to see more learners.'}
                      size="sm"
                    />
                  </td></tr>
                ) : pageRows.map((learner, index) => {
                  const submitted = reportCount(learner);
                  const reportHealth = reportsError ? 'unknown' : absenceReportHealth(submitted, learner.absent);
                  return (
                    <tr key={learner.id}>
                      <td>{(currentPage - 1) * PAGE_SIZE + index + 1}</td>
                      <td>
                        <div className={styles.learner}>
                          <span className={styles.avatar} style={avatarColours(learner.learner)}>{learner.initials || 'L'}</span>
                          <div><strong>{learner.learner}</strong><small>{display(learner.programme)}</small></div>
                        </div>
                      </td>
                      <td className={styles.numbers}>{learner.present === null ? '--' : `${learner.present} / ${learner.sessions ?? learner.present}`}</td>
                      <td className={styles.numbers}>{learner.absent ?? '--'}</td>
                      <td>
                        <span className={styles.reportStatus} data-health={reportHealth}>
                          <AppIcon className={reportHealth === 'complete' ? 'ri-checkbox-circle-fill' : reportHealth === 'partial' ? 'ri-time-fill' : reportHealth === 'missing' ? 'ri-error-warning-fill' : 'ri-information-line'} />
                          {reportsError ? '--' : `${submitted} / ${learner.absent ?? '--'} submitted`}
                        </span>
                      </td>
                      <td>{display(learner.lastSession)}</td>
                      <td>
                        <button type="button" className={styles.viewButton} onClick={() => navigate(`/coach/attendance/${learner.id}`)}>
                          <AppIcon className="ri-eye-line" />View
                        </button>
                      </td>
                      <td>
                        <button type="button" className={styles.moreButton} aria-label={`Open ${learner.learner} attendance profile`} onClick={() => navigate(`/coach/attendance/${learner.id}`)}>
                          <AppIcon className="ri-more-line" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className={styles.tableFooter}>
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              total={filteredLearners.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              noun="learners"
              className={styles.pagination}
            />
          </footer>
        </section>
      </main>
    </WorkspaceShell>
  );
}

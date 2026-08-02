import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { jsPDF } from 'jspdf';
import SignaturePad from 'signature_pad';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { SkeletonBlock } from '@/components/feature/CurriculumSkeletons';
import { roleNavMap } from '@/mocks/navigation';
import {
  fetchAuditActivityStats,
  fetchAuditLearners,
  fetchAuditLearnersPage,
  fetchLearnerAudit,
  saveAuditSignoff,
  type AuditActivitySummary,
  type AuditActivityStats,
  type AptemAuditItem,
  type AuditActivityItem,
  type AuditLearnerSummary,
  type AuditMonth,
  type AuditSignoff,
  type AuditWarning,
  type AuditWeek,
  type LearnerAuditResponse,
  type LmsAuditItem,
} from './api';

const auditorConfig = roleNavMap.auditor;
const KBC_LOGO_URL = '/assets/kbc-logo.png';
const SIGNATURE_CURSOR = 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23111827%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M12 20h9%27/%3E%3Cpath d=%27M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z%27/%3E%3C/svg%3E") 2 22, crosshair';
const metricHelp = {
  learnerId: 'The learner reference number used to identify this learner record.',
  otjh: 'Off-the-Job Hours: recorded learning or training time completed away from normal day-to-day work duties.',
  completedOtjh: 'The total recorded Off-the-Job Hours completed by the learner.',
  plannedOtjh: 'The number of Off-the-Job Hours planned for the selected month or period.',
  approvedOtjh: 'The Off-the-Job Hours that have been reviewed or validated by the coach where that information is available.',
  aptem: 'Programme activity items linked to the learner, such as reviews, sessions, assignments, or planned learning activities.',
  lms: 'Shows whether online learning activity is available for this learner.',
  lmsProgress: 'The learner progress percentage reported for online learning activity.',
  components: 'Completed programme activity items compared with the total programme activity items available.',
  quizAttempts: 'The number of quiz attempts recorded for the learner.',
  ksbProgression: 'Progression against Knowledge, Skills and Behaviours where this information has been recorded.',
  actualHours: 'The learning hours actually recorded for this month or week.',
  plannedHours: 'The learning hours planned for this month or week.',
  items: 'The number of learning items shown after the current search/filter is applied.',
  warnings: 'A warning means this item may need checking before final sign-off, usually because a date or status is incomplete or inconsistent.',
};

export default function AuditWorkspace() {
  const { auditLearnerId } = useParams<{ auditLearnerId?: string }>();

  return (
    <WorkspaceShell
      role="auditor"
      roleLabel={auditorConfig.label}
      navItems={auditorConfig.items}
      pageTitle="Audit"
      pageSubtitle="Activity categories and learner activity timeline"
      userName="Patricia Stone"
      userRole="External Auditor"
      workspaceLabel={auditorConfig.workspaceLabel}
    >
      {auditLearnerId ? <AuditLearnerActivityPage learnerId={auditLearnerId} /> : <AuditActivitiesLanding />}
    </WorkspaceShell>
  );
}

type AuditCategoryKey = 'live_session' | 'quiz_reading' | 'video' | 'assignment' | 'self_study' | 'assessment' | 'other';
type AuditSortKey = 'learner' | 'programme' | 'planned' | 'actual' | 'done';
type AuditSortDirection = 'asc' | 'desc';

interface AuditMatrixRecord {
  learner: AuditLearnerSummary;
  audit: LearnerAuditResponse | null;
  activities: AuditMatrixItem[];
  error?: string;
}

type AuditMatrixItem = AuditActivityItem | AuditActivitySummary;

interface AuditMatrixCell {
  item: AuditMatrixItem;
  planned: number;
  actual: number;
  done: boolean;
}

interface AuditMatrixColumn {
  key: string;
  title: string;
  subtitle: string;
}

const AUDIT_CATEGORY_META: Record<AuditCategoryKey, { label: string; icon: string; className: string }> = {
  live_session: { label: 'Live Session', icon: 'ri-vidicon-line', className: 'bg-rose-600 text-white border-rose-600' },
  quiz_reading: { label: 'Quiz / Reading Material', icon: 'ri-book-open-line', className: 'bg-blue-50 text-blue-800 border-blue-200' },
  video: { label: 'Video', icon: 'ri-play-circle-line', className: 'bg-red-50 text-red-800 border-red-200' },
  assignment: { label: 'Assignment', icon: 'ri-file-edit-line', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  self_study: { label: 'Self Study', icon: 'ri-book-read-line', className: 'bg-cyan-50 text-cyan-800 border-cyan-200' },
  assessment: { label: 'Assessment', icon: 'ri-checkbox-line', className: 'bg-violet-50 text-violet-800 border-violet-200' },
  other: { label: 'Other Activity', icon: 'ri-stack-line', className: 'bg-background-100 text-foreground-700 border-background-300' },
};

function AuditActivitiesLanding() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<AuditMatrixRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<AuditCategoryKey>('live_session');
  const [programme, setProgramme] = useState('all');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortKey, setSortKey] = useState<AuditSortKey>('learner');
  const [sortDirection, setSortDirection] = useState<AuditSortDirection>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalLearners, setTotalLearners] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [activityStats, setActivityStats] = useState<AuditActivityStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setActivityLoading(false);
    setError('');
    sessionStorage.removeItem('audit-activity-learners');
    fetchAuditLearnersPage({ page, pageSize, search })
      .then((response) => {
        const details = response.results.map((learner) => ({
          learner,
          audit: null,
          activities: [],
        }));
        if (!cancelled) {
          setRecords(details);
          setTotalLearners(response.count);
          setTotalPages(response.totalPages || 1);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setRecords([]);
          setError(requestError instanceof Error ? requestError.message : 'Unable to load audit learners.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [page, pageSize, search]);

  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    fetchAuditActivityStats()
      .then((response) => {
        if (!cancelled) {
          setActivityStats(response);
        }
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load audit activity totals.');
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loading || records.length === 0) return undefined;
    let cancelled = false;
    setActivityLoading(true);
    fetchAuditLearnersPage({ includeActivities: true, activityCategory: selectedCategory, page, pageSize, search })
      .then((activityLearners) => {
        if (cancelled) return;
        const byId = new Map(activityLearners.results.map((learner) => [learner.learnerId, learner.activities || []]));
        setRecords((current) => current.map((record) => ({
          ...record,
          activities: byId.get(record.learner.learnerId) || [],
        })));
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load audit activities.');
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => { cancelled = true; };
  }, [loading, page, pageSize, records.length, search, selectedCategory]);

  const programmeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    records.forEach(({ learner, audit }) => {
      const name = audit?.learner.programme_name || learner.programName || 'No programme';
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [records]);

  const categoryCounts = useMemo(() => (
    (Object.keys(AUDIT_CATEGORY_META) as AuditCategoryKey[]).reduce((acc, key) => ({
      ...acc,
      [key]: activityStats?.categories[key]?.activities || 0,
    }), {} as Record<AuditCategoryKey, number>)
  ), [activityStats]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = records
      .filter((record) => {
        const programmeName = record.audit?.learner.programme_name || record.learner.programName || 'No programme';
        return programme === 'all' || programmeName === programme;
      })
      .filter((record) => {
        if (!query) return true;
        return [
          record.learner.fullName,
          record.learner.learnerId,
          record.audit?.learner.name,
          record.audit?.learner.programme_name,
          record.learner.programName,
        ].join(' ').toLowerCase().includes(query);
      })
      .map((record) => {
        const cells = record.activities
          .filter((item) => auditCategory(item) === selectedCategory)
          .filter((item) => inAuditDateWindow(auditItemDate(item), fromDate, toDate))
          .map((item) => auditCell(item));
        const planned = roundHours(cells.reduce((sum, cell) => sum + cell.planned, 0));
        const actual = roundHours(cells.reduce((sum, cell) => sum + cell.actual, 0));
        const done = cells.filter((cell) => cell.done).length;
        return { record, cells, planned, actual, done };
      })
      .filter((row) => row.cells.length > 0 || (!fromDate && !toDate));

    return rows.sort((left, right) => {
      const direction = sortDirection === 'asc' ? 1 : -1;
      const leftProgramme = left.record.audit?.learner.programme_name || left.record.learner.programName || '';
      const rightProgramme = right.record.audit?.learner.programme_name || right.record.learner.programName || '';
      if (sortKey === 'learner') return (left.record.learner.fullName || '').localeCompare(right.record.learner.fullName || '') * direction;
      if (sortKey === 'programme') return leftProgramme.localeCompare(rightProgramme) * direction;
      if (sortKey === 'planned') return (left.planned - right.planned) * direction;
      if (sortKey === 'actual') return (left.actual - right.actual) * direction;
      return (left.done - right.done) * direction;
    });
  }, [fromDate, programme, records, search, selectedCategory, sortDirection, sortKey, toDate]);

  const columns = useMemo<AuditMatrixColumn[]>(() => {
    const preferredProgramme = programme === 'all' ? filteredRows.find((row) => row.record.audit?.learner.programme_name || row.record.learner.programName)?.record.audit?.learner.programme_name || filteredRows[0]?.record.learner.programName || '' : programme;
    const byKey = new Map<string, AuditMatrixColumn>();
    filteredRows
      .filter((row) => programme !== 'all' || !preferredProgramme || (row.record.audit?.learner.programme_name || row.record.learner.programName || 'No programme') === preferredProgramme)
      .forEach((row) => {
        row.cells.forEach((cell) => {
          const key = auditItemKey(cell.item);
          if (!byKey.has(key)) {
            byKey.set(key, { key, title: auditItemTitle(cell.item), subtitle: auditItemSubtitle(cell.item) });
          }
        });
      });
    return Array.from(byKey.values());
  }, [filteredRows, programme]);

  const totals = useMemo(() => {
    const planned = roundHours(filteredRows.reduce((sum, row) => sum + row.planned, 0));
    const actual = roundHours(filteredRows.reduce((sum, row) => sum + row.actual, 0));
    const done = filteredRows.reduce((sum, row) => sum + row.done, 0);
    const cells = filteredRows.reduce((sum, row) => sum + row.cells.length, 0);
    return { planned, actual, done, cells, rate: cells ? Math.round((done / cells) * 100) : 0 };
  }, [filteredRows]);
  const selectedDbStats = activityStats?.categories[selectedCategory] || null;

  const requestSort = (next: AuditSortKey) => {
    if (next === sortKey) setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(next);
      setSortDirection('asc');
    }
  };

  const SortButton = ({ id, label }: { id: AuditSortKey; label: string }) => (
    <button type="button" onClick={() => requestSort(id)} className="inline-flex items-center gap-1 font-bold text-foreground-700 hover:text-primary-700">
      {label}
      <i className={`${sortKey === id ? (sortDirection === 'asc' ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line') : 'ri-expand-up-down-line'} text-xs`} />
    </button>
  );

  return (
    <div className="min-h-[calc(100vh-112px)] bg-background-100/50 p-3 md:p-5">
      <section className="rounded-xl border border-foreground-200/60 bg-background-50 p-5">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-foreground-500">Audit</span>
          <h1 className="text-2xl font-heading font-semibold text-foreground-950">Activity Categories</h1>
          <p className="text-[13px] text-foreground-500">All learners from the audit data, grouped by activity type. Cells show actual / planned hours.</p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {(Object.keys(AUDIT_CATEGORY_META) as AuditCategoryKey[]).map((key) => {
            const meta = AUDIT_CATEGORY_META[key];
            const active = selectedCategory === key;
            return (
              <button key={key} type="button" onClick={() => setSelectedCategory(key)} className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-[12px] font-bold transition ${active ? meta.className : 'border-background-300 bg-white text-foreground-700 hover:bg-background-100'}`}>
                <i className={meta.icon} />
                {meta.label}
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${active ? 'bg-white/20' : 'bg-background-100 text-foreground-500'}`}>{statsLoading ? '...' : categoryCounts[key]}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-background-300 bg-white p-3">
          <div className="grid gap-3 lg:grid-cols-[120px_220px_170px_1fr]">
            <label className="flex items-center gap-2 text-xs font-bold uppercase text-foreground-500"><i className="ri-filter-3-line" />Filters</label>
            <select value={programme} onChange={(event) => setProgramme(event.target.value)} className="h-10 rounded-lg border border-background-300 bg-background-50 px-3 text-sm outline-none focus:border-primary-300">
              <option value="all">All programmes</option>
              {programmeOptions.map(([option, count]) => <option key={option} value={option}>{display(option)} ({count})</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="h-10 min-w-0 rounded-lg border border-background-300 bg-background-50 px-2 text-sm outline-none focus:border-primary-300" />
              <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="h-10 min-w-0 rounded-lg border border-background-300 bg-background-50 px-2 text-sm outline-none focus:border-primary-300" />
            </div>
            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search learner..."
                className="h-10 w-full rounded-lg border border-background-300 bg-background-50 pl-10 pr-3 text-sm outline-none focus:border-primary-300"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-background-300 bg-background-100 px-4 py-3 text-sm text-foreground-700">
          <div className="flex flex-wrap items-center gap-4">
          <span><strong>{filteredRows.length}</strong> learners on page</span>
          <span><strong>{activityStats?.learners ?? totalLearners}</strong> DB learners</span>
          <span><strong>{totalLearners}</strong> matching learners</span>
          <span><strong>{selectedDbStats?.activities ?? totals.cells}</strong> DB activities</span>
          <span><strong>{columns.length}</strong> page columns</span>
          <span>Planned: <strong>{formatHoursFromHours(totals.planned)}</strong></span>
          <span>Actual on page: <strong>{formatHoursFromHours(totals.actual)}</strong></span>
          <span>DB actual: <strong>{formatHoursFromHours(selectedDbStats?.actualHours ?? totals.actual)}</strong></span>
          <span>Completed: <strong>{totals.done}/{totals.cells}</strong></span>
          <span>Rate: <strong>{totals.rate}%</strong></span>
          {activityLoading && <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700"><i className="ri-loader-4-line animate-spin" />Loading activity cells</span>}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="h-8 rounded-md border border-background-300 bg-white px-2 text-xs font-semibold outline-none focus:border-primary-300"
            >
              {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size} / page</option>)}
            </select>
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-background-300 bg-white text-foreground-700 disabled:cursor-not-allowed disabled:opacity-40">
              <i className="ri-arrow-left-s-line" />
            </button>
            <span className="min-w-[86px] text-center text-xs font-semibold text-foreground-600">Page {page} of {totalPages}</span>
            <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-background-300 bg-white text-foreground-700 disabled:cursor-not-allowed disabled:opacity-40">
              <i className="ri-arrow-right-s-line" />
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-background-300 bg-white">
          {loading ? (
            <div className="p-6"><EmptyPanel icon="ri-loader-4-line" text="Loading audit learners and activities..." /></div>
          ) : error ? (
            <div className="p-6"><StateBanner tone="error" text={error} /></div>
          ) : filteredRows.length === 0 ? (
            <div className="p-6"><EmptyPanel icon="ri-inbox-line" text="No learners match this activity category and filter set." /></div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-20 bg-background-50 text-xs uppercase tracking-wide text-foreground-600">
                  <tr>
                    <th className="sticky left-0 z-30 w-12 border-b border-r border-background-300 bg-background-50 px-3 py-3 text-left">#</th>
                    <th className="sticky left-12 z-30 min-w-[210px] border-b border-r border-background-300 bg-background-50 px-3 py-3 text-left"><SortButton id="learner" label="Learner" /></th>
                    <th className="min-w-[90px] border-b border-r border-background-300 px-3 py-3 text-center"><SortButton id="programme" label="Prog." /></th>
                    <th className="min-w-[90px] border-b border-r border-background-300 px-3 py-3 text-right"><SortButton id="planned" label="Plan." /></th>
                    <th className="min-w-[90px] border-b border-r border-background-300 px-3 py-3 text-right"><SortButton id="actual" label="Act." /></th>
                    <th className="min-w-[90px] border-b border-r border-background-300 px-3 py-3 text-center"><SortButton id="done" label="Done" /></th>
                    {columns.map((column) => (
                      <th key={column.key} className="min-w-[145px] border-b border-r border-background-300 px-3 py-3 text-left align-bottom" title={`${column.title} - ${column.subtitle}`}>
                        <span className="block text-[11px] font-bold text-foreground-700">{compactLabel(column.title, 20)}</span>
                        <span className="mt-1 block text-[10px] normal-case tracking-normal text-foreground-400">{compactLabel(column.subtitle, 22)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, index) => {
                    const cellsByColumn = new Map(row.cells.map((cell) => [auditItemKey(cell.item), cell]));
                    const learnerName = row.record.audit?.learner.name || row.record.learner.fullName || `Learner ${row.record.learner.learnerId}`;
                    const programmeName = row.record.audit?.learner.programme_name || row.record.learner.programName || '';
                    return (
                      <tr key={row.record.learner.learnerId} onClick={() => navigate(`/workspace/auditor/learner/${row.record.learner.learnerId}`)} className={`cursor-pointer border-b border-background-200 transition hover:bg-primary-50/40 ${isTestLearner(row.record.learner) ? 'bg-red-50/60' : ''}`}>
                        <td className="sticky left-0 z-10 border-r border-background-200 bg-white px-3 py-3 text-foreground-600">{index + 1}</td>
                        <td className="sticky left-12 z-10 border-r border-background-200 bg-white px-3 py-3">
                          <p className="flex items-center gap-2 font-bold text-foreground-950">
                            {learnerName}
                            {isTestLearner(row.record.learner) && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">Test</span>}
                          </p>
                          <p className="text-[11px] text-foreground-400">ID {row.record.learner.learnerId}</p>
                        </td>
                        <td className="border-r border-background-200 px-3 py-3 text-center"><span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800" title={programmeName}>{programmeCode(programmeName)}</span></td>
                        <td className="border-r border-background-200 px-3 py-3 text-right font-semibold">{formatHoursFromHours(row.planned)}</td>
                        <td className="border-r border-background-200 px-3 py-3 text-right font-semibold">{formatHoursFromHours(row.actual)}</td>
                        <td className="border-r border-background-200 px-3 py-3 text-center font-semibold">{row.done}/{row.cells.length}</td>
                        {columns.map((column) => {
                          const cell = cellsByColumn.get(column.key);
                          return (
                            <td key={column.key} className="border-r border-background-200 px-3 py-3 text-center text-xs text-foreground-500">
                              {cell ? <span className={`inline-flex rounded-md px-2 py-1 font-bold ${cell.done ? 'bg-cyan-50 text-cyan-800' : 'bg-background-100 text-foreground-500'}`}>{formatHoursFromHours(cell.actual)}/{formatHoursFromHours(cell.planned)}</span> : '-'}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AuditLearnerActivityPage({ learnerId }: { learnerId: string }) {
  const navigate = useNavigate();
  const [audit, setAudit] = useState<LearnerAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchLearnerAudit(learnerId)
      .then((payload) => { if (!cancelled) setAudit(filterPastAudit(payload)); })
      .catch((requestError) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load learner audit.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [learnerId]);

  const learnerName = audit?.learner.name || `Learner ${learnerId}`;

  return (
    <div className="min-h-[calc(100vh-112px)] bg-background-100/50 p-3 md:p-5">
      <section className="rounded-xl border border-foreground-200/60 bg-background-50 p-5">
        <button type="button" onClick={() => navigate('/workspace/auditor')} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800">
          <i className="ri-arrow-left-line" />
          Activity Categories
        </button>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-heading font-semibold text-foreground-950">{learnerName}</h1>
          <p className="text-[13px] text-foreground-500">{display(audit?.learner.programme_name)} - ID {learnerId}</p>
        </div>

        {loading ? (
          <div className="mt-6"><TimelineSkeleton /></div>
        ) : error ? (
          <div className="mt-6"><StateBanner tone="error" text={error} /></div>
        ) : !audit || audit.months.length === 0 ? (
          <div className="mt-6"><EmptyPanel icon="ri-inbox-line" text="No monthly audit activity was found for this learner." /></div>
        ) : (
          <div className="mt-6 space-y-4">
            {audit.months.map((month, index) => <AuditLearnerMonthSection key={month.month_key} month={month} defaultOpen={index === 0} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function AuditLearnerMonthSection({ month, defaultOpen }: { month: AuditMonth; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const totalItems = month.summary.aptem_items + month.summary.lms_items + month.undated_items.length;
  const displayWeeks = useMemo(() => displayWeeksForMonth(month), [month]);

  return (
    <div className="overflow-hidden rounded-xl border border-background-300 bg-white">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-background-50">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100 text-primary-700"><i className="ri-calendar-line" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-bold text-foreground-900">{month.label}</p>
          <p className="text-xs text-foreground-500">{displayWeeks.length} weeks - {totalItems} activities - Actual {formatHoursFromHours(month.summary.actual_hours)} / Planned {formatHoursFromHours(month.summary.planned_hours)}</p>
        </div>
        <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-background-300 p-3">
          <div className="space-y-3">
            {displayWeeks.map((week, index) => <AuditLearnerWeekSection key={week.week_key} week={week} weekNumber={index + 1} />)}
          </div>
          {month.undated_items.length > 0 && (
            <div className="rounded-lg border border-background-300">
              <div className="border-b border-background-300 bg-background-50 px-4 py-3">
                <p className="text-sm font-bold text-foreground-900">Undated activity</p>
                <p className="text-xs text-foreground-500">Items without a reliable week date</p>
              </div>
              <div className="grid gap-3 p-3 xl:grid-cols-3">
                <AuditActivityBucket title="Attendance" icon="ri-calendar-check-line" items={month.undated_items.filter(isAttendanceItem)} />
                <AuditActivityBucket title="LMS Activity" icon="ri-computer-line" items={month.undated_items.filter(isLmsActivityItem)} />
                <AuditActivityBucket title="Assignment" icon="ri-file-edit-line" items={month.undated_items.filter(isAssignmentItem)} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AuditLearnerWeekSection({ week, weekNumber }: { week: AuditWeek; weekNumber: number }) {
  const [open, setOpen] = useState(false);
  const allItems = [...week.aptem_items, ...week.lms_items];
  const attendanceItems = allItems.filter(isAttendanceItem);
  const lmsItems = allItems.filter(isLmsActivityItem);
  const assignmentItems = allItems.filter(isAssignmentItem);
  const actual = roundHours(allItems.reduce((sum, item) => sum + auditCell(item).actual, 0));
  const planned = roundHours(allItems.reduce((sum, item) => sum + auditCell(item).planned, 0));

  return (
    <div className="overflow-hidden rounded-lg border border-background-300 bg-white">
      <button type="button" onClick={() => setOpen((value) => !value)} className="w-full border-b border-background-300 bg-background-50 px-4 py-3 text-left transition hover:bg-background-100">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 shrink-0 items-center justify-center rounded-full bg-primary-50 px-3 text-xs font-bold text-primary-700 ring-1 ring-primary-100">Week {weekNumber}</span>
            <div className="min-w-0">
            <p className="text-sm font-bold text-foreground-900">{week.label}</p>
            <p className="text-xs text-foreground-500">{display(week.start_date)} - {display(week.end_date)}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-right">
            <div className="text-[11px] font-semibold text-foreground-500">
              <p>{allItems.length} activities</p>
              <p>{formatHoursFromHours(actual)} / {formatHoursFromHours(planned)}</p>
            </div>
            <i className={`ri-arrow-down-s-line text-lg text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </button>
      {open && (
        <div className="grid gap-3 p-3 xl:grid-cols-3">
          <AuditActivityBucket title="Attendance" icon="ri-calendar-check-line" items={attendanceItems} />
          <AuditActivityBucket title="LMS Activity" icon="ri-computer-line" items={lmsItems} />
          <AuditActivityBucket title="Assignment" icon="ri-file-edit-line" items={assignmentItems} />
        </div>
      )}
    </div>
  );
}

function displayWeeksForMonth(month: AuditMonth): AuditWeek[] {
  const match = /^(\d{4})-(\d{2})$/.exec(month.month_key);
  if (!match) return month.weeks;

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) return month.weeks;

  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const ranges = [
    [1, 7],
    [8, 14],
    [15, 21],
    [22, lastDay],
  ];

  const buckets = ranges.map(([startDay, endDay], index): AuditWeek => ({
    week_key: `${month.month_key}-display-week-${index + 1}`,
    label: `${startDay}-${endDay} ${shortMonthName(monthNumber)}`,
    start_date: dateKey(year, monthNumber, startDay),
    end_date: dateKey(year, monthNumber, endDay),
    aptem_items: [],
    lms_items: [],
  }));

  const overflowWeeks: AuditWeek[] = [];
  month.weeks.forEach((week) => {
    const bucketIndex = weekBucketIndex(month.month_key, week);
    if (bucketIndex >= 0 && bucketIndex < buckets.length) {
      buckets[bucketIndex].aptem_items.push(...week.aptem_items);
      buckets[bucketIndex].lms_items.push(...week.lms_items);
      return;
    }
    overflowWeeks.push(week);
  });

  return [...buckets, ...overflowWeeks];
}

function weekBucketIndex(monthKey: string, week: AuditWeek) {
  const day = dayInsideMonth(monthKey, week.start_date) ?? dayInsideMonth(monthKey, week.end_date);
  if (!day) return -1;
  if (day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  return 3;
}

function dayInsideMonth(monthKey: string, value?: string | null) {
  if (!value || !value.startsWith(monthKey)) return null;
  const day = Number(value.slice(8, 10));
  return Number.isFinite(day) && day > 0 ? day : null;
}

function dateKey(year: number, monthNumber: number, day: number) {
  return `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shortMonthName(monthNumber: number) {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthNumber - 1] || '';
}

function AuditActivityBucket({ title, icon, items }: { title: string; icon: string; items: AuditActivityItem[] }) {
  return (
    <div className="rounded-lg border border-background-300 bg-background-50 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-bold text-foreground-900"><i className={icon} />{title}</h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-foreground-500">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg bg-white px-3 py-4 text-center text-xs text-foreground-400">No activity</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border border-background-300 bg-white p-3">
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${auditCell(item).done ? 'bg-emerald-50 text-emerald-700' : 'bg-background-100 text-foreground-500'}`}>
                  <i className={AUDIT_CATEGORY_META[auditCategory(item)].icon} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground-900">{auditItemTitle(item)}</p>
                  <p className="mt-1 text-xs text-foreground-500">{auditItemSubtitle(item)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-foreground-500">
                    <span className="rounded-full bg-background-100 px-2 py-0.5">{item.source}</span>
                    <span className="rounded-full bg-background-100 px-2 py-0.5">{formatHoursFromHours(auditCell(item).actual)} / {formatHoursFromHours(auditCell(item).planned)}</span>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${statusPill(item.source === 'Aptem' ? item.status : item.completion_status)}`}>{item.source === 'Aptem' ? item.status : item.completion_status}</span>
                    {item.warnings.length > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{item.warnings.length} warning(s)</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function auditItems(audit: LearnerAuditResponse | null): AuditActivityItem[] {
  if (!audit) return [];
  return audit.months.flatMap((month) => [
    ...month.weeks.flatMap((week) => [...week.aptem_items, ...week.lms_items]),
    ...month.undated_items,
  ]);
}

function isAttendanceItem(item: AuditActivityItem) {
  if (item.source !== 'Aptem') return false;
  const text = `${item.type} ${item.activity_name}`.toLowerCase();
  return ['attendance', 'attendence', 'live', 'session', 'meeting', 'review', 'workshop', 'mentoring', 'coaching'].some((term) => text.includes(term));
}

function isAssignmentItem(item: AuditActivityItem) {
  if (item.source === 'LMS') return false;
  if (isAttendanceItem(item)) return false;
  const text = `${item.type} ${item.activity_name}`.toLowerCase();
  return ['assignment', 'assessment', 'evidence', 'portfolio', 'project', 'task', 'exam', 'reflection'].some((term) => text.includes(term)) || item.source === 'Aptem';
}

function isLmsActivityItem(item: AuditActivityItem) {
  return item.source === 'LMS';
}

function auditCell(item: AuditMatrixItem): AuditMatrixCell {
  if (isAuditActivitySummary(item)) {
    return {
      item,
      planned: roundHours(item.plannedHours || 0),
      actual: roundHours(item.actualHours || 0),
      done: item.done,
    };
  }
  if (item.source === 'Aptem') {
    return {
      item,
      planned: roundHours(item.planned_hours || 0),
      actual: roundHours(item.actual_hours || 0),
      done: statusBucket(item.status) === 'completed',
    };
  }
  return {
    item,
    planned: 0,
    actual: roundHours((item.tracked_seconds || 0) / 3600),
    done: statusBucket(item.completion_status) === 'completed',
  };
}

function auditCategory(item: AuditMatrixItem): AuditCategoryKey {
  if (isAuditActivitySummary(item)) {
    if (item.category === 'quiz' || item.category === 'reading') return 'quiz_reading';
    if (item.category in AUDIT_CATEGORY_META) return item.category as AuditCategoryKey;
  }
  const text = item.source === 'Aptem'
    ? `${item.type} ${item.activity_name}`
    : `${item.component_type} ${item.component_name} ${item.course_module}`;
  const normalized = text.toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized.includes('attendance') || normalized.includes('attendence') || normalized.includes('live') || normalized.includes('session')) return 'live_session';
  if (normalized.includes('quiz') || normalized.includes('reading') || normalized.includes('material')) return 'quiz_reading';
  if (normalized.includes('video') || normalized.includes('recording')) return 'video';
  if (normalized.includes('assignment') || normalized.includes('evidence') || normalized.includes('portfolio')) return 'assignment';
  if (normalized.includes('self_study') || normalized.includes('podcast') || normalized.includes('powerpoint')) return 'self_study';
  if (normalized.includes('assessment') || normalized.includes('reflection')) return 'assessment';
  return 'other';
}

function auditItemKey(item: AuditMatrixItem): string {
  if (isAuditActivitySummary(item)) return `${item.source}:${item.sourceId || item.id}:${item.title}`;
  return `${item.source}:${item.source_id || item.id}:${auditItemTitle(item)}`;
}

function auditItemTitle(item: AuditMatrixItem): string {
  if (isAuditActivitySummary(item)) return item.title || 'Activity';
  return item.source === 'Aptem' ? item.activity_name || item.type || 'Programme activity' : item.component_name || item.course_module || 'Online learning';
}

function auditItemSubtitle(item: AuditMatrixItem): string {
  if (isAuditActivitySummary(item)) return item.subtitle || item.source;
  return item.source === 'Aptem' ? item.type || item.match_status : item.course_module || item.component_type || item.match_status;
}

function auditItemDate(item: AuditMatrixItem): string | null {
  return isAuditActivitySummary(item) ? item.relevantDate : item.relevant_date;
}

function isAuditActivitySummary(item: AuditMatrixItem): item is AuditActivitySummary {
  return 'plannedHours' in item;
}

function inAuditDateWindow(date: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!date) return true;
  const value = date.slice(0, 10);
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

function compactLabel(value: string, max: number) {
  const text = display(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function programmeCode(value: string) {
  const text = value.trim();
  if (!text) return 'N/A';
  return text.split(/\s+/).filter(Boolean).map((word) => word[0]).join('').slice(0, 4).toUpperCase();
}

function LegacyMonthlyAuditWorkspace() {
  const [auditView, setAuditView] = useState<'monthly' | 'activities'>('monthly');
  const [learners, setLearners] = useState<AuditLearnerSummary[]>([]);
  const [selectedLearnerId, setSelectedLearnerId] = useState('');
  const [audit, setAudit] = useState<LearnerAuditResponse | null>(null);
  const [learnerSearch, setLearnerSearch] = useState('');
  const [learnerTestFilter, setLearnerTestFilter] = useState<'all' | 'test'>('all');
  const [programmeFilter, setProgrammeFilter] = useState('all');
  const [activitySearch, setActivitySearch] = useState('');
  const [selectedMonthKey, setSelectedMonthKey] = useState('');
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedSignoffMonthKeys, setSelectedSignoffMonthKeys] = useState<Set<string>>(new Set());
  const [loadingLearners, setLoadingLearners] = useState(true);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [error, setError] = useState('');
  const [signoffError, setSignoffError] = useState('');
  const [pdfError, setPdfError] = useState('');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
  const [savingSignoff, setSavingSignoff] = useState(false);
  const [learnerSignerName, setLearnerSignerName] = useState('');
  const [coachSignerName, setCoachSignerName] = useState('');
  const [learnerSignature, setLearnerSignature] = useState('');
  const [coachSignature, setCoachSignature] = useState('');
  const [learnerConfirmed, setLearnerConfirmed] = useState(false);
  const [coachConfirmed, setCoachConfirmed] = useState(false);
  const [learnerSignedAt, setLearnerSignedAt] = useState('');
  const [coachSignedAt, setCoachSignedAt] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoadingLearners(true);
fetchAuditLearners({ search: learnerSearch, includeTest: true })
        .then((rows) => {
          const visibleLearners = rows.filter((row) => learnerTestFilter === 'all' || isTestLearner(row));
          setLearners(visibleLearners);
          setSelectedLearnerId((current) => visibleLearners.some((row) => row.learnerId === current) ? current : visibleLearners[0]?.learnerId || '');
          setError('');
        })
        .catch((requestError: unknown) => {
          setLearners([]);
          setSelectedLearnerId('');
          setError(requestError instanceof Error ? requestError.message : 'Unable to load audit learners.');
        })
        .finally(() => setLoadingLearners(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [learnerSearch, learnerTestFilter]);

  const programmeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    learners.forEach((learner) => {
      const programme = learner.programName || 'No programme';
      counts.set(programme, (counts.get(programme) || 0) + 1);
    });
    return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [learners]);
  const visibleLearners = useMemo(() => (
    programmeFilter === 'all'
      ? learners
      : learners.filter((learner) => (learner.programName || 'No programme') === programmeFilter)
  ), [learners, programmeFilter]);

  useEffect(() => {
    if (programmeFilter !== 'all' && !programmeOptions.some(([programme]) => programme === programmeFilter)) {
      setProgrammeFilter('all');
    }
  }, [programmeFilter, programmeOptions]);

  useEffect(() => {
    if (!selectedLearnerId) {
      setAudit(null);
      return;
    }
    setLoadingAudit(true);
    setError('');
    let cancelled = false;
    fetchLearnerAudit(selectedLearnerId)
      .then((payload) => {
        if (cancelled) return;
        const pastAudit = filterPastAudit(payload);
        setAudit(pastAudit);
        const firstMonth = pastAudit.months[0]?.month_key || '';
        setSelectedMonthKey(firstMonth);
        setOpenMonths(new Set(firstMonth ? [firstMonth] : []));
        setOpenWeeks(new Set(pastAudit.months[0]?.weeks[0]?.week_key ? [pastAudit.months[0].weeks[0].week_key] : []));
        setSelectedSignoffMonthKeys(new Set(firstMonth ? [firstMonth] : []));
        setSelectedItemId(firstActivity(pastAudit.months)?.id || '');
        setError('');
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setAudit(null);
        setError(requestError instanceof Error ? requestError.message : 'Unable to load learner audit.');
      })
      .finally(() => {
        if (!cancelled) setLoadingAudit(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLearnerId]);

  const selectedLearner = learners.find((learner) => learner.learnerId === selectedLearnerId) || null;
  const selectedMonth = audit?.months.find((month) => month.month_key === selectedMonthKey) || audit?.months[0] || null;
  const visibleItems = useMemo(() => filterMonthItems(selectedMonth, activitySearch), [selectedMonth, activitySearch]);
  const selectedItem = visibleItems.find((item) => item.id === selectedItemId) || visibleItems[0] || null;
  const selectedSignoffMonths = useMemo(() => audit?.months.filter((month) => selectedSignoffMonthKeys.has(month.month_key)) || [], [audit, selectedSignoffMonthKeys]);
  const canPreviewPdf = Boolean(audit && selectedMonth && selectedSignoffMonths.length > 0 && learnerSignature && coachSignature);

  useEffect(() => {
if (!selectedMonth) return;
    const learner = selectedMonth.signoffs.learner;
    const coach = selectedMonth.signoffs.coach;
    setLearnerSignerName(learner?.signer_name || '');
    setLearnerSignature(learner?.signature_data || '');
    setLearnerConfirmed(Boolean(learner?.review_confirmed));
    setLearnerSignedAt(learner?.signed_at || '');
    setCoachSignerName(coach?.signer_name || '');
    setCoachSignature(coach?.signature_data || '');
    setCoachConfirmed(Boolean(coach?.review_confirmed));
    setCoachSignedAt(coach?.signed_at || '');
    setSignoffError('');
  }, [selectedMonth]);

  useEffect(() => () => {
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
  }, [pdfPreviewUrl]);

  const saveSignoffs = async () => {
    if (!audit || !selectedMonth) return;
    const targetMonths = selectedSignoffMonths;
    if (!targetMonths.length) {
      setSignoffError('Select at least one month to sign.');
      return;
    }
    setSavingSignoff(true);
    setSignoffError('');
    const now = new Date().toISOString();
    try {
      const payloads = targetMonths.map((month) => ({
          monthKey: month.month_key,
          roles: {
            learner: { signerName: learnerSignerName, signature: learnerSignature, confirmed: learnerConfirmed, signedAt: learnerSignature ? learnerSignedAt || now : '' },
            coach: { signerName: coachSignerName, signature: coachSignature, confirmed: coachConfirmed, signedAt: coachSignature ? coachSignedAt || now : '' },
          },
        }));
      const responses = audit.audit_version === 'learner-source-data-v7'
        ? payloads.map((payload) => ({
            learnerId: audit.learnerId,
            month: payload.monthKey,
            signoffs: {
              learner: {
                signer_role: 'learner' as const,
                signer_name: payload.roles.learner.signerName,
                review_confirmed: payload.roles.learner.confirmed,
                signature_data: payload.roles.learner.signature,
                signed_at: payload.roles.learner.signedAt,
                updated_at: now,
              },
              coach: {
                signer_role: 'coach' as const,
                signer_name: payload.roles.coach.signerName,
                review_confirmed: payload.roles.coach.confirmed,
                signature_data: payload.roles.coach.signature,
                signed_at: payload.roles.coach.signedAt,
                updated_at: now,
              },
            },
          }))
        : await Promise.all(payloads.map((payload) => saveAuditSignoff(audit.learnerId, payload)));
      const selectedResponse = responses.find((response) => response.month === selectedMonth.month_key) || responses[0];
      setLearnerSignedAt(selectedResponse?.signoffs.learner?.signed_at || (learnerSignature ? now : ''));
      setCoachSignedAt(selectedResponse?.signoffs.coach?.signed_at || (coachSignature ? now : ''));
      setAudit((current) => current ? applyManySignoffs(current, responses) : current);
    } catch (saveError) {
      setSignoffError(saveError instanceof Error ? saveError.message : 'Could not save sign-off.');
    } finally {
      setSavingSignoff(false);
    }
  };

  const openPdfPreview = async () => {
    if (!audit || !selectedMonth) return;
    const targetMonths = selectedSignoffMonths;
    if (!targetMonths.length) {
      setPdfError('Select at least one month to include in the PDF.');
      return;
    }
    if (!learnerSignature || !coachSignature) {
      setPdfError('Learner and coach signatures are required before previewing the PDF.');
      return;
    }
    setPdfError('');
    try {
      const logoDataUrl = await imageUrlToDataUrl(KBC_LOGO_URL);
      const doc = buildAuditPdf(audit, targetMonths, { learnerSignerName, learnerSignature, learnerConfirmed, learnerSignedAt, coachSignerName, coachSignature, coachConfirmed, coachSignedAt }, logoDataUrl);
      const nextUrl = URL.createObjectURL(doc.output('blob'));
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl(nextUrl);
    } catch (previewError) {
      setPdfError(previewError instanceof Error ? previewError.message : 'Could not generate the monthly PDF preview.');
    }
  };

  return (
    <WorkspaceShell
      role="auditor"
      roleLabel={auditorConfig.label}
      navItems={auditorConfig.items}
      pageTitle="Audit"
      pageSubtitle="Learner monthly sign-off"
      userName="Patricia Stone"
      userRole="External Auditor"
      workspaceLabel={auditorConfig.workspaceLabel}
    >
<div className="h-[calc(100vh-112px)] overflow-hidden bg-background-100/50 p-3 md:p-5">
        <div className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-foreground-200/60 bg-background-50 shadow-sm">
            <div className="shrink-0 border-b border-background-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-heading font-semibold text-foreground-900">Learners</h2>
                </div>
                {loadingLearners ? <SkeletonBlock className="h-6 w-8 rounded-full" /> : <span className="rounded-full bg-primary-50 px-2 py-1 text-[11px] font-semibold text-primary-700">{visibleLearners.length}</span>}
              </div>
              <SearchBox value={learnerSearch} onChange={setLearnerSearch} placeholder="Search learner, ID, programme" />
              <label className="mt-3 block">
                <span className="sr-only">Programme filter</span>
                <select
                  value={programmeFilter}
                  onChange={(event) => {
                    setProgrammeFilter(event.target.value);
                    setSelectedLearnerId('');
                  }}
                  className="h-9 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-semibold text-foreground-700 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                >
                  <option value="all">All programmes</option>
                  {programmeOptions.map(([programme, count]) => (
                    <option key={programme} value={programme}>{display(programme)} ({count})</option>
                  ))}
                </select>
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-background-100 p-1">
                <button
                  type="button"
                  onClick={() => setLearnerTestFilter('all')}
                  className={`h-8 rounded-md text-[11px] font-semibold transition ${learnerTestFilter === 'all' ? 'bg-white text-foreground-900 shadow-sm ring-1 ring-background-200' : 'text-foreground-500 hover:text-foreground-900'}`}
                >
                  All learners
                </button>
                <button
                  type="button"
                  onClick={() => setLearnerTestFilter('test')}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold transition ${learnerTestFilter === 'test' ? 'bg-white text-red-700 shadow-sm ring-1 ring-red-100' : 'text-foreground-500 hover:text-red-700'}`}
                >
                  <i className="ri-close-circle-line text-sm"></i>
                  Test only
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loadingLearners ? (
                <LearnerListSkeleton />
              ) : visibleLearners.length === 0 ? (
                <EmptyPanel icon="ri-user-search-line" text={learnerSearch || programmeFilter !== 'all' ? 'Learner not found.' : 'No learners are available.'} />
              ) : (
                visibleLearners.map((learner) => {
                  const learnerIsTest = isTestLearner(learner);
                  return (
                  <button
                    key={learner.learnerId}
                    type="button"
                    onClick={() => setSelectedLearnerId(learner.learnerId)}
                    className={`w-full rounded-lg p-2.5 text-left transition ${selectedLearnerId === learner.learnerId ? 'bg-primary-50 ring-1 ring-primary-200' : 'hover:bg-background-100'} ${learnerIsTest ? 'border border-red-100' : ''}`}
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                      <div className="min-w-0">
                        <div className="grid min-w-0 grid-cols-[minmax(0,auto)_auto] justify-start gap-2">
                          <p className="min-w-0 truncate text-[13px] font-semibold text-foreground-900">{learner.fullName || `Learner ${learner.learnerId}`}</p>
                          {learnerIsTest && (
                            <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-red-50 px-1.5 text-[10px] font-bold text-red-700 ring-1 ring-red-100">
                              <i className="ri-close-line text-xs"></i>
                              Test
                            </span>
                          )}
                        </div>
                        {learner.programName && learner.programName !== 'learner-source-data-v7' && (
                          <p className="mt-0.5 truncate text-[11px] text-foreground-500">{display(learner.programName)}</p>
                        )}
                      </div>
                      <span className="shrink-0 rounded-full bg-background-50 px-2 py-0.5 text-[10px] font-bold text-foreground-700 ring-1 ring-background-200">ID {learner.learnerId || 'N/A'}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-foreground-500">
                      <MiniFact label="OTJH" value={learner.completedOtjh == null ? 'N/A' : formatHours(learner.completedOtjh * 3600)} title={metricHelp.otjh} />
                      <MiniFact label="Aptem" value={learner.aptemComponentCount == null ? 'N/A' : String(learner.aptemComponentCount)} title={metricHelp.aptem} />
                      <MiniFact label="LMS" value={learner.hasLmsData ? 'Present' : 'Missing'} title={metricHelp.lms} />
                    </div>
                    {learner.warnings.length > 0 && <p title={metricHelp.warnings} className="mt-2 text-[10px] font-medium text-amber-700">{learner.warnings.length} warning(s)</p>}
                  </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <div className="space-y-4 pb-8">
            <div className="inline-grid grid-cols-2 gap-1 rounded-xl border border-background-200 bg-background-50 p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setAuditView('monthly')}
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-[12px] font-bold transition ${auditView === 'monthly' ? 'bg-primary-600 text-white shadow-sm' : 'text-foreground-600 hover:bg-background-100'}`}
              >
                <i className="ri-file-search-line" />
                Monthly Audit
              </button>
              <button
                type="button"
                onClick={() => setAuditView('activities')}
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-[12px] font-bold transition ${auditView === 'activities' ? 'bg-primary-600 text-white shadow-sm' : 'text-foreground-600 hover:bg-background-100'}`}
              >
                <i className="ri-stack-line" />
                Activity Categories
              </button>
            </div>

            {auditView === 'activities' ? (
              <div />
            ) : (
            <>
            {error && <StateBanner tone="error" text={error} />}
            {pdfError && <StateBanner tone="error" text={pdfError} />}

            <LearnerHeader audit={audit} selectedLearner={selectedLearner} loading={loadingAudit} onPreviewPdf={openPdfPreview} selectedMonth={selectedMonth} canPreviewPdf={canPreviewPdf} />

            <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-[minmax(0,680px)_minmax(420px,1fr)]">
              <MonthlyTimeline
                audit={audit}
                loading={loadingAudit}
                activitySearch={activitySearch}
                onActivitySearch={setActivitySearch}
                selectedMonthKey={selectedMonthKey}
                onSelectMonth={(monthKey) => {
                  setSelectedMonthKey(monthKey);
                  const month = audit?.months.find((entry) => entry.month_key === monthKey);
                  setSelectedItemId(firstActivity(month ? [month] : [])?.id || '');
                }}
                openMonths={openMonths}
                setOpenMonths={setOpenMonths}
                openWeeks={openWeeks}
                setOpenWeeks={setOpenWeeks}
                selectedItemId={selectedItem?.id || ''}
                onSelectItem={setSelectedItemId}
                selectedSignoffMonthKeys={selectedSignoffMonthKeys}
                onToggleSignoffMonth={(monthKey) => {
                  setSelectedSignoffMonthKeys((current) => {
                    const next = new Set(current);
                    if (next.has(monthKey)) next.delete(monthKey);
                    else next.add(monthKey);
                    return next;
                  });
                }}
                onSelectAllSignoffMonths={() => {
                  if (!audit) return;
                  const datedMonths = audit.months.filter((month) => month.month_key !== 'undated');
                  setSelectedSignoffMonthKeys((current) => current.size === datedMonths.length ? new Set() : new Set(datedMonths.map((month) => month.month_key)));
                }}
              />
              <AuditItemDetails item={selectedItem} loading={loadingAudit} audit={audit} month={selectedMonth} />
            </div>

            <section className="rounded-xl border border-foreground-200/60 bg-background-50 p-5">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-sm font-heading font-semibold text-foreground-900">Monthly Sign-Off</h2>
                  <p className="mt-1 text-[11px] text-foreground-400">The same learner and coach signatures will be applied to the checked month(s) and included in one PDF.</p>
                </div>
                <button
                  type="button"
                  onClick={saveSignoffs}
                  disabled={!audit || !selectedMonth || selectedSignoffMonths.length === 0 || savingSignoff}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-foreground-950 px-4 text-[12px] font-semibold text-white transition hover:bg-foreground-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <i className={`${savingSignoff ? 'ri-loader-4-line animate-spin' : 'ri-save-3-line'} text-sm`}></i>
                  {savingSignoff ? 'Saving...' : 'Save Sign-Off'}
                </button>
              </div>
              {signoffError && <StateBanner tone="error" text={signoffError} />}
              {selectedMonth && staleMessage(selectedMonth.signoffs) && <StateBanner tone="warn" text={staleMessage(selectedMonth.signoffs)} />}
              {loadingAudit ? (
                <SignoffSkeleton />
              ) : !audit || !selectedMonth ? (
                <EmptyPanel icon="ri-pen-nib-line" text="Select a learner and report month to capture signatures." />
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <SignoffCard
                    title="Learner Monthly Sign-Off"
                    signerName={learnerSignerName}
                    onSignerNameChange={setLearnerSignerName}
                    confirmed={learnerConfirmed}
                    onConfirmedChange={setLearnerConfirmed}
                    signature={learnerSignature}
                    onSignatureChange={setLearnerSignature}
                    declaration="I confirm I have learned the KSBs shown for this month, completed the recorded OTJH against the planned hours, and applied this learning in my workplace."
                  />
                  <SignoffCard
                    title="Coach Monthly Sign-Off"
                    signerName={coachSignerName}
                    onSignerNameChange={setCoachSignerName}
                    confirmed={coachConfirmed}
                    onConfirmedChange={setCoachConfirmed}
                    signature={coachSignature}
                    onSignatureChange={setCoachSignature}
                    declaration="I confirm I have reviewed this learner's monthly OTJH, KSB evidence, workplace application declaration, and data-quality warnings."
                  />
                </div>
              )}
            </section>

            </>
            )}
            </div>
          </section>
        </div>
      </div>
      {pdfPreviewUrl && selectedMonth && (
        <PdfPreviewModal
          fileName={`learner-audit-${fileSegment(audit?.learner.name || selectedLearner?.fullName || 'learner')}-${selectedSignoffMonths.length > 1 ? 'selected-months' : selectedMonth.month_key}.pdf`}
          previewUrl={pdfPreviewUrl}
          onClose={() => setPdfPreviewUrl('')}
        />
      )}
    </WorkspaceShell>
  );
}

function LearnerHeader({ audit, selectedLearner, loading, onPreviewPdf, selectedMonth, canPreviewPdf }: { audit: LearnerAuditResponse | null; selectedLearner: AuditLearnerSummary | null; loading: boolean; onPreviewPdf: () => void; selectedMonth: AuditMonth | null; canPreviewPdf: boolean }) {
  return (
    <section className="overflow-hidden rounded-xl border border-foreground-200/60 bg-background-50">
      <div className="flex flex-col gap-4 border-b border-background-200 bg-white p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-16 w-36 shrink-0 items-center justify-center rounded-lg border border-background-200 bg-white p-2">
            <img src={KBC_LOGO_URL} alt="Kent Business College" className="max-h-full max-w-full object-contain" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-600">Learning Sign-Off</p>
          <h2 className="mt-1 text-lg font-heading font-semibold text-foreground-950">Monthly Learning Sign-Off Report</h2>
            <p className="mt-0.5 text-[12px] text-foreground-500">{selectedMonth?.label || 'Select a report month'}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onPreviewPdf}
          disabled={!canPreviewPdf}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground-950 px-4 text-[12px] font-semibold text-white transition hover:bg-foreground-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <i className="ri-eye-line text-sm"></i>
          Preview Sign-Off PDF
        </button>
      </div>
      <div className="p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {loading && selectedLearner ? (
            <div className="mt-2 space-y-2">
              <SkeletonBlock className="h-7 w-72 max-w-full" />
              <SkeletonBlock className="h-3 w-96 max-w-full" />
            </div>
          ) : (
            <>
              <h1 className="mt-1 text-2xl font-heading font-semibold text-foreground-950">{audit?.learner.name || selectedLearner?.fullName || 'Select a learner'}</h1>
              <p className="mt-1 max-w-3xl text-[13px] text-foreground-500">{display(audit?.learner.programme_name || selectedLearner?.programName)}</p>
            </>
          )}
        </div>
      </div>
      {audit && (
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SummaryFact label="Learner ID" value={display(audit.learner.id)} title={metricHelp.learnerId} />
          <SummaryFact label="Completed OTJH" value={audit.summary.completed_otjh == null ? 'Not available' : formatHours(audit.summary.completed_otjh * 3600)} title={metricHelp.completedOtjh} />
          <SummaryFact label="LMS Progress" value={audit.summary.lms_progress == null ? 'Not available' : `${audit.summary.lms_progress}%`} title={metricHelp.lmsProgress} />
          <SummaryFact label="Components" value={audit.summary.components_total == null ? 'Not available' : `${audit.summary.components_completed ?? 0}/${audit.summary.components_total}`} title={metricHelp.components} />
          <SummaryFact label="Quiz Attempts" value={display(audit.summary.quiz_attempts)} title={metricHelp.quizAttempts} />
          <SummaryFact label="KSB Progression" value={display(audit.summary.ksb_progression)} title={metricHelp.ksbProgression} />
        </div>
      )}
      </div>
    </section>
  );
}

function MonthlyTimeline({ audit, loading, activitySearch, onActivitySearch, selectedMonthKey, onSelectMonth, openMonths, setOpenMonths, openWeeks, setOpenWeeks, selectedItemId, onSelectItem, selectedSignoffMonthKeys, onToggleSignoffMonth, onSelectAllSignoffMonths }: {
  audit: LearnerAuditResponse | null;
  loading: boolean;
  activitySearch: string;
  onActivitySearch: (value: string) => void;
  selectedMonthKey: string;
  onSelectMonth: (monthKey: string) => void;
  openMonths: Set<string>;
  setOpenMonths: (value: Set<string> | ((current: Set<string>) => Set<string>)) => void;
  openWeeks: Set<string>;
  setOpenWeeks: (value: Set<string> | ((current: Set<string>) => Set<string>)) => void;
  selectedItemId: string;
  onSelectItem: (itemId: string) => void;
  selectedSignoffMonthKeys: Set<string>;
  onToggleSignoffMonth: (monthKey: string) => void;
  onSelectAllSignoffMonths: () => void;
}) {
  const toggleMonth = (monthKey: string) => {
    setOpenMonths((current) => {
      const next = new Set(current);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
    onSelectMonth(monthKey);
  };
  const toggleWeek = (weekKey: string) => {
    setOpenWeeks((current) => {
      const next = new Set(current);
      if (next.has(weekKey)) next.delete(weekKey);
      else next.add(weekKey);
      return next;
    });
  };

  return (
    <section className="rounded-xl border border-foreground-200/60 bg-background-50">
      <div className="border-b border-background-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-heading font-semibold text-foreground-900">Monthly Learning Timeline</h2>
            <p className="mt-1 text-[11px] text-foreground-400">Learner activities and completed learning items grouped by month and week.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-background-100 px-2 py-1 text-[10px] font-semibold text-foreground-500">{selectedSignoffMonthKeys.size} selected</span>
            <button
              type="button"
              onClick={onSelectAllSignoffMonths}
              disabled={!audit?.months.length}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[11px] font-semibold text-primary-700 transition hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className="ri-checkbox-multiple-line text-sm"></i>
              {audit && selectedSignoffMonthKeys.size === audit.months.filter((month) => month.month_key !== 'undated').length ? 'Clear all' : 'Select all'}
            </button>
          </div>
        </div>
        <SearchBox value={activitySearch} onChange={onActivitySearch} placeholder="Search activities" />
      </div>
      <div className="max-h-[760px] overflow-y-auto p-3">
        {loading ? (
          <TimelineSkeleton />
        ) : !audit ? (
          <EmptyPanel icon="ri-timeline-view" text="Select a learner to load the monthly audit timeline." />
        ) : audit.months.length === 0 ? (
          <EmptyPanel icon="ri-calendar-close-line" text="No Aptem or LMS activities were found for this learner." />
        ) : (
          audit.months.map((month) => {
            const isOpen = openMonths.has(month.month_key);
            const isCheckedForSignoff = selectedSignoffMonthKeys.has(month.month_key);
            const monthItems = filterMonthItems(month, activitySearch);
            const completion = monthCompletion(month);
            const completionTitle = monthCompletionTitle(month);
            return (
              <div key={month.month_key} className={`mb-3 overflow-hidden rounded-lg border ${selectedMonthKey === month.month_key ? 'border-primary-200 bg-primary-50/30 shadow-sm' : 'border-background-200 bg-white'}`}>
                <div className="flex w-full items-start justify-between gap-3 p-3">
                  <button type="button" onClick={() => onSelectMonth(month.month_key)} className="flex min-w-0 flex-1 gap-3 text-left">
                    <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-foreground-950 text-white">
                      <span className="text-[10px] font-semibold uppercase">{monthShortLabel(month.label)}</span>
                      <span className="text-sm font-bold">{monthYearLabel(month.label)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-heading font-semibold text-foreground-950">{month.label}</p>
                      <p className="mt-1 text-[11px] text-foreground-500">
                        {month.weeks.length} week(s) - {month.summary.aptem_items} programme activity item(s) - {month.summary.lms_items} online learning item(s)
                      </p>
                      <div className="mt-2 flex items-center gap-2" title={completionTitle}>
                        <div className="h-1.5 w-full max-w-[260px] overflow-hidden rounded-full bg-background-200">
                          <div className="h-full rounded-full bg-primary-500" style={{ width: `${completion}%` }}></div>
                        </div>
                        <span className="shrink-0 text-[10px] font-semibold text-foreground-400">Progress {completion}%</span>
                      </div>
                    </div>
                  </button>
                  <div className="grid w-[172px] shrink-0 grid-cols-[minmax(92px,1fr)_24px_24px] items-start gap-2">
                    <div className="min-h-5 text-right">
                      {month.summary.warnings > 0 && <span title={metricHelp.warnings} className="inline-flex whitespace-nowrap rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">{month.summary.warnings} warning(s)</span>}
                    </div>
                    <button
                      type="button"
                      aria-pressed={isCheckedForSignoff}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleSignoffMonth(month.month_key);
                      }}
                      className={`flex h-5 w-5 items-center justify-center rounded border text-[12px] ${isCheckedForSignoff ? 'border-primary-600 bg-primary-600 text-white' : 'border-background-300 bg-white text-transparent'}`}
                    >
                      <i className="ri-check-line"></i>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMonth(month.month_key)}
                      aria-label={isOpen ? `Collapse ${month.label}` : `Expand ${month.label}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-500 transition hover:bg-background-100 hover:text-foreground-900"
                    >
                      <i className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></i>
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 px-3 pb-3 text-[10px]">
                  <MiniFact label="Actual" value={formatHoursFromHours(month.summary.actual_hours)} title={metricHelp.actualHours} />
                  <MiniFact label="Planned" value={formatHoursFromHours(month.summary.planned_hours)} title={metricHelp.plannedHours} />
                  <MiniFact label="Items" value={String(monthItems.length)} title={metricHelp.items} />
                </div>
                {isOpen && (
                  <div className="space-y-3 border-t border-background-200 bg-background-100/40 p-3">
                    {monthItems.length === 0 && activitySearch.trim() ? (
                      <EmptyPanel icon="ri-search-line" text="No activities match the current search for this month." />
                    ) : (
                      <>
                        {month.weeks.map((week, index) => (
                          <WeekBlock key={week.week_key} week={week} weekNumber={index + 1} search={activitySearch} open={openWeeks.has(week.week_key)} onToggle={() => toggleWeek(week.week_key)} selectedItemId={selectedItemId} onSelectItem={onSelectItem} />
                        ))}
                        {month.undated_items.length > 0 && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                            <p className="mb-2 text-[12px] font-semibold text-amber-800">Undated / Needs Review</p>
                            {month.undated_items.filter((item) => matchesActivity(item, activitySearch)).map((item) => <ActivityButton key={item.id} item={item} selected={selectedItemId === item.id} onSelect={onSelectItem} />)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function WeekBlock({ week, weekNumber, search, open, onToggle, selectedItemId, onSelectItem }: { week: AuditWeek; weekNumber: number; search: string; open: boolean; onToggle: () => void; selectedItemId: string; onSelectItem: (id: string) => void }) {
  const aptem = week.aptem_items.filter((item) => matchesActivity(item, search));
  const lms = week.lms_items.filter((item) => matchesActivity(item, search));
  const actualHours = aptem.reduce((total, item) => total + (item.actual_hours || 0), 0);
  const plannedHours = aptem.reduce((total, item) => total + (item.planned_hours || 0), 0);
  const warningCount = [...aptem, ...lms].reduce((total, item) => total + item.warnings.length, 0);
  if (search.trim() && !aptem.length && !lms.length) return null;
  return (
    <div className="rounded-lg border border-background-200 bg-white shadow-sm">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold text-primary-700 ring-1 ring-primary-100">Week {weekNumber}</span>
            <p className="text-[12px] font-semibold text-foreground-900">{week.label}</p>
          </div>
          <p className="mt-0.5 text-[10px] text-foreground-400">{formatDate(week.start_date)} - {formatDate(week.end_date)}</p>
          {week.source_modules?.length ? <p className="mt-1 truncate text-[10px] text-foreground-500">{week.source_modules.join(', ')}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded-full bg-primary-50 px-2 py-0.5 font-semibold text-primary-700">{aptem.length} programme</span>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">{lms.length} online</span>
            <span title={metricHelp.actualHours} className="rounded-full bg-background-100 px-2 py-0.5 text-foreground-600">Actual {formatHoursFromHours(actualHours)}</span>
            <span title={metricHelp.plannedHours} className="rounded-full bg-background-100 px-2 py-0.5 text-foreground-600">Planned {formatHoursFromHours(plannedHours)}</span>
            {warningCount > 0 && <span title={metricHelp.warnings} className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{warningCount} warning(s)</span>}
          </div>
        </div>
        <i className={`${open ? 'ri-subtract-line' : 'ri-add-line'} text-sm text-foreground-500`}></i>
      </button>
      {open && (
        <div className="space-y-3 border-t border-background-200 p-3">
          <ActivityGroup title="Programme Activity Items" items={aptem} selectedItemId={selectedItemId} onSelectItem={onSelectItem} />
          <ActivityGroup title="Online Learning Items" items={lms} selectedItemId={selectedItemId} onSelectItem={onSelectItem} />
        </div>
      )}
    </div>
  );
}

function ActivityGroup({ title, items, selectedItemId, onSelectItem }: { title: string; items: AuditActivityItem[]; selectedItemId: string; onSelectItem: (id: string) => void }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-foreground-400">{title}</p>
      {items.length === 0 ? <p className="text-[11px] text-foreground-400">No items.</p> : items.map((item) => <ActivityButton key={item.id} item={item} selected={selectedItemId === item.id} onSelect={onSelectItem} />)}
    </div>
  );
}

function ActivityButton({ item, selected, onSelect }: { item: AuditActivityItem; selected: boolean; onSelect: (id: string) => void }) {
  const title = item.source === 'Aptem' ? item.activity_name : item.component_name;
  const status = item.source === 'Aptem' ? item.status : item.completion_status;
  const details = item.source === 'Aptem'
    ? `${item.type} - Actual ${formatHoursFromHours(item.actual_hours)} - Planned ${formatHoursFromHours(item.planned_hours)}`
    : `${item.course_module} - ${formatHours(item.tracked_seconds)}`;
  const dateText = formatDate(item.relevant_date);
  return (
    <button type="button" onClick={() => onSelect(item.id)} className={`mb-2 w-full rounded-lg border p-3 text-left transition ${selected ? 'border-primary-300 bg-primary-50' : 'border-background-200 bg-white hover:bg-background-100'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-foreground-900">{title}</p>
          <p className="mt-1 truncate text-[10px] text-foreground-500">{details}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusPill(status)}`}>{status || 'Unknown'}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-foreground-500">
        <span className="rounded-full bg-background-100 px-2 py-0.5">{activityDisplayType(item)}</span>
        <span className="rounded-full bg-background-100 px-2 py-0.5">{dateText}</span>
        <span className="rounded-full bg-background-100 px-2 py-0.5">{item.match_status}</span>
        {item.warnings.length > 0 && <span title={metricHelp.warnings} className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{item.warnings.length} warning(s)</span>}
      </div>
    </button>
  );
}

function AuditItemDetails({ item, loading, audit, month }: { item: AuditActivityItem | null; loading: boolean; audit: LearnerAuditResponse | null; month: AuditMonth | null }) {
  if (loading) return <DetailSkeleton />;
  if (!item) {
    return (
      <section className="self-start rounded-xl border border-foreground-200/60 bg-background-50 p-5 2xl:sticky 2xl:top-3 2xl:max-h-[760px] 2xl:overflow-y-auto">
        <h2 className="text-sm font-heading font-semibold text-foreground-900">Learning Item Details</h2>
        <EmptyPanel icon="ri-file-search-line" text="Select an Aptem or LMS activity to inspect its audit details." />
        {audit && month && <MonthlyLearnerDeclaration audit={audit} month={month} />}
      </section>
    );
  }
  return (
<section className="self-start rounded-xl border border-foreground-200/60 bg-background-50 p-4 shadow-sm 2xl:sticky 2xl:top-3 2xl:max-h-[760px] 2xl:overflow-y-auto">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-600">Learning Item Details</p>
          <h2 className="mt-1 text-base font-heading font-semibold leading-snug text-foreground-950">{item.source === 'Aptem' ? item.activity_name : item.component_name}</h2>
        </div>
        <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-bold text-foreground-700 ring-1 ring-background-200">{activityDisplayType(item)}</span>
      </div>

      {item.source === 'Aptem' ? <AptemDetails item={item} /> : <LmsDetails item={item} />}
      {audit && month && <MonthlyLearnerDeclaration audit={audit} month={month} />}
    </section>
  );
}

function AptemDetails({ item }: { item: AptemAuditItem }) {
  return (
    <InfoGrid rows={[
      ['Learning type', 'Programme activity'],
      ['Activity name', item.activity_name],
      ['Type', item.type],
      ['Status', item.status],
      ['Actual hours', formatHoursFromHours(item.actual_hours)],
      ['Planned hours', formatHoursFromHours(item.planned_hours)],
      ['Hours variance', formatHoursFromHours(item.hours_variance)],
      ['Start date', formatDate(item.start_date)],
      ['End date', formatDate(item.end_date)],
      ['Relevant date', formatDate(item.relevant_date)],
    ]} />
  );
}

function LmsDetails({ item }: { item: LmsAuditItem }) {
  return (
    <InfoGrid rows={[
      ['Learning type', 'Online learning'],
      ['Course/module', item.course_module],
      ['Component/material', item.component_name],
      ['Quiz attempts', display(item.quiz_attempts)],
      ['Quiz score', item.quiz_score == null ? 'Not available' : `${item.quiz_score}%`],
      ['Tutor', display(item.tutor)],
      ['Course started', formatDate(item.course_started_at)],
      ['Course completed', formatDate(item.course_completed_at)],
      ['Relevant date', formatDate(item.relevant_date)],
    ]} />
  );
}

function MonthlyLearnerDeclaration({ audit, month }: { audit: LearnerAuditResponse; month: AuditMonth }) {
  const declaration = monthlyDeclarationData(audit, month);
  return (
    <div className="mt-4 rounded-lg border border-primary-100 bg-primary-50/30 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
            <i className="ri-file-sign-line text-base"></i>
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-heading font-semibold text-foreground-950">Monthly Declaration</h3>
            <p className="mt-0.5 text-[11px] leading-5 text-foreground-500">
              Learner signs to confirm monthly KSB learning, OTJH, and workplace application.
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-primary-700 ring-1 ring-primary-100">{month.label}</span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <MiniFact label="Planned OTJH" value={formatHoursFromHours(declaration.plannedHours)} title={metricHelp.plannedOtjh} />
        <MiniFact label="Completed OTJH" value={formatHoursFromHours(declaration.completedHours)} title={metricHelp.completedOtjh} />
        <MiniFact label="Approved OTJH" value={formatHoursFromHours(declaration.approvedHours)} title={metricHelp.approvedOtjh} />
      </div>

      <div className="mt-3 rounded-lg border border-background-200 bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">KSBs Learned This Month</p>
          {declaration.ksbs.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {declaration.ksbs.map((ksb) => (
                <span key={ksb} className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700 ring-1 ring-primary-100">{ksb}</span>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] leading-5 text-foreground-500">No KSB codes recorded for this month.</p>
          )}
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] leading-5 text-emerald-800">
        <i className="ri-check-double-line mt-0.5 shrink-0 text-sm"></i>
        <span>
        I confirm that I have applied this month's KSB learning in my workplace practice and that the OTJH figures above reflect my planned, completed, and coach-reviewed learning record.
        </span>
      </div>
    </div>
  );
}

function SignoffCard({ title, signerName, onSignerNameChange, confirmed, onConfirmedChange, signature, onSignatureChange, declaration }: { title: string; signerName: string; onSignerNameChange: (value: string) => void; confirmed: boolean; onConfirmedChange: (value: boolean) => void; signature: string; onSignatureChange: (value: string) => void; declaration: string }) {
  return (
    <div className="grid h-full grid-rows-[auto_68px_40px_auto] gap-3 rounded-lg border border-background-200 bg-background-100/50 p-4">
      <h3 className="text-[13px] font-heading font-semibold text-foreground-900">{title}</h3>
      <label className="flex h-full items-start gap-2 rounded-lg border border-background-200 bg-white p-3 text-[12px] leading-5 text-foreground-700">
        <input type="checkbox" checked={confirmed} onChange={(event) => onConfirmedChange(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-background-300 text-primary-600" />
        <span className="line-clamp-2 overflow-hidden">{declaration}</span>
      </label>
      <input
        value={signerName}
        onChange={(event) => onSignerNameChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-background-200 bg-white px-3 text-[13px] text-foreground-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
        placeholder="Signer name"
      />
      <SignatureCapture label={title} value={signature} onChange={onSignatureChange} />
    </div>
  );
}

function SignatureCapture({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const onChangeRef = useRef(onChange);
  const [hasInk, setHasInk] = useState(Boolean(value));

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(Math.floor(rect.width * ratio), 1);
      canvas.height = Math.max(Math.floor(rect.height * ratio), 1);
      const context = canvas.getContext('2d');
      context?.scale(ratio, ratio);
    };

    const pad = new SignaturePad(canvas, {
      backgroundColor: 'rgb(255, 255, 255)',
      penColor: 'rgb(17, 24, 39)',
      minWidth: 0.8,
      maxWidth: 2.4,
      velocityFilterWeight: 0.7,
    });
    padRef.current = pad;
    resizeCanvas();

    const handleEndStroke = () => {
      const signatureValue = pad.isEmpty() ? '' : pad.toDataURL('image/png');
      setHasInk(Boolean(signatureValue));
      onChangeRef.current(signatureValue);
    };
    pad.addEventListener('endStroke', handleEndStroke);
    window.addEventListener('resize', resizeCanvas);

    return () => {
      pad.removeEventListener('endStroke', handleEndStroke);
      pad.off();
      window.removeEventListener('resize', resizeCanvas);
      padRef.current = null;
    };
  }, []);

  useEffect(() => {
    const pad = padRef.current;
    const canvas = canvasRef.current;
    if (!pad || !canvas) return;
    if (!value) {
      pad.clear();
      setHasInk(false);
      return;
    }
    const image = new Image();
    image.onload = () => {
      const context = canvas.getContext('2d');
      if (!context) return;
      pad.clear();
      context.drawImage(image, 0, 0, canvas.width / Math.max(window.devicePixelRatio || 1, 1), canvas.height / Math.max(window.devicePixelRatio || 1, 1));
      setHasInk(true);
    };
    image.src = value;
  }, [value]);

  return (
    <div className="rounded-lg border border-background-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">{label}</p>
        <button type="button" onClick={() => { padRef.current?.clear(); setHasInk(false); onChange(''); }} className="rounded-lg border border-background-200 px-2.5 py-1 text-[11px] font-semibold text-foreground-600 disabled:opacity-40" disabled={!hasInk}>
          Clear
        </button>
      </div>
      <div className="relative h-36 overflow-hidden rounded-lg border border-background-200 bg-white">
        <canvas ref={canvasRef} className="h-full w-full touch-none" style={{ cursor: SIGNATURE_CURSOR }} />
        {!hasInk && <i className="ri-pen-nib-line pointer-events-none absolute right-4 top-4 text-lg text-foreground-300"></i>}
        <div className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-dashed border-foreground-300"></div>
      </div>
    </div>
  );
}

function PdfPreviewModal({ fileName, previewUrl, onClose }: { fileName: string; previewUrl: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground-950/70 p-4">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-background-200 px-4 py-3">
          <p className="truncate text-[13px] font-semibold text-foreground-900">{fileName}</p>
          <div className="flex items-center gap-2">
            <a href={previewUrl} download={fileName} className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground-950 px-3 text-[12px] font-semibold text-white">
              <i className="ri-download-2-line text-sm"></i>
              Download
            </a>
            <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-background-200 text-foreground-600">
              <i className="ri-close-line text-lg"></i>
            </button>
          </div>
        </div>
        <iframe title="Monthly audit PDF preview" src={previewUrl} className="min-h-0 flex-1" />
      </div>
    </div>
  );
}

function InfoGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {rows.map(([label, value]) => {
        const title = infoGridHelp(label);
        return (
        <div key={label} title={title} className="rounded-lg border border-background-200 bg-background-100/50 p-3">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-400">
            <span>{label}</span>
            {title && <i className="ri-information-line text-[11px] text-foreground-300"></i>}
          </p>
          <p className="mt-1 break-words text-[12px] font-medium text-foreground-900">{value || 'Not available'}</p>
        </div>
        );
      })}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="relative mt-3">
      <i className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-10 w-full rounded-lg border border-background-200 bg-background-50 pl-9 pr-3 text-[12px] outline-none transition focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100" />
    </div>
  );
}

function EmptyPanel({ icon, text }: { icon: string; text: string }) {
  return <div className="rounded-lg border border-dashed border-background-300 bg-background-100/50 p-6 text-center text-[12px] text-foreground-500"><i className={`${icon} mb-2 block text-xl text-foreground-300`}></i>{text}</div>;
}

function StateBanner({ tone, text }: { tone: 'error' | 'warn' | 'success'; text: string }) {
  const toneClass = tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return <div className={`rounded-xl border px-4 py-3 text-[12px] ${toneClass}`}>{text}</div>;
}

function MiniFact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title} className="rounded-lg bg-background-50 px-2 py-1.5 ring-1 ring-background-200">
      <p className="flex items-center gap-1 truncate text-[9px] uppercase tracking-wide text-foreground-400">
        <span className="truncate">{label}</span>
        {title && <i className="ri-information-line shrink-0 text-[10px] text-foreground-300"></i>}
      </p>
      <p className="truncate font-semibold text-foreground-800">{value}</p>
    </div>
  );
}

function SummaryFact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title} className="rounded-lg border border-background-200 bg-background-100/50 p-3">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-400">
        <span>{label}</span>
        {title && <i className="ri-information-line text-[11px] text-foreground-300"></i>}
      </p>
      <p className="mt-1 break-words text-[13px] font-bold text-foreground-900">{value}</p>
    </div>
  );
}

function LearnerListSkeleton() {
  return <div className="space-y-2 p-1">{Array.from({ length: 6 }).map((_, index) => <SkeletonBlock key={index} className="h-24 rounded-lg" />)}</div>;
}

function TimelineSkeleton() {
  return <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <SkeletonBlock key={index} className="h-32 rounded-lg" />)}</div>;
}

function DetailSkeleton() {
  return <section className="rounded-xl border border-foreground-200/60 bg-background-50 p-5"><SkeletonBlock className="h-7 w-64 rounded-lg" /><div className="mt-4 grid grid-cols-2 gap-2">{Array.from({ length: 8 }).map((_, index) => <SkeletonBlock key={index} className="h-16 rounded-lg" />)}</div></section>;
}

function SignoffSkeleton() {
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{Array.from({ length: 2 }).map((_, index) => <SkeletonBlock key={index} className="h-80 rounded-lg" />)}</div>;
}

function filterMonthItems(month: AuditMonth | null, search: string) {
  if (!month) return [];
  const items = [...month.weeks.flatMap((week) => [...week.aptem_items, ...week.lms_items]), ...month.undated_items];
  return items.filter((item) => matchesActivity(item, search));
}

function monthlyDeclarationData(audit: LearnerAuditResponse, month: AuditMonth) {
  const items = filterMonthItems(month, '');
  const aptemItems = items.filter((item): item is AptemAuditItem => item.source === 'Aptem');
  const hasAptemHours = aptemItems.some((item) => item.actual_hours != null || item.planned_hours != null);
  const plannedHours = hasAptemHours || month.summary.planned_hours > 0 ? month.summary.planned_hours : audit.summary.planned_hours_month;
  const completedHours = hasAptemHours || month.summary.actual_hours > 0 ? month.summary.actual_hours : audit.summary.completed_otjh;
  const approvedFromRows = sumRawHours(items, ['approved_hours', 'approved_otjh', 'approved otjh', 'approved']);
  const approvedHours = approvedFromRows ?? audit.summary.approved_hours;
  const ksbs = uniqueStrings(items.flatMap((item) => extractKsbCodes(item)));

  return {
    plannedHours,
    completedHours,
    approvedHours,
    ksbs,
  };
}

function extractKsbCodes(item: AuditActivityItem) {
  const values = flattenAuditValues(item.raw);
  if (item.source === 'LMS') values.push(item.component_name, item.course_module);
  if (item.source === 'Aptem') values.push(item.activity_name, item.type);
  return values.flatMap((value) => value.match(/\b(?:K|S|B|KSB)\s*\d+[a-z]?\b/gi) || []).map((code) => code.toUpperCase().replace(/\s+/g, ''));
}

function flattenAuditValues(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((entry) => flattenAuditValues(entry));
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap((entry) => flattenAuditValues(entry));
  return [];
}

function sumRawHours(items: AuditActivityItem[], keys: string[]) {
  let total = 0;
  let found = false;
  items.forEach((item) => {
    Object.entries(item.raw).forEach(([key, value]) => {
      const normalizedKey = key.toLowerCase().replace(/[_-]+/g, ' ');
      if (!keys.some((candidate) => normalizedKey.includes(candidate))) return;
      const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/[^\d.-]/g, '')) : NaN;
      if (Number.isFinite(numeric)) {
        total += numeric;
        found = true;
      }
    });
  });
  return found ? roundHours(total) : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function monthCompletion(month: AuditMonth) {
  const total = month.summary.completed + month.summary.in_progress + month.summary.not_started;
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((month.summary.completed / total) * 100)));
}

function monthCompletionTitle(month: AuditMonth) {
  const total = month.summary.completed + month.summary.in_progress + month.summary.not_started;
  return total
    ? `Progress: ${month.summary.completed} completed learning item(s) out of ${total} total item(s) for this month.`
    : 'Progress: no learning items recorded for this month.';
}

function monthShortLabel(label: string) {
  const first = label.split(' ')[0] || '';
  return first.slice(0, 3) || 'Mon';
}

function monthYearLabel(label: string) {
  const year = label.match(/\d{4}/)?.[0] || '';
  return year.slice(-2) || '--';
}

function matchesActivity(item: AuditActivityItem, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const text = item.source === 'Aptem'
    ? [item.activity_name, item.type, item.status, item.match_status, item.warning_codes.join(' ')].join(' ')
    : [item.course_module, item.component_name, item.component_type, item.completion_status, item.tutor, item.match_status, item.warning_codes.join(' ')].join(' ');
  return text.toLowerCase().includes(needle);
}

function firstActivity(months: AuditMonth[]) {
  for (const month of months) {
    for (const week of month.weeks) {
      const item = week.aptem_items[0] || week.lms_items[0];
      if (item) return item;
    }
    if (month.undated_items[0]) return month.undated_items[0];
  }
  return null;
}

function applyManySignoffs(audit: LearnerAuditResponse, responses: Array<{ month: string; signoffs: { learner: AuditSignoff | null; coach: AuditSignoff | null } }>) {
  const signoffsByMonth = new Map(responses.map((response) => [response.month, response.signoffs]));
  const nextSignoffs = { ...audit.signoffs };
  responses.forEach((response) => {
    nextSignoffs[response.month] = response.signoffs;
  });
  return {
    ...audit,
    months: audit.months.map((month) => signoffsByMonth.has(month.month_key) ? { ...month, signoffs: signoffsByMonth.get(month.month_key)! } : month),
    signoffs: nextSignoffs,
  };
}

function statusPill(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes('complete') || normalized.includes('pass') || normalized.includes('present') || normalized.includes('attend')) return 'bg-emerald-50 text-emerald-700';
  if (normalized.includes('progress') || normalized.includes('start')) return 'bg-blue-50 text-blue-700';
  return 'bg-amber-50 text-amber-700';
}

function activityDisplayType(item: AuditActivityItem) {
  return item.source === 'Aptem' ? 'Programme activity' : 'Online learning';
}

function infoGridHelp(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes('learning type')) return 'Shows whether this item is a programme activity or an online learning item.';
  if (normalized.includes('activity name')) return 'The learning activity title recorded for this item.';
  if (normalized.includes('course/module')) return 'The course or module linked to this learning item.';
  if (normalized.includes('component/material')) return 'The specific material, component, or learning item title.';
  if (normalized.includes('actual hours')) return metricHelp.actualHours;
  if (normalized.includes('planned hours')) return metricHelp.plannedHours;
  if (normalized.includes('hours variance')) return 'The difference between recorded hours and planned hours for this item.';
  if (normalized.includes('status')) return 'The recorded progress state for this learning item.';
  if (normalized.includes('quiz attempts')) return metricHelp.quizAttempts;
  if (normalized.includes('quiz score')) return 'The quiz result recorded for this learning item where available.';
  if (normalized.includes('tutor')) return 'The tutor or coach linked to this learning item where available.';
  if (normalized.includes('started')) return 'The recorded start date for this course or learning item.';
  if (normalized.includes('completed')) return 'The recorded completion date for this course or learning item.';
  if (normalized.includes('relevant date')) return 'The date used to place this item into the month and week timeline.';
  return '';
}

function staleMessage(signoffs: AuditMonth['signoffs']) {
  return signoffs.learner?.status_message || signoffs.coach?.status_message || '';
}

function display(value: unknown) {
  if (value === null || value === undefined || value === '') return 'Not available';
  return String(value);
}

function isTestLearner(learner: AuditLearnerSummary) {
  const text = `${learner.fullName || ''} ${learner.programName || ''}`;
  return /\btest\b/i.test(text) || /\(test\)/i.test(text);
}

function filterPastAudit(audit: LearnerAuditResponse) {
  const todayKey = toDateKey(new Date());
  const months = audit.months
    .map((month) => {
      if (month.month_key === 'undated') return month;
      const weeks = month.weeks
        .map((week) => ({
          ...week,
          aptem_items: week.aptem_items.filter((item) => isPastOrToday(item.relevant_date, todayKey)),
          lms_items: week.lms_items.filter((item) => isPastOrToday(item.relevant_date, todayKey)),
        }))
        .filter((week) => week.aptem_items.length || week.lms_items.length || Boolean(week.source_column));
      const undatedItems = month.undated_items.filter((item) => !item.relevant_date || isPastOrToday(item.relevant_date, todayKey));
      if (!weeks.length && !undatedItems.length) return null;
      return recomputeMonthSummary({ ...month, weeks, undated_items: undatedItems });
    })
    .filter((month): month is AuditMonth => Boolean(month));
  return { ...audit, months, signoffs: Object.fromEntries(months.map((month) => [month.month_key, month.signoffs])) };
}

function recomputeMonthSummary(month: AuditMonth): AuditMonth {
  const items = [...month.weeks.flatMap((week) => [...week.aptem_items, ...week.lms_items]), ...month.undated_items];
  const aptemItems = items.filter((item): item is AptemAuditItem => item.source === 'Aptem');
  const lmsItems = items.filter((item): item is LmsAuditItem => item.source === 'LMS');
  return {
    ...month,
    summary: {
      actual_hours: roundHours(aptemItems.reduce((total, item) => total + (item.actual_hours || 0), 0)),
      planned_hours: roundHours(aptemItems.reduce((total, item) => total + (item.planned_hours || 0), 0)),
      aptem_items: aptemItems.length,
      lms_items: lmsItems.length,
      completed: items.filter((item) => statusBucket(item.source === 'Aptem' ? item.status : item.completion_status) === 'completed').length,
      in_progress: items.filter((item) => statusBucket(item.source === 'Aptem' ? item.status : item.completion_status) === 'in_progress').length,
      not_started: items.filter((item) => statusBucket(item.source === 'Aptem' ? item.status : item.completion_status) === 'not_started').length,
      warnings: items.reduce((total, item) => total + (item.warnings?.length || 0), 0),
    },
  };
}

function isPastOrToday(value: string | null, todayKey: string) {
  if (!value) return true;
  return value.slice(0, 10) <= todayKey;
}

function toDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

function statusBucket(status: string) {
  const normalized = status.toLowerCase().replace(/\s/g, '');
  if (normalized.includes('complete') || normalized === 'passed' || normalized === 'done' || normalized === 'present' || normalized === 'attended' || normalized === 'attend') return 'completed';
  if (normalized.includes('progress') || normalized.includes('started') || normalized.includes('visited')) return 'in_progress';
  return 'not_started';
}

function formatDate(value?: string | null) {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsed);
}

function formatHours(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return 'Not available';
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.round((safeSeconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatHoursFromHours(hours?: number | null) {
  if (hours === null || hours === undefined) return 'Not available';
  return formatHours(hours * 3600);
}

function fileSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'learner';
}

async function imageUrlToDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load the report logo.');
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the report logo.'));
    reader.readAsDataURL(blob);
  });
}

function combineSelectedMonths(months: AuditMonth[]): AuditMonth {
  const [first] = months;
  if (!first || months.length === 1) return first;
  return {
    ...first,
    month_key: months.map((month) => month.month_key).join('__'),
    label: months.map((month) => month.label).join(', '),
    summary: {
      actual_hours: roundHours(months.reduce((total, month) => total + month.summary.actual_hours, 0)),
      planned_hours: roundHours(months.reduce((total, month) => total + month.summary.planned_hours, 0)),
      aptem_items: months.reduce((total, month) => total + month.summary.aptem_items, 0),
      lms_items: months.reduce((total, month) => total + month.summary.lms_items, 0),
      completed: months.reduce((total, month) => total + month.summary.completed, 0),
      in_progress: months.reduce((total, month) => total + month.summary.in_progress, 0),
      not_started: months.reduce((total, month) => total + month.summary.not_started, 0),
      warnings: months.reduce((total, month) => total + month.summary.warnings, 0),
    },
    weeks: months.flatMap((month) => month.weeks.map((week) => ({ ...week, label: `${month.label} / ${week.label}` }))),
    undated_items: months.flatMap((month) => month.undated_items),
    signoffs: first.signoffs,
  };
}

function buildAuditPdf(audit: LearnerAuditResponse, months: AuditMonth[], signoff: {
  learnerSignerName: string;
  learnerSignature: string;
  learnerConfirmed: boolean;
  learnerSignedAt: string;
  coachSignerName: string;
  coachSignature: string;
  coachConfirmed: boolean;
  coachSignedAt: string;
}, logoDataUrl: string) {
  const month = combineSelectedMonths(months);
  const selectedMonthLabel = months.length === 1 ? month.label : `${months.length} selected months`;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const page = { left: 14, right: 196, top: 14, bottom: 282, width: 182 };
  const purple: [number, number, number] = [92, 31, 191];
  const dark: [number, number, number] = [17, 24, 39];
  const muted: [number, number, number] = [100, 116, 139];
  let y = page.top;

  const setText = (size: number, bold = false, color: [number, number, number] = dark) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };

  const printable = (value: string) => {
    if (!value || value === 'Not available') return 'Not recorded';
    return value.replace(/Not available in source/g, 'Not recorded').replace(/Not available/g, 'Not recorded');
  };

  const ensure = (height: number) => {
    if (y + height > page.bottom) {
      doc.addPage();
      y = page.top;
      pageHeader();
    }
  };

  const add = (text: string, size = 9, bold = false, color: [number, number, number] = dark, width = page.width) => {
    ensure(8);
    setText(size, bold, color);
    const lines = doc.splitTextToSize(printable(text), width) as string[];
    doc.text(lines, page.left, y);
    y += Math.max(5.5, lines.length * 5);
  };

  const pageHeader = () => {
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, 210, 24, 'F');
    doc.setFillColor(purple[0], purple[1], purple[2]);
    doc.rect(0, 0, 210, 3, 'F');
    if (logoDataUrl) doc.addImage(logoDataUrl, 'PNG', page.left, 7, 34, 12);
    setText(8, false, muted);
    doc.text('Monthly Learning Sign-Off Report', page.right, 10, { align: 'right' });
    doc.text(`${printable(display(audit.learner.name))} - ${selectedMonthLabel}`, page.right, 15, { align: 'right' });
    doc.setDrawColor(226, 232, 240);
    doc.line(page.left, 23, page.right, 23);
    y = 30;
  };

  const section = (title: string) => {
    ensure(12);
    y += 2;
    doc.setFillColor(245, 243, 255);
    doc.rect(page.left, y - 5, page.width, 9, 'F');
    setText(10, true, purple);
    doc.text(title, page.left + 2, y + 1);
    y += 10;
  };

  const fact = (label: string, value: string, x: number, width: number) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.rect(x, y, width, 15, 'FD');
    setText(6.5, true, muted);
    doc.text(label.toUpperCase(), x + 2.5, y + 5);
    setText(8.5, true, dark);
    const lines = doc.splitTextToSize(printable(value), width - 5) as string[];
    doc.text(lines.slice(0, 2), x + 2.5, y + 10);
  };

  const factGrid = (items: Array<{ label: string; value: string }>, columns = 3) => {
    const gap = 3;
    const width = (page.width - gap * (columns - 1)) / columns;
    for (let index = 0; index < items.length; index += columns) {
      ensure(20);
      items.slice(index, index + columns).forEach((item, column) => fact(item.label, item.value, page.left + column * (width + gap), width));
      y += 18;
    }
  };

  const tableHeader = (columns: Array<{ label: string; x: number; width: number }>) => {
    ensure(16);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(page.left, y - 2, page.width, 10, 'FD');
    setText(7, true, muted);
    columns.forEach((column) => doc.text(column.label.toUpperCase(), column.x, y + 4));
    y += 11;
  };

  const tableRow = (columns: Array<{ value: string; x: number; width: number; bold?: boolean }>, minHeight = 14) => {
    const lineGroups = columns.map((column) => doc.splitTextToSize(printable(column.value), column.width) as string[]);
    const rowHeight = Math.max(minHeight, ...lineGroups.map((lines) => lines.length * 4.2 + 6));
    ensure(rowHeight + 2);
    doc.setDrawColor(226, 232, 240);
    doc.rect(page.left, y - 2, page.width, rowHeight, 'S');
    columns.forEach((column, index) => {
      setText(7.5, Boolean(column.bold), column.bold ? dark : muted);
      doc.text(lineGroups[index], column.x, y + 3);
    });
    y += rowHeight;
  };

  const monthActivityTitles = (entry: AuditMonth) => {
    const items = filterMonthItems(entry, '');
    return items.slice(0, 4).map((item) => item.source === 'Aptem' ? item.activity_name : item.component_name);
  };

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, 210, 34, 'F');
  doc.setFillColor(purple[0], purple[1], purple[2]);
  doc.rect(0, 0, 210, 4, 'F');
  if (logoDataUrl) doc.addImage(logoDataUrl, 'PNG', page.left, 10, 42, 15);
  setText(16, true, purple);
  doc.text('MONTHLY LEARNING SIGN-OFF REPORT', 64, 15);
  setText(8.5, false, muted);
  doc.text(`Report Months: ${selectedMonthLabel}`, 64, 22);
  doc.text(`Generated ${formatDateTime(new Date().toISOString())}`, page.right, 22, { align: 'right' });
  doc.setDrawColor(226, 232, 240);
  doc.line(page.left, 32, page.right, 32);
  y = 44;

  section('Learner And Programme Details');
  factGrid([
    { label: 'Learner Name', value: display(audit.learner.name) },
    { label: 'Programme', value: display(audit.learner.programme_name) },
    { label: 'Report Months', value: months.map((entry) => entry.label).join(', ') },
    { label: 'Learner ID', value: display(audit.learner.id) },
    { label: 'Date of Report', value: formatDateTime(new Date().toISOString()) },
    { label: 'Months Included', value: String(months.length) },
  ]);

  section('Monthly Learning Summary');
  factGrid([
    { label: 'Planned OTJH', value: formatHoursFromHours(month.summary.planned_hours) },
    { label: 'Completed OTJH', value: formatHoursFromHours(month.summary.actual_hours) },
    { label: 'Coach Reviewed OTJH', value: formatHoursFromHours(monthlyDeclarationData(audit, month).approvedHours) },
    { label: 'Programme Activities', value: String(month.summary.aptem_items) },
    { label: 'Online Learning Items', value: String(month.summary.lms_items) },
    { label: 'Calendar Weeks', value: String(month.weeks.length) },
  ]);

  section('Months Covered');
  const monthColumns = [
    { label: 'Month', x: page.left + 3, width: 42 },
    { label: 'Weeks', x: page.left + 49, width: 24 },
    { label: 'Planned', x: page.left + 77, width: 28 },
    { label: 'Completed', x: page.left + 109, width: 30 },
    { label: 'Activities', x: page.left + 143, width: 34 },
  ];
  tableHeader(monthColumns);
  months.forEach((entry) => {
    tableRow([
      { value: entry.label, x: monthColumns[0].x, width: monthColumns[0].width, bold: true },
      { value: String(entry.weeks.length), x: monthColumns[1].x, width: monthColumns[1].width },
      { value: formatHoursFromHours(entry.summary.planned_hours), x: monthColumns[2].x, width: monthColumns[2].width },
      { value: formatHoursFromHours(entry.summary.actual_hours), x: monthColumns[3].x, width: monthColumns[3].width },
      { value: `${entry.summary.aptem_items + entry.summary.lms_items} item(s)`, x: monthColumns[4].x, width: monthColumns[4].width },
    ]);
  });

  section('Learner Declaration');
  const declaration = monthlyDeclarationData(audit, month);
  factGrid([
    { label: 'Planned OTJH', value: formatHoursFromHours(declaration.plannedHours) },
    { label: 'Completed OTJH', value: formatHoursFromHours(declaration.completedHours) },
    { label: 'Coach Reviewed OTJH', value: formatHoursFromHours(declaration.approvedHours) },
    { label: 'KSB Codes', value: declaration.ksbs.length ? declaration.ksbs.join(', ') : 'No KSB codes recorded' },
  ]);
  add('The learner confirms that the listed learning has been completed for the month(s) covered, that the recorded OTJH has been reviewed against planned hours, and that the learning has been applied in workplace practice.', 8);

  section('Learning Activity Summary');
  months.forEach((entry) => {
    const titles = monthActivityTitles(entry);
    ensure(18 + titles.length * 6);
    setText(8.5, true, dark);
    doc.text(entry.label, page.left, y);
    y += 5;
    if (!titles.length) {
      add('No learning activity titles recorded for this month.', 7.5, false, muted);
      return;
    }
    titles.forEach((title, index) => add(`${index + 1}. ${title}`, 7.5, false, muted));
  });

  if (y > 210) {
    doc.addPage();
    y = page.top;
    pageHeader();
  }
  section('Sign-Off');
  const stale = staleMessage(month.signoffs);
  if (stale) add(stale, 9, true);
  ensure(42);
  const signatureBox = (label: string, name: string, confirmed: boolean, signedAt: string, signature: string, x: number) => {
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, 84, 34, 'FD');
    setText(8, true, dark);
    doc.text(label, x + 3, y + 6);
    if (signature) doc.addImage(signature, 'PNG', x + 3, y + 9, 42, 15);
    setText(7, false, muted);
    doc.text(`Name: ${printable(name)}`, x + 3, y + 26);
    doc.text(`${confirmed ? 'Confirmed' : 'Signature captured'} | ${printable(formatDateTime(signedAt))}`, x + 3, y + 31);
  };
  signatureBox('Learner Sign-Off', signoff.learnerSignerName, signoff.learnerConfirmed, signoff.learnerSignedAt, signoff.learnerSignature, page.left);
  signatureBox('Coach Sign-Off', signoff.coachSignerName, signoff.coachConfirmed, signoff.coachSignedAt, signoff.coachSignature, page.left + 98);
  return doc;
}

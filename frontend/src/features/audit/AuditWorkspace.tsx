import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { jsPDF } from 'jspdf';
import SignaturePad from 'signature_pad';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { SkeletonBlock } from '@/components/feature/Skeletons';
import { roleNavMap } from '@/mocks/navigation';
import {
  fetchAuditLearners,
  fetchAuditLearnersPage,
  fetchLearnerAudit,
  saveAuditSignoff,
  type AuditActivitySummary,
  type AuditActivityStats,
  type AuditJsonValue,
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
import { fetchLmsSchema, type LmsMaterial, type LmsSource } from '@/api/lmsSchema';

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
  date: string;
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
    setError('');
    fetchAuditLearnersPage({ includeActivities: true, includeTest: true, activityCategory: selectedCategory, page, pageSize, search })
      .then((response) => {
        const details = response.results.map((learner) => ({
          learner,
          audit: null,
          activities: learner.activities || [],
        }));
        if (!cancelled) {
          setRecords(details);
          setTotalLearners(response.count);
          setTotalPages(response.totalPages || 1);
          setActivityStats(response.activityStats || null);
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
  }, [page, pageSize, search, selectedCategory]);

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
            byKey.set(key, { key, title: auditItemTitle(cell.item), subtitle: auditItemSubtitle(cell.item), date: auditItemDate(cell.item) || '' });
          }
        });
      });
    return Array.from(byKey.values()).sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      if (left.title !== right.title) return left.title.localeCompare(right.title);
      return left.subtitle.localeCompare(right.subtitle);
    });
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
      <AppIcon className={`${sortKey === id ? (sortDirection === 'asc' ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line') : 'ri-expand-up-down-line'} text-xs`} />
    </button>
  );

  return (
    <div className="min-h-[calc(100vh-112px)] bg-[#f8f7f4] px-3 py-5 md:px-6">
      <section className="mx-auto max-w-7xl rounded-xl border border-[#ebe4d9] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-[#8a7561]">All Learners › Activity Categories</span>
          <h1 className="text-2xl font-heading font-bold text-[#17110b]">Activity Categories</h1>
          <p className="text-[13px] text-[#8a7561]">Matrix view — each column is a lesson, each row is a learner. Cells show actual / planned hours.</p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {(Object.keys(AUDIT_CATEGORY_META) as AuditCategoryKey[]).map((key) => {
            const meta = AUDIT_CATEGORY_META[key];
            const active = selectedCategory === key;
            return (
              <button key={key} type="button" onClick={() => {
                setSelectedCategory(key);
                setPage(1);
              }} className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-[12px] font-bold transition ${active ? 'border-[#d97706] bg-[#d97706] text-white shadow-sm' : 'border-[#eee7dc] bg-white text-[#6f5b49] hover:bg-[#fff7ed]'}`}>
                <AppIcon className={meta.icon} />
                {meta.label}
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${active ? 'bg-white/20 text-white' : 'bg-[#f5f1ea] text-[#8a7561]'}`}>
                  {active ? categoryCounts[key] : '-'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-[#eee7dc] bg-white p-3">
          <div className="grid gap-3 lg:grid-cols-[120px_220px_170px_1fr]">
            <label className="flex items-center gap-2 text-xs font-bold uppercase text-[#8a7561]"><AppIcon className="ri-filter-3-line" />Filters</label>
            <select value={programme} onChange={(event) => setProgramme(event.target.value)} className="h-10 rounded-lg border border-[#eee7dc] bg-white px-3 text-sm outline-none focus:border-[#d97706]">
              <option value="all">All programmes</option>
              {programmeOptions.map(([option, count]) => <option key={option} value={option}>{display(option)} ({count})</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="h-10 min-w-0 rounded-lg border border-[#eee7dc] bg-white px-2 text-sm outline-none focus:border-[#d97706]" />
              <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="h-10 min-w-0 rounded-lg border border-[#eee7dc] bg-white px-2 text-sm outline-none focus:border-[#d97706]" />
            </div>
            <div className="relative">
              <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-[#9b8875]" />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search learner..."
                className="h-10 w-full rounded-lg border border-[#eee7dc] bg-white pl-10 pr-3 text-sm outline-none focus:border-[#d97706]"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#eee7dc] bg-[#fbfaf8] px-4 py-3 text-sm text-[#6f5b49]">
          <div className="flex flex-wrap items-center gap-4">
            {loading ? (
              <AuditStatsSkeleton />
            ) : (
              <>
                <span><strong>{filteredRows.length}</strong> learners on page</span>
                <span><strong>{records.filter((record) => isTestLearner(record.learner)).length}</strong> test learners</span>
                <span><strong>{totalLearners}</strong> matching learners</span>
                <span><strong>{selectedDbStats?.activities ?? totals.cells}</strong> page activities</span>
                <span><strong>{columns.length}</strong> page columns</span>
                <span>Planned: <strong>{formatHoursFromHours(totals.planned)}</strong></span>
                <span>Actual on page: <strong>{formatHoursFromHours(totals.actual)}</strong></span>
                <span>Category actual: <strong>{formatHoursFromHours(selectedDbStats?.actualHours ?? totals.actual)}</strong></span>
                <span>Completed: <strong>{totals.done}/{totals.cells}</strong></span>
                <span>Rate: <strong>{totals.rate}%</strong></span>
              </>
            )}
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
              <AppIcon className="ri-arrow-left-s-line" />
            </button>
            <span className="min-w-[86px] text-center text-xs font-semibold text-foreground-600">Page {page} of {totalPages}</span>
            <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-background-300 bg-white text-foreground-700 disabled:cursor-not-allowed disabled:opacity-40">
              <AppIcon className="ri-arrow-right-s-line" />
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-[#eee7dc] bg-white">
          {loading ? (
            <ActivityMatrixSkeleton />
          ) : error ? (
            <div className="p-6"><StateBanner tone="error" text={error} /></div>
          ) : filteredRows.length === 0 ? (
            <div className="p-6"><EmptyPanel icon="ri-inbox-line" text="No learners match this activity category and filter set." /></div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-20 bg-[#fbfaf8] text-xs uppercase tracking-wide text-[#8a7561]">
                  <tr>
                    <th className="sticky left-0 z-30 w-12 border-b border-r border-[#eee7dc] bg-[#fbfaf8] px-3 py-3 text-left">#</th>
                    <th className="sticky left-12 z-30 min-w-[210px] border-b border-r border-[#eee7dc] bg-[#fbfaf8] px-3 py-3 text-left"><SortButton id="learner" label="Learner" /></th>
                    <th className="min-w-[260px] border-b border-r border-background-300 px-3 py-3 text-left"><SortButton id="programme" label="Programme" /></th>
                    <th className="min-w-[110px] border-b border-r border-background-300 px-3 py-3 text-right"><SortButton id="planned" label="Planned" /></th>
                    <th className="min-w-[110px] border-b border-r border-background-300 px-3 py-3 text-right"><SortButton id="actual" label="Actual" /></th>
                    <th className="min-w-[120px] border-b border-r border-background-300 px-3 py-3 text-center"><SortButton id="done" label="Completed" /></th>
                    {columns.map((column) => (
                      <th key={column.key} className="min-w-[240px] max-w-[320px] border-b border-r border-background-300 px-3 py-3 text-left align-top" title={`${column.title} - ${column.subtitle}`}>
                        <span className="block whitespace-normal break-words text-[11px] font-bold leading-snug text-foreground-700">{column.title}</span>
                        <span className="mt-1 block whitespace-normal break-words text-[10px] font-medium leading-snug normal-case tracking-normal text-foreground-400">{column.subtitle}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, index) => {
                    const cellsByColumn = new Map(row.cells.map((cell) => [auditItemKey(cell.item), cell]));
                    const learnerName = row.record.audit?.learner.name || row.record.learner.fullName || `Learner ${row.record.learner.learnerId}`;
                    const programmeName = row.record.audit?.learner.programme_name || row.record.learner.programName || '';
                    const learnerIsTest = isTestLearner(row.record.learner);
                    return (
                      <tr key={row.record.learner.learnerId} onClick={() => navigate(`/workspace/auditor/learner/${row.record.learner.learnerId}`)} className={`cursor-pointer border-b transition hover:bg-primary-50/40 ${learnerIsTest ? 'border-l-4 border-l-red-500 border-red-100 bg-red-50/80 hover:bg-red-100/80' : 'border-background-200'}`}>
                        <td className={`sticky left-0 z-10 border-r border-background-200 px-3 py-3 text-foreground-600 ${learnerIsTest ? 'bg-red-50' : 'bg-white'}`}>{index + 1}</td>
                        <td className={`sticky left-12 z-10 border-r border-background-200 px-3 py-3 ${learnerIsTest ? 'bg-red-50' : 'bg-white'}`}>
                          <p className="flex items-center gap-2 font-bold text-foreground-950">
                            {learnerName}
                            {learnerIsTest && <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white"><AppIcon className="ri-close-line text-xs" />Test</span>}
                          </p>
                          <p className="text-[11px] text-foreground-400">ID {row.record.learner.learnerId}</p>
                        </td>
                        <td className="border-r border-background-200 px-3 py-3 text-left">
                          <span className="block max-w-[260px] whitespace-normal break-words text-xs font-bold leading-snug text-[#8a5a14]" title={programmeName}>
                            {display(programmeName)}
                          </span>
                        </td>
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
  const [selectedMonthKeys, setSelectedMonthKeys] = useState<Set<string>>(new Set());
  const [learnerSignerName, setLearnerSignerName] = useState('');
  const [coachSignerName, setCoachSignerName] = useState('');
  const [learnerSignature, setLearnerSignature] = useState('');
  const [coachSignature, setCoachSignature] = useState('');
  const [learnerConfirmed, setLearnerConfirmed] = useState(false);
  const [coachConfirmed, setCoachConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signoffError, setSignoffError] = useState('');
  const [pdfError, setPdfError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [monthSort, setMonthSort] = useState<'desc' | 'asc'>('desc');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchLearnerAudit(learnerId)
      .then((payload) => {
        if (cancelled) return;
        const pastAudit = filterPastAudit(payload);
        setAudit(pastAudit);
        const monthKeys = pastAudit.months.filter((month) => month.month_key !== 'undated').map((month) => month.month_key);
        setSelectedMonthKeys(new Set(monthKeys));
        setLearnerSignerName(pastAudit.learner.name || '');
        setCoachSignerName('');
        setLearnerSignature('');
        setCoachSignature('');
        setLearnerConfirmed(false);
        setCoachConfirmed(false);
        setPreviewUrl('');
      })
      .catch((requestError) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load learner audit.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [learnerId]);

  const learnerName = audit?.learner.name || `Learner ${learnerId}`;
  const sortedMonths = useMemo(() => sortAuditMonths(audit?.months || [], monthSort), [audit, monthSort]);
  const selectedMonths = useMemo(() => sortedMonths.filter((month) => selectedMonthKeys.has(month.month_key)), [sortedMonths, selectedMonthKeys]);
  const allDatedSelected = Boolean(audit?.months.filter((month) => month.month_key !== 'undated').every((month) => selectedMonthKeys.has(month.month_key)));
  const overall = useMemo(() => {
    const months = audit?.months || [];
    const actual = sumAvailableHours(months.map((month) => month.summary.actual_hours));
    const planned = sumAvailableHours(months.map((month) => month.summary.planned_hours));
    const items = months.reduce((total, month) => total + month.summary.aptem_items + month.summary.lms_items, 0);
    const completed = months.reduce((total, month) => total + month.summary.completed, 0);
    return { actual, planned, items, completed, rate: percentage(actual, planned) };
  }, [audit]);

  const toggleMonth = (monthKey: string) => {
    setSelectedMonthKeys((current) => {
      const next = new Set(current);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  };

  const toggleAllMonths = () => {
    if (!audit) return;
    const dated = audit.months.filter((month) => month.month_key !== 'undated').map((month) => month.month_key);
    setSelectedMonthKeys(allDatedSelected ? new Set() : new Set(dated));
  };

  const handleSaveAndPreview = async () => {
    if (!audit) return;
    setSignoffError('');
    setPdfError('');
    if (!selectedMonths.length) {
      setSignoffError('Select at least one month for the report.');
      return;
    }
    if (!learnerSignature || !coachSignature) {
      setSignoffError('Learner and coach signatures are required.');
      return;
    }
    const now = new Date().toISOString();
    setSaving(true);
    try {
      const responses = await Promise.all(selectedMonths.map((month) => saveAuditSignoff(audit.learnerId, {
        monthKey: month.month_key,
        roles: {
          learner: { signerName: learnerSignerName, signature: learnerSignature, confirmed: learnerConfirmed, signedAt: now },
          coach: { signerName: coachSignerName, signature: coachSignature, confirmed: coachConfirmed, signedAt: now },
        },
      })));
      const nextAudit = applyManySignoffs(audit, responses);
      setAudit(nextAudit);
      const logoDataUrl = await imageUrlToDataUrl(KBC_LOGO_URL).catch(() => '');
      const doc = buildAuditPdf(nextAudit, selectedMonths, {
        learnerSignerName,
        learnerSignature,
        learnerConfirmed,
        learnerSignedAt: now,
        coachSignerName,
        coachSignature,
        coachConfirmed,
        coachSignedAt: now,
      }, logoDataUrl);
      setPreviewUrl(doc.output('bloburl').toString());
    } catch (requestError) {
      setSignoffError(requestError instanceof Error ? requestError.message : 'Unable to save signatures or generate the PDF.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!audit || !selectedMonths.length) return;
    if (!learnerSignature || !coachSignature) {
      setPdfError('Learner and coach signatures are required before downloading the PDF.');
      return;
    }
    const logoDataUrl = await imageUrlToDataUrl(KBC_LOGO_URL).catch(() => '');
    const now = new Date().toISOString();
    const doc = buildAuditPdf(audit, selectedMonths, {
      learnerSignerName,
      learnerSignature,
      learnerConfirmed,
      learnerSignedAt: now,
      coachSignerName,
      coachSignature,
      coachConfirmed,
      coachSignedAt: now,
    }, logoDataUrl);
    doc.save(`learner-audit-${fileSegment(learnerName)}-${selectedMonths.length > 1 ? 'selected-months' : selectedMonths[0].month_key}.pdf`);
  };

  return (
    <div className="min-h-[calc(100vh-112px)] bg-[#f8f7f4] px-3 py-5 md:px-6">
      <section className="mx-auto max-w-5xl rounded-xl border border-[#ebe4d9] bg-white p-4 shadow-sm md:p-6">
        <button type="button" onClick={() => navigate('/workspace/auditor')} className="mb-6 inline-flex items-center gap-2 text-[13px] font-bold text-[#8b5a24] hover:text-[#d97706]">
          <AppIcon className="ri-arrow-left-line text-base" />
          Activity Categories
        </button>

        {loading ? (
          <LearnerAuditPageSkeleton />
        ) : error ? (
          <div className="mt-6"><StateBanner tone="error" text={error} /></div>
        ) : !audit || audit.months.length === 0 ? (
          <div className="mt-6"><EmptyPanel icon="ri-inbox-line" text="No monthly audit activity was found for this learner." /></div>
        ) : (
          <div className="mx-auto max-w-4xl">
            <div className="flex items-center justify-between gap-4 border-b border-[#f0ebe4] pb-5">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#ffedd5] text-lg font-bold text-[#c2410c]">
                  {learnerInitials(learnerName)}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-xl font-heading font-bold text-[#17110b]">{learnerName}</h1>
                    <span className="rounded-full bg-[#ccfbf1] px-2.5 py-1 text-[11px] font-bold text-[#0f766e]">Active</span>
                    <span className="rounded-full bg-[#ffedd5] px-2.5 py-1 text-[11px] font-bold text-[#9a3412]">Programme: {display(audit.learner.programme_name)}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-[#8a7561]">{display(audit.learner.programme_name)} · ID {learnerId}</p>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-[#eee7dc] bg-white p-5">
              <div className="mb-3 flex items-center justify-between gap-4">
                <h2 className="text-[15px] font-heading font-bold text-[#2b2118]">Overall Hours — All Months</h2>
                <span className="rounded-full bg-[#ffedd5] px-4 py-2 text-[12px] font-bold text-[#9a3412]">
                  {formatSignedHoursFromHours(overall.actual - overall.planned)}
                </span>
              </div>
              <div className="flex flex-wrap items-end gap-6">
                <div>
                  <p className="text-[11px] font-semibold text-[#8a7561]">Planned</p>
                  <p className="text-2xl font-bold text-[#09090b]">{formatHoursFromHours(overall.planned)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[#8a7561]">Actual</p>
                  <p className="text-2xl font-bold text-[#09090b]">{formatHoursFromHours(overall.actual)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[#8a7561]">Completed</p>
                  <p className="text-xl font-bold text-[#09090b]">{overall.completed}/{overall.items}</p>
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#eee7dc]">
                <div className="h-full rounded-full bg-[#d97706]" style={{ width: `${Math.min(100, overall.rate)}%` }} />
              </div>
              <p className="mt-2 text-[12px] font-semibold text-[#8a7561]">{overall.rate}% of planned hours completed</p>
            </div>

            <div className="mt-7">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <button type="button" onClick={toggleAllMonths} className="mb-3 inline-flex h-9 items-center gap-2 rounded-lg border border-[#eadfce] bg-white px-3 text-xs font-bold text-[#6f5b49] hover:bg-[#fff7ed]">
                    <AppIcon className={allDatedSelected ? 'ri-checkbox-fill' : 'ri-checkbox-blank-line'} />
                    {allDatedSelected ? 'Deselect all months' : 'Select all months'}
                  </button>
                  <h2 className="text-lg font-heading font-bold text-[#17110b]">Monthly Breakdown</h2>
                  <p className="mt-1 text-[13px] text-[#8a7561]">Click a month to expand weeks</p>
                </div>
                <label className="inline-flex items-center gap-2 text-[12px] font-bold text-[#6f5b49]">
                  Sort
                  <select
                    value={monthSort}
                    onChange={(event) => setMonthSort(event.target.value as 'desc' | 'asc')}
                    className="h-9 rounded-lg border border-[#eadfce] bg-white px-3 text-[12px] font-bold text-[#6f5b49] outline-none hover:bg-[#fff7ed] focus:border-[#d97706]"
                  >
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </label>
              </div>
              <div className="mt-4 space-y-3">
                {sortedMonths.map((month, index) => <AuditLearnerMonthSection key={month.month_key} month={month} defaultOpen={index === 0} selected={selectedMonthKeys.has(month.month_key)} onToggleSelected={toggleMonth} />)}
              </div>
            </div>
          </div>
        )}
      </section>
      {!loading && audit && audit.months.length > 0 && (
        <section className="mx-auto mt-4 max-w-5xl rounded-xl border border-[#ebe4d9] bg-white p-4 shadow-sm md:p-6">
          <div className="mx-auto max-w-4xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-heading font-bold text-[#17110b]">Monthly Sign-Off</h2>
              <p className="mt-1 text-[13px] text-[#8a7561]">The same learner and coach signatures will be applied to the checked month(s) and included in one PDF.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleSaveAndPreview} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0f766e] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#115e59] disabled:opacity-50">
                <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-file-pdf-line'} />
                Save
              </button>
              <button type="button" onClick={handleDownloadPdf} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0f766e] px-4 text-xs font-bold text-white hover:bg-[#115e59]">
                <AppIcon className="ri-download-line" />
                Download PDF
              </button>
            </div>
          </div>
          <p className="mt-3 text-[12px] font-semibold text-[#8a7561]">{selectedMonths.length} month(s) selected for the report.</p>
          {(signoffError || pdfError) && <div className="mt-4"><StateBanner tone="error" text={signoffError || pdfError} /></div>}
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <SignoffCard
              title="Learner signature"
              signerName={learnerSignerName}
              onSignerNameChange={setLearnerSignerName}
              confirmed={learnerConfirmed}
              onConfirmedChange={setLearnerConfirmed}
              signature={learnerSignature}
              onSignatureChange={setLearnerSignature}
              declaration="I confirm the selected monthly learning record is accurate and reflects my completed activity."
            />
            <SignoffCard
              title="Coach signature"
              signerName={coachSignerName}
              onSignerNameChange={setCoachSignerName}
              confirmed={coachConfirmed}
              onConfirmedChange={setCoachConfirmed}
              signature={coachSignature}
              onSignatureChange={setCoachSignature}
              declaration="I confirm I have reviewed the selected monthly learning record, attendance, LMS activity, and assignments."
            />
          </div>
          {previewUrl && (
            <div className="mt-4 overflow-hidden rounded-lg border border-background-300 bg-white">
              <div className="border-b border-background-200 px-4 py-3 text-sm font-bold text-foreground-900">PDF preview</div>
              <iframe title="Learner audit PDF preview" src={previewUrl} className="h-[620px] w-full" />
            </div>
          )}
          </div>
        </section>
      )}
    </div>
  );
}

function AuditLearnerMonthSection({ month, defaultOpen, selected, onToggleSelected }: { month: AuditMonth; defaultOpen: boolean; selected: boolean; onToggleSelected: (monthKey: string) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const displayWeeks = useMemo(() => displayWeeksForMonth(month), [month]);
  const totalItems = useMemo(() => uniqueAuditItems([
    ...displayWeeks.flatMap((week) => [...week.aptem_items, ...week.lms_items]),
    ...month.undated_items,
  ]).length, [displayWeeks, month.undated_items]);
  const rate = percentage(month.summary.actual_hours, month.summary.planned_hours);

  return (
    <div className="overflow-hidden rounded-xl border border-[#eee7dc] bg-[#fbfaf8]">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-[#fff7ed]">
        {month.month_key !== 'undated' && (
          <span
            role="checkbox"
            aria-label={`${selected ? 'Remove' : 'Include'} ${month.label} in report`}
            aria-checked={selected}
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelected(month.month_key);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onToggleSelected(month.month_key);
              }
            }}
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[13px] font-bold ${selected ? 'border-[#fed7aa] bg-[#ffedd5] text-[#9a3412]' : 'border-[#eadfce] bg-white text-[#8a7561]'}`}
          >
            <AppIcon className={selected ? 'ri-checkbox-fill' : 'ri-checkbox-blank-line'} />
          </span>
        )}
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ffedd5] text-sm font-bold text-[#d97706]">{monthAbbrev(month.label)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-heading text-[15px] font-bold text-[#17110b]">{month.label}</p>
            <span className="text-[12px] font-semibold text-[#9b8875]">
              {monthDateRange(month)}
              <span className="ml-1 text-[11px] font-semibold text-[#b08a68]" title="This is the first and last dated activity shown for this month, not the calendar month start and end.">
                activity range
              </span>
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] font-semibold text-[#6f5b49]">
            <span>{formatHoursFromHours(month.summary.actual_hours)} / {formatHoursFromHours(month.summary.planned_hours)} planned</span>
            <span className="text-[#d97706]">{rate}%</span>
            <span>{displayWeeks.length} weeks</span>
            <span>{totalItems} activities</span>
          </div>
          <div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-[#eee7dc]">
            <div className="h-full rounded-full bg-[#d97706]" style={{ width: `${Math.min(100, rate)}%` }} />
          </div>
        </div>
        <AppIcon className={`ri-arrow-right-s-line text-lg text-[#9b8875] transition-transform ${open ? 'rotate-90 text-[#d97706]' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-[#eee7dc] bg-white p-4">
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
  const allItems = uniqueAuditItems([...week.aptem_items, ...week.lms_items]);
  const attendanceItems = allItems.filter(isAttendanceItem);
  const lmsItems = allItems.filter(isLmsActivityItem);
  const assignmentItems = allItems.filter(isAssignmentItem);
  const actual = roundHours(allItems.reduce((sum, item) => sum + auditCell(item).actual, 0));
  const planned = roundHours(allItems.reduce((sum, item) => sum + auditCell(item).planned, 0));
  const done = allItems.filter((item) => auditCell(item).done).length;
  const rate = percentage(actual, planned);

  return (
    <div className="overflow-hidden rounded-lg border border-[#eee7dc] bg-white">
      <button type="button" onClick={() => setOpen((value) => !value)} className="w-full px-4 py-3 text-left transition hover:bg-[#fbfaf8]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ccfbf1] text-xs font-bold text-[#0f766e]">W{weekNumber}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-[#17110b]">Week {weekNumber}</p>
                <span className="text-[12px] font-semibold text-[#8a7561]">{formatDateRange(week.start_date, week.end_date)}</span>
              </div>
              <p className="mt-1 text-[12px] font-semibold text-[#6f5b49]">{formatHoursFromHours(actual)} / {formatHoursFromHours(planned)} · {rate}% · {done}/{allItems.length} done</p>
            </div>
          </div>
          <AppIcon className={`ri-arrow-right-s-line text-lg text-[#9b8875] transition-transform ${open ? 'rotate-90 text-[#d97706]' : ''}`} />
        </div>
      </button>
      {open && (
        <div className="grid gap-3 border-t border-[#eee7dc] bg-[#fbfaf8] p-3 xl:grid-cols-3">
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
      buckets[bucketIndex].aptem_items = uniqueAuditItems([...buckets[bucketIndex].aptem_items, ...week.aptem_items]).filter((item): item is AptemAuditItem => item.source === 'Aptem');
      buckets[bucketIndex].lms_items = uniqueAuditItems([...buckets[bucketIndex].lms_items, ...week.lms_items]).filter((item): item is LmsAuditItem => item.source === 'LMS');
      return;
    }
    overflowWeeks.push({
      ...week,
      aptem_items: uniqueAuditItems(week.aptem_items).filter((item): item is AptemAuditItem => item.source === 'Aptem'),
      lms_items: uniqueAuditItems(week.lms_items).filter((item): item is LmsAuditItem => item.source === 'LMS'),
    });
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
  const [viewerItem, setViewerItem] = useState<AuditActivityItem | null>(null);
  const visibleItems = useMemo(() => uniqueAuditItems(items), [items]);
  return (
    <div className="rounded-lg border border-[#eee7dc] bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-bold text-[#17110b]"><AppIcon className={`${icon} text-[#d97706]`} />{title}</h3>
        <span className="rounded-full bg-[#f5f1ea] px-2 py-0.5 text-xs font-bold text-[#6f5b49]">{visibleItems.length}</span>
      </div>
      {visibleItems.length === 0 ? (
        <p className="rounded-lg bg-[#fbfaf8] px-3 py-4 text-center text-xs text-[#9b8875]">No activity</p>
      ) : (
        <div className="space-y-2">
          {visibleItems.map((item, index) => {
            const canOpen = canOpenAuditSource(item);
            const ksbGroups = ksbGroupsForItem(item);
            const itemContent = (
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${auditCell(item).done ? 'bg-[#ccfbf1] text-[#0f766e]' : 'bg-[#ffedd5] text-[#d97706]'}`}>
                  <AppIcon className={AUDIT_CATEGORY_META[auditCategory(item)].icon} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[#17110b]">{auditItemTitle(item)}</p>
                  <p className="mt-1 text-xs text-[#8a7561]">{auditItemSubtitle(item)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#6f5b49]">
                    <span className="rounded-full bg-[#f5f1ea] px-2 py-0.5">{formatHoursFromHours(auditCell(item).actual)} / {formatHoursFromHours(auditCell(item).planned)}</span>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${statusPill(item.source === 'Aptem' ? item.status : item.completion_status)}`}>{item.source === 'Aptem' ? item.status : item.completion_status}</span>
                    {item.warnings.length > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{item.warnings.length} warning(s)</span>}
                    {canOpen && <span className="rounded-full bg-[#ffedd5] px-2 py-0.5 font-semibold text-[#9a3412]"><AppIcon className="ri-window-line mr-1" />Open</span>}
                  </div>
                  <ActivityKsbStrip groups={ksbGroups} compact />
                </div>
              </div>
            );
            return canOpen ? (
              <button key={`${item.id}-${index}`} type="button" onClick={() => setViewerItem(item)} className="w-full rounded-lg border border-[#eee7dc] bg-white p-3 text-left transition hover:border-[#fed7aa] hover:bg-[#fff7ed] focus:outline-none focus:ring-2 focus:ring-[#fdba74]/60">
                {itemContent}
              </button>
            ) : (
              <div key={`${item.id}-${index}`} className="w-full rounded-lg border border-[#eee7dc] bg-white p-3 text-left">
                {itemContent}
              </div>
            );
          })}
        </div>
      )}
      <AuditSourceViewer item={viewerItem} onClose={() => setViewerItem(null)} />
    </div>
  );
}

type KsbGroupKey = 'knowledge' | 'skills' | 'behaviour';
type KsbGroups = Record<KsbGroupKey, string[]>;

function ActivityKsbStrip({ groups, compact = false }: { groups: KsbGroups; compact?: boolean }) {
  const total = groups.knowledge.length + groups.skills.length + groups.behaviour.length;
  if (!total) return null;
  return (
    <div className={compact ? 'mt-3 rounded-lg border border-[#f0ebe4] bg-[#fbfaf8] p-2' : 'mt-3 rounded-lg border border-[#eee7dc] bg-white p-3'}>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#8a4b0f]">KSBs - actual evidence</p>
      <div className="grid gap-2 md:grid-cols-3">
        <KsbGroupCard title="Knowledge" codes={groups.knowledge} tone="amber" />
        <KsbGroupCard title="Skills" codes={groups.skills} tone="teal" />
        <KsbGroupCard title="Behaviour" codes={groups.behaviour} tone="stone" />
      </div>
    </div>
  );
}

function KsbGroupCard({ title, codes, tone }: { title: string; codes: string[]; tone: 'amber' | 'teal' | 'stone' }) {
  const toneClass = tone === 'teal'
    ? 'bg-[#ccfbf1] text-[#0f766e] ring-[#99f6e4]'
    : tone === 'amber'
      ? 'bg-[#ffedd5] text-[#9a3412] ring-[#fed7aa]'
      : 'bg-[#f5f1ea] text-[#6f5b49] ring-[#eadfce]';
  return (
    <div className="min-w-0 rounded-lg bg-white/80 p-2 ring-1 ring-[#f0ebe4]">
      <p className="text-[11px] font-bold text-[#17110b]">{title}</p>
      {codes.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {codes.map((code) => <span key={code} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${toneClass}`}>{code}</span>)}
        </div>
      ) : (
        <p className="mt-2 text-[10px] font-semibold text-[#b08a68]">None recorded</p>
      )}
    </div>
  );
}

type ViewerSource = {
  title: string;
  subtitle: string;
  contentType: string;
  source?: LmsSource | null;
  embedUrl?: string | null;
  openUrl?: string | null;
  fileUrl?: string | null;
  notice?: string | null;
};

function AuditSourceViewer({ item, onClose }: { item: AuditActivityItem | null; onClose: () => void }) {
  const [viewer, setViewer] = useState<ViewerSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!item) {
      setViewer(null);
      setError('');
      setLoading(false);
      return;
    }
    document.body.style.overflow = 'hidden';
    setLoading(true);
    setError('');
    resolveAuditViewerSource(item)
      .then(setViewer)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not open this component.'))
      .finally(() => setLoading(false));
    return () => { document.body.style.overflow = ''; };
  }, [item]);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 md:p-6">
      <button type="button" aria-label="Close viewer" onClick={onClose} className="absolute inset-0 bg-[#17110b]/70 backdrop-blur-sm" />
      <div className="relative z-[81] flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[#eee7dc] px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[#17110b]">{viewer?.title || auditItemTitle(item)}</p>
            <p className="truncate text-xs font-semibold text-[#8a7561]">{viewer?.subtitle || auditItemSubtitle(item)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(externalUrl(viewer?.openUrl) || externalUrl(viewer?.fileUrl)) && (
              <a href={externalUrl(viewer?.openUrl) || externalUrl(viewer?.fileUrl) || undefined} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#eadfce] px-3 text-xs font-bold text-[#6f5b49] hover:bg-[#fff7ed]">
                <AppIcon className="ri-external-link-line" /> New tab
              </a>
            )}
            <button type="button" onClick={onClose} className="h-9 w-9 rounded-lg text-[#8a7561] hover:bg-[#fff7ed] hover:text-[#17110b]">
              <AppIcon className="ri-close-line text-lg" />
            </button>
          </div>
        </div>
        {viewer?.notice && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">{viewer.notice}</div>}
        <div className="min-h-[360px] flex-1 bg-[#17110b]">
          {loading ? (
            <div className="grid h-[70vh] place-items-center text-sm font-bold text-white"><AppIcon className="ri-loader-4-line mr-2 animate-spin" />Loading component...</div>
          ) : error ? (
            <div className="grid h-[70vh] place-items-center p-8 text-center text-white">
              <div>
                <AppIcon className="ri-error-warning-line text-3xl text-amber-300" />
                <p className="mt-3 text-sm font-bold">{error}</p>
              </div>
            </div>
          ) : viewer ? (
            <ViewerFrame viewer={viewer} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ViewerFrame({ viewer }: { viewer: ViewerSource }) {
  const url = externalUrl(viewer.fileUrl) || externalUrl(viewer.embedUrl) || externalUrl(viewer.openUrl) || '';
  const iframeUrl = externalUrl(viewer.embedUrl) || externalUrl(viewer.openUrl) || externalUrl(viewer.fileUrl) || '';
  const type = viewer.contentType.toLowerCase();
  if (url && shouldLaunchOutside(url)) {
    return <ExternalLaunchPanel viewer={viewer} url={url} />;
  }
  if (url && (type.includes('video') || type.includes('recording')) && isDirectVideoUrl(url)) {
    return <video src={url} controls autoPlay className="h-full max-h-[78vh] w-full bg-black" />;
  }
  if (url && type.includes('audio') && isDirectAudioUrl(url)) {
    return (
      <div className="grid h-[70vh] place-items-center bg-gradient-to-br from-[#312e81] to-[#17110b] p-8">
        <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-white/10 p-6">
          <p className="mb-4 text-sm font-bold text-white">{viewer.title}</p>
          <audio src={url} controls autoPlay className="w-full" />
        </div>
      </div>
    );
  }
  if (iframeUrl) {
    return <iframe title={viewer.title} src={iframeUrl} className="h-[78vh] w-full bg-white" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />;
  }
  return (
    <div className="grid h-[70vh] place-items-center p-8 text-center text-white">
      <div>
        <AppIcon className="ri-link-unlink-m text-3xl text-white/40" />
        <p className="mt-3 text-sm font-bold">No source link is available for this component.</p>
      </div>
    </div>
  );
}

function ExternalLaunchPanel({ viewer, url }: { viewer: ViewerSource; url: string }) {
  const host = urlHost(url);
  return (
    <div className="grid h-[70vh] place-items-center bg-[#f8f7f4] p-6">
      <div className="w-full max-w-xl rounded-xl border border-[#eadfce] bg-white p-6 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#ffedd5] text-[#d97706]">
          <AppIcon className="ri-external-link-line text-2xl" />
        </span>
        <h3 className="mt-4 text-base font-bold text-[#17110b]">Open this activity in a new tab</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#6f5b49]">
          {host || 'This site'} blocks embedded viewing, so the browser will refuse iframe playback. Use the direct launch button to open the original content.
        </p>
        <div className="mt-5 rounded-lg bg-[#fbfaf8] px-4 py-3 text-left">
          <p className="truncate text-sm font-bold text-[#17110b]">{viewer.title}</p>
          <p className="mt-1 truncate text-xs font-semibold text-[#8a7561]">{viewer.subtitle || viewer.contentType}</p>
          {host && <p className="mt-2 text-xs font-bold text-[#d97706]">{host}</p>}
        </div>
        <a href={url} target="_blank" rel="noreferrer" className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-[#d97706] px-4 text-sm font-bold text-white hover:bg-[#b45309]">
          <AppIcon className="ri-arrow-right-up-line" /> Open original
        </a>
      </div>
    </div>
  );
}

async function resolveAuditViewerSource(item: AuditActivityItem): Promise<ViewerSource> {
  if (item.source === 'Aptem') return aptemViewerSource(item);
  let materials: LmsMaterial[] = [];
  try {
    const schema = await fetchLmsSchema({ search: auditItemTitle(item) });
    materials = schema.students.flatMap((student) =>
      (student.courses || []).flatMap((course) => (course.sections || []).flatMap((section) => section.materials || [])),
    );
  } catch {
    materials = [];
  }
  const material = findLmsMaterial(item, materials);
  if (!material) {
    const fallbackUrl = wordpressPostUrl(item);
    return {
      title: auditItemTitle(item),
      subtitle: auditItemSubtitle(item),
      contentType: item.component_type || String(item.raw.material_type || 'component'),
      openUrl: fallbackUrl,
      embedUrl: fallbackUrl,
      notice: fallbackUrl
        ? 'No direct file link was found in the paged LMS schema yet. Opening the WordPress LMS item by its component id.'
        : 'No matching LMS material link was found in the source schema. The audit record still shows the component metadata.',
    };
  }
  const source = material.source || null;
  const attachment = source?.attachments?.[0];
  const embedUrl = externalUrl(source?.embed_url) || externalUrl(attachment?.embed_url) || null;
  const openUrl = externalUrl(source?.open_url) || externalUrl(attachment?.open_url) || externalUrl(source?.lms_url) || null;
  const fileUrl = externalUrl(source?.file_url) || externalUrl(attachment?.file_url) || null;
  return {
    title: material.material_title || auditItemTitle(item),
    subtitle: [item.course_module, material.material_format || material.content_type].filter(Boolean).join(' - '),
    contentType: material.content_type || material.material_format || item.component_type || '',
    source,
    embedUrl: embedUrl || (fileUrl ? embeddableAuditUrl(fileUrl) : null),
    openUrl: openUrl || fileUrl,
    fileUrl,
    notice: source?.requires_lms_login || source?.can_embed === false
      ? 'This LMS item may require WordPress login or may block iframe embedding. Use New tab if the viewer stays blank.'
      : null,
  };
}

function wordpressPostUrl(item: LmsAuditItem) {
  const rawId = Number(item.raw.component_id ?? item.raw.material_id ?? item.source_id);
  if (!Number.isFinite(rawId) || rawId <= 0) return null;
  return `https://kentbusinesscollege.org/?p=${rawId}`;
}

function findLmsMaterial(item: LmsAuditItem, materials: LmsMaterial[]) {
  const rawId = Number(item.raw.component_id ?? item.raw.material_id ?? item.source_id);
  if (Number.isFinite(rawId)) {
    const byId = materials.find((material) => Number(material.material_id) === rawId || Number(material.curriculum_material_record_id) === rawId);
    if (byId) return byId;
  }
  const title = normalizeLookup(item.component_name || String(item.raw.title || ''));
  if (!title) return null;
  return materials
    .map((material) => ({ material, score: lmsMaterialScore(title, material) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.material || null;
}

function aptemViewerSource(item: AptemAuditItem): ViewerSource {
  const raw = item.raw.raw && typeof item.raw.raw === 'object' && !Array.isArray(item.raw.raw) ? item.raw.raw as Record<string, AuditJsonValue> : {};
  const reportUrls = Array.isArray(item.raw.assignment_report_urls) ? item.raw.assignment_report_urls : [];
  const evidence = assignmentEvidence(item);
  const firstEvidence = evidence.find((entry) => externalUrl(entry.fileUrl) || externalUrl(entry.reportUrl) || externalUrl(entry.noteUrl));
  const firstReport = reportUrls.find((value): value is string => Boolean(externalUrl(value)));
  const safeUrl = externalUrl(firstEvidence?.fileUrl) || externalUrl(firstEvidence?.reportUrl) || externalUrl(firstEvidence?.noteUrl) || externalUrl(firstReport);
  const componentName = String(raw.ComponentName || item.activity_name || 'Assignment');
  return {
    title: componentName,
    subtitle: [item.type, item.status].filter(Boolean).join(' - '),
    contentType: safeUrl ? inferContentType(safeUrl) : item.type,
    fileUrl: safeUrl,
    openUrl: safeUrl,
    embedUrl: safeUrl ? embeddableAuditUrl(safeUrl) : null,
    notice: safeUrl ? null : 'This Aptem assignment has no attached file, report, or evidence link in the audit source yet.',
  };
}

function embeddableAuditUrl(url: string) {
  const safeUrl = externalUrl(url);
  if (!safeUrl) return null;
  if (/drive\.google\.com\/file\/d\/([^/]+)/.test(safeUrl)) return safeUrl.replace(/\/view.*$/, '/preview');
  if (/docs\.google\.com\/presentation\/d\/([^/]+)/.test(safeUrl)) return safeUrl.replace(/\/(edit|present).*$/, '/embed');
  if (/docs\.google\.com\/document\/d\/([^/]+)/.test(safeUrl)) return safeUrl.replace(/\/edit.*$/, '/preview');
  if (/\.(doc|docx|ppt|pptx|xls|xlsx)(\?.*)?$/i.test(safeUrl)) return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(safeUrl)}`;
  return safeUrl;
}

function lmsMaterialScore(lookupTitle: string, material: LmsMaterial) {
  const materialTitle = normalizeLookup(material.material_title);
  if (!materialTitle) return 0;
  const titleTokens = lookupTitle.split(' ').filter((token) => token.length > 2);
  const materialTokens = new Set(materialTitle.split(' ').filter((token) => token.length > 2));
  let score = 0;
  if (materialTitle === lookupTitle) score += 120;
  if (materialTitle.includes(lookupTitle) || lookupTitle.includes(materialTitle)) score += 70;
  score += titleTokens.filter((token) => materialTokens.has(token)).length * 8;
  const source = material.source || null;
  const attachment = source?.attachments?.[0];
  const hasDirectSource = Boolean(externalUrl(source?.embed_url) || externalUrl(source?.file_url) || externalUrl(attachment?.embed_url) || externalUrl(attachment?.file_url));
  if (hasDirectSource) score += 35;
  const type = `${material.content_type || ''} ${material.material_format || ''} ${material.component_type || ''}`.toLowerCase();
  if (/(video|recording|powerpoint|presentation|pdf|word|file)/.test(type)) score += 20;
  if (/quiz/.test(type) && !/^q\d+\b/.test(lookupTitle)) score -= 20;
  return score;
}

function canOpenAuditSource(item: AuditActivityItem) {
  if (item.source === 'LMS') return true;
  if (isAttendanceItem(item)) return false;
  return hasAptemSourceUrl(item);
}

function hasAptemSourceUrl(item: AptemAuditItem) {
  const reportUrls = Array.isArray(item.raw.assignment_report_urls) ? item.raw.assignment_report_urls : [];
  return assignmentEvidence(item).some((entry) => externalUrl(entry.fileUrl) || externalUrl(entry.reportUrl) || externalUrl(entry.noteUrl))
    || reportUrls.some((value) => externalUrl(value));
}

function externalUrl(value?: AuditJsonValue | null) {
  if (typeof value !== 'string' || !value) return null;
  const url = String(value).trim();
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return null;
  } catch {
    return null;
  }
  return url;
}

function inferContentType(url: string) {
  if (/\.(ppt|pptx)(\?.*)?$/i.test(url)) return 'ppt';
  if (/\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(url)) return 'audio';
  if (/\.pdf(\?.*)?$/i.test(url)) return 'pdf';
  if (/\.(doc|docx)(\?.*)?$/i.test(url)) return 'word';
  return 'file';
}

function isDirectVideoUrl(url: string) {
  return /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url);
}

function isDirectAudioUrl(url: string) {
  return /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(url);
}

function shouldLaunchOutside(url: string) {
  const host = urlHost(url);
  if (!host) return false;
  return host.includes('aptem.co.uk');
}

function urlHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeLookup(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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
  return item.type === 'Attendance' && (item.raw.Attendance !== undefined || item.raw.attendance !== undefined);
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

function uniqueAuditItems<T extends AuditActivityItem>(items: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  items.forEach((item) => {
    const key = auditDuplicateKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(item);
  });
  return unique;
}

function auditDuplicateKey(item: AuditActivityItem) {
  const cell = auditCell(item);
  const status = item.source === 'Aptem' ? item.status : item.completion_status;
  return [
    item.source,
    normalizeLookup(auditItemTitle(item)),
    normalizeLookup(auditItemSubtitle(item)),
    auditItemDate(item) || '',
    normalizeLookup(status),
    cell.actual,
    cell.planned,
  ].join('|');
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
    return 'other';
  }
  const text = item.source === 'Aptem'
    ? `${item.type} ${item.activity_name}`
    : `${item.component_type} ${item.component_name} ${item.course_module}`;
  const normalized = text.toLowerCase().replace(/[-\s]+/g, '_');
  if (!isAuditActivitySummary(item) && isAttendanceItem(item)) return 'live_session';
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
  if (item.source === 'Aptem' && isAttendanceItem(item)) {
    const rawAttendance = item.raw.Attendance ?? item.raw.attendance;
    return [
      formatDate(item.relevant_date),
      rawAttendance !== undefined && rawAttendance !== null ? `Attendance ${String(rawAttendance)}` : '',
      item.status,
      item.type || item.match_status,
    ].filter(Boolean).join(' - ');
  }
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
                  <AppIcon className="ri-close-circle-line text-sm"></AppIcon>
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
                              <AppIcon className="ri-close-line text-xs"></AppIcon>
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
                aria-pressed={auditView === 'monthly'}
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-[12px] font-bold transition ${auditView === 'monthly' ? 'bg-primary-600 text-white shadow-sm' : 'text-foreground-600 hover:bg-background-100'}`}
              >
                <AppIcon className="ri-file-search-line" />
                Monthly Audit
              </button>
              <button
                type="button"
                onClick={() => setAuditView('activities')}
                aria-pressed={auditView === 'activities'}
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-[12px] font-bold transition ${auditView === 'activities' ? 'bg-primary-600 text-white shadow-sm' : 'text-foreground-600 hover:bg-background-100'}`}
              >
                <AppIcon className="ri-stack-line" />
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
                  <AppIcon className={`${savingSignoff ? 'ri-loader-4-line animate-spin' : 'ri-save-3-line'} text-sm`}></AppIcon>
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
          <AppIcon className="ri-eye-line text-sm"></AppIcon>
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
              <AppIcon className="ri-checkbox-multiple-line text-sm"></AppIcon>
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
                      <AppIcon className="ri-check-line"></AppIcon>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMonth(month.month_key)}
                      aria-label={isOpen ? `Collapse ${month.label}` : `Expand ${month.label}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-500 transition hover:bg-background-100 hover:text-foreground-900"
                    >
                      <AppIcon className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></AppIcon>
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
        <AppIcon className={`${open ? 'ri-subtract-line' : 'ri-add-line'} text-sm text-foreground-500`}></AppIcon>
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
  const evidence = assignmentEvidence(item);
  const ksbGroups = ksbGroupsForItem(item);
  return (
    <>
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
      <ActivityKsbStrip groups={ksbGroups} />
      {evidence.length > 0 && (
        <div className="mt-3 rounded-lg border border-background-200 bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Assignment Evidence</p>
          <div className="mt-2 space-y-2">
            {evidence.map((entry, index) => (
              <div key={`${entry.evidenceId || entry.name}-${index}`} className="rounded-lg border border-background-200 bg-background-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-[12px] font-semibold text-foreground-900">{entry.name || 'Evidence item'}</p>
                    <p className="mt-1 text-[11px] text-foreground-500">{[entry.kind, entry.status, formatDate(entry.submissionDate)].filter(Boolean).join(' - ')}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    {entry.fileUrl && <EvidenceLink href={entry.fileUrl} icon="ri-file-word-line" label="File" />}
                    {entry.noteUrl && <EvidenceLink href={entry.noteUrl} icon="ri-sticky-note-line" label="Note" />}
                    {entry.reportUrl && <EvidenceLink href={entry.reportUrl} icon="ri-file-pdf-line" label="Report" />}
                  </div>
                </div>
                {entry.feedbacks.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-background-200 pt-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Coach Feedback</p>
                    {entry.feedbacks.map((feedback, feedbackIndex) => (
                      <div key={`${feedback.id || feedback.author}-${feedbackIndex}`} className="rounded-lg bg-white p-2 ring-1 ring-background-200">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-foreground-500">
                          <span>{feedback.author || 'Coach'}</span>
                          {feedback.date && <span>{formatDate(feedback.date)}</span>}
                        </div>
                        <p className="mt-1 whitespace-pre-line text-[11px] leading-5 text-foreground-700">{feedback.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function EvidenceLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary-100 bg-white px-2.5 text-[11px] font-bold text-primary-700 hover:bg-primary-50">
      <AppIcon className={icon} />
      {label}
    </a>
  );
}

function LmsDetails({ item }: { item: LmsAuditItem }) {
  const ksbGroups = ksbGroupsForItem(item);
  return (
    <>
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
      <ActivityKsbStrip groups={ksbGroups} />
    </>
  );
}

function MonthlyLearnerDeclaration({ audit, month }: { audit: LearnerAuditResponse; month: AuditMonth }) {
  const declaration = monthlyDeclarationData(audit, month);
  return (
    <div className="mt-4 rounded-lg border border-primary-100 bg-primary-50/30 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
            <AppIcon className="ri-file-sign-line text-base"></AppIcon>
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
        <AppIcon className="ri-check-double-line mt-0.5 shrink-0 text-sm"></AppIcon>
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
        {!hasInk && <AppIcon className="ri-pen-nib-line pointer-events-none absolute right-4 top-4 text-lg text-foreground-300"></AppIcon>}
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
              <AppIcon className="ri-download-2-line text-sm"></AppIcon>
              Download
            </a>
            <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-background-200 text-foreground-600">
              <AppIcon className="ri-close-line text-lg"></AppIcon>
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
            {title && <AppIcon className="ri-information-line text-[11px] text-foreground-300"></AppIcon>}
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
      <AppIcon className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></AppIcon>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-10 w-full rounded-lg border border-background-200 bg-background-50 pl-9 pr-3 text-[12px] outline-none transition focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100" />
    </div>
  );
}

function EmptyPanel({ icon, text }: { icon: string; text: string }) {
  return <div className="rounded-lg border border-dashed border-background-300 bg-background-100/50 p-6 text-center text-[12px] text-foreground-500"><AppIcon className={`${icon} mb-2 block text-xl text-foreground-300`}></AppIcon>{text}</div>;
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
        {title && <AppIcon className="ri-information-line shrink-0 text-[10px] text-foreground-300"></AppIcon>}
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
        {title && <AppIcon className="ri-information-line text-[11px] text-foreground-300"></AppIcon>}
      </p>
      <p className="mt-1 break-words text-[13px] font-bold text-foreground-900">{value}</p>
    </div>
  );
}

function AuditStatsSkeleton() {
  return (
    <>
      {Array.from({ length: 10 }).map((_, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          <SkeletonBlock className="h-4 w-8 rounded bg-[#eadfce]" />
          <SkeletonBlock className={`${index % 3 === 0 ? 'w-24' : 'w-16'} h-3 rounded bg-[#efe7dc]`} />
        </span>
      ))}
    </>
  );
}

function ActivityMatrixSkeleton() {
  const columns = 8;
  const rows = 6;

  return (
    <div className="overflow-auto p-5">
      <div className="min-w-[1120px] overflow-hidden rounded-lg border border-[#eee7dc]">
        <div className="grid grid-cols-[54px_220px_90px_90px_90px_90px_repeat(8,145px)] bg-[#fbfaf8]">
          {Array.from({ length: columns + 6 }).map((_, index) => (
            <div key={index} className="border-b border-r border-[#eee7dc] px-3 py-4">
              <SkeletonBlock className={`${index === 1 ? 'w-28' : index > 5 ? 'w-24' : 'w-12'} h-3 rounded bg-[#eadfce]`} />
              {index > 5 && <SkeletonBlock className="mt-2 h-2.5 w-20 rounded bg-[#f0e8dd]" />}
            </div>
          ))}
        </div>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="grid grid-cols-[54px_220px_90px_90px_90px_90px_repeat(8,145px)]">
            <div className="border-b border-r border-[#f0ebe4] px-3 py-4">
              <SkeletonBlock className="h-3 w-4 rounded bg-[#efe7dc]" />
            </div>
            <div className="border-b border-r border-[#f0ebe4] px-3 py-4">
              <SkeletonBlock className="h-4 w-32 rounded bg-[#e9dfd1]" />
              <SkeletonBlock className="mt-2 h-3 w-16 rounded bg-[#f1e9df]" />
            </div>
            <div className="border-b border-r border-[#f0ebe4] px-3 py-4">
              <SkeletonBlock className="mx-auto h-6 w-12 rounded-full bg-[#ffedd5]" />
            </div>
            {Array.from({ length: 3 }).map((_, metricIndex) => (
              <div key={metricIndex} className="border-b border-r border-[#f0ebe4] px-3 py-4">
                <SkeletonBlock className="ml-auto h-4 w-12 rounded bg-[#efe7dc]" />
              </div>
            ))}
            {Array.from({ length: columns }).map((_, columnIndex) => (
              <div key={columnIndex} className="border-b border-r border-[#f0ebe4] px-3 py-4">
                <SkeletonBlock className={`mx-auto h-6 rounded-md ${columnIndex % 3 === rowIndex % 3 ? 'w-12 bg-[#ccfbf1]' : 'w-5 bg-[#f1e9df]'}`} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-center">
        <SkeletonBlock className="h-3 w-96 max-w-full rounded bg-[#eadfce]" />
      </div>
    </div>
  );
}

function LearnerAuditPageSkeleton() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center gap-4 border-b border-[#f0ebe4] pb-5">
        <SkeletonBlock className="h-14 w-14 shrink-0 rounded-full bg-[#ffedd5]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SkeletonBlock className="h-6 w-44 rounded bg-[#e9dfd1]" />
            <SkeletonBlock className="h-6 w-16 rounded-full bg-[#ccfbf1]" />
            <SkeletonBlock className="h-6 w-28 rounded-full bg-[#ffedd5]" />
          </div>
          <SkeletonBlock className="mt-2 h-3 w-64 max-w-full rounded bg-[#efe7dc]" />
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-[#eee7dc] bg-white p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <SkeletonBlock className="h-4 w-48 rounded bg-[#e9dfd1]" />
          <SkeletonBlock className="h-8 w-24 rounded-full bg-[#ffedd5]" />
        </div>
        <div className="flex gap-8">
          <div>
            <SkeletonBlock className="h-3 w-16 rounded bg-[#efe7dc]" />
            <SkeletonBlock className="mt-2 h-8 w-20 rounded bg-[#e9dfd1]" />
          </div>
          <div>
            <SkeletonBlock className="h-3 w-14 rounded bg-[#efe7dc]" />
            <SkeletonBlock className="mt-2 h-8 w-24 rounded bg-[#e9dfd1]" />
          </div>
        </div>
        <SkeletonBlock className="mt-5 h-2 w-full rounded-full bg-[#ffedd5]" />
        <SkeletonBlock className="mt-3 h-3 w-44 rounded bg-[#efe7dc]" />
      </div>

      <div className="mt-6">
        <SkeletonBlock className="h-5 w-40 rounded bg-[#e9dfd1]" />
        <SkeletonBlock className="mt-2 h-3 w-48 rounded bg-[#efe7dc]" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-[#eee7dc] bg-[#fbfaf8] p-4">
              <div className="flex items-center gap-4">
                <SkeletonBlock className="h-9 w-9 rounded-lg bg-[#ffedd5]" />
                <div className="flex-1">
                  <SkeletonBlock className="h-4 w-44 rounded bg-[#e9dfd1]" />
                  <div className="mt-2 flex gap-3">
                    <SkeletonBlock className="h-3 w-20 rounded bg-[#efe7dc]" />
                    <SkeletonBlock className="h-3 w-14 rounded bg-[#efe7dc]" />
                    <SkeletonBlock className="h-3 w-16 rounded bg-[#efe7dc]" />
                  </div>
                  <SkeletonBlock className="mt-3 h-1.5 w-80 max-w-full rounded-full bg-[#f59e0b]" />
                </div>
                <SkeletonBlock className="h-5 w-5 rounded-full bg-[#efe7dc]" />
              </div>
              {index === 0 && (
                <div className="mt-4 rounded-lg border border-[#eee7dc] bg-white p-4">
                  <div className="flex items-center gap-3">
                    <SkeletonBlock className="h-9 w-9 rounded-lg bg-[#ccfbf1]" />
                    <div className="flex-1">
                      <SkeletonBlock className="h-4 w-72 max-w-full rounded bg-[#e9dfd1]" />
                      <SkeletonBlock className="mt-2 h-3 w-40 rounded bg-[#efe7dc]" />
                    </div>
                    <SkeletonBlock className="h-6 w-24 rounded-full bg-[#ccfbf1]" />
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, cardIndex) => (
                      <div key={cardIndex} className="rounded-lg bg-[#fbfaf8] p-3">
                        <SkeletonBlock className="h-3 w-20 rounded bg-[#e9dfd1]" />
                        <SkeletonBlock className="mt-3 h-3 w-full rounded bg-[#efe7dc]" />
                        <SkeletonBlock className="mt-2 h-3 w-3/4 rounded bg-[#efe7dc]" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-[#eee7dc] bg-white p-5">
        <SkeletonBlock className="h-5 w-40 rounded bg-[#e9dfd1]" />
        <SkeletonBlock className="mt-3 h-3 w-96 max-w-full rounded bg-[#efe7dc]" />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <SkeletonBlock className="h-44 rounded-lg bg-[#fbfaf8]" />
          <SkeletonBlock className="h-44 rounded-lg bg-[#fbfaf8]" />
        </div>
        <SkeletonBlock className="mt-5 h-10 w-32 rounded-lg bg-[#0f766e]" />
      </div>
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
  const approvedFromRows = sumRawHours(items, ['approved_hours', 'approved_otjh', 'approved otjh', 'approved']);
  const approvedHours = approvedFromRows ?? audit.summary.approved_hours;
  const ksbs = uniqueStrings(items.flatMap((item) => extractKsbCodes(item)));

  return {
    plannedHours: month.summary.planned_hours,
    completedHours: month.summary.actual_hours,
    approvedHours,
    ksbs,
  };
}

function extractKsbCodes(item: AuditActivityItem) {
  if (item.source === 'Aptem') {
    const feedbackValues = assignmentEvidence(item).flatMap((entry) => entry.feedbacks.map((feedback) => feedback.message));
    const feedbackCodes = uniqueStrings(feedbackValues.flatMap(extractCoachFeedbackKsbCodesFromText)).sort(compareKsbCodes);
    if (feedbackCodes.length) return feedbackCodes;

    const evidenceValues = assignmentEvidence(item).flatMap((entry) => [entry.name, entry.kind, entry.status].filter(Boolean));
    const evidenceCodes = uniqueStrings(evidenceValues.flatMap(extractCoachFeedbackKsbCodesFromText)).sort(compareKsbCodes);
    if (evidenceCodes.length) return evidenceCodes;
  }
  const values = flattenAuditValues(item.raw);
  return uniqueStrings(values.flatMap(extractCoachFeedbackKsbCodesFromText)).sort(compareKsbCodes);
}

function ksbGroupsForItem(item: AuditActivityItem): KsbGroups {
  const groups: KsbGroups = { knowledge: [], skills: [], behaviour: [] };
  extractKsbCodes(item).forEach((code) => {
    const bucket = ksbGroupForCode(code);
    if (!groups[bucket].includes(code)) groups[bucket].push(code);
  });
  groups.knowledge.sort(compareKsbCodes);
  groups.skills.sort(compareKsbCodes);
  groups.behaviour.sort(compareKsbCodes);
  return groups;
}

function extractCoachFeedbackKsbCodesFromText(value: string) {
  const cleanValue = stripHtml(value);
  const matches = [...cleanValue.matchAll(/(?:KSBs?\s+achieved|Evidenced\s+KSBs?|KSBs?\s+evidenced|KSBs?)\s*:\s*([^\n\r]+)/gi)];
  return matches.flatMap((match) => extractKsbCodesFromText(match[1] || ''));
}

function extractKsbCodesFromText(value: string) {
  return (value.match(/\b(?:KSB\s*)?[KSB]\s*\d+(?:\.\d+)?[a-z]?\b/gi) || [])
    .map((code) => code.toUpperCase().replace(/^KSB\s*/, '').replace(/\s+/g, ''))
    .filter((code) => /^[KSB]\d/.test(code));
}

function ksbGroupForCode(code: string): KsbGroupKey {
  if (code.startsWith('S')) return 'skills';
  if (code.startsWith('B')) return 'behaviour';
  return 'knowledge';
}

function compareKsbCodes(left: string, right: string) {
  const leftMatch = /^([KSB])(\d+)(?:\.(\d+))?([A-Z])?$/.exec(left);
  const rightMatch = /^([KSB])(\d+)(?:\.(\d+))?([A-Z])?$/.exec(right);
  const order = { K: 0, S: 1, B: 2 } as Record<string, number>;
  if (!leftMatch || !rightMatch) return left.localeCompare(right);
  const groupDiff = order[leftMatch[1]] - order[rightMatch[1]];
  if (groupDiff) return groupDiff;
  const numberDiff = Number(leftMatch[2]) - Number(rightMatch[2]);
  if (numberDiff) return numberDiff;
  const decimalDiff = Number(leftMatch[3] || 0) - Number(rightMatch[3] || 0);
  if (decimalDiff) return decimalDiff;
  return (leftMatch[4] || '').localeCompare(rightMatch[4] || '');
}

function assignmentEvidence(item: AptemAuditItem) {
  const rawEvidence = item.raw.evidence;
  if (!Array.isArray(rawEvidence)) return [];
  return rawEvidence
    .filter((entry): entry is Record<string, AuditJsonValue> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      kind: stringFromAuditValue(entry.kind),
      name: stringFromAuditValue(entry.name),
      status: stringFromAuditValue(entry.status),
      evidenceId: stringFromAuditValue(entry.evidence_id),
      submissionDate: stringFromAuditValue(entry.submission_date),
      fileUrl: stringFromAuditValue(entry.file_blob_url) || stringFromAuditValue(entry.source_file_url),
      noteUrl: stringFromAuditValue(entry.note_blob_url),
      reportUrl: stringFromAuditValue(entry.assessment_report_blob_url) || stringFromAuditValue(entry.assessment_report_url),
      feedbacks: feedbacksFromAuditValue(entry.feedbacks),
    }));
}

function stringFromAuditValue(value: AuditJsonValue | undefined) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function feedbacksFromAuditValue(value: AuditJsonValue | undefined) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, AuditJsonValue> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      id: stringFromAuditValue(entry.id),
      author: stringFromAuditValue(entry.author),
      date: stringFromAuditValue(entry.date),
      message: stripHtml(stringFromAuditValue(entry.message)),
    }))
    .filter((entry) => entry.message || entry.author || entry.date);
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
      if (month.month_key === 'undated') {
        const undatedItems = month.undated_items.filter((item) => !item.relevant_date || isPastOrToday(item.relevant_date, todayKey));
        if (!undatedItems.length) return null;
        return recomputeMonthSummary({ ...month, label: 'Needs Review - Missing Date', undated_items: undatedItems });
      }
      const weeks = month.weeks
        .map((week) => ({
          ...week,
          aptem_items: week.aptem_items.filter((item) => isPastOrToday(item.relevant_date, todayKey)),
          lms_items: week.lms_items.filter((item) => isPastOrToday(item.relevant_date, todayKey)),
        }))
        .filter((week) => week.aptem_items.length || week.lms_items.length || Boolean(week.source_column));
      const undatedItems = month.undated_items.filter((item) => !item.relevant_date || isPastOrToday(item.relevant_date, todayKey));
      const hasMonthlyHours = month.summary.planned_hours !== null || month.summary.actual_hours !== null;
      if (!weeks.length && !undatedItems.length && !hasMonthlyHours) return null;
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
      actual_hours: month.summary.actual_hours,
      planned_hours: month.summary.planned_hours,
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

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start && !end) return 'Not available';
  if (!start || !end) return formatDate(start || end);
  return `${formatDate(start)} - ${formatDate(end)}`;
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

function sumAvailableHours(values: Array<number | null | undefined>) {
  const available = values.filter((value): value is number => value !== null && value !== undefined);
  if (!available.length) return null;
  return roundHours(available.reduce((total, value) => total + value, 0));
}

function formatSignedHoursFromHours(hours?: number | null) {
  if (hours === null || hours === undefined) return 'Not available';
  const sign = hours > 0 ? '+' : hours < 0 ? '-' : '';
  return `${sign}${formatHoursFromHours(Math.abs(hours))}`;
}

function percentage(actual?: number | null, planned?: number | null) {
  if (!planned || planned <= 0) return actual && actual > 0 ? 100 : 0;
  return Math.max(0, Math.round(((actual || 0) / planned) * 100));
}

function learnerInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'L') + (parts[1]?.[0] || '');
}

function monthAbbrev(label: string) {
  return (label || '').slice(0, 3) || 'Mon';
}

function monthDateRange(month: AuditMonth) {
  const weeks = month.weeks;
  const start = weeks[0]?.start_date || (month.month_key.match(/^\d{4}-\d{2}$/) ? `${month.month_key}-01` : null);
  const end = weeks[weeks.length - 1]?.end_date || null;
  if (start && end) return `${start} - ${end}`;
  if (start) return start;
  return '';
}

function sortAuditMonths(months: AuditMonth[], direction: 'desc' | 'asc') {
  return [...months].sort((left, right) => {
    if (left.month_key === 'undated') return 1;
    if (right.month_key === 'undated') return -1;
    const result = left.month_key.localeCompare(right.month_key);
    return direction === 'asc' ? result : -result;
  });
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
      actual_hours: sumAvailableHours(months.map((month) => month.summary.actual_hours)),
      planned_hours: sumAvailableHours(months.map((month) => month.summary.planned_hours)),
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

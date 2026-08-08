import { useEffect, useState, useMemo } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import type { AbsenceReport } from '@/mocks/absence-reports';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/absence-reports';
const HIGH_RISK_ABSENCE_REPORTS_LABEL = 'High-Risk Absence Reports';
const HIGH_RISK_ABSENCE_SHORT_LABEL = 'High Risk';
type ReportStatusKey = 'pending' | 'approved' | 'declined';

function FilterDropdown({ label, value, onChange, options, allLabel }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string }) {
  return (
    <div className="relative min-w-[145px] flex-1 sm:flex-none">
      <select value={value} onChange={e => onChange(e.target.value)} className="h-10 w-full appearance-none rounded-xl border border-foreground-200 bg-white pl-3 pr-8 text-[11px] font-semibold text-foreground-700 shadow-sm outline-none transition hover:border-primary-200 focus:border-primary-400 focus:ring-2 focus:ring-primary-100">
        <option value="all">{allLabel || `All ${label}s`}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <AppIcon className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-400 text-xs pointer-events-none"></AppIcon>
    </div>
  );
}

function normalizeReportStatus(status?: string | null): ReportStatusKey {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'approved' || value === 'declined') return value;
  return 'pending';
}

function statusLabel(status?: string | null) {
  const normalized = normalizeReportStatus(status);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function statusBadgeClass(status?: string | null) {
  const normalized = normalizeReportStatus(status);
  if (normalized === 'approved') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'declined') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-700';
}

function isPendingReport(report: AbsenceReport) {
  return normalizeReportStatus(report.status) === 'pending';
}

function reportPriority(report: AbsenceReport) {
  if (report.attendanceRate < 80 || report.previousAbsences >= 5) return { label: HIGH_RISK_ABSENCE_SHORT_LABEL, className: 'bg-red-50 text-red-700 border-red-100' };
  if (!report.evidenceProvided || report.previousAbsences >= 3) return { label: 'Check carefully', className: 'bg-amber-50 text-amber-700 border-amber-100' };
  return { label: 'Standard review', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' };
}

function resolveEvidenceUrl(url?: string | null) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

function isImageEvidence(report: AbsenceReport) {
  const kind = String(report.evidenceKind || '').toLowerCase();
  const url = resolveEvidenceUrl(report.evidenceImageUrl);
  return kind === 'image' || (!!url && /\.(apng|avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i.test(url));
}

function evidenceActionLabel(report: AbsenceReport) {
  if (isImageEvidence(report)) return 'image';
  if (report.evidenceImageUrl) return 'file';
  return 'text';
}

export default function CoachAbsenceReports() {
  const { success, error } = useToast();
  const [reports, setReports] = useState<AbsenceReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [reportsError, setReportsError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [programmeFilter, setProgrammeFilter] = useState<string>('all');
  const [cohortFilter, setCohortFilter] = useState<string>('all');
  const [reportedByFilter, setReportedByFilter] = useState<string>('all');
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const [queueFilter, setQueueFilter] = useState<'all' | 'high-priority' | 'with-evidence' | 'missing-evidence'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<AbsenceReport | null>(null);
  const [actionModal, setActionModal] = useState<{ type: 'approve' | 'decline'; reportId: string } | null>(null);
  const [sendNotification, setSendNotification] = useState(true);
  const [coachNoteText, setCoachNoteText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(8);

  useEffect(() => {
    const controller = new AbortController();
    fetch(API_ENDPOINT, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);
        return data as { items?: AbsenceReport[] };
      })
      .then(data => {
        setReports(data.items || []);
        setReportsError(null);
      })
      .catch(requestError => {
        if (controller.signal.aborted) return;
        setReports([]);
        setReportsError(requestError instanceof Error ? requestError.message : 'Unable to load absence reports.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingReports(false);
      });
    return () => controller.abort();
  }, []);

  const programmes = useMemo(() => [...new Set(reports.map(r => r.programme))].sort(), [reports]);
  const cohorts = useMemo(() => [...new Set(reports.map(r => r.cohort))].sort(), [reports]);
  const reportedByOptions = useMemo(() => [...new Set(reports.map(r => r.reportedBy))].sort(), [reports]);
  const reasonCategories = useMemo(() => [...new Set(reports.map(r => r.reasonCategory))].sort(), [reports]);

  const filteredData = useMemo(() => {
    let data = reports;
    if (statusFilter !== 'all') data = data.filter(r => normalizeReportStatus(r.status) === statusFilter);
    if (programmeFilter !== 'all') data = data.filter(r => r.programme === programmeFilter);
    if (cohortFilter !== 'all') data = data.filter(r => r.cohort === cohortFilter);
    if (reportedByFilter !== 'all') data = data.filter(r => r.reportedBy === reportedByFilter);
    if (reasonFilter !== 'all') data = data.filter(r => r.reasonCategory === reasonFilter);
    if (queueFilter === 'high-priority') data = data.filter(r => isPendingReport(r) && (r.attendanceRate < 80 || r.previousAbsences >= 5));
    if (queueFilter === 'with-evidence') data = data.filter(r => r.evidenceProvided);
    if (queueFilter === 'missing-evidence') data = data.filter(r => isPendingReport(r) && !r.evidenceProvided);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      data = data.filter(r =>
        r.learner.toLowerCase().includes(q) ||
        r.initials.toLowerCase().includes(q) ||
        r.programme.toLowerCase().includes(q) ||
        r.sessionTitle.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q) ||
        r.module.toLowerCase().includes(q)
      );
    }
    if (dateFrom && dateTo) {
      data = data.filter(r => r.sessionDate >= dateFrom && r.sessionDate <= dateTo);
    } else if (dateFrom) {
      data = data.filter(r => r.sessionDate >= dateFrom);
    } else if (dateTo) {
      data = data.filter(r => r.sessionDate <= dateTo);
    }
    return data.sort((a, b) => {
      if (isPendingReport(a) && !isPendingReport(b)) return -1;
      if (!isPendingReport(a) && isPendingReport(b)) return 1;
      if (a.evidenceProvided !== b.evidenceProvided) return a.evidenceProvided ? -1 : 1;
      if (a.previousAbsences !== b.previousAbsences) return b.previousAbsences - a.previousAbsences;
      if (a.attendanceRate !== b.attendanceRate) return a.attendanceRate - b.attendanceRate;
      return 0;
    });
  }, [reports, statusFilter, programmeFilter, cohortFilter, reportedByFilter, reasonFilter, queueFilter, searchQuery, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const selectedReport = reports.find(r => r.id === selectedReportId) || null;

  const pending = reports.filter(isPendingReport).length;
  const approved = reports.filter(r => normalizeReportStatus(r.status) === 'approved').length;
  const declined = reports.filter(r => normalizeReportStatus(r.status) === 'declined').length;
  const total = reports.length;
  const withEvidence = reports.filter(r => r.evidenceProvided).length;
  const pendingWithoutEvidence = reports.filter(r => isPendingReport(r) && !r.evidenceProvided).length;
  const highPriority = reports.filter(r => isPendingReport(r) && (r.attendanceRate < 80 || r.previousAbsences >= 5)).length;

  const saveDecision = async (reportId: string, status: 'approved' | 'declined') => {
    const report = reports.find(item => item.id === reportId);
    if (!report) return;
    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reportId, status, coachNote: coachNoteText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);
      setReports(current => current.map(item => item.id === reportId ? data.item as AbsenceReport : item));
      if (status === 'approved') success(`Approved absence for ${report.learner}`, report.sessionTitle);
      else error(`Declined absence for ${report.learner}`, report.sessionTitle);
      if (sendNotification) success(`Notification sent to ${report.learner}`, coachNoteText.trim() ? 'With your message' : 'Absence decision confirmed');
      setCoachNoteText('');
      setActionModal(null);
    } catch (requestError) {
      error('Unable to save absence decision', requestError instanceof Error ? requestError.message : 'Please try again.');
    }
  };

  const handleApprove = (reportId: string) => saveDecision(reportId, 'approved');
  const handleDecline = (reportId: string) => saveDecision(reportId, 'declined');

  const reasonCategoryLabel: Record<string, string> = {
    illness: 'Illness',
    work: 'Work Commitment',
    personal: 'Personal',
    'annual-leave': 'Annual Leave',
    family: 'Family Emergency',
    other: 'Other',
  };

  const reasonCategoryColor: Record<string, string> = {
    illness: 'bg-red-100 text-red-700',
    work: 'bg-accent-100 text-accent-700',
    personal: 'bg-secondary-100 text-secondary-700',
    'annual-leave': 'bg-emerald-100 text-emerald-700',
    family: 'bg-amber-100 text-amber-700',
    other: 'bg-foreground-100 text-foreground-700',
  };

  const hasActiveFilters = statusFilter !== 'all' || programmeFilter !== 'all' || cohortFilter !== 'all' || reportedByFilter !== 'all' || reasonFilter !== 'all' || queueFilter !== 'all' || dateFrom || dateTo || searchQuery;

  const clearFilters = () => {
    setStatusFilter('all');
    setProgrammeFilter('all');
    setCohortFilter('all');
    setReportedByFilter('all');
    setReasonFilter('all');
    setQueueFilter('all');
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setCurrentPage(1);
  };

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Absence Reports" pageSubtitle="Review, approve or decline learner absence reports" userName="Med Maher" userRole="Progress Coach">
      <div className="min-h-screen space-y-4 bg-[#f7f6fb] p-3 md:p-5">

        {/* ===== Hero Banner ===== */}
        <div className="relative overflow-hidden rounded-2xl border border-primary-800/20 shadow-[0_16px_35px_-24px_rgba(61,20,115,0.75)]" style={{ background: 'linear-gradient(115deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 58%, oklch(var(--primary-700)) 100%)' }}>
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-28 left-1/3 h-48 w-48 rounded-full bg-primary-300/20 blur-3xl" />
          <div className="relative flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner backdrop-blur-sm">
                <AppIcon className="ri-file-list-3-line text-xl text-white"></AppIcon>
              </span>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary-200">Attendance management</p>
                <h2 className="text-xl font-heading font-bold text-white">Absence Reports</h2>
                <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-white/70">
                  Review evidence and make clear, consistent attendance decisions.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:min-w-[330px]">
              <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2.5 backdrop-blur-sm">
                <p className="text-lg font-bold text-white">{pending}</p>
                <p className="text-[9px] font-medium uppercase tracking-wider text-white/60">To review</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2.5 backdrop-blur-sm">
                <p className="text-lg font-bold text-white">{withEvidence}</p>
                <p className="text-[9px] font-medium uppercase tracking-wider text-white/60">Evidence</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2.5 backdrop-blur-sm">
                <p className="text-lg font-bold text-white">{total}</p>
                <p className="text-[9px] font-medium uppercase tracking-wider text-white/60">Total</p>
              </div>
            </div>
          </div>
        </div>

        {/* ===== Review Queue Snapshot ===== */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Needs review', value: pending, sub: 'Pending decisions', icon: 'ri-time-line', color: 'amber', accent: 'bg-amber-400', onClick: () => { setStatusFilter('pending'); setQueueFilter('all'); } },
            { label: HIGH_RISK_ABSENCE_REPORTS_LABEL, value: highPriority, sub: 'Low attendance or repeat absence', icon: 'ri-alarm-warning-line', color: 'red', accent: 'bg-red-400', onClick: () => { setStatusFilter('pending'); setQueueFilter('high-priority'); } },
            { label: 'Approved', value: approved, sub: 'Confirmed absences', icon: 'ri-check-line', color: 'emerald', accent: 'bg-emerald-400', onClick: () => { setStatusFilter('approved'); setQueueFilter('all'); } },
            { label: 'Declined', value: declined, sub: 'Rejected requests', icon: 'ri-close-line', color: 'red', accent: 'bg-rose-400', onClick: () => { setStatusFilter('declined'); setQueueFilter('all'); } },
          ].map(card => (
            <button
              key={card.label}
              type="button"
              onClick={() => { card.onClick(); setCurrentPage(1); }}
              className="group relative overflow-hidden rounded-2xl border border-foreground-200/60 bg-white p-4 text-left shadow-[0_8px_24px_-20px_rgba(33,20,65,0.7)] transition duration-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-[0_14px_30px_-20px_rgba(82,35,145,0.55)]"
            >
              <span className={`absolute inset-x-0 top-0 h-1 ${card.accent}`} />
              <div className="flex items-center justify-between gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  card.color === 'amber' ? 'bg-amber-50 text-amber-600' :
                  card.color === 'red' ? 'bg-red-50 text-red-600' :
                  card.color === 'emerald' ? 'bg-emerald-50 text-emerald-600' :
                  'bg-primary-50 text-primary-600'
                }`}>
                  <AppIcon className={`${card.icon} text-lg`}></AppIcon>
                </span>
                <AppIcon className="ri-arrow-right-line text-sm text-foreground-300 transition group-hover:translate-x-0.5 group-hover:text-primary-500"></AppIcon>
              </div>
              <div className="mt-3 flex items-end justify-between gap-2">
                <div>
                  <p className="text-[12px] font-semibold text-foreground-900">{card.label}</p>
                  <p className="mt-0.5 text-[10px] text-foreground-400">{card.sub}</p>
                </div>
                <span className="text-2xl font-heading font-bold text-foreground-900">{card.value}</span>
              </div>
            </button>
          ))}
        </div>

        {/* ===== Search + Filters Bar ===== */}
        <div className="rounded-2xl border border-foreground-200/60 bg-white p-4 shadow-[0_8px_24px_-22px_rgba(33,20,65,0.65)]">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[12px] font-semibold text-foreground-900">Find a report</p>
              <p className="mt-0.5 text-[10px] text-foreground-400">Search and narrow the review queue</p>
            </div>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-primary-600 transition hover:bg-primary-50">
                Reset filters
              </button>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {/* Search */}
            <div className="relative flex-1 w-full">
              <AppIcon className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                placeholder="Search by learner, session, module, reason..."
                className="h-11 w-full rounded-xl border border-foreground-200 bg-[#faf9fc] pl-10 pr-10 text-xs text-foreground-700 outline-none transition placeholder:text-foreground-400 hover:border-primary-200 focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setCurrentPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400 hover:text-foreground-600 cursor-pointer">
                  <AppIcon className="ri-close-line text-xs"></AppIcon>
                </button>
              )}
            </div>
            {/* Filter Dropdowns */}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <FilterDropdown
                label="Status"
                allLabel="All Statuses"
                value={statusFilter}
                onChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}
                options={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'approved', label: 'Approved' },
                  { value: 'declined', label: 'Declined' },
                ]}
              />
              <FilterDropdown
                label="Programme"
                allLabel="All Programmes"
                value={programmeFilter}
                onChange={(v) => { setProgrammeFilter(v); setCurrentPage(1); }}
                options={programmes.map(p => ({ value: p, label: p }))}
              />
              <FilterDropdown
                label="Cohort"
                allLabel="All Cohorts"
                value={cohortFilter}
                onChange={(v) => { setCohortFilter(v); setCurrentPage(1); }}
                options={cohorts.map(c => ({ value: c, label: c }))}
              />
              <FilterDropdown
                label="Reported By"
                allLabel="All Sources"
                value={reportedByFilter}
                onChange={(v) => { setReportedByFilter(v); setCurrentPage(1); }}
                options={reportedByOptions.map(r => ({ value: r, label: r }))}
              />
              <FilterDropdown
                label="Reason"
                allLabel="All Reasons"
                value={reasonFilter}
                onChange={(v) => { setReasonFilter(v); setCurrentPage(1); }}
                options={reasonCategories.map(r => ({ value: r, label: reasonCategoryLabel[r] || r }))}
              />
              {/* Date Range */}
              <div className="col-span-2 flex items-center gap-1 sm:col-span-1">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-foreground-200 bg-white px-2 text-[10px] text-foreground-700 shadow-sm outline-none transition hover:border-primary-200 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 sm:w-[125px] sm:flex-none"
                  placeholder="From"
                />
                <span className="text-[10px] text-foreground-400">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-foreground-200 bg-white px-2 text-[10px] text-foreground-700 shadow-sm outline-none transition hover:border-primary-200 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 sm:w-[125px] sm:flex-none"
                  placeholder="To"
                />
              </div>
            </div>
          </div>

          {/* Active Filter Tags */}
          {hasActiveFilters && (
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              <span className="text-[10px] text-foreground-400">Active:</span>
              {statusFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}
                  <button onClick={() => { setStatusFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
                </span>
              )}
              {programmeFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {programmeFilter}
                  <button onClick={() => { setProgrammeFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
                </span>
              )}
              {cohortFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {cohortFilter}
                  <button onClick={() => { setCohortFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
                </span>
              )}
              {reportedByFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {reportedByFilter}
                  <button onClick={() => { setReportedByFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
                </span>
              )}
              {reasonFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {reasonCategoryLabel[reasonFilter] || reasonFilter}
                  <button onClick={() => { setReasonFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
                </span>
              )}
              {queueFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {queueFilter === 'high-priority' ? HIGH_RISK_ABSENCE_REPORTS_LABEL : queueFilter === 'with-evidence' ? 'With evidence' : 'Missing evidence'}
                  <button onClick={() => { setQueueFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
                </span>
              )}
              {(dateFrom || dateTo) && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {dateFrom || '...'} to {dateTo || '...'}
                  <button onClick={() => { setDateFrom(''); setDateTo(''); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* ===== Reports Table ===== */}
        <div className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-white shadow-[0_12px_30px_-24px_rgba(33,20,65,0.75)]">
          <div className="flex flex-col gap-3 border-b border-foreground-200/60 bg-gradient-to-r from-white via-white to-primary-50/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                <AppIcon className="ri-list-check-3 text-lg"></AppIcon>
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Review queue</p>
                <h3 className="mt-0.5 text-sm font-heading font-bold text-foreground-900">
                {filteredData.length} report{filteredData.length === 1 ? '' : 's'} in view
                </h3>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-foreground-400">
              <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">{pending} pending</span>
              <span className="rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-700">{highPriority} high-risk reports</span>
              <span className="rounded-full bg-primary-50 px-2.5 py-1 font-semibold text-primary-700">{withEvidence} with evidence</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left">
              <thead className="bg-[#faf9fc]">
                <tr className="border-b border-foreground-200/60">
                  <th className="pl-4 pr-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Learner</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Session</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Date</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Reason</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Evidence</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Prev. Absences</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Attendance</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Status</th>
                  <th className="pr-4 pl-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground-100">
                {paginatedData.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <span className="w-12 h-12 rounded-2xl bg-background-100 flex items-center justify-center">
                          <AppIcon className={`${loadingReports ? 'ri-loader-4-line animate-spin' : reportsError ? 'ri-error-warning-line' : 'ri-inbox-line'} text-foreground-300 text-xl`}></AppIcon>
                        </span>
                        <p className="text-[13px] text-foreground-400 font-medium">{loadingReports ? 'Loading absence reports...' : reportsError || 'No absence reports found'}</p>
                        {!loadingReports && !reportsError && <p className="text-[11px] text-foreground-300">Try adjusting your search or filters</p>}
                        {hasActiveFilters && (
                          <button onClick={clearFilters} className="px-3 py-1.5 bg-background-100 text-foreground-500 rounded-lg text-[11px] font-medium hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
                            <AppIcon className="ri-close-line mr-1"></AppIcon>Clear Filters
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedData.map(row => {
                    const isSel = selectedReportId === row.id;
                    const priority = reportPriority(row);
                    return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedReportId(isSel ? null : row.id)}
                        className={`cursor-pointer border-l-2 transition duration-150 ${isSel ? 'border-primary-500 bg-primary-50/50' : 'border-transparent hover:bg-[#faf9fc]'}`}
                      >
                        <td className="pl-4 pr-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ring-1 ${row.attendanceRate >= 90 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : row.attendanceRate >= 80 ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-red-50 text-red-700 ring-red-200'}`}>
                              <span className="text-[11px] font-bold">{row.initials}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[12px] font-semibold text-foreground-900 truncate">{row.learner}</p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                <p className="text-[10px] text-foreground-400 truncate">{row.programme}</p>
                                <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-semibold ${priority.className}`}>{priority.label}</span>
                              </div>
                              <p className="text-[10px] text-foreground-300 truncate">{row.cohort}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="max-w-[180px]">
                            <p className="text-[12px] font-medium text-foreground-700 truncate">{row.sessionTitle}</p>
                            <p className="text-[10px] text-foreground-400">{row.module} · {row.tutor}</p>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div>
                            <p className="text-[12px] text-foreground-600 whitespace-nowrap">{row.sessionDate}</p>
                            <p className="text-[10px] text-foreground-400">{row.sessionTime}</p>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="max-w-[220px]">
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full mb-1 inline-block ${reasonCategoryColor[row.reasonCategory] || 'bg-foreground-100 text-foreground-700'}`}>
                              {reasonCategoryLabel[row.reasonCategory] || row.reasonCategory}
                            </span>
                            <p className="text-[11px] text-foreground-500 truncate">{row.reason}</p>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          {row.evidenceProvided ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedEvidence(row);
                              }}
                              className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-primary-700 bg-primary-50 border border-primary-200 px-2.5 py-1.5 rounded-lg hover:bg-primary-100 hover:border-primary-300 transition-smooth cursor-pointer whitespace-nowrap"
                              aria-label={`View ${evidenceActionLabel(row)} evidence for ${row.learner}`}
                            >
                              <AppIcon className={`${isImageEvidence(row) ? 'ri-image-line' : row.evidenceImageUrl ? 'ri-attachment-2' : 'ri-file-text-line'} text-[12px]`}></AppIcon>
                              View {evidenceActionLabel(row)}
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-foreground-400 bg-foreground-50 px-2 py-0.5 rounded-full">
                              <AppIcon className="ri-close-line text-[9px]"></AppIcon>
                              None
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`text-[12px] font-semibold ${row.previousAbsences >= 5 ? 'text-red-600' : row.previousAbsences >= 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {row.previousAbsences}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <div className="w-10 h-1.5 rounded-full bg-background-200">
                              <div className={`h-full rounded-full ${row.attendanceRate >= 90 ? 'bg-emerald-500' : row.attendanceRate >= 80 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${row.attendanceRate}%` }}></div>
                            </div>
                            <span className={`text-[11px] font-semibold ${row.attendanceRate >= 90 ? 'text-emerald-600' : row.attendanceRate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{row.attendanceRate}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusBadgeClass(row.status)}`}>
                            {statusLabel(row.status)}
                          </span>
                        </td>
                        <td className="pr-4 pl-3 py-3 text-center">
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            {isPendingReport(row) && (
                              <>
                                <button
                                  onClick={() => {
                                    setCoachNoteText('');
                                    setSendNotification(true);
                                    setActionModal({ type: 'approve', reportId: row.id });
                                  }}
                                  className="px-2.5 py-1.5 bg-emerald-500 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1"
                                >
                                  <AppIcon className="ri-check-line text-[11px]"></AppIcon> Approve
                                </button>
                                <button
                                  onClick={() => {
                                    setCoachNoteText('');
                                    setSendNotification(true);
                                    setActionModal({ type: 'decline', reportId: row.id });
                                  }}
                                  className="px-2.5 py-1.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-[10px] font-semibold hover:bg-red-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1"
                                >
                                  <AppIcon className="ri-close-line text-[11px]"></AppIcon> Decline
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => setSelectedReportId(row.id)}
                              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${isSel ? 'bg-primary-100 text-primary-600' : 'bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200'}`}
                            >
                              <AppIcon className="ri-eye-line text-xs"></AppIcon>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {filteredData.length > 0 && (
            <div className="flex flex-col items-center justify-between gap-3 border-t border-foreground-100 bg-[#faf9fc] px-4 py-3 sm:flex-row">
              <div className="flex items-center gap-2 text-[11px] text-foreground-400">
                <span>Showing {filteredData.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0}–{Math.min(currentPage * itemsPerPage, filteredData.length)} of {filteredData.length} reports</span>
                <span className="text-foreground-300">|</span>
                <span>Page {currentPage} of {totalPages}</span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={itemsPerPage}
                  onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                  className="px-2 py-1 bg-background-100 border border-foreground-200 rounded-lg text-[11px] text-foreground-700 cursor-pointer focus:outline-none"
                >
                  <option value={5}>5</option>
                  <option value={8}>8</option>
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                </select>
                <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                  <AppIcon className="ri-skip-back-line"></AppIcon>
                </button>
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                  <AppIcon className="ri-arrow-left-s-line"></AppIcon>
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) { pageNum = i + 1; }
                    else if (currentPage <= 3) { pageNum = i + 1; }
                    else if (currentPage >= totalPages - 2) { pageNum = totalPages - 4 + i; }
                    else { pageNum = currentPage - 2 + i; }
                    return (
                      <button key={pageNum} onClick={() => setCurrentPage(pageNum)} className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-semibold transition-smooth cursor-pointer ${currentPage === pageNum ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200'}`}>
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                  <AppIcon className="ri-arrow-right-s-line"></AppIcon>
                </button>
                <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                  <AppIcon className="ri-skip-forward-line"></AppIcon>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══════ Right Slide Panel — View Report Details ═══════ */}
      <RightSlidePanel
        isOpen={selectedReport !== null}
        onClose={() => setSelectedReportId(null)}
        title="Absence Report Details"
        width="w-[560px]"
      >
        {selectedReport && (
          <div className="space-y-5">
            {/* Header */}
            <div className="flex items-start gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ring-3 ${selectedReport.attendanceRate >= 90 ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : selectedReport.attendanceRate >= 80 ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-red-100 text-red-700 ring-red-200'}`}>
                <span className="text-lg font-bold">{selectedReport.initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-heading font-bold text-foreground-900">{selectedReport.learner}</h3>
                <p className="text-[11px] text-foreground-400">{selectedReport.programme}</p>
                <p className="text-[11px] text-foreground-300">{selectedReport.cohort} · Tutor: {selectedReport.tutor}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusBadgeClass(selectedReport.status)}`}>
                    {statusLabel(selectedReport.status)}
                  </span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${reasonCategoryColor[selectedReport.reasonCategory]}`}>
                    {reasonCategoryLabel[selectedReport.reasonCategory]}
                  </span>
                </div>
              </div>
            </div>

            {/* Session Info Card */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 space-y-3">
              <h4 className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider flex items-center gap-1.5">
                <AppIcon className="ri-calendar-event-line text-xs"></AppIcon> Missed Session
              </h4>
              <div className="space-y-2">
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground-400">Session</span>
                  <span className="text-foreground-900 font-medium text-right">{selectedReport.sessionTitle}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground-400">Module</span>
                  <span className="text-foreground-900 font-medium">{selectedReport.module}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground-400">Date & Time</span>
                  <span className="text-foreground-900 font-medium">{selectedReport.sessionDate} · {selectedReport.sessionTime}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground-400">Tutor</span>
                  <span className="text-foreground-900 font-medium">{selectedReport.tutor}</span>
                </div>
              </div>
            </div>

            {/* Reason & Evidence */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 space-y-3">
              <h4 className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider flex items-center gap-1.5">
                <AppIcon className="ri-file-text-line text-xs"></AppIcon> Reason & Evidence
              </h4>
              <div className="space-y-2">
                <div>
                  <p className="text-[10px] text-foreground-400 mb-1">Reason Provided</p>
                  <p className="text-[12px] text-foreground-800 leading-relaxed">{selectedReport.reason}</p>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground-400">Evidence</span>
                  <span className={selectedReport.evidenceProvided ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium'}>
                    {selectedReport.evidenceProvided ? `${selectedReport.evidenceType} — Provided` : 'No evidence submitted'}
                  </span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground-400">Reported By</span>
                  <span className="text-foreground-900 font-medium">{selectedReport.reportedBy} — {selectedReport.reportedDate}</span>
                </div>
              </div>
            </div>

            {/* Learner Stats */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 space-y-3">
              <h4 className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider flex items-center gap-1.5">
                <AppIcon className="ri-bar-chart-line text-xs"></AppIcon> Learner Attendance Stats
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background-100 rounded-lg p-3 text-center">
                  <p className={`text-xl font-heading font-bold ${selectedReport.attendanceRate >= 90 ? 'text-emerald-600' : selectedReport.attendanceRate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
                    {selectedReport.attendanceRate}%
                  </p>
                  <p className="text-[10px] text-foreground-400">Attendance Rate</p>
                </div>
                <div className="bg-background-100 rounded-lg p-3 text-center">
                  <p className={`text-xl font-heading font-bold ${selectedReport.previousAbsences >= 5 ? 'text-red-600' : selectedReport.previousAbsences >= 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {selectedReport.previousAbsences}
                  </p>
                  <p className="text-[10px] text-foreground-400">Previous Absences</p>
                </div>
              </div>
              {/* Progress bar for attendance */}
              <div>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-foreground-400">Attendance</span>
                  <span className="text-foreground-600 font-medium">{selectedReport.attendanceRate}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-background-200">
                  <div className={`h-full rounded-full transition-all duration-700 ${selectedReport.attendanceRate >= 90 ? 'bg-emerald-500' : selectedReport.attendanceRate >= 80 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${selectedReport.attendanceRate}%` }}></div>
                </div>
              </div>
            </div>

            {/* Decision History (if already decided) */}
            {!isPendingReport(selectedReport) && selectedReport.coachNotes && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 space-y-3">
                <h4 className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider flex items-center gap-1.5">
                  <AppIcon className="ri-history-line text-xs"></AppIcon> Decision History
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-foreground-400">Decision</span>
                    <span className={`font-semibold ${normalizeReportStatus(selectedReport.status) === 'approved' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {normalizeReportStatus(selectedReport.status) === 'approved' ? 'Approved' : 'Declined'}
                    </span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-foreground-400">Decided By</span>
                    <span className="text-foreground-900 font-medium">{selectedReport.decisionBy}</span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-foreground-400">Date</span>
                    <span className="text-foreground-900 font-medium">{selectedReport.decisionDate}</span>
                  </div>
                  <div className="pt-2 border-t border-foreground-200/60">
                    <p className="text-[10px] text-foreground-400 mb-1">Coach Notes</p>
                    <p className="text-[12px] text-foreground-700 leading-relaxed">{selectedReport.coachNotes}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons for pending reports */}
            {isPendingReport(selectedReport) && (
              <div className="flex flex-col gap-2 pt-2">
                <button
                  onClick={() => {
                    setSelectedReportId(null);
                    setCoachNoteText('');
                    setSendNotification(true);
                    setActionModal({ type: 'approve', reportId: selectedReport.id });
                  }}
                  className="w-full px-4 py-2.5 bg-emerald-500 text-white rounded-lg text-[13px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5"
                >
                  <AppIcon className="ri-check-line"></AppIcon> Approve Absence
                </button>
                <button
                  onClick={() => {
                    setSelectedReportId(null);
                    setCoachNoteText('');
                    setSendNotification(true);
                    setActionModal({ type: 'decline', reportId: selectedReport.id });
                  }}
                  className="w-full px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-[13px] font-semibold hover:bg-red-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5"
                >
                  <AppIcon className="ri-close-line"></AppIcon> Decline Absence
                </button>
              </div>
            )}
          </div>
        )}
      </RightSlidePanel>

      {/* ═══════ Action Confirmation Modal ═══════ */}
      {selectedEvidence && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={() => setSelectedEvidence(null)}>
          <div className="absolute inset-0 bg-black/45 backdrop-blur-sm"></div>
          <div className="relative w-full max-w-[560px] overflow-hidden rounded-2xl bg-background-50 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-foreground-100 px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
                  <AppIcon className={`${isImageEvidence(selectedEvidence) ? 'ri-image-line' : selectedEvidence.evidenceImageUrl ? 'ri-attachment-2' : 'ri-file-text-line'} text-lg`}></AppIcon>
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-foreground-900">Absence evidence</h3>
                  <p className="truncate text-[11px] text-foreground-400">{selectedEvidence.learner} · {selectedEvidence.sessionTitle}</p>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedEvidence(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 hover:text-foreground-700 cursor-pointer" aria-label="Close evidence preview">
                <AppIcon className="ri-close-line text-lg"></AppIcon>
              </button>
            </div>

            <div className="p-5">
              {isImageEvidence(selectedEvidence) ? (
                <div className="relative flex min-h-[290px] items-center justify-center overflow-hidden rounded-xl border border-foreground-200 bg-background-100">
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-foreground-400">
                    <AppIcon className="ri-image-line text-4xl"></AppIcon>
                    <span className="text-xs font-medium">Image preview unavailable</span>
                    {selectedEvidence.evidenceImageUrl && (
                      <a href={resolveEvidenceUrl(selectedEvidence.evidenceImageUrl)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary-700 hover:text-primary-800">
                        Open evidence file
                      </a>
                    )}
                  </div>
                  {selectedEvidence.evidenceImageUrl && (
                    <img
                      src={resolveEvidenceUrl(selectedEvidence.evidenceImageUrl)}
                      alt={`Evidence submitted by ${selectedEvidence.learner}`}
                      className="relative z-10 max-h-[430px] w-full object-contain bg-white"
                      onError={(event) => { event.currentTarget.style.display = 'none'; }}
                    />
                  )}
                </div>
              ) : selectedEvidence.evidenceImageUrl ? (
                <div className="rounded-xl border border-foreground-200 bg-background-100 p-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Attached file</p>
                  <a href={resolveEvidenceUrl(selectedEvidence.evidenceImageUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-[12px] font-semibold text-primary-700 hover:bg-primary-100">
                    <AppIcon className="ri-attachment-2"></AppIcon>
                    Open evidence file
                  </a>
                  {selectedEvidence.evidenceText && (
                    <p className="mt-3 whitespace-pre-wrap text-[13px] leading-6 text-foreground-800">{selectedEvidence.evidenceText}</p>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-foreground-200 bg-background-100 p-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Submitted text</p>
                  <p className="whitespace-pre-wrap text-[13px] leading-6 text-foreground-800">
                    {selectedEvidence.evidenceText || selectedEvidence.reason || 'No text was provided.'}
                  </p>
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-background-100 p-3 text-[11px]">
                <div>
                  <p className="text-foreground-400">Session date</p>
                  <p className="mt-0.5 font-semibold text-foreground-800">{selectedEvidence.sessionDate}</p>
                </div>
                <div>
                  <p className="text-foreground-400">Evidence type</p>
                  <p className="mt-0.5 font-semibold capitalize text-foreground-800">{selectedEvidence.evidenceKind || selectedEvidence.evidenceType || 'Evidence'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {actionModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" onClick={() => setActionModal(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl shadow-2xl p-6 w-full max-w-[420px] mx-4" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${actionModal.type === 'approve' ? 'bg-emerald-100' : 'bg-red-100'}`}>
                <AppIcon className={`text-lg ${actionModal.type === 'approve' ? 'ri-check-line text-emerald-600' : 'ri-close-line text-red-600'}`}></AppIcon>
              </span>
              <div>
                <h3 className="text-sm font-heading font-bold text-foreground-900">
                  {actionModal.type === 'approve' ? 'Approve Absence' : 'Decline Absence'}
                </h3>
                <p className="text-[11px] text-foreground-400">
                  {actionModal.type === 'approve' ? 'This will mark the absence as approved.' : 'This will mark the absence as declined.'}
                </p>
              </div>
            </div>

            {/* Report Summary */}
            {(() => {
              const r = reports.find(x => x.id === actionModal.reportId);
              if (!r) return null;
              return (
                <div className="bg-background-100 rounded-xl p-3 mb-4 space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-foreground-400">Learner</span>
                    <span className="text-foreground-900 font-medium">{r.learner}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-foreground-400">Session</span>
                    <span className="text-foreground-900 font-medium">{r.sessionTitle}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-foreground-400">Date</span>
                    <span className="text-foreground-900 font-medium">{r.sessionDate}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-foreground-400">Reason</span>
                    <span className="text-foreground-900 font-medium text-right max-w-[200px]">{r.reason}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-foreground-400">Evidence</span>
                    <span className={r.evidenceProvided ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium'}>
                      {r.evidenceProvided ? r.evidenceType : 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-foreground-400">Attendance</span>
                    <span className={`font-medium ${r.attendanceRate >= 90 ? 'text-emerald-600' : r.attendanceRate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{r.attendanceRate}%</span>
                  </div>
                </div>
              );
            })()}

            {/* Notification Toggle */}
            <div className="mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <div
                  onClick={() => setSendNotification(!sendNotification)}
                  className={`w-9 h-5 rounded-full flex items-center transition-all duration-200 cursor-pointer ${sendNotification ? 'bg-primary-500' : 'bg-background-300'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200 ${sendNotification ? 'translate-x-4' : 'translate-x-0.5'}`}></div>
                </div>
                <span className="text-[12px] font-medium text-foreground-700">Send notification to learner</span>
              </label>
              <p className="text-[10px] text-foreground-400 ml-11 mt-0.5">
                The learner will receive a message about your decision.
              </p>
            </div>

            {/* Coach Notes */}
            {sendNotification && (
              <div className="mb-4">
                <label className="text-[11px] font-medium text-foreground-500 mb-1 block">Message to learner (optional)</label>
                <textarea
                  value={coachNoteText}
                  onChange={(e) => setCoachNoteText(e.target.value)}
                  placeholder={`Explain why you ${actionModal.type === 'approve' ? 'approved' : 'declined'} this absence...`}
                  maxLength={500}
                  className="w-full px-3 py-2 bg-background-100 border border-foreground-200 rounded-lg text-[12px] text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 resize-none"
                  rows={3}
                />
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-foreground-400">{coachNoteText.length}/500</span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActionModal(null)}
                className="flex-1 px-4 py-2.5 bg-background-100 text-foreground-600 rounded-lg text-[12px] font-semibold hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={() => actionModal.type === 'approve' ? handleApprove(actionModal.reportId) : handleDecline(actionModal.reportId)}
                className={`flex-1 px-4 py-2.5 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap text-white ${actionModal.type === 'approve' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'}`}
              >
                {actionModal.type === 'approve' ? 'Confirm Approve' : 'Confirm Decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}

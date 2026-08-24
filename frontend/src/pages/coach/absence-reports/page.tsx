import { useEffect, useState, useMemo } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import type { AbsenceReport } from '@/mocks/absence-reports';
import { cn } from '@/lib/cn';
import { statusTone, toneStyle, type StatusTone } from '@/lib/statusTone';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { CompactMetric, MetricRow } from '@/components/ui/MetricCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ProgressMetric } from '@/components/ui/ProgressMetric';
import { EmptyState, EmptyStateAction } from '@/components/ui/EmptyState';
import { FilterToolbar, SearchInput, FilterSelect, FilterChip } from '@/components/ui/FilterToolbar';
import { Pagination } from '@/components/ui/Pagination';
import { ActionRow } from '@/components/ui/ActionRow';
import { LearnerAvatar, ReasonLine } from '@/pages/coach/shared/LearnerIdentity';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/absence-reports';
const HIGH_RISK_ABSENCE_REPORTS_LABEL = 'High-Risk Absence Reports';
const HIGH_RISK_ABSENCE_SHORT_LABEL = 'High Risk';
type ReportStatusKey = 'pending' | 'approved' | 'declined';

const REASON_ICON: Record<string, string> = {
  illness: 'ri-heart-pulse-line',
  work: 'ri-briefcase-line',
  personal: 'ri-user-line',
  'annual-leave': 'ri-plane-line',
  family: 'ri-parent-line',
  other: 'ri-question-line',
};

function normalizeReportStatus(status?: string | null): ReportStatusKey {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'approved' || value === 'declined') return value;
  return 'pending';
}

function statusLabel(status?: string | null) {
  const normalized = normalizeReportStatus(status);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isPendingReport(report: AbsenceReport) {
  return normalizeReportStatus(report.status) === 'pending';
}

/**
 * How urgent a report is to review — the same tiers as before
 * (`getRiskClasses`'s replacement), now carried as a StatusTone rather than a
 * hand-picked className so the colour matches every other risk signal in the
 * workspace.
 */
function reportPriority(report: AbsenceReport): { label: string; tone: StatusTone } {
  if (report.attendanceRate < 80 || report.previousAbsences >= 5) return { label: HIGH_RISK_ABSENCE_SHORT_LABEL, tone: 'critical' };
  if (!report.evidenceProvided || report.previousAbsences >= 3) return { label: 'Check carefully', tone: 'caution' };
  return { label: 'Standard review', tone: 'positive' };
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

function optionsFrom(values: string[]): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: value }));
}

export default function CoachAbsenceReports() {
  const { success, error } = useToast();
  const coach = useCoachIdentity();
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
  const [itemsPerPage, setItemsPerPage] = useState(12);

  useEffect(() => {
    if (!coach.isInitialized) return;
    if (!coach.email) {
      setReports([]);
      setReportsError('Coach access is required to load absence reports.');
      setLoadingReports(false);
      return;
    }
    const controller = new AbortController();
    coachFetch(API_ENDPOINT, { signal: controller.signal })
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
  }, [coach.email, coach.isInitialized]);

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
  const highPriority = reports.filter(r => isPendingReport(r) && (r.attendanceRate < 80 || r.previousAbsences >= 5)).length;

  const saveDecision = async (reportId: string, status: 'approved' | 'declined') => {
    const report = reports.find(item => item.id === reportId);
    if (!report) return;
    try {
      const response = await coachFetch(API_ENDPOINT, {
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

  /**
   * The reason category is a fact, not a risk signal, so most map to the quiet
   * tones. Illness and family emergencies lean `caution` because they are the
   * two categories most likely to need a welfare follow-up; annual leave leans
   * `positive` because it is pre-approved and needs nothing from the coach.
   */
  const reasonCategoryTone: Record<string, StatusTone> = {
    illness: 'caution',
    work: 'info',
    personal: 'neutral',
    'annual-leave': 'positive',
    family: 'caution',
    other: 'neutral',
  };

  const hasActiveFilters = Boolean(statusFilter !== 'all' || programmeFilter !== 'all' || cohortFilter !== 'all' || reportedByFilter !== 'all' || reasonFilter !== 'all' || queueFilter !== 'all' || dateFrom || dateTo || searchQuery.trim());

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

  const chips: { key: string; label: string; value: string; onRemove: () => void }[] = [];
  if (statusFilter !== 'all') chips.push({ key: 'status', label: 'Status', value: statusLabel(statusFilter), onRemove: () => { setStatusFilter('all'); setCurrentPage(1); } });
  if (programmeFilter !== 'all') chips.push({ key: 'programme', label: 'Programme', value: programmeFilter, onRemove: () => { setProgrammeFilter('all'); setCurrentPage(1); } });
  if (cohortFilter !== 'all') chips.push({ key: 'cohort', label: 'Cohort', value: cohortFilter, onRemove: () => { setCohortFilter('all'); setCurrentPage(1); } });
  if (reportedByFilter !== 'all') chips.push({ key: 'reportedBy', label: 'Reported by', value: reportedByFilter, onRemove: () => { setReportedByFilter('all'); setCurrentPage(1); } });
  if (reasonFilter !== 'all') chips.push({ key: 'reason', label: 'Reason', value: reasonCategoryLabel[reasonFilter] || reasonFilter, onRemove: () => { setReasonFilter('all'); setCurrentPage(1); } });
  if (queueFilter !== 'all') chips.push({
    key: 'queue',
    label: 'Queue',
    value: queueFilter === 'high-priority' ? HIGH_RISK_ABSENCE_REPORTS_LABEL : queueFilter === 'with-evidence' ? 'With evidence' : 'Missing evidence',
    onRemove: () => { setQueueFilter('all'); setCurrentPage(1); },
  });
  if (dateFrom || dateTo) chips.push({ key: 'date', label: 'Date', value: `${dateFrom || '…'} to ${dateTo || '…'}`, onRemove: () => { setDateFrom(''); setDateTo(''); setCurrentPage(1); } });

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Absence Reports" pageSubtitle="Review, approve or decline learner absence reports" userName={coach.name} userRole="Progress Coach">
      <PageContainer>
        <PageHeader
          title="Absence Reports"
          description="Review evidence and make clear, consistent attendance decisions."
          icon="ri-file-list-3-line"
        />

        {/* ===== Review queue snapshot ===== */}
        <MetricRow>
          <button type="button" onClick={() => { setStatusFilter('pending'); setQueueFilter('all'); setCurrentPage(1); }} className="rounded-lg p-1 text-left transition hover:bg-background-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200">
            <CompactMetric label="Needs review" value={pending} tone="caution" note="Pending decisions" />
          </button>
          <button type="button" onClick={() => { setStatusFilter('pending'); setQueueFilter('high-priority'); setCurrentPage(1); }} className="rounded-lg p-1 text-left transition hover:bg-background-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200">
            <CompactMetric label={HIGH_RISK_ABSENCE_REPORTS_LABEL} value={highPriority} tone="critical" note="Low attendance or repeat absence" />
          </button>
          <button type="button" onClick={() => { setStatusFilter('approved'); setQueueFilter('all'); setCurrentPage(1); }} className="rounded-lg p-1 text-left transition hover:bg-background-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200">
            <CompactMetric label="Approved" value={approved} tone="positive" note="Confirmed absences" />
          </button>
          <button type="button" onClick={() => { setStatusFilter('declined'); setQueueFilter('all'); setCurrentPage(1); }} className="rounded-lg p-1 text-left transition hover:bg-background-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200">
            <CompactMetric label="Declined" value={declined} tone="critical" note="Rejected requests" />
          </button>
        </MetricRow>

        {/* ===== Search + filters ===== */}
        <FilterToolbar
          search={(
            <SearchInput
              value={searchQuery}
              onChange={(value) => { setSearchQuery(value); setCurrentPage(1); }}
              placeholder="Search by learner, session, module, reason…"
            />
          )}
          filters={(
            <>
              <FilterSelect
                value={statusFilter}
                onChange={(value) => { setStatusFilter(value); setCurrentPage(1); }}
                options={[{ value: 'all', label: 'All statuses' }, { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'declined', label: 'Declined' }]}
                widthClass="w-[145px]"
                tone={statusFilter !== 'all' ? 'active' : 'default'}
              />
              <FilterSelect
                value={programmeFilter}
                onChange={(value) => { setProgrammeFilter(value); setCurrentPage(1); }}
                options={[{ value: 'all', label: 'All programmes' }, ...optionsFrom(programmes)]}
                widthClass="w-[160px]"
                tone={programmeFilter !== 'all' ? 'active' : 'default'}
              />
              <FilterSelect
                value={cohortFilter}
                onChange={(value) => { setCohortFilter(value); setCurrentPage(1); }}
                options={[{ value: 'all', label: 'All cohorts' }, ...optionsFrom(cohorts)]}
                widthClass="w-[150px]"
                tone={cohortFilter !== 'all' ? 'active' : 'default'}
              />
              <FilterSelect
                value={reportedByFilter}
                onChange={(value) => { setReportedByFilter(value); setCurrentPage(1); }}
                options={[{ value: 'all', label: 'All sources' }, ...optionsFrom(reportedByOptions)]}
                widthClass="w-[145px]"
                tone={reportedByFilter !== 'all' ? 'active' : 'default'}
              />
              <FilterSelect
                value={reasonFilter}
                onChange={(value) => { setReasonFilter(value); setCurrentPage(1); }}
                options={[{ value: 'all', label: 'All reasons' }, ...reasonCategories.map((value) => ({ value, label: reasonCategoryLabel[value] || value }))]}
                widthClass="w-[150px]"
                tone={reasonFilter !== 'all' ? 'active' : 'default'}
              />
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => { setDateFrom(event.target.value); setCurrentPage(1); }}
                  className="h-9 rounded-lg border border-foreground-200 bg-background-50 px-2.5 text-[12px] text-foreground-700 transition focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200/50"
                />
                <span className="text-[12px] text-foreground-400">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => { setDateTo(event.target.value); setCurrentPage(1); }}
                  className="h-9 rounded-lg border border-foreground-200 bg-background-50 px-2.5 text-[12px] text-foreground-700 transition focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200/50"
                />
              </div>
            </>
          )}
          trailing={hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-foreground-500 transition hover:bg-background-100 hover:text-foreground-800"
            >
              <AppIcon className="ri-close-circle-line text-[13px]"></AppIcon>
              Clear filters
            </button>
          ) : undefined}
          chips={chips.length > 0 ? (
            <>
              {chips.map((chip) => (
                <FilterChip key={chip.key} label={chip.label} value={chip.value} onRemove={chip.onRemove} />
              ))}
            </>
          ) : undefined}
        />

        {/* ===== Review queue ===== */}
        <section className="space-y-3">
          <SectionHeader
            title="Review queue"
            count={filteredData.length}
            icon="ri-list-check-3"
            description="Reports awaiting your decision are shown first, most severe on top."
          />

          {loadingReports ? (
            <RowsSkeleton rows={6} />
          ) : paginatedData.length === 0 ? (
            <EmptyState
              variant={reportsError ? 'error' : hasActiveFilters ? 'no-matches' : 'empty'}
              title={reportsError || 'No absence reports found'}
              description={reportsError ? undefined : hasActiveFilters ? 'Try adjusting your search or filters.' : 'Absence reports will appear here once learners or employers report one.'}
              action={hasActiveFilters ? <EmptyStateAction label="Clear filters" icon="ri-close-line" onClick={clearFilters} /> : undefined}
            />
          ) : (
            <div className="space-y-2">
              {paginatedData.map((row) => {
                const isSel = selectedReportId === row.id;
                const priority = reportPriority(row);
                return (
                  <ActionRow
                    key={row.id}
                    tone={priority.tone}
                    onClick={() => setSelectedReportId(isSel ? null : row.id)}
                    className={isSel ? 'ring-2 ring-primary-300' : undefined}
                    leading={<LearnerAvatar name={row.learner} tone={priority.tone} />}
                    title={(
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {row.learner}
                        <StatusBadge tone={priority.tone} label={priority.label} size="sm" />
                      </span>
                    )}
                    subtitle={`${row.programme} · ${row.cohort} · Tutor: ${row.tutor}`}
                    status={<StatusBadge tone={statusTone(normalizeReportStatus(row.status))} label={statusLabel(row.status)} size="sm" />}
                    meta={(
                      <>
                        <ReasonLine icon="ri-calendar-event-line" label={row.sessionTitle} detail={`${row.sessionDate} · ${row.sessionTime}`} />
                        <ReasonLine
                          icon={REASON_ICON[row.reasonCategory] || 'ri-question-line'}
                          label={reasonCategoryLabel[row.reasonCategory] || row.reasonCategory}
                          detail={row.reason}
                        />
                        {row.evidenceProvided ? (
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); setSelectedEvidence(row); }}
                            className="inline-flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-[12px] font-semibold text-primary-700 transition hover:border-primary-300 hover:bg-primary-100"
                            aria-label={`View ${evidenceActionLabel(row)} evidence for ${row.learner}`}
                          >
                            <AppIcon className={isImageEvidence(row) ? 'ri-image-line' : row.evidenceImageUrl ? 'ri-attachment-2' : 'ri-file-text-line'}></AppIcon>
                            View {evidenceActionLabel(row)}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-background-100 px-2 py-1 text-[12px] font-medium text-foreground-400">
                            <AppIcon className="ri-close-line"></AppIcon>
                            No evidence
                          </span>
                        )}
                        <ProgressMetric
                          label="Attendance"
                          value={`${row.attendanceRate}%`}
                          percent={row.attendanceRate}
                          note={`${row.previousAbsences} previous absence${row.previousAbsences === 1 ? '' : 's'}`}
                          noteTone={row.previousAbsences >= 5 ? 'critical' : row.previousAbsences >= 3 ? 'caution' : 'neutral'}
                          className="w-36"
                        />
                      </>
                    )}
                    actions={(
                      <div onClick={(event) => event.stopPropagation()} className="flex items-center gap-1.5">
                        {isPendingReport(row) && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setCoachNoteText('');
                                setSendNotification(true);
                                setActionModal({ type: 'approve', reportId: row.id });
                              }}
                              className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition', toneStyle('positive').bg, toneStyle('positive').text, 'hover:bg-emerald-100')}
                            >
                              <AppIcon className="ri-check-line"></AppIcon> Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCoachNoteText('');
                                setSendNotification(true);
                                setActionModal({ type: 'decline', reportId: row.id });
                              }}
                              className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold transition', toneStyle('critical').bg, toneStyle('critical').text, toneStyle('critical').border, 'hover:bg-red-100')}
                            >
                              <AppIcon className="ri-close-line"></AppIcon> Decline
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedReportId(row.id)}
                          aria-label={`View details for ${row.learner}`}
                          className={cn('flex h-9 w-9 items-center justify-center rounded-lg transition', isSel ? 'bg-primary-100 text-primary-600' : 'bg-background-100 text-foreground-500 hover:bg-background-200 hover:text-foreground-700')}
                        >
                          <AppIcon className="ri-eye-line"></AppIcon>
                        </button>
                      </div>
                    )}
                  />
                );
              })}
            </div>
          )}

          {!loadingReports && filteredData.length > 0 ? (
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              total={filteredData.length}
              pageSize={itemsPerPage}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => { setItemsPerPage(size); setCurrentPage(1); }}
              noun="reports"
            />
          ) : null}
        </section>
      </PageContainer>

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
              <LearnerAvatar name={selectedReport.learner} tone={reportPriority(selectedReport).tone} size="lg" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-heading font-bold text-foreground-900">{selectedReport.learner}</h3>
                <p className="text-[12px] text-foreground-400">{selectedReport.programme}</p>
                <p className="text-[12px] text-foreground-300">{selectedReport.cohort} · Tutor: {selectedReport.tutor}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <StatusBadge tone={statusTone(normalizeReportStatus(selectedReport.status))} label={statusLabel(selectedReport.status)} size="sm" />
                  <StatusBadge tone={reasonCategoryTone[selectedReport.reasonCategory] || 'neutral'} label={reasonCategoryLabel[selectedReport.reasonCategory]} size="sm" />
                </div>
              </div>
            </div>

            {/* Session Info Card */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 space-y-3">
              <h4 className="text-[12px] font-semibold text-foreground-500 uppercase tracking-wider flex items-center gap-1.5">
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
              <h4 className="text-[12px] font-semibold text-foreground-500 uppercase tracking-wider flex items-center gap-1.5">
                <AppIcon className="ri-file-text-line text-xs"></AppIcon> Reason & Evidence
              </h4>
              <div className="space-y-2">
                <div>
                  <p className="text-[12px] text-foreground-400 mb-1">Reason Provided</p>
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
              <h4 className="text-[12px] font-semibold text-foreground-500 uppercase tracking-wider flex items-center gap-1.5">
                <AppIcon className="ri-bar-chart-line text-xs"></AppIcon> Learner Attendance Stats
              </h4>
              <ProgressMetric
                value={`${selectedReport.attendanceRate}%`}
                percent={selectedReport.attendanceRate}
                note={`${selectedReport.previousAbsences} previous absence${selectedReport.previousAbsences === 1 ? '' : 's'}`}
                noteTone={selectedReport.previousAbsences >= 5 ? 'critical' : selectedReport.previousAbsences >= 3 ? 'caution' : 'neutral'}
              />
            </div>

            {/* Decision History (if already decided) */}
            {!isPendingReport(selectedReport) && selectedReport.coachNotes && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 space-y-3">
                <h4 className="text-[12px] font-semibold text-foreground-500 uppercase tracking-wider flex items-center gap-1.5">
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
                    <p className="text-[12px] text-foreground-400 mb-1">Coach Notes</p>
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

      {/* ═══════ Evidence Preview Modal ═══════ */}
      {selectedEvidence && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={() => setSelectedEvidence(null)}>
          <div className="absolute inset-0 bg-black/45 backdrop-blur-sm"></div>
          <div className="relative w-full max-w-[560px] overflow-hidden rounded-2xl bg-background-50 shadow-sm" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-foreground-100 px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
                  <AppIcon className={`${isImageEvidence(selectedEvidence) ? 'ri-image-line' : selectedEvidence.evidenceImageUrl ? 'ri-attachment-2' : 'ri-file-text-line'} text-lg`}></AppIcon>
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-foreground-900">Absence evidence</h3>
                  <p className="truncate text-[12px] text-foreground-400">{selectedEvidence.learner} · {selectedEvidence.sessionTitle}</p>
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
                      className="relative z-10 max-h-[430px] w-full object-contain bg-background-50"
                      onError={(event) => { event.currentTarget.style.display = 'none'; }}
                    />
                  )}
                </div>
              ) : selectedEvidence.evidenceImageUrl ? (
                <div className="rounded-xl border border-foreground-200 bg-background-100 p-4">
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-foreground-400">Attached file</p>
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
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-foreground-400">Submitted text</p>
                  <p className="whitespace-pre-wrap text-[13px] leading-6 text-foreground-800">
                    {selectedEvidence.evidenceText || selectedEvidence.reason || 'No text was provided.'}
                  </p>
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-background-100 p-3 text-[12px]">
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

      {/* ═══════ Action Confirmation Modal ═══════ */}
      {actionModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" onClick={() => setActionModal(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl shadow-sm p-6 w-full max-w-[420px] mx-4" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${actionModal.type === 'approve' ? 'bg-emerald-100' : 'bg-red-100'}`}>
                <AppIcon className={`text-lg ${actionModal.type === 'approve' ? 'ri-check-line text-emerald-600' : 'ri-close-line text-red-600'}`}></AppIcon>
              </span>
              <div>
                <h3 className="text-sm font-heading font-bold text-foreground-900">
                  {actionModal.type === 'approve' ? 'Approve Absence' : 'Decline Absence'}
                </h3>
                <p className="text-[12px] text-foreground-400">
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
                  <div className="flex justify-between text-[12px]">
                    <span className="text-foreground-400">Learner</span>
                    <span className="text-foreground-900 font-medium">{r.learner}</span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-foreground-400">Session</span>
                    <span className="text-foreground-900 font-medium">{r.sessionTitle}</span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-foreground-400">Date</span>
                    <span className="text-foreground-900 font-medium">{r.sessionDate}</span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-foreground-400">Reason</span>
                    <span className="text-foreground-900 font-medium text-right max-w-[200px]">{r.reason}</span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-foreground-400">Evidence</span>
                    <span className={r.evidenceProvided ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium'}>
                      {r.evidenceProvided ? r.evidenceType : 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between text-[12px]">
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
                  <div className={`w-4 h-4 rounded-full bg-background-50 shadow-sm transition-all duration-200 ${sendNotification ? 'translate-x-4' : 'translate-x-0.5'}`}></div>
                </div>
                <span className="text-[12px] font-medium text-foreground-700">Send notification to learner</span>
              </label>
              <p className="text-[12px] text-foreground-400 ml-11 mt-0.5">
                The learner will receive a message about your decision.
              </p>
            </div>

            {/* Coach Notes */}
            {sendNotification && (
              <div className="mb-4">
                <label className="text-[12px] font-medium text-foreground-500 mb-1 block">Message to learner (optional)</label>
                <textarea
                  value={coachNoteText}
                  onChange={(e) => setCoachNoteText(e.target.value)}
                  placeholder={`Explain why you ${actionModal.type === 'approve' ? 'approved' : 'declined'} this absence...`}
                  maxLength={500}
                  className="w-full px-3 py-2 bg-background-100 border border-foreground-200 rounded-lg text-[12px] text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 resize-none"
                  rows={3}
                />
                <div className="flex justify-between mt-1">
                  <span className="text-[12px] text-foreground-400">{coachNoteText.length}/500</span>
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

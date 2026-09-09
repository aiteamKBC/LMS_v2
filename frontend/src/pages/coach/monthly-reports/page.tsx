// ============================================================================
// Coach — learners' end-of-month reports.
//
// Read-only. A monthly report is the learner's own signed declaration about
// their month; the coach reads it here alongside the marking queue, and there
// is nothing in it awaiting a decision, so there is no accept/reject.
//
// The table is deliberately light: the signature and the full activity record
// are fetched only when a coach opens one report, because a caseload's worth of
// either would be megabytes of JSON for columns that show neither.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { EmptyState, EmptyStateAction } from '@/components/ui/EmptyState';
import { MetricCard } from '@/components/ui/MetricCard';
import { LearnerIdentity } from '@/pages/coach/shared/LearnerIdentity';
import {
  fetchCoachMonthlyReport,
  fetchCoachMonthlyReports,
  type CoachMonthlyReportSummary,
  type CoachMonthlyReportsResponse,
} from '@/api/coachMonthlyReports';
import type { MonthlyReport, MonthlyReportAttachment } from '@/api/monthlyReports';
import { canOpenAttachment, openMonthlyReportAttachment } from '@/lib/monthlyReportAttachments';
import { downloadMonthlyReportPdf } from '@/lib/monthlyReportPdf';

const coachNav = roleNavMap.coach;

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CoachMonthlyReportsPage() {
  const coach = useCoachIdentity();
  const [data, setData] = useState<CoachMonthlyReportsResponse>({ items: [], months: [], learners: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [month, setMonth] = useState('');
  const [learner, setLearner] = useState('');
  const [search, setSearch] = useState('');

  const [openReport, setOpenReport] = useState<MonthlyReport | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState('');
  const [buildingPdfId, setBuildingPdfId] = useState<string | null>(null);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!coach.isInitialized) return;
    setLoading(true);
    setError('');
    if (!coach.hasCoachAccess) {
      setData({ items: [], months: [], learners: [] });
      setError('Coach access is required to read monthly reports.');
      setLoading(false);
      return;
    }
    try {
      setData(await fetchCoachMonthlyReports({ month, learner, search }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the monthly reports.');
    } finally {
      setLoading(false);
    }
  }, [coach.isInitialized, coach.hasCoachAccess, month, learner, search]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Fetch the full report — the table row does not carry the signature or the
   *  activity record. Used by both the drawer and the PDF download. */
  const loadFull = async (row: CoachMonthlyReportSummary) => {
    setDetailError('');
    return fetchCoachMonthlyReport(row.id);
  };

  const view = async (row: CoachMonthlyReportSummary) => {
    if (openingId) return;
    setOpeningId(row.id);
    try {
      setOpenReport(await loadFull(row));
    } catch (viewError) {
      setDetailError(viewError instanceof Error ? viewError.message : 'Could not open the report.');
    } finally {
      setOpeningId(null);
    }
  };

  const download = async (row: CoachMonthlyReportSummary) => {
    if (buildingPdfId) return;
    setBuildingPdfId(row.id);
    setDetailError('');
    try {
      const full = await loadFull(row);
      // The learner identity comes from the report, not from the page: the
      // attachments are read through the learner's own evidence route, which a
      // coach reaches as staff.
      await downloadMonthlyReportPdf(full, {
        learnerKind: full.learnerKind,
        learnerId: full.learnerId,
      });
    } catch (downloadError) {
      setDetailError(downloadError instanceof Error ? downloadError.message : 'Could not build the report.');
    } finally {
      setBuildingPdfId(null);
    }
  };

  const openAttachment = async (report: MonthlyReport, attachment: MonthlyReportAttachment) => {
    if (openingAttachmentId) return;
    setOpeningAttachmentId(attachment.id);
    setDetailError('');
    try {
      await openMonthlyReportAttachment(report.learnerKind, report.learnerId, attachment);
    } catch (openError) {
      setDetailError(openError instanceof Error ? openError.message : 'That document could not be opened.');
    } finally {
      setOpeningAttachmentId(null);
    }
  };

  const metrics = useMemo(() => {
    const learners = new Set(data.items.map((item) => item.learnerId));
    const documents = data.items.reduce((total, item) => total + item.attachments.length, 0);
    const unsigned = data.items.filter((item) => !item.signed).length;
    return [
      { label: 'Reports submitted', value: data.items.length, icon: 'ri-file-list-3-line', tone: 'brand' as const },
      { label: 'Learners reporting', value: learners.size, icon: 'ri-team-line', tone: 'positive' as const },
      { label: 'Documents attached', value: documents, icon: 'ri-attachment-2', tone: 'neutral' as const },
      { label: 'Unsigned', value: unsigned, icon: 'ri-error-warning-line', tone: unsigned ? ('critical' as const) : ('neutral' as const) },
    ];
  }, [data.items]);

  const columns: DataColumn<CoachMonthlyReportSummary>[] = [
    {
      key: 'learner',
      label: 'Learner',
      widthClass: 'w-[250px] min-w-[210px]',
      render: (row) => (
        <LearnerIdentity name={row.learnerName || 'Learner'} programme={row.programmeName || undefined} size="sm" />
      ),
    },
    {
      key: 'month',
      label: 'Month',
      widthClass: 'w-[140px]',
      render: (row) => (
        <span className="text-sm font-semibold text-foreground-900">{row.monthLabel || row.monthKey}</span>
      ),
    },
    {
      key: 'submitted',
      label: 'Submitted',
      widthClass: 'w-[130px]',
      render: (row) => <span className="text-sm text-foreground-600">{formatDate(row.submittedAt)}</span>,
    },
    {
      key: 'activity',
      label: 'Activity',
      align: 'center',
      widthClass: 'w-[110px]',
      render: (row) => (
        <span className="text-sm text-foreground-700">
          {row.activityCount} {row.activityCount === 1 ? 'event' : 'events'}
        </span>
      ),
    },
    {
      key: 'ksbs',
      label: 'KSBs claimed',
      align: 'center',
      widthClass: 'w-[120px]',
      render: (row) => (
        <span className="inline-flex min-w-7 justify-center rounded-md bg-secondary-50 px-2 py-0.5 text-sm font-semibold text-secondary-700">
          {row.selectedKsbs.length}
        </span>
      ),
    },
    {
      key: 'documents',
      label: 'Documents',
      align: 'center',
      widthClass: 'w-[120px]',
      render: (row) => (
        <span className={`text-sm font-semibold ${row.attachments.length ? 'text-primary-700' : 'text-foreground-400'}`}>
          {row.attachments.length}
        </span>
      ),
    },
    {
      key: 'signed',
      label: 'Signed',
      align: 'center',
      widthClass: 'w-[110px]',
      render: (row) => (row.signed ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
          <AppIcon className="ri-check-line"></AppIcon>Signed
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">
          <AppIcon className="ri-error-warning-line"></AppIcon>No
        </span>
      )),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      widthClass: 'w-[190px]',
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => void view(row)}
            disabled={openingId === row.id}
            className="inline-flex items-center gap-1 rounded-lg border border-foreground-200 bg-background-50 px-2.5 py-1.5 text-xs font-semibold text-foreground-700 transition hover:border-primary-300 hover:text-primary-700 disabled:opacity-50"
          >
            <AppIcon className={openingId === row.id ? 'ri-loader-4-line animate-spin' : 'ri-eye-line'}></AppIcon>
            View
          </button>
          <button
            type="button"
            onClick={() => void download(row)}
            disabled={buildingPdfId === row.id}
            title={row.attachments.length ? 'Includes the attached documents' : undefined}
            className="inline-flex items-center gap-1 rounded-lg bg-primary-900 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-800 disabled:opacity-50"
          >
            <AppIcon className={buildingPdfId === row.id ? 'ri-loader-4-line animate-spin' : 'ri-download-2-line'}></AppIcon>
            {buildingPdfId === row.id ? 'Building…' : 'PDF'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Monthly Reports"
      pageSubtitle="What each learner recorded and signed off at the end of the month"
      userName={coach.name}
      userRole="Progress Coach"
    >
      <PageContainer>
        <PageHeader
          icon="ri-file-list-3-line"
          title="End-of-month reports"
          description="Every monthly report your learners have submitted — what they did, the KSBs they claimed, the documents they attached, and their signature."
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
        </div>

        {/* ── Filters ── */}
        <div className="mt-5 flex flex-col gap-3 rounded-xl border border-foreground-200/70 bg-background-50 p-3 lg:flex-row lg:items-center">
          <label className="relative block flex-1">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"></AppIcon>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search a learner or what they wrote…"
              className="h-10 w-full rounded-lg border border-foreground-200 bg-background-50 pl-9 pr-3 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100"
            />
          </label>
          <select
            value={learner}
            onChange={(event) => setLearner(event.target.value)}
            aria-label="Filter by learner"
            className="h-10 rounded-lg border border-foreground-200 bg-background-50 px-3 text-sm outline-none focus:border-primary-400 lg:w-56"
          >
            <option value="">All learners</option>
            {data.learners.map((option) => (
              <option key={option.learnerId} value={option.learnerId}>
                {option.learnerName || `Learner ${option.learnerId}`}
              </option>
            ))}
          </select>
          <select
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            aria-label="Filter by month"
            className="h-10 rounded-lg border border-foreground-200 bg-background-50 px-3 text-sm outline-none focus:border-primary-400 lg:w-48"
          >
            <option value="">All months</option>
            {data.months.map((option) => (
              <option key={option.monthKey} value={option.monthKey}>
                {option.monthLabel || option.monthKey}
              </option>
            ))}
          </select>
        </div>

        {detailError && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            <AppIcon className="ri-error-warning-line mr-1.5"></AppIcon>{detailError}
          </p>
        )}

        {error ? (
          <div className="mt-5">
            <EmptyState
              variant="error"
              title="Unable to load the monthly reports"
              description={error}
              action={<EmptyStateAction label="Retry" icon="ri-refresh-line" onClick={() => void load()} />}
            />
          </div>
        ) : (
          <div className="mt-5">
            <DataTable
              columns={columns}
              rows={data.items}
              rowKey={(row) => row.id}
              loading={loading}
              minWidthClass="min-w-[1100px]"
              caption="Monthly reports submitted by your learners"
              empty={
                <EmptyState
                  variant="empty"
                  icon="ri-file-list-3-line"
                  title={month || learner || search ? 'No reports match those filters' : 'No monthly reports yet'}
                  description={
                    month || learner || search
                      ? 'Try another learner, month or search term.'
                      : 'A report appears here once a learner completes the monthly report wizard on their monthly activity page.'
                  }
                />
              }
            />
          </div>
        )}
      </PageContainer>

      {/* ── One report in full ── */}
      <RightSlidePanel
        isOpen={Boolean(openReport)}
        onClose={() => setOpenReport(null)}
        title={openReport ? `${openReport.learnerName || 'Learner'} · ${openReport.monthLabel || openReport.monthKey}` : ''}
        width="w-[560px]"
      >
        {openReport && (
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Total events', String(openReport.summaryMetrics.totalEvents ?? openReport.activitySnapshot.length)],
                ['Active days', String(openReport.summaryMetrics.activeDays ?? 0)],
                ['Time logged', openReport.summaryMetrics.loggedLabel || '0m'],
                ['KSBs evidenced', String(openReport.summaryMetrics.ksbCount ?? 0)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-foreground-200/70 bg-background-50 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-foreground-400">{label}</p>
                  <p className="mt-0.5 text-lg font-bold text-foreground-900">{value}</p>
                </div>
              ))}
            </div>

            <section>
              <h4 className="text-xs font-bold uppercase tracking-wide text-foreground-400">What the learner wrote</h4>
              <p className="mt-2 whitespace-pre-wrap rounded-xl border border-foreground-200/70 bg-background-50 p-3 text-sm leading-6 text-foreground-800">
                {openReport.learnedSummary || '—'}
              </p>
            </section>

            <section>
              <h4 className="text-xs font-bold uppercase tracking-wide text-foreground-400">
                KSBs claimed ({openReport.selectedKsbs.length})
              </h4>
              {openReport.selectedKsbs.length === 0 ? (
                <p className="mt-2 text-sm text-foreground-500">None selected.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {openReport.selectedKsbs.map((ksb) => (
                    <span
                      key={ksb.code}
                      title={ksb.description || undefined}
                      className="rounded-md border border-secondary-200 bg-secondary-50 px-2 py-0.5 text-xs font-semibold text-secondary-700"
                    >
                      {ksb.code}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="text-xs font-bold uppercase tracking-wide text-foreground-400">
                Documents ({openReport.attachments.length})
              </h4>
              {openReport.attachments.length === 0 ? (
                <p className="mt-2 text-sm text-foreground-500">Nothing attached.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {openReport.attachments.map((attachment) => {
                    const openable = canOpenAttachment(attachment);
                    return (
                      <li
                        key={attachment.id}
                        className="flex items-center gap-3 rounded-xl border border-foreground-200/70 bg-background-50 px-3 py-2.5"
                      >
                        <AppIcon className="ri-file-line shrink-0 text-foreground-500"></AppIcon>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-foreground-800">{attachment.filename}</span>
                          <span className="text-[11px] text-foreground-400">
                            {openable ? formatBytes(attachment.sizeBytes) || 'Ready to view' : 'Security scan in progress'}
                          </span>
                        </span>
                        {openable && (
                          <button
                            type="button"
                            onClick={() => void openAttachment(openReport, attachment)}
                            disabled={openingAttachmentId === attachment.id}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-background-100 px-2 py-1 text-[11px] font-bold text-primary-700 hover:bg-background-200 disabled:opacity-50"
                          >
                            <AppIcon className={openingAttachmentId === attachment.id ? 'ri-loader-4-line animate-spin' : 'ri-external-link-line'}></AppIcon>
                            Open
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <h4 className="text-xs font-bold uppercase tracking-wide text-foreground-400">Signed by the learner</h4>
              <div className="mt-2 rounded-xl border border-foreground-200/70 bg-background-50 p-3">
                {openReport.signature ? (
                  <img
                    src={openReport.signature}
                    alt={`Signature of ${openReport.signedName || openReport.learnerName || 'the learner'}`}
                    className="max-h-20 w-auto max-w-full object-contain"
                  />
                ) : (
                  <p className="text-sm text-amber-700">
                    <AppIcon className="ri-error-warning-line mr-1"></AppIcon>This report carries no signature.
                  </p>
                )}
                <p className="mt-2 border-t border-background-200 pt-2 text-[11px] text-foreground-500">
                  {openReport.signedName || openReport.learnerName || '—'}
                  {openReport.signedAt ? ` · ${formatDate(openReport.signedAt)}` : ''}
                </p>
              </div>
            </section>

            <section>
              <h4 className="text-xs font-bold uppercase tracking-wide text-foreground-400">
                Activity record ({openReport.activitySnapshot.length})
              </h4>
              {openReport.activitySnapshot.length === 0 ? (
                <p className="mt-2 text-sm text-foreground-500">Nothing was recorded for this month.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {[...openReport.activitySnapshot]
                    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                    .map((activity, index) => (
                      <li key={`${activity.at}-${index}`} className="rounded-xl border border-foreground-200/70 bg-background-50 p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-primary-700">{activity.type}</span>
                          <span className="text-[11px] text-foreground-400">{formatDate(activity.at)}</span>
                        </div>
                        <p className="mt-0.5 text-sm font-semibold text-foreground-900">{activity.title}</p>
                        {activity.detail && <p className="text-xs text-foreground-500">{activity.detail}</p>}
                      </li>
                    ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </RightSlidePanel>
    </WorkspaceShell>
  );
}

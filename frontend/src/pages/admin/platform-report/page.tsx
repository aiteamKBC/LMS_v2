// ============================================================================
// Platform report — every headline figure in one place, with its source named
//
// The screen this replaces generated PDF "reports" from fixtures, including
// funding and Ofsted-readiness figures this platform has no data for. This one
// reports what the database holds and names the table each number came from, so
// a figure can be checked rather than trusted.
//
// Export is CSV built in the browser from the response already on screen —
// there is no report-generation service behind this, and pretending otherwise
// is what got the old page into trouble.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { AdminPage, DataPanel, SourceNote } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import {
  fetchPlatformOverview, fetchReportDrill,
  type PlatformOverview, type ReportDrill,
} from '@/api/platformAdmin';

/** `metric` is the drill key (backend DRILL_METRICS). A row without one is not
 *  clickable — better than opening a panel that cannot explain itself. */
interface Row { label: string; value: number | string; source: string; metric?: string }
interface Section { title: string; icon: string; available: boolean; rows: Row[]; note?: string }

function buildSections(o: PlatformOverview): Section[] {
  return [
    {
      title: 'Sign-in accounts',
      icon: 'ri-shield-user-line',
      available: o.accounts.available,
      rows: [
        { label: 'Total accounts', value: o.accounts.total, source: 'login."Login_accounts"', metric: 'accounts.total' },
        { label: 'Able to sign in', value: o.accounts.active, source: 'Is_active and password set', metric: 'accounts.active' },
        { label: 'Awaiting first sign-in', value: o.accounts.neverSignedIn, source: 'Password_hash empty', metric: 'accounts.neverSignedIn' },
        { label: 'Suspended', value: o.accounts.suspended, source: 'Is_active = false', metric: 'accounts.suspended' },
        { label: 'Locked out', value: o.accounts.locked, source: 'Locked_until in the future', metric: 'accounts.locked' },
        { label: 'Signed in within 30 days', value: o.accounts.activeLast30d, source: 'Last_login_at', metric: 'accounts.activeLast30d' },
        { label: 'Live sessions', value: o.accounts.liveSessions, source: 'login."Login_sessions"', metric: 'accounts.liveSessions' },
        { label: 'Admins', value: o.accounts.byRole.admin, source: 'Role = admin', metric: 'accounts.byRole.admin' },
        { label: 'Staff', value: o.accounts.byRole.staff, source: 'Role = staff', metric: 'accounts.byRole.staff' },
        { label: 'Employer accounts', value: o.accounts.byRole.employer, source: 'Role = employer', metric: 'accounts.byRole.employer' },
        { label: 'Learner accounts', value: o.accounts.byRole.learner, source: 'Role = learner', metric: 'accounts.byRole.learner' },
      ],
    },
    {
      title: 'Authentication activity',
      icon: 'ri-door-lock-line',
      available: o.authActivity.available,
      rows: [
        { label: 'Sign-ins (24h)', value: o.authActivity.signIns24h, source: 'login."Login_audit"', metric: 'authActivity.signIns24h' },
        { label: 'Failed sign-ins (24h)', value: o.authActivity.failedSignIns24h, source: 'login."Login_audit"', metric: 'authActivity.failedSignIns24h' },
        { label: 'Distinct users (7d)', value: o.authActivity.distinctSignIns7d, source: 'login."Login_audit"', metric: 'authActivity.distinctSignIns7d' },
        { label: 'All audit events (24h)', value: o.authActivity.events24h, source: 'login."Login_audit"', metric: 'authActivity.events24h' },
      ],
    },
    {
      title: 'Invitations',
      icon: 'ri-mail-send-line',
      available: true,
      rows: [
        { label: 'Pending', value: o.invitations.pending, source: 'login."Invitations"', metric: 'invitations.pending' },
        { label: 'Expired unused', value: o.invitations.expired, source: 'login."Invitations"', metric: 'invitations.expired' },
        { label: 'Failed to send', value: o.invitations.failed, source: 'Send_error is set', metric: 'invitations.failed' },
      ],
    },
    {
      title: 'People',
      icon: 'ri-group-line',
      available: o.people.available,
      note: 'People exist whether or not they have been invited to sign in, so these exceed the account counts above.',
      rows: [
        { label: 'Learners', value: o.people.learners, source: 'enrolment."Created_users"', metric: 'people.learners' },
        { label: '— apprenticeship', value: o.people.apprenticeship, source: 'Learner_type', metric: 'people.apprenticeship' },
        { label: '— commercial', value: o.people.commercial, source: 'Learner_type', metric: 'people.commercial' },
        { label: 'Marked active', value: o.people.learnersActive, source: 'Status column', metric: 'people.learnersActive' },
        { label: 'Staff', value: o.people.staff, source: 'enrolment."Staff_users"', metric: 'people.staff' },
        { label: 'Employers', value: o.people.employers, source: 'enrolment."Employers"', metric: 'people.employers' },
        { label: 'Organisations', value: o.people.organisations, source: 'enrolment."Organisations"', metric: 'people.organisations' },
      ],
    },
    {
      title: 'Curriculum',
      icon: 'ri-stack-line',
      available: o.curriculum.available,
      rows: [
        { label: 'Programmes', value: o.curriculum.programmes, source: 'curriculum.programmes', metric: 'curriculum.programmes' },
        { label: 'Cohorts', value: o.curriculum.cohorts, source: 'curriculum.cohorts', metric: 'curriculum.cohorts' },
        { label: 'Modules authored', value: o.curriculum.modules, source: 'curriculum.modules', metric: 'curriculum.modules' },
      ],
    },
    {
      title: 'Documents',
      icon: 'ri-folder-line',
      available: o.documents.available,
      rows: [
        { label: 'Stored documents', value: o.documents.total, source: 'enrolment."Enrolment_Documents"', metric: 'documents.total' },
        { label: 'Fully signed', value: o.documents.signed, source: 'Signed column', metric: 'documents.signed' },
        { label: 'Distinct types', value: o.documents.docTypes, source: 'Doc_type', metric: 'documents.docTypes' },
        { label: 'Generated in last 30 days', value: o.documents.last30d, source: 'Generated_at', metric: 'documents.last30d' },
      ],
    },
    {
      title: 'Delivery',
      icon: 'ri-graduation-cap-line',
      available: o.delivery.available,
      rows: [
        { label: 'Active learners', value: o.delivery.activeLearners, source: 'Learner."Active_users"', metric: 'delivery.activeLearners' },
        { label: 'Archived learners', value: o.delivery.inactiveLearners, source: 'Learner."Unactive_users"', metric: 'delivery.inactiveLearners' },
      ],
    },
  ];
}

/** A cell of drilled data. Nulls are shown as an em-dash rather than blank, so
 *  "no value stored" is distinguishable from a rendering gap. */
function Cell({ value }: { value: string | number | boolean | null }) {
  if (value === null || value === '') return <span className="text-foreground-300">—</span>;
  if (typeof value === 'boolean') {
    return (
      <span className={value ? 'text-emerald-600 font-semibold' : 'text-foreground-400'}>
        {value ? 'true' : 'false'}
      </span>
    );
  }
  const text = String(value);
  // ISO timestamps are the common case here and unreadable at full precision.
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const when = new Date(text);
    if (!Number.isNaN(when.getTime())) {
      return (
        <span title={text} className="whitespace-nowrap">
          {when.toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </span>
      );
    }
  }
  return <span>{text}</span>;
}

/** The records behind one figure, with the SQL that produced it.
 *
 * Shown as a panel over the report rather than a separate route: the question
 * being answered is "where did *that* number come from", and losing the report
 * to answer it makes the two harder to compare. */
function DrillPanel({ metric, label, onClose }: {
  metric: string; label: string; onClose: () => void;
}) {
  const [drill, setDrill] = useState<ReportDrill | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDrill(null);
    setError(null);
    fetchReportDrill(metric)
      .then(result => { if (!cancelled) setDrill(result); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load.'); });
    return () => { cancelled = true; };
  }, [metric]);

  // Escape closes, and the body must not scroll behind the panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground-950/40 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl border border-foreground-200/60 bg-white shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-foreground-200/60 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">
              Where this number comes from
            </p>
            <h2 className="mt-1 font-heading text-lg font-bold text-foreground-900">{label}</h2>
            {drill && (
              <p className="mt-1 font-mono text-[11px] text-foreground-400">{drill.table}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-foreground-400 transition-colors hover:bg-background-100 hover:text-foreground-700 cursor-pointer"
            title="Close (Esc)"
          >
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {error && <p className="text-[13px] font-medium text-red-600">{error}</p>}
          {!drill && !error && <p className="text-[13px] text-foreground-400">Loading…</p>}

          {drill && !drill.available && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <p className="text-[13px] font-semibold text-amber-900">
                This table is not present on this database.
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-amber-800">
                The report omits the section for the same reason. The query it would have run is
                below — an absent table is not an empty one, so no rows are shown rather than zero.
              </p>
              {drill.error && (
                <p className="mt-2 font-mono text-[11px] leading-relaxed text-amber-700">{drill.error}</p>
              )}
            </div>
          )}

          {drill?.available && (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Count</p>
                  <p className="font-heading text-2xl font-bold text-foreground-900">
                    {(drill.total ?? 0).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Showing</p>
                  <p className="text-[13px] font-semibold text-foreground-700">
                    {drill.shown ?? 0}
                    {(drill.total ?? 0) > (drill.shown ?? 0) && (
                      <span className="ml-1 font-normal text-foreground-400">
                        of {(drill.total ?? 0).toLocaleString()} (first {drill.limit})
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {drill.note && (
                <p className="mt-3 rounded-lg border border-primary-200/70 bg-primary-50/50 px-3 py-2 text-[12px] leading-relaxed text-foreground-600">
                  {drill.note}
                </p>
              )}

              <div className="mt-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                  The query behind the figure
                </p>
                <pre className="mt-1.5 overflow-x-auto rounded-lg bg-foreground-950 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-emerald-200">
{drill.countSql}
                </pre>
                <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                  The records it counts
                </p>
                <pre className="mt-1.5 overflow-x-auto rounded-lg bg-foreground-950 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-emerald-200">
{drill.rowsSql}
                </pre>
              </div>

              {drill.rows && drill.rows.length > 0 ? (
                <div className="mt-4 overflow-x-auto rounded-xl border border-foreground-200/60">
                  <table className="w-full text-[12px]">
                    <thead className="bg-background-100/70">
                      <tr>
                        {drill.columns?.map(column => (
                          <th
                            key={column}
                            className="whitespace-nowrap px-3 py-2 text-left font-mono text-[10px] font-semibold text-foreground-500"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {drill.rows.map((row, index) => (
                        <tr key={index} className="border-t border-background-100">
                          {drill.columns?.map(column => (
                            <td key={column} className="max-w-[260px] truncate px-3 py-2 text-foreground-700">
                              <Cell value={row[column] ?? null} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-[13px] text-foreground-400">
                  The query returns no rows — the figure is genuinely zero.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** CSV from what is on screen — no server-side report job exists or is implied. */
function downloadCsv(sections: Section[], generatedAt: string) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = ['Section,Measure,Value,Source'];
  for (const section of sections) {
    if (!section.available) continue;
    for (const row of section.rows) {
      lines.push([section.title, row.label, row.value, row.source].map(esc).join(','));
    }
  }
  const stamp = new Date(generatedAt).toISOString().slice(0, 10);
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `platform-report-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PlatformReportPage() {
  const { data, loading, error, reload } = useAdminData(useCallback(() => fetchPlatformOverview(), []));
  const [drilling, setDrilling] = useState<{ metric: string; label: string } | null>(null);
  const sections = data ? buildSections(data) : [];
  const availableSections = sections.filter(s => s.available);
  const unavailable = sections.filter(s => !s.available);

  return (
    <AdminPage
      title="Platform Report"
      subtitle="Every headline figure, with the table it came from"
      icon="ri-bar-chart-box-line"
      heroTitle="Platform report"
      heroBlurb={
        <>A full count of what the platform holds. Each row names its source table, so any figure here can be checked directly against the database.</>
      }
      stats={data ? [{ label: 'Sections', value: availableSections.length }] : undefined}
      actions={data ? (
        <button
          onClick={() => downloadCsv(sections, data.generatedAt)}
          className="px-4 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-xl text-[13px] font-semibold hover:bg-white/30 transition-smooth cursor-pointer whitespace-nowrap shrink-0"
        >
          <AppIcon className="ri-download-2-line mr-1.5"></AppIcon>Export CSV
        </button>
      ) : undefined}
    >
      <DataPanel loading={loading && !data} error={error} onRetry={reload}>
        {data && (
          <p className="text-[11px] text-foreground-400">
            Generated {new Date(data.generatedAt).toLocaleString('en-GB', {
              day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          {availableSections.map(section => (
            <div key={section.title} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-foreground-200/60 flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
                  <AppIcon className={`${section.icon} text-sm`}></AppIcon>
                </span>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">{section.title}</h3>
              </div>
              {section.note && (
                <p className="px-4 pt-3 text-[11px] text-foreground-400 leading-relaxed">{section.note}</p>
              )}
              <table className="w-full text-[13px]">
                <tbody>
                  {section.rows.map(row => (
                    <tr
                      key={row.label}
                      onClick={row.metric ? () => setDrilling({ metric: row.metric!, label: row.label }) : undefined}
                      title={row.metric ? 'Show where this number comes from' : undefined}
                      className={`border-b border-background-100/50 last:border-0 ${
                        row.metric ? 'cursor-pointer transition-colors hover:bg-primary-50/60' : ''
                      }`}
                    >
                      <td className="px-4 py-2.5 text-foreground-700">
                        {row.metric ? (
                          <span className="inline-flex items-center gap-1.5">
                            {row.label}
                            <AppIcon className="ri-search-eye-line text-[11px] text-foreground-300"></AppIcon>
                          </span>
                        ) : row.label}
                      </td>
                      <td className="px-4 py-2.5 text-right font-heading font-semibold text-foreground-900 whitespace-nowrap">
                        {typeof row.value === 'number' ? row.value.toLocaleString() : row.value}
                      </td>
                      <td className="px-4 py-2.5 text-[10px] text-foreground-300 font-mono text-right whitespace-nowrap max-w-[180px] truncate">
                        {row.source}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {unavailable.length > 0 && (
          <div className="mt-4 bg-background-100/60 border border-foreground-200/60 rounded-xl p-4">
            <p className="text-[12px] font-semibold text-foreground-600 mb-1">Not reported</p>
            <p className="text-[11px] text-foreground-500 leading-relaxed">
              {unavailable.map(s => s.title).join(', ')} — the source tables are not present on this database.
              These sections are omitted rather than shown as zero, because an absent table does not mean an empty one.
            </p>
          </div>
        )}
      </DataPanel>

      <SourceNote>
        Counts are read live when this page loads; there is no snapshotting or scheduled report job.
        Export produces a CSV of exactly the rows shown. Select any row to see the query behind its
        figure and the records that make it up.
      </SourceNote>

      {drilling && (
        <DrillPanel
          metric={drilling.metric}
          label={drilling.label}
          onClose={() => setDrilling(null)}
        />
      )}
    </AdminPage>
  );
}

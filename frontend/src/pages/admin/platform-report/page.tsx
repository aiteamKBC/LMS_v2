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
import { useCallback, useState } from 'react';
import { AdminPage, DataPanel, SourceNote } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { fetchPlatformOverview, type PlatformOverview } from '@/api/platformAdmin';

interface Row { label: string; value: number | string; source: string }
interface Section { title: string; icon: string; available: boolean; rows: Row[]; note?: string }

function buildSections(o: PlatformOverview): Section[] {
  return [
    {
      title: 'Sign-in accounts',
      icon: 'ri-shield-user-line',
      available: o.accounts.available,
      rows: [
        { label: 'Total accounts', value: o.accounts.total, source: 'login."Login_accounts"' },
        { label: 'Able to sign in', value: o.accounts.active, source: 'Is_active and password set' },
        { label: 'Awaiting first sign-in', value: o.accounts.neverSignedIn, source: 'Password_hash empty' },
        { label: 'Suspended', value: o.accounts.suspended, source: 'Is_active = false' },
        { label: 'Locked out', value: o.accounts.locked, source: 'Locked_until in the future' },
        { label: 'Signed in within 30 days', value: o.accounts.activeLast30d, source: 'Last_login_at' },
        { label: 'Live sessions', value: o.accounts.liveSessions, source: 'login."Login_sessions"' },
        { label: 'Admins', value: o.accounts.byRole.admin, source: 'Role = admin' },
        { label: 'Staff', value: o.accounts.byRole.staff, source: 'Role = staff' },
        { label: 'Employer accounts', value: o.accounts.byRole.employer, source: 'Role = employer' },
        { label: 'Learner accounts', value: o.accounts.byRole.learner, source: 'Role = learner' },
      ],
    },
    {
      title: 'Authentication activity',
      icon: 'ri-door-lock-line',
      available: o.authActivity.available,
      rows: [
        { label: 'Sign-ins (24h)', value: o.authActivity.signIns24h, source: 'login."Login_audit"' },
        { label: 'Failed sign-ins (24h)', value: o.authActivity.failedSignIns24h, source: 'login."Login_audit"' },
        { label: 'Distinct users (7d)', value: o.authActivity.distinctSignIns7d, source: 'login."Login_audit"' },
        { label: 'All audit events (24h)', value: o.authActivity.events24h, source: 'login."Login_audit"' },
      ],
    },
    {
      title: 'Invitations',
      icon: 'ri-mail-send-line',
      available: true,
      rows: [
        { label: 'Pending', value: o.invitations.pending, source: 'login."Invitations"' },
        { label: 'Expired unused', value: o.invitations.expired, source: 'login."Invitations"' },
        { label: 'Failed to send', value: o.invitations.failed, source: 'Send_error is set' },
      ],
    },
    {
      title: 'People',
      icon: 'ri-group-line',
      available: o.people.available,
      note: 'People exist whether or not they have been invited to sign in, so these exceed the account counts above.',
      rows: [
        { label: 'Learners', value: o.people.learners, source: 'enrolment."Created_users"' },
        { label: '— apprenticeship', value: o.people.apprenticeship, source: 'Learner_type' },
        { label: '— commercial', value: o.people.commercial, source: 'Learner_type' },
        { label: 'Marked active', value: o.people.learnersActive, source: 'Status column' },
        { label: 'Staff', value: o.people.staff, source: 'enrolment."Staff_users"' },
        { label: 'Employers', value: o.people.employers, source: 'enrolment."Employers"' },
        { label: 'Organisations', value: o.people.organisations, source: 'enrolment."Organisations"' },
      ],
    },
    {
      title: 'Curriculum',
      icon: 'ri-stack-line',
      available: o.curriculum.available,
      rows: [
        { label: 'Programmes', value: o.curriculum.programmes, source: 'curriculum.programmes' },
        { label: 'Cohorts', value: o.curriculum.cohorts, source: 'curriculum.cohorts' },
        { label: 'Modules authored', value: o.curriculum.modules, source: 'curriculum.modules' },
      ],
    },
    {
      title: 'Documents',
      icon: 'ri-folder-line',
      available: o.documents.available,
      rows: [
        { label: 'Stored documents', value: o.documents.total, source: 'enrolment."Enrolment_Documents"' },
        { label: 'Fully signed', value: o.documents.signed, source: 'Signed column' },
        { label: 'Distinct types', value: o.documents.docTypes, source: 'Doc_type' },
        { label: 'Generated in last 30 days', value: o.documents.last30d, source: 'Generated_at' },
      ],
    },
    {
      title: 'Delivery',
      icon: 'ri-graduation-cap-line',
      available: o.delivery.available,
      rows: [
        { label: 'Active learners', value: o.delivery.activeLearners, source: 'Learner."Active_users"' },
        { label: 'Archived learners', value: o.delivery.inactiveLearners, source: 'Learner."Unactive_users"' },
      ],
    },
  ];
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
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [unavailableOpen, setUnavailableOpen] = useState(true);
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
          className="platform-report-export-button px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-smooth cursor-pointer whitespace-nowrap shrink-0"
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

        <div className="mt-4 grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-2">
          {availableSections.map((section, index) => {
            const open = openSections[section.title] !== false;
            const contentId = `platform-report-section-${index}`;
            return (
              <section key={section.title} className="admin-cool-table overflow-hidden rounded-xl border border-foreground-200/60">
                <div className={`flex items-center gap-2.5 px-4 py-3 ${open ? 'border-b border-foreground-200/60' : ''}`}>
                  <button
                    type="button"
                    onClick={() => setOpenSections(current => ({ ...current, [section.title]: !open }))}
                    aria-expanded={open}
                    aria-controls={contentId}
                    className="group inline-flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg text-left transition-colors hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-600">
                      <AppIcon className={`${section.icon} text-sm`}></AppIcon>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-heading font-semibold text-foreground-900">{section.title}</span>
                    <AppIcon className={`${open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} shrink-0 text-sm text-foreground-400 transition-transform`} aria-hidden="true"></AppIcon>
                  </button>
                </div>
                {open && (
                  <div id={contentId}>
                    {section.note && (
                      <p className="px-4 pb-2 pt-3 text-[11px] leading-relaxed text-foreground-400">{section.note}</p>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <tbody>
                          {section.rows.map(row => (
                            <tr key={row.label} className="border-b border-background-100/50 last:border-0">
                              <td className="px-4 py-2.5 text-foreground-700">{row.label}</td>
                              <td className="px-4 py-2.5 text-right font-heading font-semibold text-foreground-900 whitespace-nowrap">
                                {typeof row.value === 'number' ? row.value.toLocaleString() : row.value}
                              </td>
                              <td className="max-w-[180px] truncate whitespace-nowrap px-4 py-2.5 text-right font-sans text-[11px] tracking-normal text-foreground-400">
                                {row.source}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {unavailable.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-xl border border-foreground-200/60 bg-background-100/60 md:mt-4">
            <button
              type="button"
              onClick={() => setUnavailableOpen(open => !open)}
              aria-expanded={unavailableOpen}
              aria-controls="platform-report-unavailable-content"
              className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left transition-colors hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset"
            >
              <AppIcon className={`${unavailableOpen ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} shrink-0 text-sm text-foreground-400`} aria-hidden="true"></AppIcon>
              <span className="text-[12px] font-semibold text-red-700">Not reported</span>
            </button>
            {unavailableOpen && (
              <p id="platform-report-unavailable-content" className="border-t border-foreground-200/60 px-4 py-3 text-[11px] leading-relaxed text-foreground-500">
                {unavailable.map(s => s.title).join(', ')} — the source tables are not present on this database.
                These sections are omitted rather than shown as zero, because an absent table does not mean an empty one.
              </p>
            )}
          </div>
        )}
      </DataPanel>

      <SourceNote>
        Counts are read live when this page loads; there is no snapshotting or scheduled report job.
        Export produces a CSV of exactly the rows shown.
      </SourceNote>
    </AdminPage>
  );
}

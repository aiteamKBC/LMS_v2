// ============================================================================
// System status — what this deployment is wired up to
//
// Replaces two screens: the old System Settings page (toggles that persisted
// nowhere) and the Integrations board (tiles for Aptem, Power BI, DocuSign and
// a "CRM Bridge" — none of which this codebase connects to).
//
// What is reported is deliberately modest: whether each subsystem's settings
// are present in the environment. That is a fact the server can establish
// without calling anyone, and the page says so rather than implying a live
// health check it does not perform. Names of missing settings are shown; values
// never are.
// ============================================================================
import { useCallback } from 'react';
import { AdminPage, DataPanel, SourceNote } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { fetchPlatformOverview, fetchSystemStatus } from '@/api/platformAdmin';

const ICONS: Record<string, string> = {
  database: 'ri-database-2-line',
  email: 'ri-mail-line',
  blob: 'ri-cloud-line',
  graph: 'ri-microsoft-line',
  openai: 'ri-robot-line',
};

export default function AdminSystemPage() {
  const { data, loading, error, reload } = useAdminData(
    useCallback(async () => {
      const [system, overview] = await Promise.all([fetchSystemStatus(), fetchPlatformOverview()]);
      return { system, overview };
    }, []),
  );

  const system = data?.system;
  const overview = data?.overview;
  const checks = system?.checks ?? [];

  return (
    <AdminPage
      title="System Status"
      subtitle="Subsystems this deployment depends on, and whether they are configured"
      icon="ri-pulse-line"
      heroTitle="System status"
      heroBlurb={
        <>Each subsystem below is one this codebase genuinely calls. &ldquo;Configured&rdquo; means its settings are present — it is not a live health check of the remote service.</>
      }
      stats={[
        { label: 'Configured', value: loading && !data ? '—' : `${system?.configuredCount ?? 0}/${system?.totalCount ?? 0}` },
      ]}
    >
      <DataPanel loading={loading && !data} error={error} empty={checks.length === 0} onRetry={reload}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          {checks.map(check => (
            <div
              key={check.id}
              className={`rounded-xl border p-4 md:p-5 ${
                check.configured
                  ? 'bg-background-50 border-foreground-200/60'
                  : 'bg-amber-50/60 border-amber-200/60'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                  check.configured ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                }`}>
                  <AppIcon className={`${ICONS[check.id] || 'ri-plug-2-line'} text-lg`}></AppIcon>
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">{check.name}</h3>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                      check.configured
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                        : 'bg-amber-50 text-amber-700 border-amber-200/50'
                    }`}>
                      {check.configured ? 'Configured' : 'Not configured'}
                    </span>
                  </div>
                  <p className="text-[11px] text-foreground-500 mb-2">{check.purpose}</p>
                  <p className={`text-[11px] font-mono break-all ${check.configured ? 'text-foreground-400' : 'text-amber-700'}`}>
                    {check.detail}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Record volumes — a rough sense of what the database is holding */}
        {overview && (
          <div className="mt-4 md:mt-6 bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-1">Record volumes</h3>
            <p className="text-[11px] text-foreground-400 mb-4">Row counts from the schemas this platform owns.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Vol label="Sign-in accounts" value={overview.accounts.total} />
              <Vol label="Live sessions" value={overview.accounts.liveSessions} />
              {overview.people.available && <>
                <Vol label="Learners" value={overview.people.learners} />
                <Vol label="Staff" value={overview.people.staff} />
                <Vol label="Employers" value={overview.people.employers} />
                <Vol label="Organisations" value={overview.people.organisations} />
              </>}
              {overview.curriculum.available && <>
                <Vol label="Programmes" value={overview.curriculum.programmes} />
                <Vol label="Modules" value={overview.curriculum.modules} />
              </>}
              {overview.documents.available && <Vol label="Documents" value={overview.documents.total} />}
            </div>
          </div>
        )}
      </DataPanel>

      <SourceNote>
        There are no settings to change on this page. Configuration lives in the deployment&apos;s environment,
        not in the database, so it is edited where the app is deployed rather than from a browser —
        which also means a mistake here cannot take the platform down.
      </SourceNote>
    </AdminPage>
  );
}

function Vol({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-background-100/70 rounded-lg p-3">
      <p className="text-xl font-heading font-semibold text-foreground-900">{value.toLocaleString()}</p>
      <p className="text-[10px] text-foreground-400 mt-0.5">{label}</p>
    </div>
  );
}

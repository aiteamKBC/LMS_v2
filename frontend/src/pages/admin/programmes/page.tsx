// ============================================================================
// Programmes — curriculum.programmes, with real enrolment counts
//
// The learner count comes from enrolment."Created_users", not from the
// curriculum tables: a programme existing and a programme being used are
// different facts, and an authored programme carrying nobody is the one worth
// spotting. Authoring happens in the curriculum workspace; this page reports.
// ============================================================================
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AdminPage, DataPanel, SourceNote } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { fetchAdminCurriculum } from '@/api/platformAdmin';

export default function AdminProgrammesPage() {
  const { data, loading, error, reload } = useAdminData(useCallback(() => fetchAdminCurriculum(), []));

  const programmes = data?.programmes ?? [];
  const withLearners = programmes.filter(p => p.learners > 0).length;
  const totalModules = programmes.reduce((s, p) => s + p.modules, 0);

  return (
    <AdminPage
      title="Programmes"
      subtitle="Authored programmes and how many learners are on each"
      icon="ri-stack-line"
      heroTitle="Programmes"
      heroBlurb={
        <>Every non-archived programme in the curriculum schema. Learner counts come from enrolment records, so a programme with none is authored but unused.</>
      }
      stats={[
        { label: 'Programmes', value: loading && !data ? '—' : programmes.length },
        { label: 'In use', value: loading && !data ? '—' : withLearners },
        { label: 'Modules', value: loading && !data ? '—' : totalModules },
      ]}
    >
      <DataPanel
        loading={loading && !data}
        error={error}
        empty={programmes.length === 0}
        emptyMessage={data && !data.available
          ? 'The curriculum schema is not provisioned on this deployment.'
          : 'No programmes have been authored yet.'}
        onRetry={reload}
      >
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Programme</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Cohorts</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Modules</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Learners</th>
                  <th className="text-right px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody>
                {programmes.map(p => (
                  <tr key={p.name} className="border-b border-background-100/50 hover:bg-background-100/40 transition-smooth">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
                          <AppIcon className="ri-stack-line text-sm"></AppIcon>
                        </span>
                        <span className="font-medium text-foreground-800">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground-600">{p.cohorts}</td>
                    <td className="px-4 py-3 text-foreground-600">
                      {p.modules === 0
                        ? <span className="text-amber-600 text-[12px]">none authored</span>
                        : p.modules}
                    </td>
                    <td className="px-4 py-3">
                      {p.learners === 0
                        ? <span className="text-[11px] text-foreground-400">no learners</span>
                        : <span className="font-medium text-foreground-800">{p.learners}</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/admin/cohorts?programme=${encodeURIComponent(p.name)}`} className="text-[11px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">
                        Cohorts <AppIcon className="ri-arrow-right-line text-[10px]"></AppIcon>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DataPanel>

      <SourceNote>
        Programmes are authored in the curriculum workspace — this page reports what exists.
        A programme showing no modules has been created but not yet built out.
      </SourceNote>
    </AdminPage>
  );
}

// ============================================================================
// Cohorts — curriculum.cohorts, with real enrolment counts and dates
//
// Dates are the min start / max end across the cohort's authored rows, which is
// how cohort_dates() derives the Start_date/End_date stamped onto learners.
// ============================================================================
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminPage, DataPanel, SourceNote } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { fetchAdminCurriculum } from '@/api/platformAdmin';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Running / upcoming / ended, from the cohort's own dates. */
function phase(start: string | null, end: string | null): { label: string; tone: string } {
  const now = Date.now();
  const s = start ? new Date(start).getTime() : null;
  const e = end ? new Date(end).getTime() : null;
  if (s && s > now) return { label: 'Upcoming', tone: 'bg-blue-50 text-blue-700 border-blue-200/50' };
  if (e && e < now) return { label: 'Ended', tone: 'bg-background-100 text-foreground-500 border-foreground-200/60' };
  if (s || e) return { label: 'Running', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200/50' };
  return { label: 'No dates', tone: 'bg-amber-50 text-amber-700 border-amber-200/50' };
}

export default function AdminCohortsPage() {
  const [params, setParams] = useSearchParams();
  const programme = params.get('programme') || '';

  const { data, loading, error, reload } = useAdminData(
    useCallback(() => fetchAdminCurriculum(programme || undefined), [programme]),
    [programme],
  );

  const cohorts = data?.cohorts ?? [];
  const programmes = data?.programmes ?? [];
  const running = cohorts.filter(c => phase(c.startDate, c.endDate).label === 'Running').length;

  return (
    <AdminPage
      title="Cohorts"
      subtitle="Cohorts defined in the curriculum, with their dates and enrolment"
      icon="ri-group-2-line"
      heroTitle="Cohorts"
      heroBlurb={
        <>From <strong>curriculum.cohorts</strong>. Dates are the earliest start and latest end across the cohort&apos;s scheduled weeks — the same derivation that stamps dates onto a learner record.</>
      }
      stats={[
        { label: 'Cohorts', value: loading && !data ? '—' : cohorts.length },
        { label: 'Running', value: loading && !data ? '—' : running },
      ]}
    >
      <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <label className="text-[12px] text-foreground-500 shrink-0">Filter by programme</label>
        <select
          value={programme}
          onChange={e => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set('programme', e.target.value); else next.delete('programme');
            setParams(next, { replace: true });
          }}
          className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200 flex-1 md:flex-none md:min-w-[260px]"
        >
          <option value="">All programmes</option>
          {programmes.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
      </div>

      <DataPanel
        loading={loading && !data}
        error={error}
        empty={cohorts.length === 0}
        emptyMessage={data && !data.available
          ? 'The curriculum schema is not provisioned on this deployment.'
          : programme ? `No cohorts defined for ${programme}.` : 'No cohorts have been defined yet.'}
        onRetry={reload}
      >
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Cohort</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Programme</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Starts</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Ends</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Learners</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Phase</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map(c => {
                  const p = phase(c.startDate, c.endDate);
                  return (
                    <tr key={`${c.programme}-${c.name}`} className="border-b border-background-100/50 hover:bg-background-100/40 transition-smooth">
                      <td className="px-4 py-3 font-medium text-foreground-800">{c.name}</td>
                      <td className="px-4 py-3 text-[12px] text-foreground-600">{c.programme || '—'}</td>
                      <td className="px-4 py-3 text-[12px] text-foreground-500 whitespace-nowrap">{fmtDate(c.startDate)}</td>
                      <td className="px-4 py-3 text-[12px] text-foreground-500 whitespace-nowrap">{fmtDate(c.endDate)}</td>
                      <td className="px-4 py-3">
                        {c.learners === 0
                          ? <span className="text-[11px] text-foreground-400">none</span>
                          : <span className="font-medium text-foreground-800">{c.learners}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${p.tone}`}>{p.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </DataPanel>

      <SourceNote>
        A cohort with no dates has been named but never scheduled, so learners assigned to it
        will not receive start and end dates on their record.
      </SourceNote>
    </AdminPage>
  );
}

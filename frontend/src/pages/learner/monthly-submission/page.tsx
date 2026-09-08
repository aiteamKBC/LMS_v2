import { Link, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';

/** Only the learner's live assigned components are offered, never mock assignments. */
export default function MonthlySubmissionPage() {
  const { kind: routeKind, id: routeId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(routeKind, routeId);
  const { real, loading, loadError, refresh } = useLearnerDetailParam(kind, id);
  const nav = roleNavMap.learner;
  const assignments = (real?.components || []).filter(c => c.type === 'assignment' && c.componentId);
  return <WorkspaceShell role="learner" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel}
    pageTitle="Monthly submission" pageSubtitle="Your assignment, evidence and coaching preparation" userName={real?.name || 'Learner'} userRole="Learner">
    <main className="mx-auto max-w-6xl space-y-5 p-5 sm:p-8">
      <h1 className="text-2xl font-bold text-slate-900">Monthly submission</h1>
      <p className="text-sm text-slate-600">Choose your assignment to continue the eight-step submission. You can save a draft at any point and return to generate your presentation and book coaching.</p>
      {loading ? <p role="status">Loading your assignments…</p> : loadError ? <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800"><p>{loadError}</p><button type="button" className="mt-2 underline" onClick={refresh}>Retry</button></div> : assignments.length === 0 ? <p className="rounded-xl border bg-white p-5">No live assignments are assigned to you yet.</p> : assignments.map(c => <Link key={c.componentId} to={`/learner/monthly-submission/${kind}/${id}/${encodeURIComponent(c.componentId!)}`} className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-300"><h2 className="font-semibold text-slate-900">{c.component}</h2><p className="mt-2 text-sm text-slate-500">{c.module} · {c.week}{c.expectedOtjh != null ? ` · ${c.expectedOtjh} planned OTJ hours` : ''}</p><span className="mt-3 inline-block text-sm font-semibold text-blue-800">Open submission →</span></Link>)}
    </main>
  </WorkspaceShell>;
}

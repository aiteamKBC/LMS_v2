import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { feedbackApi, type LearnerFeedbackListItem } from '@/api/feedback';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useAuth } from '@/hooks/useAuth';
import { roleNavMap } from '@/mocks/navigation';

export default function LearnerFeedbackPage() {
  const navigate = useNavigate(); const { auth } = useAuth(); const [forms, setForms] = useState<LearnerFeedbackListItem[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { feedbackApi.myForms().then(x => setForms(x.forms)).catch(error => void Swal.fire({ icon: 'error', title: 'Could not load feedback', text: error.message })).finally(() => setLoading(false)); }, []);
  const nav = roleNavMap.learner;
  return <WorkspaceShell role="learner" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel} pageTitle="Feedback" pageSubtitle="Your assigned feedback forms" userName={auth.account?.displayName || 'Learner'} userRole="Learner">
    <div className="space-y-5 p-6"><div className="rounded-2xl bg-gradient-to-r from-[#541EA0] to-[#7C3AED] p-6 text-white"><h1 className="font-heading text-2xl font-bold !text-white">Feedback</h1><p className="mt-1 text-sm text-purple-100">Share your experience and continue any forms you have saved.</p></div>
      <div className="overflow-hidden rounded-xl border border-foreground-200/60 bg-background-50"><div className="border-b p-4"><h2 className="text-sm font-semibold">Assigned forms</h2></div>{loading ? <p className="p-8 text-center text-sm text-foreground-400">Loading…</p> : <div className="divide-y">{forms.map(form => <button key={form.id} onClick={() => navigate(`/learner/feedback/${form.id}`)} className="flex w-full items-center gap-4 p-4 text-left hover:bg-primary-50/40"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><i className="ri-survey-line" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-foreground-900">{form.title}</span><span className="block text-xs text-foreground-400">Assigned {formatDate(form.assignedAt)} · Due {formatDate(form.dueDate)}</span></span><Status status={form.status} /><i className="ri-arrow-right-s-line text-foreground-400" /></button>)}{!forms.length && <p className="p-10 text-center text-sm text-foreground-400">You have no feedback forms assigned right now.</p>}</div>}</div>
    </div>
  </WorkspaceShell>;
}
function Status({ status }: { status: string }) { const style = status === 'completed' ? 'bg-emerald-100 text-emerald-700' : status === 'in_progress' ? 'bg-amber-100 text-amber-700' : 'bg-background-200 text-foreground-600'; return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${style}`}>{status.replace('_', ' ').replace(/\b\w/g, x => x.toUpperCase())}</span>; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleDateString('en-GB') : '—'; }

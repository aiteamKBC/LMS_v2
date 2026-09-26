import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { feedbackApi, type LearnerFeedbackListItem } from '@/api/feedback';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useAuth } from '@/hooks/useAuth';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { roleNavMap } from '@/mocks/navigation';

export default function LearnerFeedbackPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { auth, isInitialized } = useAuth();
  const params = new URLSearchParams(location.search);
  const requestedKind = params.get('kind') || undefined;
  const requestedLearnerId = params.get('learnerId') || undefined;
  const resolved = useResolvedLearner(requestedKind, requestedLearnerId);
  const account = auth.account;
  const isLearner = account?.role === 'learner' && account.subjectType === 'learner';
  const learnerId = isLearner ? String(account.subjectId) : resolved.id;
  const learnerKind = isLearner ? account.learnerType || 'apprenticeship' : resolved.kind;
  const preview = Boolean(account && !isLearner);
  const [forms, setForms] = useState<LearnerFeedbackListItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!isInitialized) return;
    if (!learnerId) { setForms([]); setLoading(false); return; }
    setLoading(true);
    feedbackApi.myForms(preview ? learnerId : undefined).then(result => setForms(Array.isArray(result.forms) ? result.forms : []))
      .catch(error => void Swal.fire({ icon: 'error', title: 'Could not load feedback', text: error.message }))
      .finally(() => setLoading(false));
  }, [isInitialized, learnerId, preview]);
  const nav = roleNavMap.learner;
  const previewQuery = preview && learnerId
    ? `?learnerId=${encodeURIComponent(learnerId)}${learnerKind ? `&kind=${encodeURIComponent(learnerKind)}` : ''}`
    : '';
  const navItems = useMemo(() => (nav.items || []).map(item => {
    if (!preview || !learnerId) return item;
    if (item.id === 'learner-feedback') return { ...item, href: `/learner/feedback${previewQuery}` };
    if (item.id === 'learner-my-learning' && learnerKind) return { ...item, href: `/learner/my-learning/${encodeURIComponent(learnerKind)}/${encodeURIComponent(learnerId)}` };
    return item;
  }), [learnerId, learnerKind, nav.items, preview, previewQuery]);
  return <WorkspaceShell role="learner" roleLabel={nav.label} navItems={navItems} workspaceLabel={nav.workspaceLabel} pageTitle="Feedback" pageSubtitle="Your assigned feedback forms" userName={auth.account?.displayName || 'Learner'} userRole="Learner">
    <div className="space-y-5 p-6">
      <div className="rounded-2xl bg-gradient-to-r from-[#541EA0] to-[#7C3AED] p-6 text-white"><h1 className="font-heading text-2xl font-bold !text-white">Feedback</h1><p className="mt-1 text-sm text-purple-100">Share your experience and continue any forms you have saved.</p></div>
      {preview && learnerId && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">Viewing this learner’s feedback assignments. Preview is read-only; only the learner can submit a response.</div>}
      <div className="overflow-hidden rounded-xl border border-foreground-200/60 bg-background-50">
        <div className="border-b p-4"><h2 className="text-sm font-semibold">Assigned forms</h2></div>
        {loading ? <p className="p-8 text-center text-sm text-foreground-400">Loading…</p> : <div className="divide-y">
          {forms.map(form => <button key={form.deliveryId ? `delivery-${form.deliveryId}` : `form-${form.id}`} onClick={() => navigate(`${form.deliveryId ? `/learner/feedback/delivery/${form.deliveryId}` : `/learner/feedback/${form.id}`}${previewQuery}`)} className="flex w-full items-center gap-4 p-4 text-left hover:bg-primary-50/40">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><i className="ri-survey-line" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-foreground-900">{form.title}</span>{form.sessionTitle && <span className="block truncate text-xs font-medium text-foreground-600">{form.sessionTitle}{form.sessionStartsAt ? ` · ${formatDate(form.sessionStartsAt)}` : ''}</span>}<span className="block text-xs text-foreground-400">Assigned {formatDate(form.assignedAt)} · Due {formatDate(form.dueDate)}</span></span>
            <Status status={form.status} /><i className="ri-arrow-right-s-line text-foreground-400" />
          </button>)}
          {!forms.length && <p className="p-10 text-center text-sm text-foreground-400">{preview && !learnerId ? 'Choose a learner from My Learning to preview their feedback.' : 'You have no feedback forms assigned right now.'}</p>}
        </div>}
      </div>
    </div>
  </WorkspaceShell>;
}
function Status({ status }: { status: string }) { const style = status === 'completed' ? 'bg-emerald-100 text-emerald-700' : status === 'in_progress' ? 'bg-amber-100 text-amber-700' : 'bg-background-200 text-foreground-600'; return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${style}`}>{status.replace('_', ' ').replace(/\b\w/g, value => value.toUpperCase())}</span>; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleDateString('en-GB') : '—'; }

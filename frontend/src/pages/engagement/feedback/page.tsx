import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { feedbackApi, type FeedbackAnalyticsData, type FeedbackForm, type FeedbackLearnerOption, type FeedbackRecipient, type FeedbackResponse } from '@/api/feedback';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { FormRenderer } from '@/features/feedback/FormRenderer';
import { useOperatorIdentity } from '@/hooks/useOperatorIdentity';
import { roleNavMap } from '@/mocks/navigation';

type Tab = 'overview' | 'forms' | 'responses' | 'analytics';
const nav = roleNavMap.engagement;
const button = 'rounded-lg px-3 py-2 text-xs font-semibold transition-colors';

export default function FeedbackPage() {
  const operator = useOperatorIdentity();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [forms, setForms] = useState<FeedbackForm[]>([]);
  const [responses, setResponses] = useState<FeedbackResponse[]>([]);
  const [analytics, setAnalytics] = useState<FeedbackAnalyticsData | null>(null);
  const [summary, setSummary] = useState({ totalForms: 0, publishedForms: 0, draftForms: 0, totalResponses: 0 });
  const [search, setSearch] = useState('');
  const [status, setStatusFilter] = useState('all');
  const [assigning, setAssigning] = useState<FeedbackForm | null>(null);
  const [recipientForm, setRecipientForm] = useState<FeedbackForm | null>(null);
  const [viewing, setViewing] = useState<FeedbackResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [formData, responseData, analyticsData] = await Promise.all([feedbackApi.listForms(), feedbackApi.responses(), feedbackApi.analytics()]);
      setForms(formData.forms); setSummary(formData.summary); setResponses(responseData.responses); setAnalytics(analyticsData.analytics);
    } catch (error) { void Swal.fire({ icon: 'error', title: 'Could not load feedback', text: error instanceof Error ? error.message : 'Unexpected error.' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => forms.filter(form => (status === 'all' || form.status === status) && form.title.toLowerCase().includes(search.toLowerCase())), [forms, search, status]);

  async function action(form: FeedbackForm, kind: 'publish' | 'draft' | 'close' | 'duplicate' | 'delete') {
    if (kind === 'delete') {
      const result = await Swal.fire({ icon: 'warning', title: 'Delete feedback form?', text: 'This cannot be undone.', showCancelButton: true, confirmButtonText: 'Delete', confirmButtonColor: '#dc2626' });
      if (!result.isConfirmed) return;
    }
    try {
      if (kind === 'duplicate') await feedbackApi.duplicateForm(form.id);
      else if (kind === 'delete') await feedbackApi.deleteForm(form.id);
      else await feedbackApi.setStatus(form.id, kind === 'publish' ? 'published' : kind === 'draft' ? 'draft' : 'closed');
      await refresh();
    } catch (error) { await Swal.fire({ icon: 'error', title: 'Action failed', text: error instanceof Error ? error.message : 'Unexpected error.' }); }
  }

  async function openResponse(response: FeedbackResponse) {
    try { setViewing((await feedbackApi.response(response.id)).response); } catch (error) { void Swal.fire({ icon: 'error', title: 'Could not open response', text: error instanceof Error ? error.message : '' }); }
  }

  return <WorkspaceShell role="engagement" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel} pageTitle="Feedback" pageSubtitle="Create, assign, and analyse learner feedback forms" userName={operator.name} userRole={operator.role}>
    <div className="space-y-5 p-6">
      <div className="rounded-2xl bg-gradient-to-r from-[#541EA0] to-[#7C3AED] p-6 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-purple-200">Reports / Feedback</p><h1 className="mt-1 font-heading text-2xl font-bold !text-white">Feedback Forms</h1><p className="mt-1 max-w-2xl text-sm text-purple-100">Build flexible forms, assign them to learners, monitor completion, and review responses.</p></div><button onClick={() => navigate('/engagement/reports/feedback/create')} className="rounded-lg bg-white px-4 py-2.5 text-xs font-bold text-[#541EA0] shadow-sm">+ Create Feedback Form</button></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ['Total Forms', summary.totalForms, 'ri-file-list-3-line'], ['Published', summary.publishedForms, 'ri-send-plane-line'], ['Draft', summary.draftForms, 'ri-draft-line'], ['Responses', summary.totalResponses, 'ri-chat-check-line'],
      ].map(([label, value, icon]) => <div key={String(label)} className="rounded-xl border border-foreground-200/60 bg-background-50 p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-foreground-500">{label}</p><p className="mt-1 text-2xl font-bold text-foreground-900">{value}</p></div><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><i className={`${icon} text-lg`} /></span></div></div>)}</div>
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-background-100 p-1">{(['overview', 'forms', 'responses', 'analytics'] as Tab[]).map(value => <button key={value} onClick={() => setTab(value)} className={`${button} whitespace-nowrap ${tab === value ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-600 hover:bg-white'}`}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      {loading ? <div className="rounded-xl border bg-white p-10 text-center text-sm text-foreground-400">Loading feedback…</div> : <>
        {tab === 'overview' && <Overview analytics={analytics} forms={forms} onViewForms={() => setTab('forms')} />}
        {tab === 'forms' && <FormsTable forms={filtered} search={search} status={status} onSearch={setSearch} onStatus={setStatusFilter} onEdit={form => navigate(`/engagement/reports/feedback/forms/${form.id}/edit`)} onPreview={form => navigate(`/engagement/reports/feedback/forms/${form.id}/preview`)} onAssign={setAssigning} onViewRecipients={setRecipientForm} onResponses={() => setTab('responses')} onAction={action} />}
        {tab === 'responses' && <ResponsesTable responses={responses} forms={forms} onOpen={response => void openResponse(response)} />}
        {tab === 'analytics' && analytics && <AnalyticsView data={analytics} />}
      </>}
    </div>
    {assigning && <AssignmentDialog form={assigning} onClose={() => setAssigning(null)} onAssigned={() => { setAssigning(null); void refresh(); }} />}
    {recipientForm && <RecipientsDialog form={recipientForm} onClose={() => setRecipientForm(null)} />}
    {viewing && <ResponseDialog response={viewing} onClose={() => setViewing(null)} />}
  </WorkspaceShell>;
}

function Overview({ analytics, forms, onViewForms }: { analytics: FeedbackAnalyticsData | null; forms: FeedbackForm[]; onViewForms: () => void }) {
  return <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]"><div className="rounded-xl border border-foreground-200/60 bg-background-50 p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-heading text-sm font-semibold text-foreground-900">Recently updated forms</h2><button onClick={onViewForms} className="text-xs font-semibold text-primary-600">View all</button></div><div className="divide-y divide-background-200">{forms.slice(0, 5).map(form => <div key={form.id} className="flex items-center justify-between py-3"><div><p className="text-sm font-medium text-foreground-800">{form.title}</p><p className="text-[11px] text-foreground-400">Updated {formatDate(form.updatedAt)}</p></div><Status status={form.status} /></div>)}{!forms.length && <p className="py-8 text-center text-sm text-foreground-400">Create your first feedback form to get started.</p>}</div></div>{analytics && <AnalyticsView data={analytics} compact />}</div>;
}

function FormsTable({ forms, search, status, onSearch, onStatus, onEdit, onPreview, onAssign, onViewRecipients, onResponses, onAction }: { forms: FeedbackForm[]; search: string; status: string; onSearch: (v: string) => void; onStatus: (v: string) => void; onEdit: (f: FeedbackForm) => void; onPreview: (f: FeedbackForm) => void; onAssign: (f: FeedbackForm) => void; onViewRecipients: (f: FeedbackForm) => void; onResponses: () => void; onAction: (f: FeedbackForm, a: 'publish' | 'draft' | 'close' | 'duplicate' | 'delete') => void }) {
  return <div className="overflow-hidden rounded-xl border border-foreground-200/60 bg-background-50"><div className="flex flex-wrap gap-3 border-b border-background-200 p-4"><input value={search} onChange={e => onSearch(e.target.value)} placeholder="Search forms…" className="min-w-56 flex-1 rounded-lg border border-foreground-200 px-3 py-2 text-xs" /><select value={status} onChange={e => onStatus(e.target.value)} className="rounded-lg border border-foreground-200 px-3 py-2 text-xs"><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option></select></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-background-100 text-foreground-500"><tr>{['Form Name', 'Status', 'Assigned Learners', 'Responses', 'Created', 'Last Updated', 'Actions'].map(x => <th key={x} className="px-4 py-3 font-semibold">{x}</th>)}</tr></thead><tbody className="divide-y divide-background-200">{forms.map(form => <tr key={form.id}><td className="px-4 py-3 font-semibold text-foreground-900">{form.title}</td><td className="px-4 py-3"><Status status={form.status} /></td><td className="px-4 py-3"><button type="button" disabled={!form.assignedCount} onClick={() => onViewRecipients(form)} className="font-semibold text-primary-600 underline-offset-2 hover:underline disabled:text-foreground-400 disabled:no-underline">{form.assignedCount}</button></td><td className="px-4 py-3">{form.responseCount} / {form.assignedCount || '—'}</td><td className="px-4 py-3 text-foreground-500">{formatDate(form.createdAt)}</td><td className="px-4 py-3 text-foreground-500">{formatDate(form.updatedAt)}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold"><button onClick={() => onEdit(form)} className="text-primary-600">Edit</button><button onClick={() => onPreview(form)} className="text-primary-600">Preview</button><button onClick={() => void onAction(form, 'duplicate')} className="text-primary-600">Duplicate</button>{form.formType === 'general' && <button disabled={form.status !== 'published'} onClick={() => onAssign(form)} className="text-primary-600 disabled:text-foreground-300">Assign</button>}{form.status === 'draft' && <button onClick={() => void onAction(form, 'publish')} className="text-emerald-600">Publish</button>}{form.status === 'published' && <><button onClick={() => void onAction(form, 'draft')} className="text-amber-600">Unpublish</button><button onClick={() => void onAction(form, 'close')} className="text-amber-700">Close</button></>}<button onClick={onResponses} className="text-primary-600">Responses</button><button onClick={() => void onAction(form, 'delete')} className="text-red-600">Delete</button></div></td></tr>)}{!forms.length && <tr><td colSpan={7} className="p-10 text-center text-foreground-400">No feedback forms match these filters.</td></tr>}</tbody></table></div></div>;
}

function ResponsesTable({ responses, forms, onOpen }: { responses: FeedbackResponse[]; forms: FeedbackForm[]; onOpen: (r: FeedbackResponse) => void }) {
  const [formId, setFormId] = useState('all'); const [status, setStatus] = useState('all'); const [learner, setLearner] = useState('');
  const filtered = responses.filter(r => (formId === 'all' || r.formId === Number(formId)) && (status === 'all' || r.status === status) && r.learnerName.toLowerCase().includes(learner.toLowerCase()));
  return <div className="overflow-hidden rounded-xl border border-foreground-200/60 bg-background-50"><div className="flex flex-wrap gap-3 border-b p-4"><select value={formId} onChange={e => setFormId(e.target.value)} className="rounded-lg border px-3 py-2 text-xs"><option value="all">All forms</option>{forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}</select><select value={status} onChange={e => setStatus(e.target.value)} className="rounded-lg border px-3 py-2 text-xs"><option value="all">All statuses</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select><input value={learner} onChange={e => setLearner(e.target.value)} placeholder="Search learner…" className="rounded-lg border px-3 py-2 text-xs" /></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-background-100 text-foreground-500"><tr>{['Form', 'Learner', 'Programme', 'Status', 'Started', 'Submitted'].map(x => <th key={x} className="px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y">{filtered.map(r => <tr key={r.id} onClick={() => onOpen(r)} className="cursor-pointer hover:bg-primary-50/40"><td className="px-4 py-3 font-semibold">{r.formTitle}</td><td className="px-4 py-3">{r.learnerName}</td><td className="px-4 py-3">{r.programme || '—'}</td><td className="px-4 py-3"><Status status={r.status} /></td><td className="px-4 py-3">{formatDate(r.startedAt)}</td><td className="px-4 py-3">{formatDate(r.submittedAt)}</td></tr>)}{!filtered.length && <tr><td colSpan={6} className="p-10 text-center text-foreground-400">No responses found.</td></tr>}</tbody></table></div></div>;
}

function AnalyticsView({ data, compact = false }: { data: FeedbackAnalyticsData; compact?: boolean }) { return <div className={`rounded-xl border border-foreground-200/60 bg-background-50 p-5 ${compact ? '' : 'space-y-5'}`}><h2 className="mb-4 font-heading text-sm font-semibold text-foreground-900">Completion analytics</h2><div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[['Assigned', data.totalAssigned], ['Not Started', data.notStarted], ['In Progress', data.inProgress], ['Completed', data.completed], ['Completion', `${data.completionRate}%`]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-background-100 p-3"><p className="text-[10px] text-foreground-500">{label}</p><p className="mt-1 text-lg font-bold text-foreground-900">{value}</p></div>)}</div>{!compact && <div><h3 className="mb-2 text-xs font-semibold text-foreground-700">Average ratings</h3>{data.ratingAverages.map(rating => <div key={rating.questionId} className="mb-2 flex items-center justify-between rounded-lg border p-3 text-xs"><span>{rating.question}</span><strong className="text-primary-700">{rating.average} ({rating.responses})</strong></div>)}{!data.ratingAverages.length && <p className="text-xs text-foreground-400">No completed rating answers yet.</p>}</div>}</div>; }

function AssignmentDialog({ form, onClose, onAssigned }: { form: FeedbackForm; onClose: () => void; onAssigned: () => void }) {
  const [mode, setMode] = useState<'all_learners' | 'learner'>('learner'); const [learners, setLearners] = useState<FeedbackLearnerOption[]>([]); const [selected, setSelected] = useState<string[]>([]); const [search, setSearch] = useState('');
  useEffect(() => { const timer = setTimeout(() => feedbackApi.learners(search).then(x => setLearners(x.learners)), 200); return () => clearTimeout(timer); }, [search]);
  async function assign() { try { await feedbackApi.assign(form.id, mode, selected, form.dueDate); await Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Learners assigned', timer: 1500, showConfirmButton: false }); onAssigned(); } catch (error) { void Swal.fire({ icon: 'error', title: 'Could not assign form', text: error instanceof Error ? error.message : '' }); } }
  return <Modal title={`Assign ${form.title}`} onClose={onClose}><div className="space-y-4"><div className="flex gap-2"><button onClick={() => setMode('learner')} className={`${button} ${mode === 'learner' ? 'bg-primary-600 text-white' : 'bg-background-100'}`}>Specific Learners</button><button onClick={() => setMode('all_learners')} className={`${button} ${mode === 'all_learners' ? 'bg-primary-600 text-white' : 'bg-background-100'}`}>All Learners</button></div>{mode === 'learner' && <><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search learners…" className="w-full rounded-lg border px-3 py-2 text-xs" /><div className="max-h-64 space-y-1 overflow-y-auto">{learners.map(learner => <label key={learner.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-background-100"><input type="checkbox" checked={selected.includes(learner.id)} onChange={() => setSelected(current => current.includes(learner.id) ? current.filter(x => x !== learner.id) : [...current, learner.id])} /><span><span className="block text-xs font-semibold">{learner.name}</span><span className="text-[10px] text-foreground-400">{learner.programme || learner.email}</span></span></label>)}</div></>}<div className="flex justify-end gap-2"><button onClick={onClose} className={`${button} border`}>Cancel</button><button disabled={mode === 'learner' && !selected.length} onClick={() => void assign()} className={`${button} bg-primary-600 text-white disabled:opacity-40`}>Assign</button></div></div></Modal>;
}

function RecipientsDialog({ form, onClose }: { form: FeedbackForm; onClose: () => void }) {
  const [recipients, setRecipients] = useState<FeedbackRecipient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pageSize = 50;
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      feedbackApi.recipients(form.id, search, page, pageSize).then(data => {
        if (!active) return;
        setRecipients(data.recipients); setTotal(data.total);
      }).catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load assigned learners.');
      }).finally(() => { if (active) setLoading(false); });
    }, search ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [form.id, page, search]);
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  return <Modal title={`Assigned learners — ${form.title}`} onClose={onClose}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-foreground-500">{total} assignment{total === 1 ? '' : 's'}. Attendance assignments include the lecture that triggered the form.</p><input aria-label="Search assigned learners" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, email, programme or lecture…" className="min-w-64 rounded-lg border px-3 py-2 text-xs" /></div>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
    {loading ? <p className="py-10 text-center text-sm text-foreground-400">Loading assigned learners…</p> : <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-background-100 text-foreground-500"><tr>{['Learner', 'Programme', 'Assigned From', 'Lecture', 'Assigned', 'Response'].map(label => <th key={label} className="px-3 py-2.5 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y">{recipients.map(recipient => <tr key={recipient.key}><td className="px-3 py-3"><span className="block font-semibold text-foreground-900">{recipient.learnerName}</span><span className="text-[10px] text-foreground-400">{recipient.email || `Learner ${recipient.learnerId}`}</span></td><td className="px-3 py-3">{recipient.programme || '—'}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${recipient.source === 'attendance' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{recipient.source === 'attendance' ? 'Attendance' : 'Manual'}</span></td><td className="px-3 py-3"><span className="block">{recipient.sessionTitle || '—'}</span>{recipient.moduleName && <span className="text-[10px] text-foreground-400">{recipient.moduleName} · v{recipient.formVersion}</span>}</td><td className="px-3 py-3 text-foreground-500">{formatDate(recipient.assignedAt)}</td><td className="px-3 py-3"><Status status={recipient.responseStatus} /></td></tr>)}{!recipients.length && !error && <tr><td colSpan={6} className="p-10 text-center text-foreground-400">No assigned learners found.</td></tr>}</tbody></table></div>}
    {total > pageSize && <div className="mt-4 flex items-center justify-between"><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)} className={`${button} border disabled:opacity-40`}>Previous</button><span className="text-xs text-foreground-500">Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)} className={`${button} border disabled:opacity-40`}>Next</button></div>}
  </Modal>;
}

function ResponseDialog({ response, onClose }: { response: FeedbackResponse; onClose: () => void }) { return <Modal title="Feedback response" onClose={onClose}><div className="mb-4 grid grid-cols-3 gap-3 rounded-lg bg-background-100 p-3 text-xs"><div><span className="text-foreground-400">Learner</span><p className="font-semibold">{response.learnerName}</p></div><div><span className="text-foreground-400">Form</span><p className="font-semibold">{response.formTitle}</p></div><div><span className="text-foreground-400">Submitted</span><p className="font-semibold">{formatDate(response.submittedAt)}</p></div></div><FormRenderer sections={response.sections || []} answers={Object.fromEntries((response.sections || []).flatMap(s => s.questions.map(q => [String(q.id), q.answer ?? null])))} readOnly /></Modal>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"><div className="mb-4 flex items-center justify-between"><h2 className="font-heading text-lg font-bold">{title}</h2><button onClick={onClose} aria-label="Close" className="text-xl text-foreground-400">×</button></div>{children}</div></div>; }
function Status({ status }: { status: string }) { const styles = status === 'published' || status === 'completed' ? 'bg-emerald-100 text-emerald-700' : status === 'draft' || status === 'in_progress' ? 'bg-amber-100 text-amber-700' : 'bg-background-200 text-foreground-600'; return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${styles}`}>{status.replace('_', ' ').replace(/\b\w/g, x => x.toUpperCase())}</span>; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

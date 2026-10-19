import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { feedbackApi, type FeedbackFormType, type LearnerFeedbackListItem } from '@/api/feedback';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useAuth } from '@/hooks/useAuth';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { roleNavMap } from '@/mocks/navigation';

type FeedbackCategory = 'lecture' | 'mcm' | 'progress-review' | 'event' | 'general';

const CATEGORIES: Array<{
  id: FeedbackCategory;
  title: string;
  description: string;
  icon: string;
  tone: string;
  wash: string;
}> = [
  { id: 'lecture', title: 'Lecture Feedback', description: 'Feedback for every lecture you attended.', icon: 'ri-presentation-line', tone: 'bg-violet-100 text-violet-700 ring-violet-200', wash: 'from-violet-50' },
  { id: 'mcm', title: 'MCM Feedback', description: 'Feedback after a completed Monthly Coaching Meeting.', icon: 'ri-user-voice-line', tone: 'bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200', wash: 'from-fuchsia-50' },
  { id: 'progress-review', title: 'Progress Review Feedback', description: 'Feedback after a completed Progress Review.', icon: 'ri-line-chart-line', tone: 'bg-amber-100 text-amber-700 ring-amber-200', wash: 'from-amber-50' },
  { id: 'event', title: 'Event Feedback', description: 'Share your experience after events.', icon: 'ri-calendar-event-line', tone: 'bg-blue-100 text-blue-700 ring-blue-200', wash: 'from-blue-50' },
  { id: 'general', title: 'General Feedback', description: 'Other feedback forms assigned to you.', icon: 'ri-survey-line', tone: 'bg-emerald-100 text-emerald-700 ring-emerald-200', wash: 'from-emerald-50' },
];

export default function LearnerFeedbackPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { auth, isInitialized } = useAuth();
  const params = new URLSearchParams(location.search);
  const requestedKind = params.get('kind') || undefined;
  const requestedLearnerId = params.get('learnerId') || undefined;
  const requestedCategory = params.get('category');
  const activeCategory = CATEGORIES.find(category => category.id === requestedCategory) || null;
  const resolved = useResolvedLearner(requestedKind, requestedLearnerId);
  const account = auth.account;
  const isLearner = account?.role === 'learner' && account.subjectType === 'learner';
  const learnerId = isLearner ? String(account.subjectId) : resolved.id;
  const learnerKind = isLearner ? account.learnerType || 'apprenticeship' : resolved.kind;
  const preview = Boolean(account && !isLearner);
  const [forms, setForms] = useState<LearnerFeedbackListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadForms = useCallback(async () => {
    if (!isInitialized) return;
    if (!learnerId) { setForms([]); setLoading(false); return; }
    setLoading(true);
    try {
      const result = await feedbackApi.myForms(preview ? learnerId : undefined);
      setForms(Array.isArray(result.forms) ? result.forms : []);
    } catch (error) {
      void Swal.fire({ icon: 'error', title: 'Could not load feedback', text: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setLoading(false);
    }
  }, [isInitialized, learnerId, preview]);

  useEffect(() => {
    void loadForms();
    const refreshOnFocus = () => { void loadForms(); };
    const refreshWhenVisible = () => { if (!document.hidden) void loadForms(); };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadForms]);

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

  const formsByCategory = useMemo(() => ({
    lecture: forms.filter(form => categoryFor(form) === 'lecture'),
    mcm: forms.filter(form => categoryFor(form) === 'mcm'),
    'progress-review': forms.filter(form => categoryFor(form) === 'progress-review'),
    event: forms.filter(form => categoryFor(form) === 'event'),
    general: forms.filter(form => categoryFor(form) === 'general'),
  }), [forms]);
  const selectedForms = activeCategory ? formsByCategory[activeCategory.id] : [];
  const lectureGroups = useMemo(() => groupLectures(formsByCategory.lecture), [formsByCategory.lecture]);

  function contextSearch(category?: FeedbackCategory, eventRecipientId?: number | null) {
    const search = new URLSearchParams(previewQuery.replace(/^\?/, ''));
    if (category) search.set('category', category);
    if (eventRecipientId) search.set('eventRecipientId', String(eventRecipientId));
    return search.toString();
  }

  function openForm(form: LearnerFeedbackListItem) {
    const path = form.reviewDeliveryId
      ? `/learner/feedback/review/${form.reviewDeliveryId}`
      : form.deliveryId ? `/learner/feedback/delivery/${form.deliveryId}` : `/learner/feedback/${form.id}`;
    const search = contextSearch(activeCategory?.id, form.eventRecipientId);
    navigate(`${path}${search ? `?${search}` : ''}`);
  }

  return <WorkspaceShell role="learner" roleLabel={nav.label} navItems={navItems} workspaceLabel={nav.workspaceLabel} pageTitle="Feedback" pageSubtitle="Your assigned feedback forms" userName={auth.account?.displayName || 'Learner'} userRole="Learner">
    <div className="space-y-5 p-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#4B197D] via-[#6024A8] to-[#7C3AED] px-6 py-7 text-white shadow-sm"><span aria-hidden="true" className="absolute -right-8 -top-16 h-44 w-44 rounded-full border border-white/15" /><span aria-hidden="true" className="absolute right-16 top-7 h-24 w-24 rounded-full bg-white/5" /><div className="relative flex items-center gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-2xl"><i className={activeCategory?.icon || 'ri-chat-smile-2-line'} /></span><div><h1 className="font-heading text-2xl font-bold !text-white">{activeCategory?.title || 'Feedback'}</h1><p className="mt-1 text-sm text-purple-100">{activeCategory?.description || 'Choose a feedback type to view the forms assigned to you.'}</p></div></div></div>
      {preview && learnerId && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">Viewing this learner’s feedback assignments. Preview is read-only; only the learner can submit a response.</div>}
      {activeCategory
        ? <CategoryView category={activeCategory} forms={selectedForms} lectureGroups={lectureGroups} loading={loading} onBack={() => navigate(`/learner/feedback${previewQuery}`)} onRefresh={loadForms} onOpen={openForm} />
        : <CategoryCards formsByCategory={formsByCategory} loading={loading} onOpen={category => {
          const search = contextSearch(category);
          navigate(`/learner/feedback${search ? `?${search}` : ''}`);
        }} />}
    </div>
  </WorkspaceShell>;
}

function CategoryCards({ formsByCategory, loading, onOpen }: {
  formsByCategory: Record<FeedbackCategory, LearnerFeedbackListItem[]>;
  loading: boolean;
  onOpen: (category: FeedbackCategory) => void;
}) {
  return <section aria-label="Feedback types" className="grid gap-4 md:grid-cols-3">
    {CATEGORIES.map(category => {
      const forms = formsByCategory[category.id];
      const outstanding = forms.filter(form => form.status !== 'completed').length;
      const completed = forms.length - outstanding;
      const completion = forms.length ? Math.round((completed / forms.length) * 100) : 0;
      return <button key={category.id} type="button" onClick={() => onOpen(category.id)} className="group relative overflow-hidden rounded-2xl border border-foreground-200/70 bg-white p-5 text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:border-primary-300 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
        <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-28 bg-gradient-to-br ${category.wash} via-white to-white opacity-80`} />
        <span className="relative flex items-start justify-between"><span className={`flex h-12 w-12 items-center justify-center rounded-xl text-2xl ring-1 ${category.tone}`}><i aria-hidden="true" className={category.icon} /></span><span className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground-200 bg-white text-primary-700 shadow-sm transition group-hover:border-primary-300 group-hover:bg-primary-600 group-hover:text-white"><i aria-hidden="true" className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5" /></span></span>
        <span className="relative mt-5 block"><span className="block font-heading text-lg font-bold text-foreground-900">{category.title}</span><span className="mt-1 block min-h-10 text-sm leading-5 text-foreground-500">{category.description}</span></span>
        <span className="relative mt-5 grid grid-cols-2 gap-3 border-t border-foreground-100 pt-4"><span><span className="block text-lg font-bold text-foreground-900">{loading ? '—' : forms.length}</span><span className="block text-[11px] font-medium uppercase tracking-wide text-foreground-400">Assigned</span></span><span><span className="block text-lg font-bold text-primary-700">{loading ? '—' : outstanding}</span><span className="block text-[11px] font-medium uppercase tracking-wide text-foreground-400">To complete</span></span></span>
        <span className="relative mt-4 block"><span className="mb-1.5 flex justify-between text-[11px] font-medium text-foreground-500"><span>Completion</span><span>{loading ? '—' : `${completion}%`}</span></span><span className="block h-1.5 overflow-hidden rounded-full bg-background-300"><span className="block h-full rounded-full bg-primary-600 transition-all" style={{ width: loading ? '0%' : `${completion}%` }} /></span></span>
      </button>;
    })}
  </section>;
}

function CategoryView({ category, forms, lectureGroups, loading, onBack, onRefresh, onOpen }: {
  category: (typeof CATEGORIES)[number];
  forms: LearnerFeedbackListItem[];
  lectureGroups: Array<{ moduleName: string; forms: LearnerFeedbackListItem[] }>;
  loading: boolean;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onOpen: (form: LearnerFeedbackListItem) => void;
}) {
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><button type="button" onClick={onBack} className="rounded-lg border border-foreground-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-50"><i className="ri-arrow-left-line mr-1" />All feedback types</button><button type="button" disabled={loading} onClick={() => void onRefresh()} className="rounded-lg border border-foreground-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700 disabled:opacity-50"><i className="ri-refresh-line mr-1" />Refresh</button></div>
    {loading ? <div className="rounded-xl border border-foreground-200/60 bg-white p-10 text-center text-sm text-foreground-400">Loading…</div>
      : category.id === 'lecture' && lectureGroups.length
        ? <div className="space-y-5">{lectureGroups.map(group => {
          const completed = group.forms.filter(form => form.status === 'completed').length;
          const outstanding = group.forms.length - completed;
          return <section key={group.moduleName} aria-label={group.moduleName} className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-white shadow-sm"><div className="h-1 bg-gradient-to-r from-primary-700 via-primary-500 to-violet-400" /><div className="flex flex-wrap items-center justify-between gap-4 border-b border-foreground-100 bg-gradient-to-r from-primary-50/80 to-white px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-lg text-primary-700 shadow-sm ring-1 ring-primary-100"><i className="ri-book-open-line" /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">Module</p><h2 className="font-heading text-base font-bold text-foreground-900">{group.moduleName}</h2></div></div><div className="flex items-center gap-2 text-xs"><span className="rounded-full border border-foreground-200 bg-white px-3 py-1.5 font-semibold text-foreground-600">{group.forms.length} {group.forms.length === 1 ? 'lecture' : 'lectures'}</span><span className={`rounded-full px-3 py-1.5 font-semibold ${outstanding ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{outstanding ? `${outstanding} to complete` : 'All completed'}</span></div></div><div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">{group.forms.map(form => <FeedbackCard key={formKey(form)} form={form} category={category} onOpen={onOpen} />)}</div></section>;
        })}</div>
        : forms.length
          ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{forms.map(form => <FeedbackCard key={formKey(form)} form={form} category={category} onOpen={onOpen} />)}</div>
          : <div className="rounded-xl border border-dashed border-foreground-300 bg-white p-12 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-background-200 text-2xl text-foreground-500"><i className={category.icon} /></span><h2 className="mt-4 text-base font-semibold text-foreground-800">No {category.title.toLowerCase()} assigned</h2><p className="mt-1 text-sm text-foreground-400">New forms will appear here when they are assigned to you.</p></div>}
  </div>;
}

function FeedbackCard({ form, category, onOpen }: { form: LearnerFeedbackListItem; category: (typeof CATEGORIES)[number]; onOpen: (form: LearnerFeedbackListItem) => void }) {
  const heading = form.sessionTitle || form.title;
  return <button type="button" onClick={() => onOpen(form)} className="group relative flex min-h-48 flex-col overflow-hidden rounded-xl border border-foreground-200 bg-white p-4 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
    <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-20 bg-gradient-to-br ${category.wash} via-white to-white opacity-70`} />
    <span className="relative flex items-start justify-between gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ring-1 ${category.tone}`}><i className={category.icon} /></span><Status status={form.status} /></span>
    <span className="relative mt-4 block text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">{category.id === 'lecture' ? 'Lecture feedback' : category.title}</span>
    <span className="relative mt-1.5 block font-heading text-base font-bold leading-6 text-foreground-900">{heading}</span>
    {category.id === 'lecture' && form.title !== heading && <span className="relative mt-1 block text-xs text-foreground-500">{form.title}</span>}
    <span className="relative mt-auto flex items-center justify-between gap-3 border-t border-foreground-100 pt-4 text-xs text-foreground-500"><span className="flex items-center gap-1.5"><i className="ri-calendar-line text-primary-600" /><span>{form.sessionStartsAt ? formatDateTime(form.sessionStartsAt) : `Assigned ${formatDate(form.assignedAt)}`}</span></span><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700 transition group-hover:bg-primary-600 group-hover:text-white"><i className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5" /></span></span>
  </button>;
}

function categoryFor(form: LearnerFeedbackListItem): FeedbackCategory {
  const type: FeedbackFormType = form.formType || (form.deliveryId ? 'post_lecture' : form.eventRecipientId ? 'post_event' : 'general');
  if (type === 'post_lecture') return 'lecture';
  if (type === 'post_mcm_review') return 'mcm';
  if (type === 'post_progress_review') return 'progress-review';
  if (type === 'post_event') return 'event';
  return 'general';
}

function groupLectures(forms: LearnerFeedbackListItem[]) {
  const groups = new Map<string, LearnerFeedbackListItem[]>();
  for (const form of forms) {
    const moduleName = form.moduleName?.trim() || 'Other lectures';
    groups.set(moduleName, [...(groups.get(moduleName) || []), form]);
  }
  return [...groups.entries()].map(([moduleName, moduleForms]) => ({
    moduleName,
    forms: [...moduleForms].sort((left, right) => sortDate(right) - sortDate(left)),
  })).sort((left, right) => sortDate(right.forms[0]) - sortDate(left.forms[0]));
}

function sortDate(form: LearnerFeedbackListItem) { return new Date(form.sessionStartsAt || form.assignedAt || 0).getTime(); }
function formKey(form: LearnerFeedbackListItem) { return form.reviewDeliveryId ? `review-${form.reviewDeliveryId}` : form.eventRecipientId ? `event-${form.eventRecipientId}-${form.id}` : form.deliveryId ? `delivery-${form.deliveryId}` : `form-${form.id}`; }
function Status({ status }: { status: string }) { const style = status === 'completed' ? 'bg-emerald-100 text-emerald-700' : status === 'in_progress' ? 'bg-amber-100 text-amber-700' : 'bg-background-200 text-foreground-600'; return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${style}`}>{status.replace('_', ' ').replace(/\b\w/g, value => value.toUpperCase())}</span>; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleDateString('en-GB') : '—'; }
function formatDateTime(value: string) { return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }

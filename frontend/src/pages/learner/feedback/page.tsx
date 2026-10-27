import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { feedbackApi, type FeedbackFormType, type LearnerFeedbackListItem, type LearnerFeedbackStatus } from '@/api/feedback';
import { ThemedSelect, type ThemedSelectOption } from '@/components/feature/ThemedSelect';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useAuth } from '@/hooks/useAuth';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { LEARNER_FEEDBACK_ENABLED } from '@/lib/featureFlags';
import { roleNavMap } from '@/mocks/navigation';

type FeedbackCategory = 'mid-module' | 'end-module' | 'lecture' | 'mcm' | 'progress-review' | 'event' | 'general';
type CategoryFilter = 'all' | FeedbackCategory;
type StatusFilter = 'all' | LearnerFeedbackStatus;

interface FeedbackCategoryConfig {
  id: FeedbackCategory;
  title: string;
  shortTitle: string;
  icon: string;
  tone: string;
  bar: string;
}

const CATEGORIES: FeedbackCategoryConfig[] = [
  { id: 'mid-module', title: 'Mid-module Feedback', shortTitle: 'Mid-module', icon: 'ri-calendar-check-line', tone: 'bg-teal-100 text-teal-700 ring-teal-200', bar: 'bg-teal-500' },
  { id: 'end-module', title: 'End-module Feedback', shortTitle: 'End-module', icon: 'ri-flag-line', tone: 'bg-indigo-100 text-indigo-700 ring-indigo-200', bar: 'bg-indigo-500' },
  { id: 'lecture', title: 'Live Sessions Feedback', shortTitle: 'Live Sessions', icon: 'ri-presentation-line', tone: 'bg-violet-100 text-violet-700 ring-violet-200', bar: 'bg-violet-500' },
  { id: 'mcm', title: 'MCM Feedback', shortTitle: 'MCM', icon: 'ri-user-voice-line', tone: 'bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200', bar: 'bg-fuchsia-500' },
  { id: 'progress-review', title: 'Progress Review Feedback', shortTitle: 'Progress review', icon: 'ri-line-chart-line', tone: 'bg-amber-100 text-amber-700 ring-amber-200', bar: 'bg-amber-500' },
  { id: 'event', title: 'Event Feedback', shortTitle: 'Event', icon: 'ri-calendar-event-line', tone: 'bg-blue-100 text-blue-700 ring-blue-200', bar: 'bg-blue-500' },
  { id: 'general', title: 'General Feedback', shortTitle: 'General', icon: 'ri-survey-line', tone: 'bg-emerald-100 text-emerald-700 ring-emerald-200', bar: 'bg-emerald-500' },
];

export default function LearnerFeedbackPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { auth, isInitialized } = useAuth();
  const params = new URLSearchParams(location.search);
  const requestedKind = params.get('kind') || undefined;
  const requestedLearnerId = params.get('learnerId') || undefined;
  const requestedCategory = params.get('category');
  const resolved = useResolvedLearner(requestedKind, requestedLearnerId);
  const account = auth.account;
  const isLearner = account?.role === 'learner' && account.subjectType === 'learner';
  const limitedFeedback = !LEARNER_FEEDBACK_ENABLED && isLearner;
  const availableCategories = limitedFeedback ? CATEGORIES.filter(category => category.id === 'lecture') : CATEGORIES;
  const activeCategory = availableCategories.find(category => category.id === requestedCategory) || null;
  const learnerId = isLearner ? String(account.subjectId) : resolved.id;
  const learnerKind = isLearner ? account.learnerType || 'apprenticeship' : resolved.kind;
  const preview = Boolean(account && !isLearner);
  const [forms, setForms] = useState<LearnerFeedbackListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

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

  const allowedCategoryIds = useMemo(() => new Set(availableCategories.map(category => category.id)), [availableCategories]);
  const visibleForms = useMemo(() => forms.filter(form => allowedCategoryIds.has(categoryFor(form))), [allowedCategoryIds, forms]);
  const actionForms = useMemo(() => visibleForms.filter(form => form.status !== 'completed').sort(compareFeedbackPriority), [visibleForms]);
  const filteredForms = useMemo(() => {
    const term = search.trim().toLowerCase();
    return visibleForms
      .filter(form => !activeCategory || categoryFor(form) === activeCategory.id)
      .filter(form => statusFilter === 'all' || form.status === statusFilter)
      .filter(form => !term || [form.title, form.description, form.sessionTitle, form.moduleName, categoryConfig(form).title]
        .some(value => value?.toLowerCase().includes(term)))
      .sort(compareFeedbackPriority);
  }, [activeCategory, search, statusFilter, visibleForms]);

  function contextSearch(category?: FeedbackCategory, eventRecipientId?: number | null) {
    const query = new URLSearchParams(previewQuery.replace(/^\?/, ''));
    if (category) query.set('category', category);
    if (eventRecipientId) query.set('eventRecipientId', String(eventRecipientId));
    return query.toString();
  }

  function selectCategory(category?: FeedbackCategory) {
    const query = contextSearch(category);
    navigate(`/learner/feedback${query ? `?${query}` : ''}`);
  }

  function openForm(form: LearnerFeedbackListItem) {
    const path = form.reviewDeliveryId
      ? `/learner/feedback/review/${form.reviewDeliveryId}`
      : form.deliveryId ? `/learner/feedback/delivery/${form.deliveryId}` : `/learner/feedback/${form.id}`;
    const query = contextSearch(activeCategory?.id, form.eventRecipientId);
    navigate(`${path}${query ? `?${query}` : ''}`);
  }

  return <WorkspaceShell role="learner" roleLabel={nav.label} navItems={navItems} workspaceLabel={nav.workspaceLabel} pageTitle="Feedback" pageSubtitle="Your assigned feedback forms" userName={auth.account?.displayName || 'Learner'} userRole="Learner">
    <div className="space-y-5 p-4 sm:p-6">
      <FeedbackHero pendingCount={actionForms.length} />
      {preview && learnerId && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">Viewing this learner’s feedback assignments. Preview is read-only; only the learner can submit a response.</div>}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <ActionNeeded forms={actionForms} loading={loading} onOpen={openForm} />
          <AllFeedback categories={availableCategories} activeCategory={activeCategory} forms={filteredForms} loading={loading} search={search} statusFilter={statusFilter} totalForms={visibleForms.length} onCategoryChange={selectCategory} onOpen={openForm} onRefresh={loadForms} onSearchChange={setSearch} onStatusChange={setStatusFilter} />
        </div>
        <HelpfulDetails />
      </div>
      <FeedbackSummary categories={availableCategories} forms={visibleForms} loading={loading} />
    </div>
  </WorkspaceShell>;
}

function FeedbackHero({ pendingCount }: { pendingCount: number }) {
  return <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#4B197D] via-[#6024A8] to-[#7C3AED] px-5 py-6 text-white shadow-sm sm:px-6">
    <span aria-hidden="true" className="absolute -right-8 -top-16 h-44 w-44 rounded-full border border-white/15" />
    <span aria-hidden="true" className="absolute right-16 top-7 h-24 w-24 rounded-full bg-white/5" />
    <div className="relative flex items-center gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-2xl"><i className="ri-chat-smile-2-line" /></span><div><div className="flex flex-wrap items-center gap-2"><h1 className="font-heading text-2xl font-bold !text-white">Feedback</h1>{pendingCount > 0 && <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold text-white">{pendingCount} to complete</span>}</div><p className="mt-1 text-sm text-purple-100">Complete optional feedback requests to help improve your learning experience.</p></div></div>
  </div>;
}

function ActionNeeded({ forms, loading, onOpen }: { forms: LearnerFeedbackListItem[]; loading: boolean; onOpen: (form: LearnerFeedbackListItem) => void }) {
  return <section aria-labelledby="action-needed-title" className="overflow-hidden rounded-2xl border border-rose-100 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-100 bg-gradient-to-r from-rose-50 to-white px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-lg text-rose-600"><i className="ri-alarm-warning-line" /></span><div><div className="flex items-center gap-2"><h2 id="action-needed-title" className="font-heading text-base font-bold text-foreground-900">Action needed</h2>{!loading && forms.length > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">{forms.length}</span>}</div><p className="mt-0.5 text-xs text-foreground-500">Feedback requests waiting for your response.</p></div></div><a href="#all-feedback" className="text-xs font-semibold text-primary-700 hover:text-primary-800">View all feedback <i className="ri-arrow-right-line ml-1" /></a></div>
    {loading ? <div className="p-8 text-center text-sm text-foreground-400">Loading feedback…</div> : forms.length ? <div className="divide-y divide-foreground-100">{forms.slice(0, 3).map(form => <ActionRow key={formKey(form)} form={form} onOpen={onOpen} />)}</div> : <div className="flex items-center gap-3 p-6"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-xl text-emerald-700"><i className="ri-check-line" /></span><div><p className="text-sm font-semibold text-foreground-800">You’re all caught up</p><p className="mt-0.5 text-xs text-foreground-500">There are no feedback requests waiting for you.</p></div></div>}
  </section>;
}

function ActionRow({ form, onOpen }: { form: LearnerFeedbackListItem; onOpen: (form: LearnerFeedbackListItem) => void }) {
  const category = categoryConfig(form);
  return <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl ring-1 ${category.tone}`}><i className={category.icon} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-foreground-900">{form.sessionTitle || form.title}</p><p className="mt-0.5 truncate text-xs text-foreground-500">{form.moduleName || category.title}</p><FeedbackDate form={form} compact /></div><Status status={form.status} /><button type="button" aria-label={`${actionLabel(form.status)} ${form.sessionTitle || form.title} from action needed`} onClick={() => onOpen(form)} className="inline-flex min-w-28 items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">{actionLabel(form.status)} <i className="ri-arrow-right-line ml-1.5" /></button></div>;
}

function HelpfulDetails() {
  const details = [
    ['ri-book-open-line', 'Related session/module name', 'Shows which module, lecture or event the feedback is about.'],
    ['ri-calendar-line', 'Event date', 'The date the session, module activity or event took place.'],
    ['ri-time-line', 'Deadline to submit', 'Feedback may be available for a limited time, so check the due date.'],
    ['ri-timer-line', 'Estimated time to complete', 'Most feedback forms take 1–2 minutes to complete.'],
    ['ri-team-line', 'Who can view it', 'Your response can be viewed by the Engagement Team.'],
    ['ri-star-line', 'Why this feedback matters', 'Your feedback helps improve teaching, support and your learning experience.'],
    ['ri-refresh-line', 'Can you resubmit?', 'Some feedback forms can be updated after submission when editing is enabled.'],
    ['ri-forbid-line', 'Can you ignore it?', 'If a request is not relevant to you, contact the Engagement Team for help.'],
  ];
  return <aside aria-labelledby="helpful-details-title" className="rounded-2xl border border-primary-100 bg-gradient-to-b from-primary-50/70 to-white p-5 shadow-sm xl:sticky xl:top-4"><div className="flex items-center gap-2 text-primary-800"><i className="ri-information-line text-xl" /><h2 id="helpful-details-title" className="font-heading text-sm font-bold">Helpful details before you submit</h2></div><p className="mt-2 text-[11px] leading-4 text-foreground-500">Here’s what to look for when deciding whether to complete feedback.</p><div className="mt-4 space-y-4">{details.map(([icon, title, copy]) => <div key={title} className="flex gap-3"><i className={`${icon} mt-0.5 text-lg text-primary-600`} /><div><p className="text-xs font-bold text-foreground-800">{title}</p><p className="mt-0.5 text-[11px] leading-4 text-foreground-500">{copy}</p></div></div>)}</div></aside>;
}

function AllFeedback({ categories, activeCategory, forms, loading, search, statusFilter, totalForms, onCategoryChange, onOpen, onRefresh, onSearchChange, onStatusChange }: {
  categories: FeedbackCategoryConfig[]; activeCategory: FeedbackCategoryConfig | null; forms: LearnerFeedbackListItem[]; loading: boolean; search: string; statusFilter: StatusFilter; totalForms: number; onCategoryChange: (category?: FeedbackCategory) => void; onOpen: (form: LearnerFeedbackListItem) => void; onRefresh: () => Promise<void>; onSearchChange: (value: string) => void; onStatusChange: (value: StatusFilter) => void;
}) {
  const categoryOptions: ThemedSelectOption<CategoryFilter>[] = [
    { value: 'all', label: `All feedback types (${totalForms})` },
    ...categories.map(category => ({ value: category.id, label: category.title })),
  ];
  const statusOptions: ThemedSelectOption<StatusFilter>[] = [
    { value: 'all', label: 'All statuses' },
    { value: 'not_started', label: 'Not started' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'completed', label: 'Submitted' },
  ];
  return <section id="all-feedback" aria-labelledby="all-feedback-title" className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-white shadow-sm">
    <div className="border-b border-foreground-100 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-lg text-primary-700"><i className="ri-list-check-2" /></span><div><h2 id="all-feedback-title" className="font-heading text-base font-bold text-foreground-900">All feedback requests</h2><p className="mt-0.5 text-xs text-foreground-500">View and manage feedback assigned to you.</p></div></div><button type="button" disabled={loading} onClick={() => void onRefresh()} className="rounded-lg border border-foreground-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-50"><i className="ri-refresh-line mr-1" />Refresh</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_220px_170px]"><label className="relative block sm:col-span-2 lg:col-span-1"><span className="sr-only">Search feedback</span><i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" /><input value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Search feedback…" className="h-10 w-full rounded-lg border border-foreground-200 bg-background-50 pl-9 pr-3 text-sm text-foreground-800 outline-none transition placeholder:text-foreground-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100" /></label><ThemedSelect<CategoryFilter> value={activeCategory?.id || 'all'} options={categoryOptions} onChange={value => onCategoryChange(value === 'all' ? undefined : value)} buttonClassName="bg-background-50 shadow-none" /><ThemedSelect<StatusFilter> value={statusFilter} options={statusOptions} onChange={onStatusChange} buttonClassName="bg-background-50 shadow-none" /></div>
    </div>
    <div className="hidden grid-cols-[minmax(180px,1.1fr)_minmax(220px,1.6fr)_120px_110px] gap-4 bg-[#AEB8C5] px-5 py-3 text-[10px] font-bold uppercase tracking-wide text-white md:grid"><span>Feedback type</span><span>Related to / event info</span><span>Status</span><span className="text-center">Action</span></div>
    {loading ? <div className="p-10 text-center text-sm text-foreground-400">Loading feedback…</div> : forms.length ? <div className="divide-y divide-foreground-100">{forms.map(form => <FeedbackRow key={formKey(form)} form={form} onOpen={onOpen} />)}</div> : <EmptyFeedback filtered={Boolean(search || activeCategory || statusFilter !== 'all')} />}
  </section>;
}

function FeedbackRow({ form, onOpen }: { form: LearnerFeedbackListItem; onOpen: (form: LearnerFeedbackListItem) => void }) {
  const category = categoryConfig(form);
  return <div className="grid gap-3 px-5 py-4 transition hover:bg-primary-50/30 md:grid-cols-[minmax(180px,1.1fr)_minmax(220px,1.6fr)_120px_110px] md:items-center md:gap-4"><div className="flex min-w-0 items-center gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ring-1 ${category.tone}`}><i className={category.icon} /></span><div className="min-w-0"><p className="truncate text-sm font-bold text-foreground-900">{category.title}</p><p className="mt-0.5 truncate text-[11px] text-foreground-500">{form.title}</p></div></div><div className="min-w-0 md:pl-0"><p className="truncate text-sm font-semibold text-foreground-800">{form.sessionTitle || form.moduleName || form.title}</p>{form.moduleName && form.moduleName !== form.sessionTitle && <p className="mt-0.5 truncate text-xs text-foreground-500">{form.moduleName}</p>}<FeedbackDate form={form} /></div><div><Status status={form.status} /></div><button type="button" aria-label={`${actionLabel(form.status)} ${form.sessionTitle || form.title}`} onClick={() => onOpen(form)} className={`inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${form.status === 'completed' ? 'border border-primary-300 bg-white text-primary-700 hover:bg-primary-50' : 'bg-primary-600 text-white shadow-sm hover:bg-primary-700'}`}>{actionLabel(form.status)}{form.status !== 'completed' && <i className="ri-arrow-right-line ml-1.5" />}</button></div>;
}

function FeedbackDate({ form, compact = false }: { form: LearnerFeedbackListItem; compact?: boolean }) {
  const primaryDate = form.sessionStartsAt || form.assignedAt;
  return <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-500 ${compact ? 'mt-1' : 'mt-1.5'}`}>{primaryDate && <span><i className="ri-calendar-line mr-1 text-primary-600" />{form.sessionStartsAt ? formatDateTime(primaryDate) : `Assigned ${formatDate(primaryDate)}`}</span>}{form.dueDate && <span className="font-medium text-rose-600"><i className="ri-time-line mr-1" />Due {formatDate(form.dueDate)}</span>}</div>;
}

function FeedbackSummary({ categories, forms, loading }: { categories: FeedbackCategoryConfig[]; forms: LearnerFeedbackListItem[]; loading: boolean }) {
  const completed = forms.filter(form => form.status === 'completed').length;
  const inProgress = forms.filter(form => form.status === 'in_progress').length;
  const notStarted = forms.length - completed - inProgress;
  const completion = forms.length ? Math.round((completed / forms.length) * 100) : 0;
  const stats = [['Submitted', completed, 'ri-check-line', 'bg-emerald-50 text-emerald-700'], ['In progress', inProgress, 'ri-time-line', 'bg-amber-50 text-amber-700'], ['Not started', notStarted, 'ri-subtract-line', 'bg-slate-100 text-slate-600']] as const;
  return <section aria-labelledby="feedback-summary-title" className="rounded-2xl border border-foreground-200/70 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-lg text-primary-700"><i className="ri-bar-chart-box-line" /></span><div><h2 id="feedback-summary-title" className="font-heading text-base font-bold text-foreground-900">Your feedback summary</h2><p className="mt-0.5 text-xs text-foreground-500">An overview of your feedback activity. This does not include your answers.</p></div></div><div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{stats.map(([label, value, icon, tone]) => <div key={label} className={`rounded-xl p-4 ${tone}`}><i className={`${icon} text-xl`} /><p className="mt-3 text-2xl font-bold">{loading ? '—' : value}</p><p className="mt-0.5 text-xs font-semibold">{label}</p></div>)}<div className="rounded-xl bg-primary-50 p-4 text-primary-800"><div className="flex items-center gap-3"><span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white text-xs font-bold shadow-inner">{loading ? '—' : `${completion}%`}</span><div><p className="text-sm font-bold">Completion rate</p><p className="text-[11px] text-primary-600">{completed} of {forms.length} submitted</p></div></div></div></div><div><p className="mb-3 text-xs font-bold text-foreground-700">Submitted by feedback type</p><div className="space-y-2">{categories.map(category => { const categoryForms = forms.filter(form => categoryFor(form) === category.id); const categoryCompleted = categoryForms.filter(form => form.status === 'completed').length; const width = categoryForms.length ? (categoryCompleted / categoryForms.length) * 100 : 0; return <div key={category.id} className="grid grid-cols-[110px_minmax(0,1fr)_36px] items-center gap-2 text-[11px]"><span className="truncate text-foreground-600">{category.shortTitle}</span><span className="h-2 overflow-hidden rounded-full bg-background-300"><span className={`block h-full rounded-full ${category.bar}`} style={{ width: `${width}%` }} /></span><span className="text-right font-semibold text-foreground-500">{categoryCompleted}/{categoryForms.length}</span></div>; })}</div></div></div></section>;
}

function EmptyFeedback({ filtered }: { filtered: boolean }) {
  return <div className="p-12 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-background-200 text-2xl text-foreground-500"><i className={filtered ? 'ri-search-line' : 'ri-survey-line'} /></span><h2 className="mt-4 text-base font-semibold text-foreground-800">{filtered ? 'No feedback matches these filters' : 'No feedback assigned'}</h2><p className="mt-1 text-sm text-foreground-400">{filtered ? 'Try changing your search, type or status.' : 'New requests will appear here when they are assigned to you.'}</p></div>;
}

function categoryFor(form: LearnerFeedbackListItem): FeedbackCategory {
  const type: FeedbackFormType = form.formType || (form.deliveryId ? 'post_lecture' : form.eventRecipientId ? 'post_event' : 'general');
  if (type === 'post_lecture') return 'lecture';
  if (type === 'mid_module') return 'mid-module';
  if (type === 'end_module') return 'end-module';
  if (type === 'post_mcm_review') return 'mcm';
  if (type === 'post_progress_review') return 'progress-review';
  if (type === 'post_event') return 'event';
  return 'general';
}

function categoryConfig(form: LearnerFeedbackListItem) { return CATEGORIES.find(category => category.id === categoryFor(form)) || CATEGORIES[CATEGORIES.length - 1]; }
function formKey(form: LearnerFeedbackListItem) { return form.reviewDeliveryId ? `review-${form.reviewDeliveryId}` : form.eventRecipientId ? `event-${form.eventRecipientId}-${form.id}` : form.deliveryId ? `delivery-${form.deliveryId}` : `form-${form.id}`; }
function dateValue(form: LearnerFeedbackListItem) { const value = form.dueDate || form.sessionStartsAt || form.assignedAt; return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER; }
function compareFeedbackPriority(left: LearnerFeedbackListItem, right: LearnerFeedbackListItem) { const rank = { in_progress: 0, not_started: 1, completed: 2 }; return rank[left.status] - rank[right.status] || dateValue(left) - dateValue(right); }
function actionLabel(status: LearnerFeedbackStatus) { return status === 'completed' ? 'View' : status === 'in_progress' ? 'Continue' : 'Start'; }
function Status({ status }: { status: LearnerFeedbackStatus }) { const config = status === 'completed' ? ['bg-emerald-100 text-emerald-700', 'ri-checkbox-circle-line', 'Submitted'] : status === 'in_progress' ? ['bg-amber-100 text-amber-700', 'ri-time-line', 'In progress'] : ['bg-rose-100 text-rose-700', 'ri-time-line', 'Not started']; return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${config[0]}`}><i className={`${config[1]} mr-1`} />{config[2]}</span>; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
function formatDateTime(value: string) { return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }

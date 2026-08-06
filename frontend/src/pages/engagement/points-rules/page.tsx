import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import { ENGAGEMENT_LEARNERS } from '@/mocks/engagement-data';
import {
  fetchPointsRules, createPointsRule, updatePointsRule, fetchRuleGrants,
  type EngagementPointsRule as PointsRule, type EngagementPointsGrant,
} from '@/api/engagement';
import { RuleCardSkeletonGrid } from '@/pages/engagement/EngagementSkeletons';

const engagementNav = roleNavMap.engagement;

// Small hover info box, portalled to <body> so it can't be clipped by an
// ancestor's overflow-hidden (the rules list card rounds its corners).
function InfoTooltip({ label, text }: { label: string; text: string }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function show() {
    const rect = iconRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.top - 8, left: rect.left + rect.width / 2 });
  }

  return (
    <span
      ref={iconRef}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-background-200/70 text-foreground-500 hover:bg-primary-100 hover:text-primary-600 cursor-help transition-smooth"
    >
      <AppIcon className="ri-question-line text-[10px]"></AppIcon>
      {pos && createPortal(
        <div
          className="fixed z-[100] w-56 -translate-x-1/2 -translate-y-full rounded-lg bg-foreground-900 text-white text-[11px] leading-snug px-3 py-2 shadow-xl pointer-events-none"
          style={{ top: pos.top, left: pos.left }}
        >
          <p className="font-semibold text-[10px] uppercase tracking-wide text-white/60 mb-0.5">{label}</p>
          {text}
          <span className="absolute left-1/2 top-full -translate-x-1/2 -mt-px w-2 h-2 bg-foreground-900 rotate-45"></span>
        </div>,
        document.body,
      )}
    </span>
  );
}

// PointsRule / EngagementPointsGrant types come from the api module.
// learnersImpacted + totalPointsAwarded are aggregates the backend computes
// from the grants table, not stored columns.

const LEARNER_BY_ID = new Map(ENGAGEMENT_LEARNERS.map(l => [l.id, l]));

// Visual weight banding so a 100pt rule doesn't look the same as a 5pt one.
function pointsBand(points: number) {
  if (points >= 50) return { wrap: 'w-11 h-11 bg-amber-100 text-amber-700', text: 'text-base' };
  if (points >= 15) return { wrap: 'w-10 h-10 bg-accent-100 text-accent-600', text: 'text-sm' };
  return { wrap: 'w-9 h-9 bg-background-200 text-foreground-500', text: 'text-xs' };
}

type SortKey = 'points' | 'learners' | 'name';

interface RuleFormData {
  name: string;
  description: string;
  points: number;
  category: string;
  frequency: string;
  trigger: string;
  active: boolean;
}

interface FormErrors {
  name?: string;
  description?: string;
  points?: string;
  category?: string;
  frequency?: string;
  trigger?: string;
}

const blankForm: RuleFormData = { name: '', description: '', points: 10, category: '', frequency: '', trigger: '', active: true };

function validateForm(form: RuleFormData): FormErrors {
  const errs: FormErrors = {};
  if (!form.name.trim()) errs.name = 'Rule name is required';
  else if (form.name.trim().length < 3) errs.name = 'Name must be at least 3 characters';
  if (!form.description.trim()) errs.description = 'Description is required';
  if (!form.points || form.points <= 0) errs.points = 'Points must be greater than 0';
  else if (form.points > 500) errs.points = 'Maximum 500 points per rule';
  if (!form.category.trim()) errs.category = 'Category is required';
  if (!form.frequency.trim()) errs.frequency = 'Frequency is required';
  if (!form.trigger.trim()) errs.trigger = 'How to obtain is required';
  return errs;
}

function RuleForm({
  form, errors, setForm, setErrors, categories,
}: {
  form: RuleFormData; errors: FormErrors; setForm: (fn: (f: RuleFormData) => RuleFormData) => void; setErrors: (fn: (e: FormErrors) => FormErrors) => void; categories: string[];
}) {
  function field<K extends keyof RuleFormData>(key: K, value: RuleFormData[K]) {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(errs => { const n = { ...errs }; delete n[key as keyof FormErrors]; return n; });
  }
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Rule Name <span className="text-red-500">*</span></label>
        <input type="text" value={form.name} onChange={e => field('name', e.target.value)} placeholder="e.g. Session Attendance" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.name ? 'border-red-300' : 'border-foreground-200/60'}`} />
        {errors.name && <p className="text-[10px] text-red-500 mt-1">{errors.name}</p>}
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Description <span className="text-red-500">*</span></label>
        <textarea value={form.description} onChange={e => field('description', e.target.value)} rows={2} maxLength={200} placeholder="What does a learner do to earn this?" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none ${errors.description ? 'border-red-300' : 'border-foreground-200/60'}`}></textarea>
        {errors.description && <p className="text-[10px] text-red-500 mt-1">{errors.description}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Points <span className="text-red-500">*</span></label>
          <input type="number" value={form.points} onChange={e => field('points', parseInt(e.target.value) || 0)} min={1} max={500} className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.points ? 'border-red-300' : 'border-foreground-200/60'}`} />
          {errors.points && <p className="text-[10px] text-red-500 mt-1">{errors.points}</p>}
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Category <span className="text-red-500">*</span></label>
          <input type="text" list="points-rule-categories" value={form.category} onChange={e => field('category', e.target.value)} placeholder="e.g. Attendance" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.category ? 'border-red-300' : 'border-foreground-200/60'}`} />
          <datalist id="points-rule-categories">
            {categories.map(c => <option key={c} value={c} />)}
          </datalist>
          {errors.category && <p className="text-[10px] text-red-500 mt-1">{errors.category}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Frequency <span className="text-red-500">*</span></label>
          <input type="text" value={form.frequency} onChange={e => field('frequency', e.target.value)} placeholder="e.g. Per session" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.frequency ? 'border-red-300' : 'border-foreground-200/60'}`} />
          {errors.frequency && <p className="text-[10px] text-red-500 mt-1">{errors.frequency}</p>}
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">How to Obtain <span className="text-red-500">*</span></label>
          <input type="text" value={form.trigger} onChange={e => field('trigger', e.target.value)} placeholder="e.g. Automatic on attendance mark" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.trigger ? 'border-red-300' : 'border-foreground-200/60'}`} />
          {errors.trigger && <p className="text-[10px] text-red-500 mt-1">{errors.trigger}</p>}
        </div>
      </div>
      <p className="text-[10px] text-foreground-400 -mt-2">"How to Obtain" is shown in the info hover next to the rule name.</p>
      <label className="flex items-center gap-2 text-[12px] text-foreground-600 cursor-pointer">
        <input type="checkbox" checked={form.active} onChange={e => field('active', e.target.checked)} className="w-4 h-4 rounded border-background-300 accent-primary-500 cursor-pointer" />
        Rule is active
      </label>
    </div>
  );
}

export default function PointsRulesPage() {
  const navigate = useNavigate();
  const { success, warning } = useToast();
  const [rules, setRules] = useState<PointsRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('points');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<RuleFormData>({ ...blankForm });
  const [addErrors, setAddErrors] = useState<FormErrors>({});

  const [editRuleId, setEditRuleId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RuleFormData>({ ...blankForm });
  const [editErrors, setEditErrors] = useState<FormErrors>({});

  const [statsRuleId, setStatsRuleId] = useState<string | null>(null);
  const [logsRuleId, setLogsRuleId] = useState<string | null>(null);
  const [logsGrants, setLogsGrants] = useState<EngagementPointsGrant[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPointsRules()
      .then(data => { if (!cancelled) setRules(data); })
      .catch(err => { if (!cancelled) warning('Could not load rules', err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warning]);

  // Fetch the grant history for whichever rule's Logs modal is open.
  useEffect(() => {
    if (!logsRuleId) { setLogsGrants([]); return; }
    let cancelled = false;
    setLogsLoading(true);
    fetchRuleGrants(logsRuleId)
      .then(data => { if (!cancelled) setLogsGrants(data); })
      .catch(err => { if (!cancelled) warning('Could not load grant history', err.message); })
      .finally(() => { if (!cancelled) setLogsLoading(false); });
    return () => { cancelled = true; };
  }, [logsRuleId, warning]);

  const categories = useMemo(() => Array.from(new Set(rules.map(r => r.category))).sort(), [rules]);
  const totalPoints = rules.reduce((s, r) => s + r.totalPointsAwarded, 0);
  const activeRules = rules.filter(r => r.active).length;

  const filtered = useMemo(() => {
    let list = rules.filter(r => {
      const matchCat = categoryFilter === 'all' || r.category === categoryFilter;
      const matchActive = !activeOnly || r.active;
      const matchSearch = !search.trim() || r.name.toLowerCase().includes(search.toLowerCase()) || r.description.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchActive && matchSearch;
    });
    list = [...list].sort((a, b) => {
      let va: number | string, vb: number | string;
      switch (sortKey) {
        case 'name': va = a.name; vb = b.name; break;
        case 'learners': va = a.learnersImpacted; vb = b.learnersImpacted; break;
        default: va = a.points; vb = b.points;
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? va - (vb as number) : (vb as number) - va;
    });
    return list;
  }, [rules, categoryFilter, activeOnly, search, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  function openAddModal() {
    setAddForm({ ...blankForm });
    setAddErrors({});
    setShowAddModal(true);
  }

  async function handleAdd() {
    const errs = validateForm(addForm);
    if (Object.keys(errs).length > 0) { setAddErrors(errs); return; }
    try {
      const created = await createPointsRule({
        name: addForm.name.trim(), description: addForm.description.trim(), points: addForm.points,
        category: addForm.category.trim(), frequency: addForm.frequency.trim(), trigger: addForm.trigger.trim(), active: addForm.active,
      });
      setRules(prev => [created, ...prev]);
      setShowAddModal(false);
      success(`Rule "${created.name}" created`);
    } catch (err: any) {
      warning('Could not create rule', err.message);
    }
  }

  function openEditModal(rule: PointsRule) {
    setEditForm({ name: rule.name, description: rule.description, points: rule.points, category: rule.category, frequency: rule.frequency, trigger: rule.trigger, active: rule.active });
    setEditErrors({});
    setEditRuleId(rule.id);
  }

  async function handleEdit() {
    if (!editRuleId) return;
    const errs = validateForm(editForm);
    if (Object.keys(errs).length > 0) { setEditErrors(errs); return; }
    try {
      const updated = await updatePointsRule(editRuleId, {
        name: editForm.name.trim(), description: editForm.description.trim(), points: editForm.points,
        category: editForm.category.trim(), frequency: editForm.frequency.trim(), trigger: editForm.trigger.trim(), active: editForm.active,
      });
      setRules(prev => prev.map(r => r.id === editRuleId ? updated : r));
      setEditRuleId(null);
      success(`Rule "${updated.name}" updated`);
    } catch (err: any) {
      warning('Could not update rule', err.message);
    }
  }

  async function toggleActive(rule: PointsRule) {
    const nextActive = !rule.active;
    try {
      const updated = await updatePointsRule(rule.id, { active: nextActive });
      setRules(prev => prev.map(r => r.id === rule.id ? updated : r));
      (nextActive ? success : warning)(`Rule "${rule.name}" ${nextActive ? 'activated' : 'deactivated'}`);
    } catch (err: any) {
      warning('Could not update rule', err.message);
    }
  }

  const statsRule = rules.find(r => r.id === statsRuleId) ?? null;
  const logsRule = rules.find(r => r.id === logsRuleId) ?? null;
  // Enrich each grant with the mocked learner's avatar/programme (owned by
  // another team); fall back to the name the grant itself stored.
  const logsEntries = logsGrants.map(g => {
    const learner = LEARNER_BY_ID.get(g.learnerId);
    return {
      id: g.id,
      name: learner?.name ?? g.learner,
      avatarImg: learner?.avatarImg,
      programme: learner?.programme ?? '',
      date: g.awardedAt,
      points: g.points,
    };
  });

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Points Rules" pageSubtitle="Configure engagement point rules, thresholds, and reward triggers"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Points Rules Engine"
          description={`${activeRules} active rules. ${totalPoints.toLocaleString()} total points awarded to date. ${rules.length} rules configured across ${categories.length} categories.`}
          icon="ri-gift-2-line"
          imageUrl="https://readdy.ai/api/search-image?query=points%20rewards%20gamification%20system%20modern%20dashboard%20warm%20professional%20lighting&width=400&height=160&seq=points-01&orientation=landscape"
          imageAlt="Points Rules"
          stats={[{ label: 'Active', value: String(activeRules) }, { label: 'Points', value: totalPoints.toLocaleString() }, { label: 'Categories', value: String(categories.length) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/rewards-shop')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-accent-50 hover:text-accent-600 hover:border-accent-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-shopping-bag-3-line text-sm"></AppIcon> Rewards Shop
          </button>
          <button onClick={() => navigate('/engagement/voucher-claims')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-coupon-line text-sm"></AppIcon> Voucher Claims
          </button>
          <button onClick={() => navigate('/engagement/recognition')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-thumb-up-line text-sm"></AppIcon> Recognition
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-heart-line text-sm"></AppIcon> Learner Engagement
          </button>
        </div>

        {/* Filters + Search + Add */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input type="text" placeholder="Search rules..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', ...categories].map(cat => (
              <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${categoryFilter === cat ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
          <button
            onClick={() => setActiveOnly(a => !a)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer border ${activeOnly ? 'bg-primary-50 text-primary-700 border-primary-200/50' : 'bg-background-100 text-foreground-500 border-transparent hover:text-foreground-700'}`}
          >
            <AppIcon className={activeOnly ? 'ri-toggle-fill text-sm' : 'ri-toggle-line text-sm'}></AppIcon> Active only
          </button>
          <div className="flex-1"></div>
          <button onClick={openAddModal} className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap shrink-0">
            <AppIcon className="ri-add-line mr-1"></AppIcon> Add Rule
          </button>
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="font-semibold text-foreground-500">Sort by:</span>
          {([
            { key: 'points' as SortKey, label: 'Points' },
            { key: 'learners' as SortKey, label: 'Learners Impacted' },
            { key: 'name' as SortKey, label: 'Name' },
          ]).map(opt => (
            <button key={opt.key} onClick={() => handleSort(opt.key)} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-smooth cursor-pointer whitespace-nowrap ${sortKey === opt.key ? 'bg-primary-50 text-primary-700 border border-primary-200/50' : 'text-foreground-500 hover:text-foreground-700 border border-transparent'}`}>
              {opt.label}
              {sortKey === opt.key && <AppIcon className={sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'}></AppIcon>}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-heading font-semibold text-foreground-900">Points Rules</span>
          <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} rules</span>
        </div>

        {loading && <RuleCardSkeletonGrid />}

        {!loading && filtered.length === 0 && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-10 flex flex-col items-center justify-center text-center gap-2">
            <AppIcon className="ri-search-line text-2xl text-foreground-300"></AppIcon>
            <p className="text-sm font-semibold text-foreground-700">No rules match this view</p>
            <p className="text-[11px] text-foreground-400">Try clearing the search, switching the category filter, or add a rule.</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {filtered.map(rule => {
            const band = pointsBand(rule.points);
            return (
              <div key={rule.id} className={`bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium hover:border-primary-200/50 transition-smooth ${rule.active ? '' : 'opacity-60 bg-background-100/40'}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className={`rounded-full flex items-center justify-center shrink-0 ${band.wrap}`}>
                    <span className={`font-bold ${band.text}`}>{rule.points}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[13px] font-semibold text-foreground-900 truncate">{rule.name}</span>
                      <InfoTooltip label="How to earn this" text={rule.trigger} />
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{rule.category}</span>
                      <button onClick={() => toggleActive(rule)} className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full cursor-pointer transition-smooth ${rule.active ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-foreground-100 text-foreground-500 hover:bg-foreground-200'}`}>
                        {rule.active ? 'Active' : 'Inactive'}
                      </button>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-foreground-500 mb-3 line-clamp-2">{rule.description}</p>
                <div className="flex items-center gap-3 text-[10px] text-foreground-400 mb-3 flex-wrap">
                  <span>Frequency: {rule.frequency}</span>
                  <span>{rule.learnersImpacted} learners</span>
                  <span>{rule.totalPointsAwarded} pts awarded</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => openEditModal(rule)} className="flex-1 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-edit-line mr-1"></AppIcon> Edit
                  </button>
                  <button onClick={() => setStatsRuleId(rule.id)} className="flex-1 px-3 py-1.5 bg-secondary-50 border border-secondary-200/50 text-secondary-700 rounded-lg text-[10px] font-medium hover:bg-secondary-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-bar-chart-line mr-1"></AppIcon> Stats
                  </button>
                  <button onClick={() => setLogsRuleId(rule.id)} className="flex-1 px-3 py-1.5 bg-primary-50 border border-primary-200/50 text-primary-700 rounded-lg text-[10px] font-medium hover:bg-primary-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-history-line mr-1"></AppIcon> Logs
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ADD RULE MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><AppIcon className="ri-gift-2-line text-lg"></AppIcon></span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-900">Add Rule</h3>
                  <p className="text-[11px] text-foreground-400">Create a new way for learners to earn points</p>
                </div>
              </div>
              <button onClick={() => setShowAddModal(false)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
            </div>
            <div className="p-5 overflow-y-auto">
              <RuleForm form={addForm} errors={addErrors} setForm={setAddForm} setErrors={setAddErrors} categories={categories} />
            </div>
            <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={handleAdd} className="px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 bg-primary-500 text-white hover:bg-primary-600">
                <AppIcon className="ri-add-line"></AppIcon> Create Rule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT RULE MODAL */}
      {editRuleId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditRuleId(null)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-accent-100 text-accent-600 flex items-center justify-center"><AppIcon className="ri-edit-line text-lg"></AppIcon></span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-900">Edit Rule</h3>
                  <p className="text-[11px] text-foreground-400">Update points, category, how to obtain, and status</p>
                </div>
              </div>
              <button onClick={() => setEditRuleId(null)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
            </div>
            <div className="p-5 overflow-y-auto">
              <RuleForm form={editForm} errors={editErrors} setForm={setEditForm} setErrors={setEditErrors} categories={categories} />
            </div>
            <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
              <button onClick={() => setEditRuleId(null)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={handleEdit} className="px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 bg-accent-500 text-white hover:bg-accent-600">
                <AppIcon className="ri-save-line"></AppIcon> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATS MODAL (read-only) */}
      {statsRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setStatsRuleId(null)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-md w-full overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-secondary-100 text-secondary-600 flex items-center justify-center"><AppIcon className="ri-bar-chart-line text-lg"></AppIcon></span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-900">{statsRule.name}</h3>
                  <p className="text-[11px] text-foreground-400">Rule performance</p>
                </div>
              </div>
              <button onClick={() => setStatsRuleId(null)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 mb-1">Learners Impacted</p>
                  <p className="font-semibold text-foreground-900 text-lg">{statsRule.learnersImpacted}</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 mb-1">Points Awarded</p>
                  <p className="font-semibold text-foreground-900 text-lg">{statsRule.totalPointsAwarded.toLocaleString()}</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 mb-1">Avg per Learner</p>
                  <p className="font-semibold text-foreground-900 text-lg">{statsRule.learnersImpacted > 0 ? Math.round(statsRule.totalPointsAwarded / statsRule.learnersImpacted) : 0}</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 mb-1">Share of Total Points</p>
                  <p className="font-semibold text-foreground-900 text-lg">{totalPoints > 0 ? Math.round((statsRule.totalPointsAwarded / totalPoints) * 100) : 0}%</p>
                </div>
              </div>
              <div className="bg-amber-50/50 rounded-lg p-3 text-[11px] text-amber-700">
                <span className="font-medium text-amber-800">How to obtain:</span> {statsRule.trigger} &middot; <span className="font-medium text-amber-800">Frequency:</span> {statsRule.frequency}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LOGS MODAL (read-only) */}
      {logsRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setLogsRuleId(null)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><AppIcon className="ri-history-line text-lg"></AppIcon></span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-900">{logsRule.name}</h3>
                  <p className="text-[11px] text-foreground-400">Most recent learners granted this rule</p>
                </div>
              </div>
              <button onClick={() => setLogsRuleId(null)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
            </div>
            <div className="overflow-y-auto">
              {logsLoading ? (
                <div className="p-8 flex flex-col items-center justify-center text-center gap-2">
                  <AppIcon className="ri-loader-4-line text-2xl text-foreground-300 animate-spin"></AppIcon>
                  <p className="text-[12px] font-semibold text-foreground-700">Loading grant history…</p>
                </div>
              ) : logsEntries.length === 0 ? (
                <div className="p-8 flex flex-col items-center justify-center text-center gap-2">
                  <AppIcon className="ri-history-line text-2xl text-foreground-300"></AppIcon>
                  <p className="text-[12px] font-semibold text-foreground-700">No grants recorded yet</p>
                  <p className="text-[11px] text-foreground-400">This rule hasn't been awarded to any learner.</p>
                </div>
              ) : (
                <div className="divide-y divide-background-200/30">
                  {logsEntries.map(entry => (
                    <div key={entry.id} className="p-3.5 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full shrink-0 overflow-hidden bg-background-200">
                        {entry.avatarImg ? (
                          <img src={entry.avatarImg} alt={entry.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[11px] font-bold bg-primary-100 text-primary-600">{entry.name.charAt(0)}</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-semibold text-foreground-900 truncate">{entry.name}</p>
                        <p className="text-[10px] text-foreground-400 truncate">{entry.programme ? `${entry.programme} · ` : ''}{entry.date}</p>
                      </div>
                      <span className="text-[11px] font-bold text-emerald-600 shrink-0">+{entry.points}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import { VOUCHER_CLAIMS, ENGAGEMENT_REWARDS, type RewardItem } from '@/mocks/engagement-data';

const engagementNav = roleNavMap.engagement;

// Placeholder artwork for rewards created via "Create Reward" — there's no
// image upload flow yet, so new items share a generic catalogue image.
const DEFAULT_REWARD_IMAGE = 'https://readdy.ai/api/search-image?query=generic%20gift%20reward%20box%20modern%20minimalist%20design&width=200&height=200&seq=reward-default&orientation=squarish';

const blankRewardForm: RewardFormData = { name: '', description: '', points: 100, category: '', deliveryType: 'digital', stock: 10, image: '', popular: false, active: true };

type SortKey = 'points' | 'stock' | 'claimed' | 'name';

interface RewardFormData {
  name: string;
  description: string;
  points: number;
  category: string;
  deliveryType: 'physical' | 'digital';
  stock: number;
  image: string;
  popular: boolean;
  active: boolean;
}

interface FormErrors {
  name?: string;
  description?: string;
  points?: string;
  category?: string;
  stock?: string;
  image?: string;
}

function validateForm(form: RewardFormData): FormErrors {
  const errs: FormErrors = {};
  if (!form.name.trim()) errs.name = 'Reward name is required';
  else if (form.name.trim().length < 3) errs.name = 'Name must be at least 3 characters';
  if (!form.description.trim()) errs.description = 'Description is required';
  if (!form.points || form.points <= 0) errs.points = 'Points must be greater than 0';
  else if (form.points > 5000) errs.points = 'Maximum 5000 points per reward';
  if (!form.category.trim()) errs.category = 'Category is required';
  if (form.stock < 0) errs.stock = 'Stock cannot be negative';
  if (form.image.trim() && !/^https?:\/\//i.test(form.image.trim())) errs.image = 'Must be a valid image URL (http/https)';
  return errs;
}

function RewardForm({
  form, errors, setForm, setErrors, categories,
}: {
  form: RewardFormData; errors: FormErrors; setForm: (fn: (f: RewardFormData) => RewardFormData) => void; setErrors: (fn: (e: FormErrors) => FormErrors) => void; categories: string[];
}) {
  function field<K extends keyof RewardFormData>(key: K, value: RewardFormData[K]) {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(errs => { const n = { ...errs }; delete n[key as keyof FormErrors]; return n; });
  }
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Reward Name <span className="text-red-500">*</span></label>
        <input type="text" value={form.name} onChange={e => field('name', e.target.value)} placeholder="e.g. Amazon Gift Card" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.name ? 'border-red-300' : 'border-foreground-200/60'}`} />
        {errors.name && <p className="text-[10px] text-red-500 mt-1">{errors.name}</p>}
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Description <span className="text-red-500">*</span></label>
        <textarea value={form.description} onChange={e => field('description', e.target.value)} rows={2} maxLength={150} placeholder="What does the learner get?" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none ${errors.description ? 'border-red-300' : 'border-foreground-200/60'}`}></textarea>
        {errors.description && <p className="text-[10px] text-red-500 mt-1">{errors.description}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Points <span className="text-red-500">*</span></label>
          <input type="number" value={form.points} onChange={e => field('points', parseInt(e.target.value) || 0)} min={1} max={5000} className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.points ? 'border-red-300' : 'border-foreground-200/60'}`} />
          {errors.points && <p className="text-[10px] text-red-500 mt-1">{errors.points}</p>}
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Category <span className="text-red-500">*</span></label>
          <input type="text" list="reward-categories" value={form.category} onChange={e => field('category', e.target.value)} placeholder="e.g. Voucher" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.category ? 'border-red-300' : 'border-foreground-200/60'}`} />
          <datalist id="reward-categories">
            {categories.map(c => <option key={c} value={c} />)}
          </datalist>
          {errors.category && <p className="text-[10px] text-red-500 mt-1">{errors.category}</p>}
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Stock <span className="text-red-500">*</span></label>
          <input type="number" value={form.stock} onChange={e => field('stock', parseInt(e.target.value) || 0)} min={0} className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.stock ? 'border-red-300' : 'border-foreground-200/60'}`} />
          {errors.stock && <p className="text-[10px] text-red-500 mt-1">{errors.stock}</p>}
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Delivery Type <span className="text-red-500">*</span></label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => field('deliveryType', 'digital')} className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-smooth cursor-pointer ${form.deliveryType === 'digital' ? 'border-primary-400 bg-primary-50' : 'border-foreground-200/60 bg-background-50 hover:border-foreground-300'}`}>
            <i className={`ri-mail-send-line text-base mt-0.5 ${form.deliveryType === 'digital' ? 'text-primary-600' : 'text-foreground-400'}`}></i>
            <span>
              <span className={`block text-[12px] font-semibold ${form.deliveryType === 'digital' ? 'text-primary-700' : 'text-foreground-700'}`}>Digital</span>
              <span className="block text-[10px] text-foreground-400">Sent by email automatically</span>
            </span>
          </button>
          <button type="button" onClick={() => field('deliveryType', 'physical')} className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-smooth cursor-pointer ${form.deliveryType === 'physical' ? 'border-primary-400 bg-primary-50' : 'border-foreground-200/60 bg-background-50 hover:border-foreground-300'}`}>
            <i className={`ri-box-3-line text-base mt-0.5 ${form.deliveryType === 'physical' ? 'text-primary-600' : 'text-foreground-400'}`}></i>
            <span>
              <span className={`block text-[12px] font-semibold ${form.deliveryType === 'physical' ? 'text-primary-700' : 'text-foreground-700'}`}>Physical</span>
              <span className="block text-[10px] text-foreground-400">Fulfilled to the learner's address</span>
            </span>
          </button>
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Image URL</label>
        <input type="text" value={form.image} onChange={e => field('image', e.target.value)} placeholder="Leave blank to use the default catalogue image" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.image ? 'border-red-300' : 'border-foreground-200/60'}`} />
        {errors.image && <p className="text-[10px] text-red-500 mt-1">{errors.image}</p>}
      </div>
      <div className="flex items-center gap-5">
        <label className="flex items-center gap-2 text-[12px] text-foreground-600 cursor-pointer">
          <input type="checkbox" checked={form.popular} onChange={e => field('popular', e.target.checked)} className="w-4 h-4 rounded border-background-300 accent-primary-500 cursor-pointer" />
          Mark as popular
        </label>
        <label className="flex items-center gap-2 text-[12px] text-foreground-600 cursor-pointer">
          <input type="checkbox" checked={form.active} onChange={e => field('active', e.target.checked)} className="w-4 h-4 rounded border-background-300 accent-primary-500 cursor-pointer" />
          Visible in shop
        </label>
      </div>
    </div>
  );
}

export default function RewardsShopPage() {
  const navigate = useNavigate();
  const { success, warning } = useToast();
  const [rewards, setRewards] = useState<RewardItem[]>(ENGAGEMENT_REWARDS);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'digital' | 'physical'>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('claimed');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<RewardFormData>({ ...blankRewardForm });
  const [addErrors, setAddErrors] = useState<FormErrors>({});

  const [editRewardId, setEditRewardId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RewardFormData>({ ...blankRewardForm });
  const [editErrors, setEditErrors] = useState<FormErrors>({});

  const [statsRewardId, setStatsRewardId] = useState<string | null>(null);

  const categories = useMemo(() => Array.from(new Set(rewards.map(r => r.category))).sort(), [rewards]);
  const totalClaimed = rewards.reduce((s, r) => s + r.totalClaimed, 0);
  const lowStockCount = rewards.filter(r => r.stock > 0 && r.stock < 10).length;
  const outOfStockCount = rewards.filter(r => r.stock === 0).length;

  const filtered = useMemo(() => {
    let list = rewards.filter(r => {
      const matchCat = categoryFilter === 'all' || r.category === categoryFilter;
      const matchType = typeFilter === 'all' || r.deliveryType === typeFilter;
      const matchVisibility = visibilityFilter === 'all' || (visibilityFilter === 'visible' ? r.active : !r.active);
      const matchSearch = !search.trim() || r.name.toLowerCase().includes(search.toLowerCase()) || r.description.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchType && matchVisibility && matchSearch;
    });
    list = [...list].sort((a, b) => {
      let va: number | string, vb: number | string;
      switch (sortKey) {
        case 'name': va = a.name; vb = b.name; break;
        case 'stock': va = a.stock; vb = b.stock; break;
        case 'claimed': va = a.totalClaimed; vb = b.totalClaimed; break;
        default: va = a.points; vb = b.points;
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? va - (vb as number) : (vb as number) - va;
    });
    return list;
  }, [rewards, categoryFilter, typeFilter, visibilityFilter, search, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  function openAddModal() {
    setAddForm({ ...blankRewardForm });
    setAddErrors({});
    setShowAddModal(true);
  }

  function handleAdd() {
    const errs = validateForm(addForm);
    if (Object.keys(errs).length > 0) { setAddErrors(errs); return; }
    const name = addForm.name.trim();
    const points = addForm.points;
    const category = addForm.category.trim();
    setRewards(prev => [{
      // Counter derived from the current list, not Date.now() — two creations
      // in the same millisecond would otherwise generate the same id.
      id: `rw-new-${prev.length + 1}`,
      name, description: addForm.description.trim(), points,
      category, deliveryType: addForm.deliveryType, stock: addForm.stock, popular: addForm.popular, active: addForm.active,
      totalClaimed: 0, image: addForm.image.trim() || DEFAULT_REWARD_IMAGE,
    }, ...prev]);
    setShowAddModal(false);
    success(`Reward "${name}" created`, `${points} pts · ${category}`);
  }

  function openEditModal(reward: RewardItem) {
    setEditForm({ name: reward.name, description: reward.description, points: reward.points, category: reward.category, deliveryType: reward.deliveryType, stock: reward.stock, image: reward.image === DEFAULT_REWARD_IMAGE ? '' : reward.image, popular: reward.popular, active: reward.active });
    setEditErrors({});
    setEditRewardId(reward.id);
  }

  function handleEdit() {
    const errs = validateForm(editForm);
    if (Object.keys(errs).length > 0) { setEditErrors(errs); return; }
    setRewards(prev => prev.map(r => r.id === editRewardId ? { ...r, ...editForm, name: editForm.name.trim(), description: editForm.description.trim(), category: editForm.category.trim(), image: editForm.image.trim() || DEFAULT_REWARD_IMAGE } : r));
    setEditRewardId(null);
    success(`Reward "${editForm.name.trim()}" updated`);
  }

  function toggleActive(reward: RewardItem) {
    const nextActive = !reward.active;
    setRewards(prev => prev.map(r => r.id === reward.id ? { ...r, active: nextActive } : r));
    (nextActive ? success : warning)(`Reward "${reward.name}" ${nextActive ? 'shown in' : 'hidden from'} the shop`);
  }

  const statsReward = rewards.find(r => r.id === statsRewardId) ?? null;
  const statsClaims = statsReward ? VOUCHER_CLAIMS.filter(c => c.reward === statsReward.name) : [];

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Rewards Shop" pageSubtitle="Manage the learner rewards catalogue with vouchers and merchandise"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Rewards Shop"
          description={`${rewards.length} rewards in the catalogue. ${totalClaimed} total claims. ${lowStockCount} low stock, ${outOfStockCount} out of stock.`}
          icon="ri-shopping-bag-3-line"
          imageUrl="https://readdy.ai/api/search-image?query=rewards%20shop%20catalogue%20gift%20cards%20modern%20warm%20professional%20display&width=400&height=160&seq=rewards-shop-01&orientation=landscape"
          imageAlt="Rewards Shop"
          stats={[{ label: 'Items', value: String(rewards.length) }, { label: 'Claimed', value: String(totalClaimed) }, { label: 'Low/Out of Stock', value: String(lowStockCount + outOfStockCount), variant: lowStockCount + outOfStockCount > 0 ? 'danger' : undefined }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/points-rules')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-accent-50 hover:text-accent-600 hover:border-accent-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-gift-2-line text-sm"></i> Points Rules
          </button>
          <button onClick={() => navigate('/engagement/voucher-claims')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-coupon-line text-sm"></i> Voucher Claims
          </button>
          <button onClick={() => navigate('/engagement/recognition')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-thumb-up-line text-sm"></i> Recognition
          </button>
        </div>

        {/* Search + Category filter */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" placeholder="Search rewards..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
            {['all', ...categories].map(cat => (
              <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${categoryFilter === cat ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
            {(['all', 'digital', 'physical'] as const).map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === t ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                <i className={t === 'all' ? 'ri-list-check' : t === 'digital' ? 'ri-mail-send-line' : 'ri-box-3-line'}></i>
                {t === 'all' ? 'All Types' : t === 'digital' ? 'Digital' : 'Physical'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
            {(['all', 'visible', 'hidden'] as const).map(v => (
              <button key={v} onClick={() => setVisibilityFilter(v)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${visibilityFilter === v ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                <i className={v === 'all' ? 'ri-list-check' : v === 'visible' ? 'ri-eye-line' : 'ri-eye-off-line'}></i>
                {v === 'all' ? 'All' : v === 'visible' ? 'Visible' : 'Hidden'}
              </button>
            ))}
          </div>
          <div className="flex-1"></div>
          <button onClick={openAddModal} className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap shrink-0">
            <i className="ri-add-line mr-1"></i> Create Reward
          </button>
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="font-semibold text-foreground-500">Sort by:</span>
          {([
            { key: 'claimed' as SortKey, label: 'Most Claimed' },
            { key: 'points' as SortKey, label: 'Points' },
            { key: 'stock' as SortKey, label: 'Stock' },
            { key: 'name' as SortKey, label: 'Name' },
          ]).map(opt => (
            <button key={opt.key} onClick={() => handleSort(opt.key)} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-smooth cursor-pointer whitespace-nowrap ${sortKey === opt.key ? 'bg-primary-50 text-primary-700 border border-primary-200/50' : 'text-foreground-500 hover:text-foreground-700 border border-transparent'}`}>
              {opt.label}
              {sortKey === opt.key && <i className={sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'}></i>}
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-10 flex flex-col items-center justify-center text-center gap-2">
            <i className="ri-search-line text-2xl text-foreground-300"></i>
            <p className="text-sm font-semibold text-foreground-700">No rewards match this view</p>
            <p className="text-[11px] text-foreground-400">Try clearing the search or switching the category/type/visibility filter.</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {filtered.map(reward => (
            <div key={reward.id} className={`bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden card-premium hover:border-primary-200/50 transition-smooth ${reward.active ? '' : 'opacity-60'}`}>
              <div className="relative h-32 bg-background-100">
                <img src={reward.image} alt={reward.name} className="w-full h-full object-cover" />
                {reward.popular && <span className="absolute top-2 right-2 bg-accent-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">POPULAR</span>}
                {reward.stock === 0 ? (
                  <span className="absolute top-2 left-2 bg-foreground-900 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">OUT OF STOCK</span>
                ) : reward.stock < 10 && (
                  <span className="absolute top-2 left-2 bg-red-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">LOW STOCK</span>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-foreground-400">{reward.category}</span>
                  <span className="text-[10px] font-bold text-accent-600">{reward.points} pts</span>
                </div>
                <div className="flex items-center gap-2 mb-1 min-w-0">
                  <h4 className="text-[13px] font-semibold text-foreground-900 truncate min-w-0">{reward.name}</h4>
                  <button onClick={() => toggleActive(reward)} className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full cursor-pointer transition-smooth shrink-0 ${reward.active ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-foreground-100 text-foreground-500 hover:bg-foreground-200'}`}>
                    {reward.active ? 'Visible' : 'Hidden'}
                  </button>
                </div>
                <span className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full mb-2 ${reward.deliveryType === 'digital' ? 'bg-primary-100 text-primary-700' : 'bg-amber-100 text-amber-700'}`}>
                  <i className={reward.deliveryType === 'digital' ? 'ri-mail-send-line' : 'ri-box-3-line'}></i>
                  {reward.deliveryType === 'digital' ? 'Digital · Sent by email' : 'Physical · Fulfilled to learner'}
                </span>
                <p className="text-[10px] text-foreground-400 mb-3 line-clamp-2">{reward.description}</p>
                <div className="flex items-center justify-between text-[10px] text-foreground-400">
                  <span>Stock: {reward.stock}</span>
                  <span>Claimed: {reward.totalClaimed}</span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={() => openEditModal(reward)} className="flex-1 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-edit-line mr-1"></i> Edit
                  </button>
                  <button onClick={() => setStatsRewardId(reward.id)} className="flex-1 px-3 py-1.5 bg-secondary-50 border border-secondary-200/50 text-secondary-700 rounded-lg text-[10px] font-medium hover:bg-secondary-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-bar-chart-line mr-1"></i> Stats
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ADD REWARD MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><i className="ri-shopping-bag-3-line text-lg"></i></span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-900">Create Reward</h3>
                  <p className="text-[11px] text-foreground-400">Add a new item to the rewards catalogue</p>
                </div>
              </div>
              <button onClick={() => setShowAddModal(false)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><i className="ri-close-line text-lg"></i></button>
            </div>
            <div className="p-5 overflow-y-auto">
              <RewardForm form={addForm} errors={addErrors} setForm={setAddForm} setErrors={setAddErrors} categories={categories} />
            </div>
            <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={handleAdd} className="px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 bg-primary-500 text-white hover:bg-primary-600">
                <i className="ri-add-line"></i> Create Reward
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT REWARD MODAL */}
      {editRewardId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditRewardId(null)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-accent-100 text-accent-600 flex items-center justify-center"><i className="ri-edit-line text-lg"></i></span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-900">Edit Reward</h3>
                  <p className="text-[11px] text-foreground-400">Update points, stock, and visibility</p>
                </div>
              </div>
              <button onClick={() => setEditRewardId(null)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><i className="ri-close-line text-lg"></i></button>
            </div>
            <div className="p-5 overflow-y-auto">
              <RewardForm form={editForm} errors={editErrors} setForm={setEditForm} setErrors={setEditErrors} categories={categories} />
            </div>
            <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
              <button onClick={() => setEditRewardId(null)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={handleEdit} className="px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 bg-accent-500 text-white hover:bg-accent-600">
                <i className="ri-save-line"></i> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATS MODAL (read-only) */}
      {statsReward && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setStatsRewardId(null)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-secondary-100 text-secondary-600 flex items-center justify-center"><i className="ri-bar-chart-line text-lg"></i></span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-900">{statsReward.name}</h3>
                  <p className="text-[11px] text-foreground-400">Reward performance</p>
                </div>
              </div>
              <button onClick={() => setStatsRewardId(null)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><i className="ri-close-line text-lg"></i></button>
            </div>
            <div className="overflow-y-auto">
              <div className="p-5 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div className="bg-background-100/50 rounded-lg p-3">
                    <p className="text-[10px] text-foreground-400 mb-1">Total Claimed</p>
                    <p className="font-semibold text-foreground-900 text-lg">{statsReward.totalClaimed}</p>
                  </div>
                  <div className="bg-background-100/50 rounded-lg p-3">
                    <p className="text-[10px] text-foreground-400 mb-1">Stock Remaining</p>
                    <p className="font-semibold text-foreground-900 text-lg">{statsReward.stock}</p>
                  </div>
                  <div className="bg-background-100/50 rounded-lg p-3">
                    <p className="text-[10px] text-foreground-400 mb-1">Points Cost</p>
                    <p className="font-semibold text-foreground-900 text-lg">{statsReward.points}</p>
                  </div>
                  <div className="bg-background-100/50 rounded-lg p-3">
                    <p className="text-[10px] text-foreground-400 mb-1">Status</p>
                    <p className={`font-semibold text-lg ${statsReward.active ? 'text-emerald-600' : 'text-foreground-400'}`}>{statsReward.active ? 'Visible' : 'Hidden'}</p>
                  </div>
                </div>
              </div>
              <div className="px-5 pb-5">
                <p className="text-[11px] font-medium text-foreground-800">Recent Claims</p>
                <p className="text-[10px] text-foreground-400 mb-2">Sample of recent activity from the voucher claims log — not the full history behind "Total Claimed".</p>
                {statsClaims.length === 0 ? (
                  <div className="bg-background-100/50 rounded-lg p-4 text-center text-[11px] text-foreground-400">
                    No claims recorded for this reward yet.
                  </div>
                ) : (
                  <div className="divide-y divide-background-200/30 border border-foreground-200/60 rounded-lg overflow-hidden">
                    {statsClaims.map(claim => (
                      <div key={claim.id} className="p-3 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full shrink-0 overflow-hidden bg-background-200">
                          {claim.avatarImg ? (
                            <img src={claim.avatarImg} alt={claim.learner} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[11px] font-bold bg-primary-100 text-primary-600">{claim.learner.charAt(0)}</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-semibold text-foreground-900 truncate">{claim.learner}</p>
                          <p className="text-[10px] text-foreground-400 truncate">{claim.requestedAt}</p>
                        </div>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${claim.status === 'pending' ? 'bg-amber-100 text-amber-700' : claim.status === 'approved' ? 'bg-primary-100 text-primary-700' : claim.status === 'fulfilled' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{claim.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}

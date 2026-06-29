import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface RewardItem {
  id: string;
  name: string;
  description: string;
  points: number;
  category: string;
  stock: number;
  totalClaimed: number;
  image: string;
  popular: boolean;
}

const REWARDS: RewardItem[] = [
  { id: 'rw-01', name: 'Amazon Gift Card', description: '&pound;10 Amazon gift card for online purchases', points: 500, category: 'Voucher', stock: 24, totalClaimed: 156, image: 'https://readdy.ai/api/search-image?query=Amazon%20gift%20card%20voucher%20online%20shopping%20modern%20clean&width=200&height=200&seq=reward-amazon&orientation=squarish', popular: true },
  { id: 'rw-02', name: 'Coffee Shop Voucher', description: '&pound;5 voucher for major coffee chains', points: 250, category: 'Voucher', stock: 45, totalClaimed: 89, image: 'https://readdy.ai/api/search-image?query=professional%20coffee%20shop%20voucher%20warm%20modern%20design&width=200&height=200&seq=reward-coffee&orientation=squarish', popular: true },
  { id: 'rw-03', name: 'Stationery Kit', description: 'Premium notebook, pens, and highlighters', points: 300, category: 'Merchandise', stock: 18, totalClaimed: 42, image: 'https://readdy.ai/api/search-image?query=premium%20stationery%20kit%20notebook%20pen%20highlighter%20modern%20professional&width=200&height=200&seq=reward-stationery&orientation=squarish', popular: false },
  { id: 'rw-04', name: 'Book Voucher', description: '&pound;15 voucher for any book retailer', points: 750, category: 'Voucher', stock: 12, totalClaimed: 67, image: 'https://readdy.ai/api/search-image?query=book%20voucher%20reading%20education%20modern%20design&width=200&height=200&seq=reward-book&orientation=squarish', popular: false },
  { id: 'rw-05', name: 'Laptop Bag', description: 'Professional laptop bag with KBC branding', points: 1000, category: 'Merchandise', stock: 8, totalClaimed: 23, image: 'https://readdy.ai/api/search-image?query=professional%20laptop%20bag%20modern%20design%20clean%20aesthetic&width=200&height=200&seq=reward-bag&orientation=squarish', popular: true },
  { id: 'rw-06', name: 'Water Bottle', description: 'Insulated stainless steel water bottle', points: 200, category: 'Merchandise', stock: 32, totalClaimed: 78, image: 'https://readdy.ai/api/search-image?query=insulated%20stainless%20steel%20water%20bottle%20modern%20minimalist%20design&width=200&height=200&seq=reward-bottle&orientation=squarish', popular: false },
  { id: 'rw-07', name: 'Netflix Subscription', description: '1 month Netflix subscription', points: 600, category: 'Subscription', stock: 15, totalClaimed: 34, image: 'https://readdy.ai/api/search-image?query=streaming%20subscription%20service%20modern%20digital%20design&width=200&height=200&seq=reward-netflix&orientation=squarish', popular: false },
  { id: 'rw-08', name: 'Team Lunch Voucher', description: '&pound;20 team lunch voucher for your cohort', points: 1200, category: 'Voucher', stock: 5, totalClaimed: 12, image: 'https://readdy.ai/api/search-image?query=team%20lunch%20voucher%20professional%20food%20modern%20design&width=200&height=200&seq=reward-lunch&orientation=squarish', popular: true },
];

export default function RewardsShopPage() {
  const navigate = useNavigate();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const filtered = categoryFilter === 'all' ? REWARDS : REWARDS.filter(r => r.category === categoryFilter);
  const totalClaimed = REWARDS.reduce((s, r) => s + r.totalClaimed, 0);

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Rewards Shop" pageSubtitle="Manage the learner rewards catalogue with vouchers and merchandise"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Rewards Shop"
          description={`${REWARDS.length} rewards available. ${totalClaimed} total claims. ${REWARDS.filter(r => r.stock < 10).length} items low stock. Manage catalogue, adjust points, and track redemptions.`}
          icon="ri-shopping-bag-3-line"
          imageUrl="https://readdy.ai/api/search-image?query=rewards%20shop%20catalogue%20gift%20cards%20modern%20warm%20professional%20display&width=400&height=160&seq=rewards-shop-01&orientation=landscape"
          imageAlt="Rewards Shop"
          stats={[{ label: 'Items', value: String(REWARDS.length) }, { label: 'Claimed', value: String(totalClaimed) }, { label: 'Low Stock', value: String(REWARDS.filter(r => r.stock < 10).length) }]}
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

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {['all', 'Voucher', 'Merchandise', 'Subscription'].map(cat => (
            <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${categoryFilter === cat ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {filtered.map(reward => (
            <div key={reward.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden card-premium hover:border-primary-200/50 transition-smooth">
              <div className="relative h-32 bg-background-100">
                <img src={reward.image} alt={reward.name} className="w-full h-full object-cover" />
                {reward.popular && <span className="absolute top-2 right-2 bg-accent-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">POPULAR</span>}
                {reward.stock < 10 && <span className="absolute top-2 left-2 bg-red-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">LOW STOCK</span>}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-foreground-400">{reward.category}</span>
                  <span className="text-[10px] font-bold text-accent-600">{reward.points} pts</span>
                </div>
                <h4 className="text-[13px] font-semibold text-foreground-900 mb-1">{reward.name}</h4>
                <p className="text-[10px] text-foreground-400 mb-3">{reward.description}</p>
                <div className="flex items-center justify-between text-[10px] text-foreground-400">
                  <span>Stock: {reward.stock}</span>
                  <span>Claimed: {reward.totalClaimed}</span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button className="flex-1 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-edit-line mr-1"></i> Edit
                  </button>
                  <button className="flex-1 px-3 py-1.5 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[10px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-bar-chart-line mr-1"></i> Stats
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}
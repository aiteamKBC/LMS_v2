import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface VoucherClaim {
  id: string;
  learner: string;
  programme: string;
  cohort: string;
  reward: string;
  points: number;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  reviewedBy: string | null;
  reviewedAt: string | null;
  deliveryMethod: string;
}

const VOUCHER_CLAIMS: VoucherClaim[] = [
  { id: 'vc-01', learner: 'Emily Watson', programme: 'Digital Marketer L3', cohort: 'Cohort B', reward: 'Amazon Gift Card', points: 500, requestedAt: 'Today, 09:00', status: 'pending', reviewedBy: null, reviewedAt: null, deliveryMethod: 'Email' },
  { id: 'vc-02', learner: 'Sarah Mitchell', programme: 'Business Admin L3', cohort: 'Cohort A', reward: 'Coffee Shop Voucher', points: 250, requestedAt: 'Today, 08:30', status: 'pending', reviewedBy: null, reviewedAt: null, deliveryMethod: 'Email' },
  { id: 'vc-03', learner: 'David Chen', programme: 'Software Developer L4', cohort: 'Cohort F', reward: 'Laptop Bag', points: 1000, requestedAt: 'Yesterday, 15:00', status: 'pending', reviewedBy: null, reviewedAt: null, deliveryMethod: 'Post' },
  { id: 'vc-04', learner: 'Liam Foster', programme: 'Project Manager L4', cohort: 'Cohort A', reward: 'Book Voucher', points: 750, requestedAt: 'Yesterday, 11:00', status: 'approved', reviewedBy: 'Tom Harrington', reviewedAt: 'Today, 08:00', deliveryMethod: 'Email' },
  { id: 'vc-05', learner: 'Maya Kapoor', programme: 'HR Consultant L5', cohort: 'Cohort E', reward: 'Netflix Subscription', points: 600, requestedAt: '8 Jun, 14:00', status: 'approved', reviewedBy: 'Tom Harrington', reviewedAt: '9 Jun, 09:00', deliveryMethod: 'Email' },
  { id: 'vc-06', learner: 'Sophie Williams', programme: 'Marketing Executive L4', cohort: 'Cohort C', reward: 'Team Lunch Voucher', points: 1200, requestedAt: '8 Jun, 10:00', status: 'fulfilled', reviewedBy: 'Tom Harrington', reviewedAt: '8 Jun, 16:00', deliveryMethod: 'Email' },
  { id: 'vc-07', learner: 'James Okonkwo', programme: 'Data Analyst L4', cohort: 'Cohort D', reward: 'Coffee Shop Voucher', points: 250, requestedAt: '7 Jun, 09:00', status: 'rejected', reviewedBy: 'Tom Harrington', reviewedAt: '8 Jun, 10:00', deliveryMethod: 'Email' },
  { id: 'vc-08', learner: 'Aisha Patel', programme: 'Accountancy L3', cohort: 'Cohort C', reward: 'Water Bottle', points: 200, requestedAt: '7 Jun, 08:00', status: 'pending', reviewedBy: null, reviewedAt: null, deliveryMethod: 'Post' },
  { id: 'vc-09', learner: 'Olivia Park', programme: 'Marketing Executive L4', cohort: 'Cohort B', reward: 'Stationery Kit', points: 300, requestedAt: '6 Jun, 16:00', status: 'fulfilled', reviewedBy: 'Tom Harrington', reviewedAt: '7 Jun, 09:00', deliveryMethod: 'Post' },
  { id: 'vc-10', learner: 'Lucas Nguyen', programme: 'Software Developer L4', cohort: 'Cohort F', reward: 'Amazon Gift Card', points: 500, requestedAt: '6 Jun, 10:00', status: 'approved', reviewedBy: 'Tom Harrington', reviewedAt: '7 Jun, 08:00', deliveryMethod: 'Email' },
];

export default function VoucherClaimsPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'fulfilled'>('all');
  const filtered = statusFilter === 'all' ? VOUCHER_CLAIMS : VOUCHER_CLAIMS.filter(v => v.status === statusFilter);
  const pendingCount = VOUCHER_CLAIMS.filter(v => v.status === 'pending').length;
  const approvedCount = VOUCHER_CLAIMS.filter(v => v.status === 'approved').length;
  const fulfilledCount = VOUCHER_CLAIMS.filter(v => v.status === 'fulfilled').length;

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Voucher Claims" pageSubtitle="Review and approve learner voucher redemption requests"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Voucher Claims Review"
          description={`${pendingCount} pending claims. ${approvedCount} approved, ${fulfilledCount} fulfilled, ${VOUCHER_CLAIMS.filter(v => v.status === 'rejected').length} rejected. ${VOUCHER_CLAIMS.reduce((s, v) => s + v.points, 0).toLocaleString()} total points redeemed this week.`}
          icon="ri-coupon-line"
          imageUrl="https://readdy.ai/api/search-image?query=voucher%20coupon%20redemption%20modern%20professional%20warm%20lighting%20desk&width=400&height=160&seq=voucher-01&orientation=landscape"
          imageAlt="Voucher Claims"
          stats={[{ label: 'Pending', value: String(pendingCount), variant: 'danger' }, { label: 'Approved', value: String(approvedCount) }, { label: 'Fulfilled', value: String(fulfilledCount) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/rewards-shop')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-accent-50 hover:text-accent-600 hover:border-accent-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-shopping-bag-3-line text-sm"></i> Rewards Shop
          </button>
          <button onClick={() => navigate('/engagement/points-rules')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-gift-2-line text-sm"></i> Points Rules
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {(['all', 'pending', 'approved', 'rejected', 'fulfilled'] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
              <i className={`${f === 'pending' ? 'ri-time-line' : f === 'approved' ? 'ri-check-line' : f === 'rejected' ? 'ri-close-line' : f === 'fulfilled' ? 'ri-check-double-line' : 'ri-list-check'} text-sm`}></i>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'pending' && pendingCount > 0 && <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">{pendingCount}</span>}
            </button>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <span className="text-sm font-heading font-semibold text-foreground-900">Voucher Claims</span>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} claims</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(claim => (
              <div key={claim.id} className={`p-4 flex items-center gap-4 ${claim.status === 'pending' ? 'bg-amber-50/20' : claim.status === 'rejected' ? 'bg-red-50/20' : ''}`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-accent-100 text-accent-600 flex items-center justify-center text-sm font-bold shrink-0">{claim.learner.charAt(0)}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground-900">{claim.learner}</p>
                    <p className="text-[10px] text-foreground-400">{claim.programme} &middot; {claim.cohort}</p>
                    <p className="text-[10px] text-foreground-400 mt-0.5">{claim.reward} &middot; {claim.points} pts &middot; {claim.deliveryMethod}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] shrink-0 flex-wrap">
                  <span className="text-foreground-400">{claim.requestedAt}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${claim.status === 'pending' ? 'bg-amber-100 text-amber-700' : claim.status === 'approved' ? 'bg-primary-100 text-primary-700' : claim.status === 'fulfilled' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{claim.status}</span>
                  {claim.reviewedBy && <span className="text-[10px] text-foreground-400">By: {claim.reviewedBy}</span>}
                  {claim.status === 'pending' && (
                    <>
                      <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap">Approve</button>
                      <button className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap">Reject</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { ProgrammeFilter } from '@/components/feature/ProgrammeFilter';
import { useToast } from '@/hooks/useToast';
import { useOperatorIdentity } from '@/hooks/useOperatorIdentity';
import { roleNavMap } from '@/mocks/navigation';
import { countByProgramme, filterByProgramme, type VoucherClaim, type ProgrammeFilterValue } from '@/mocks/engagement-data';
import { fetchVoucherClaims, updateVoucherClaim } from '@/api/engagement';
import { fetchEnrolmentUsers } from '@/api/enrolmentUsers';
import type { UserListRow } from '@/pages/users/types';
import { ClaimCardSkeletonGrid } from '@/pages/engagement/EngagementSkeletons';
import { LearnerProfilePanel } from '@/pages/engagement/LearnerProfilePanel';
import { EmptyState } from '@/components/feature/EmptyState';

const engagementNav = roleNavMap.engagement;

type SortKey = 'points' | 'name';

// Every reward is digital now — always the learner's own real, on-file
// email. Never a manually typed address, and never prompted for again.
function learnerEmail(claim: VoucherClaim, directory: Map<string, UserListRow>): string {
  return directory.get(claim.learnerId)?.email || '';
}

export default function VoucherClaimsPage() {
  const navigate = useNavigate();
  const { success, warning } = useToast();
  const operator = useOperatorIdentity();
  const [claims, setClaims] = useState<VoucherClaim[]>([]);
  const [directory, setDirectory] = useState<Map<string, UserListRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'fulfilled'>('all');
  const [programmeFilter, setProgrammeFilter] = useState<ProgrammeFilterValue>('all');
  const [sortKey, setSortKey] = useState<SortKey>('points');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileMeta, setProfileMeta] = useState<{ name: string; programme: string; cohort: string } | null>(null);
  const [fulfilId, setFulfilId] = useState<string | null>(null);

  // Load claims plus the real learner directory (for programme/cohort/email —
  // fields the Engagement schema doesn't own) and enrich claims client-side.
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchVoucherClaims(), fetchEnrolmentUsers()])
      .then(([claimRows, users]) => {
        if (cancelled) return;
        const byId = new Map(users.map(u => [u.id, u]));
        setDirectory(byId);
        setClaims(claimRows.map(c => {
          const user = byId.get(c.learnerId);
          return user ? { ...c, programme: user.programme || '', cohort: user.cohort || '' } : c;
        }));
      })
      .catch(err => { if (!cancelled) warning('Could not load claims', err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warning]);

  const programmeScoped = filterByProgramme(claims, programmeFilter);
  const programmeCounts = countByProgramme(claims);
  const pendingCount = programmeScoped.filter(v => v.status === 'pending').length;
  const approvedCount = programmeScoped.filter(v => v.status === 'approved').length;
  const fulfilledCount = programmeScoped.filter(v => v.status === 'fulfilled').length;
  const rejectedCount = programmeScoped.filter(v => v.status === 'rejected').length;
  const totalPointsRedeemed = programmeScoped.reduce((s, v) => s + v.points, 0);

  const filtered = useMemo(() => {
    let list = statusFilter === 'all' ? programmeScoped : programmeScoped.filter(v => v.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(v => v.learner.toLowerCase().includes(q) || v.reward.toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      const va = sortKey === 'name' ? a.learner : a.points;
      const vb = sortKey === 'name' ? b.learner : b.points;
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? va - (vb as number) : (vb as number) - va;
    });
    return list;
  }, [programmeScoped, statusFilter, search, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  }

  async function approveClaim(claim: VoucherClaim) {
    try {
      const updated = await updateVoucherClaim(claim.id, { status: 'approved' });
      setClaims(prev => prev.map(c => c.id === claim.id ? updated : c));
      success(`Claim approved for ${claim.learner}`, `${claim.reward} · ${claim.points} pts`);
    } catch (err: any) {
      warning('Could not approve claim', err.message);
    }
  }

  async function rejectClaim(claim: VoucherClaim) {
    try {
      const updated = await updateVoucherClaim(claim.id, { status: 'rejected' });
      setClaims(prev => prev.map(c => c.id === claim.id ? updated : c));
      warning(`Claim rejected for ${claim.learner}`, `${claim.reward} · ${claim.points} pts`);
    } catch (err: any) {
      warning('Could not reject claim', err.message);
    }
  }

  function openFulfilModal(claim: VoucherClaim) {
    setFulfilId(claim.id);
  }

  async function handleFulfil(claim: VoucherClaim) {
    const email = learnerEmail(claim, directory);
    try {
      const updated = await updateVoucherClaim(claim.id, { status: 'fulfilled', deliveryDetail: email });
      setClaims(prev => prev.map(c => c.id === claim.id ? updated : c));
      setFulfilId(null);
      success(`${claim.reward} marked as fulfilled for ${claim.learner}`, `Sent to ${email}`);
    } catch (err: any) {
      warning('Could not fulfil claim', err.message);
    }
  }

  const reviewClaim = claims.find(c => c.id === reviewId) ?? null;
  const fulfilClaim = claims.find(c => c.id === fulfilId) ?? null;

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Voucher Claims" pageSubtitle="Review and approve learner voucher redemption requests"
      userName={operator.name} userRole={operator.role}
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Voucher Claims Review"
          description={`${pendingCount} pending claims. ${approvedCount} approved, ${fulfilledCount} fulfilled, ${rejectedCount} rejected. ${totalPointsRedeemed.toLocaleString()} total points redeemed this week.`}
          icon="ri-coupon-line"
          imageUrl="https://readdy.ai/api/search-image?query=voucher%20coupon%20redemption%20modern%20professional%20warm%20lighting%20desk&width=400&height=160&seq=voucher-01&orientation=landscape"
          imageAlt="Voucher Claims"
          stats={[{ label: 'Pending', value: String(pendingCount) }, { label: 'Approved', value: String(approvedCount) }, { label: 'Fulfilled', value: String(fulfilledCount) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/rewards-shop')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-accent-50 hover:text-accent-600 hover:border-accent-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-shopping-bag-3-line text-sm"></AppIcon> Rewards Shop
          </button>
          <button onClick={() => navigate('/engagement/points-rules')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-gift-2-line text-sm"></AppIcon> Points Rules
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-heart-line text-sm"></AppIcon> Learner Engagement
          </button>
        </div>

        {/* Programme Filter */}
        <ProgrammeFilter value={programmeFilter} onChange={setProgrammeFilter} counts={programmeCounts} />

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input type="text" placeholder="Search learner or reward..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
            {(['all', 'pending', 'approved', 'rejected', 'fulfilled'] as const).map(f => (
              <button key={f} onClick={() => setStatusFilter(f)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                <AppIcon className={`${f === 'pending' ? 'ri-time-line' : f === 'approved' ? 'ri-check-line' : f === 'rejected' ? 'ri-close-line' : f === 'fulfilled' ? 'ri-check-double-line' : 'ri-list-check'} text-sm`}></AppIcon>
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                {f === 'pending' && pendingCount > 0 && <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">{pendingCount}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="font-semibold text-foreground-500">Sort by:</span>
          {([
            { key: 'points' as SortKey, label: 'Points' },
            { key: 'name' as SortKey, label: 'Learner Name' },
          ]).map(opt => (
            <button key={opt.key} onClick={() => handleSort(opt.key)} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-smooth cursor-pointer whitespace-nowrap ${sortKey === opt.key ? 'bg-primary-50 text-primary-700 border border-primary-200/50' : 'text-foreground-500 hover:text-foreground-700 border border-transparent'}`}>
              {opt.label}
              {sortKey === opt.key && <AppIcon className={sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'}></AppIcon>}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-heading font-semibold text-foreground-900">Voucher Claims</span>
          <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} claims</span>
        </div>

        {loading && <ClaimCardSkeletonGrid />}

        {!loading && filtered.length === 0 && (
          <EmptyState icon="ri-search-line" title="No claims match this view" subtitle="Try switching the status or programme filter." />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {filtered.map(claim => (
            <div key={claim.id} className={`bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium hover:border-primary-200/50 transition-smooth ${claim.status === 'pending' ? 'bg-amber-50/20' : claim.status === 'rejected' ? 'bg-red-50/20' : ''}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full shrink-0 overflow-hidden bg-accent-100">
                  {claim.avatarImg ? (
                    <img src={claim.avatarImg} alt={claim.learner} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm font-bold text-accent-600">{claim.learner.charAt(0)}</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground-900 truncate">{claim.learner}</p>
                  <p className="text-[10px] text-foreground-400 truncate">{claim.programme} &middot; {claim.cohort}</p>
                </div>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${claim.status === 'pending' ? 'bg-amber-100 text-amber-700' : claim.status === 'approved' ? 'bg-primary-100 text-primary-700' : claim.status === 'fulfilled' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{claim.status}</span>
              </div>
              <div className="bg-background-100/50 rounded-lg p-3 mb-3">
                <p className="text-[12px] font-semibold text-foreground-900">{claim.reward}</p>
                <div className="flex items-center gap-3 text-[10px] text-foreground-400 mt-1 flex-wrap">
                  <span className="font-semibold text-accent-600">{claim.points} pts</span>
                  <span className={`inline-flex items-center gap-1 font-semibold ${claim.deliveryType === 'digital' ? 'text-primary-600' : 'text-amber-600'}`}>
                    <AppIcon className={claim.deliveryType === 'digital' ? 'ri-mail-send-line' : 'ri-box-3-line'}></AppIcon>
                    {claim.deliveryType === 'digital' ? 'Digital' : 'Physical'}
                  </span>
                  <span>{claim.requestedAt}</span>
                </div>
              </div>
              {claim.reviewedBy && (
                <p className="text-[10px] text-foreground-400 mb-3">Reviewed by {claim.reviewedBy}{claim.reviewedAt ? ` · ${claim.reviewedAt}` : ''}</p>
              )}
              <div className="flex items-center gap-2">
                <button onClick={() => setReviewId(claim.id)} className="flex-1 px-3 py-1.5 bg-secondary-50 border border-secondary-200/50 text-secondary-700 rounded-lg text-[10px] font-medium hover:bg-secondary-100 transition-smooth cursor-pointer whitespace-nowrap">
                  <AppIcon className="ri-file-list-3-line mr-1"></AppIcon> Review
                </button>
                {claim.status === 'pending' && (
                  <>
                    <button onClick={() => approveClaim(claim)} className="flex-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap">Approve</button>
                    <button onClick={() => rejectClaim(claim)} className="flex-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap">Reject</button>
                  </>
                )}
                {claim.status === 'approved' && (
                  <button onClick={() => openFulfilModal(claim)} className="flex-1 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-truck-line mr-1"></AppIcon> Fulfil
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* REVIEW PANEL */}
      <RightSlidePanel isOpen={!!reviewClaim} onClose={() => setReviewId(null)} title={reviewClaim?.learner} coloredHeader>
        {reviewClaim && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full shrink-0 overflow-hidden bg-accent-100">
                {reviewClaim.avatarImg ? (
                  <img src={reviewClaim.avatarImg} alt={reviewClaim.learner} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-base font-bold text-accent-600">{reviewClaim.learner.charAt(0)}</div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground-900">{reviewClaim.learner}</p>
                <p className="text-[11px] text-foreground-400">{reviewClaim.programme} &middot; {reviewClaim.cohort}</p>
              </div>
            </div>

            <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${reviewClaim.status === 'pending' ? 'bg-amber-100 text-amber-700' : reviewClaim.status === 'approved' ? 'bg-primary-100 text-primary-700' : reviewClaim.status === 'fulfilled' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{reviewClaim.status}</span>

            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <div className="bg-background-100/50 rounded-lg p-3 col-span-2">
                <p className="text-[10px] text-foreground-400 mb-1">Reward</p>
                <p className="font-semibold text-foreground-900">{reviewClaim.reward}</p>
              </div>
              <div className="bg-background-100/50 rounded-lg p-3">
                <p className="text-[10px] text-foreground-400 mb-1">Points</p>
                <p className="font-semibold text-foreground-900">{reviewClaim.points}</p>
              </div>
              <div className="bg-background-100/50 rounded-lg p-3">
                <p className="text-[10px] text-foreground-400 mb-1">Requested</p>
                <p className="font-semibold text-foreground-900">{reviewClaim.requestedAt}</p>
              </div>
              <div className="bg-background-100/50 rounded-lg p-3">
                <p className="text-[10px] text-foreground-400 mb-1">Delivery Type</p>
                <p className="font-semibold text-foreground-900">{reviewClaim.deliveryType === 'digital' ? 'Digital · Email' : 'Physical · Post'}</p>
              </div>
              <div className="bg-background-100/50 rounded-lg p-3">
                <p className="text-[10px] text-foreground-400 mb-1">Reviewed By</p>
                <p className="font-semibold text-foreground-900">{reviewClaim.reviewedBy ?? '—'}</p>
              </div>
              {reviewClaim.deliveryDetail && (
                <div className="bg-background-100/50 rounded-lg p-3 col-span-2">
                  <p className="text-[10px] text-foreground-400 mb-1">{reviewClaim.deliveryType === 'digital' ? 'Delivery Email' : 'Delivery Address'}</p>
                  <p className="font-semibold text-foreground-900">{reviewClaim.deliveryDetail}</p>
                </div>
              )}
              {reviewClaim.deliveryInstructions && (
                <div className="bg-background-100/50 rounded-lg p-3 col-span-2">
                  <p className="text-[10px] text-foreground-400 mb-1">Delivery Instructions</p>
                  <p className="font-semibold text-foreground-900">{reviewClaim.deliveryInstructions}</p>
                </div>
              )}
            </div>

            {reviewClaim.reviewedAt && (
              <p className="text-[11px] text-foreground-400">Last reviewed {reviewClaim.reviewedAt}</p>
            )}

            {reviewClaim.status === 'pending' && (
              <div className="flex items-center gap-2">
                <button onClick={() => approveClaim(reviewClaim)} className="flex-1 px-3 py-2 bg-emerald-600 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer">
                  <AppIcon className="ri-check-line mr-1"></AppIcon> Approve
                </button>
                <button onClick={() => rejectClaim(reviewClaim)} className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-[11px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer">
                  <AppIcon className="ri-close-line mr-1"></AppIcon> Reject
                </button>
              </div>
            )}

            {reviewClaim.status === 'approved' && (
              <button onClick={() => { setReviewId(null); openFulfilModal(reviewClaim); }} className="w-full px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer">
                <AppIcon className="ri-truck-line mr-1"></AppIcon> Fulfil Claim
              </button>
            )}

            <button onClick={() => {
              setProfileMeta({ name: reviewClaim.learner, programme: reviewClaim.programme, cohort: reviewClaim.cohort });
              setProfileId(reviewClaim.learnerId);
              setReviewId(null);
            }} className="w-full px-3 py-2 border border-foreground-200/60 text-foreground-600 rounded-lg text-[11px] font-medium hover:bg-background-100 transition-smooth cursor-pointer">
              View Full Engagement Profile
            </button>
          </div>
        )}
      </RightSlidePanel>

      {/* FULL ENGAGEMENT PROFILE — opens in place, over the voucher page */}
      <LearnerProfilePanel
        learnerId={profileId}
        learnerName={profileMeta?.name}
        programme={(profileId && directory.get(profileId)?.programme) || profileMeta?.programme}
        cohort={(profileId && directory.get(profileId)?.cohort) || profileMeta?.cohort}
        email={profileId ? directory.get(profileId)?.email : undefined}
        onClose={() => setProfileId(null)}
      />

      {/* FULFILMENT FORM MODAL */}
      {fulfilClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setFulfilId(null)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><AppIcon className="ri-truck-line text-lg"></AppIcon></span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-900">Fulfil Reward</h3>
                  <p className="text-[11px] text-foreground-400">{fulfilClaim.reward} for {fulfilClaim.learner}</p>
                </div>
              </div>
              <button onClick={() => setFulfilId(null)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Delivery Email</label>
                <div className="rounded-lg border border-foreground-200/60 bg-background-100/40 p-3">
                  <p className="text-[11px] text-foreground-700 font-semibold">{learnerEmail(fulfilClaim, directory) || 'No email on file'}</p>
                  <p className="text-[10px] text-foreground-400 mt-0.5">The learner's own on-file email — this can't be changed here.</p>
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
              <button onClick={() => setFulfilId(null)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={() => handleFulfil(fulfilClaim)} disabled={!learnerEmail(fulfilClaim, directory)} className="px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed">
                <AppIcon className="ri-check-double-line"></AppIcon> Mark Fulfilled
              </button>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import {
  ENGAGEMENT_REWARDS, VOUCHER_CLAIMS,
  type RewardItem, type VoucherClaim,
} from '@/mocks/engagement-data';

// ============================================================
// Shared reward-catalogue + voucher-claims state.
// ----------------------------------------------------------------------------
// Rewards Shop (catalogue + fulfilment queue) and Voucher Claims (approve/
// reject workflow) both need to see the SAME live data — approving a claim
// here must show up there immediately. A per-page useState copy can't do
// that, so this follows the same Provider/useX pattern as useAuth/useToast.
// ============================================================

export interface RewardFormInput {
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

interface EngagementRewardsContextValue {
  rewards: RewardItem[];
  addReward: (form: RewardFormInput) => RewardItem;
  updateReward: (id: string, form: RewardFormInput) => void;
  toggleRewardActive: (id: string) => void;
  claims: VoucherClaim[];
  approveClaim: (id: string, deliveryDetail: string) => void;
  rejectClaim: (id: string) => void;
  markFulfilled: (id: string) => void;
  updateClaimDelivery: (id: string, deliveryDetail: string) => void;
}

const EngagementRewardsContext = createContext<EngagementRewardsContextValue | null>(null);

const DEFAULT_REWARD_IMAGE = 'https://readdy.ai/api/search-image?query=generic%20gift%20reward%20box%20modern%20minimalist%20design&width=200&height=200&seq=reward-default&orientation=squarish';

export function EngagementRewardsProvider({ children }: { children: ReactNode }) {
  const [rewards, setRewards] = useState<RewardItem[]>(ENGAGEMENT_REWARDS);
  const [claims, setClaims] = useState<VoucherClaim[]>(VOUCHER_CLAIMS);

  const addReward = useCallback((form: RewardFormInput): RewardItem => {
    let created!: RewardItem;
    setRewards(prev => {
      created = {
        id: `rw-new-${prev.length + 1}`,
        name: form.name, description: form.description, points: form.points,
        category: form.category, deliveryType: form.deliveryType, stock: form.stock,
        image: form.image || DEFAULT_REWARD_IMAGE, popular: form.popular, active: form.active,
        totalClaimed: 0,
      };
      return [created, ...prev];
    });
    return created!;
  }, []);

  const updateReward = useCallback((id: string, form: RewardFormInput) => {
    setRewards(prev => prev.map(r => r.id === id ? {
      ...r, name: form.name, description: form.description, points: form.points,
      category: form.category, deliveryType: form.deliveryType, stock: form.stock,
      image: form.image || DEFAULT_REWARD_IMAGE, popular: form.popular, active: form.active,
    } : r));
  }, []);

  const toggleRewardActive = useCallback((id: string) => {
    setRewards(prev => prev.map(r => r.id === id ? { ...r, active: !r.active } : r));
  }, []);

  const approveClaim = useCallback((id: string, deliveryDetail: string) => {
    setClaims(prev => prev.map(c => c.id === id ? { ...c, status: 'approved', reviewedBy: 'Tom Harrington', reviewedAt: 'Just now', deliveryDetail } : c));
  }, []);

  const rejectClaim = useCallback((id: string) => {
    setClaims(prev => prev.map(c => c.id === id ? { ...c, status: 'rejected', reviewedBy: 'Tom Harrington', reviewedAt: 'Just now' } : c));
  }, []);

  const markFulfilled = useCallback((id: string) => {
    setClaims(prev => prev.map(c => c.id === id ? { ...c, status: 'fulfilled' } : c));
  }, []);

  const updateClaimDelivery = useCallback((id: string, deliveryDetail: string) => {
    setClaims(prev => prev.map(c => c.id === id ? { ...c, deliveryDetail } : c));
  }, []);

  const value = useMemo<EngagementRewardsContextValue>(() => ({
    rewards, addReward, updateReward, toggleRewardActive,
    claims, approveClaim, rejectClaim, markFulfilled, updateClaimDelivery,
  }), [rewards, addReward, updateReward, toggleRewardActive, claims, approveClaim, rejectClaim, markFulfilled, updateClaimDelivery]);

  return (
    <EngagementRewardsContext.Provider value={value}>
      {children}
    </EngagementRewardsContext.Provider>
  );
}

export function useEngagementRewards(): EngagementRewardsContextValue {
  const ctx = useContext(EngagementRewardsContext);
  if (!ctx) throw new Error('useEngagementRewards must be used within an EngagementRewardsProvider');
  return ctx;
}

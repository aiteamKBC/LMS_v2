// ============================================================================
// Coach caseload — card grid.
//
// Column count follows the width the cards actually need to stay readable:
// four across from 1600px, three from 1280px, two on tablet, one on phones.
// ============================================================================
import { memo } from 'react';
import { LearnerCard } from './LearnerCard';
import type { InsightMap, LearnerInsight } from '../lib/attention';
import type { Learner, QuickViewTab } from '../types';

const FALLBACK_INSIGHT: LearnerInsight = {
  tier: 'on-track',
  riskLabel: 'On Track',
  reasons: [],
  criticalReasonCount: 0,
  otjhDeltaHours: null,
  gatewayDate: null,
  gatewayDaysAway: null,
  lastActivityDaysAgo: null,
  urgency: 0,
};

export const LearnerCardGrid = memo(function LearnerCardGrid({
  learners,
  insights,
  selectedLearnerIds,
  selectionMode,
  onToggleSelect,
  onQuickView,
  onOpenProfile,
}: {
  learners: Learner[];
  insights: InsightMap;
  selectedLearnerIds: Set<string>;
  selectionMode: boolean;
  onToggleSelect: (learnerId: string) => void;
  onQuickView: (learner: Learner, tab?: QuickViewTab) => void;
  onOpenProfile: (learner: Learner) => void;
}) {
  return (
    <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3 min-[1600px]:grid-cols-4">
      {learners.map((learner) => (
        <LearnerCard
          key={learner.id}
          learner={learner}
          insight={insights.get(learner.id) || FALLBACK_INSIGHT}
          selected={selectedLearnerIds.has(learner.id)}
          selectionMode={selectionMode}
          onToggleSelect={onToggleSelect}
          onQuickView={onQuickView}
          onOpenProfile={onOpenProfile}
        />
      ))}
    </div>
  );
});

// ============================================================================
// Coach caseload — colour mapping.
//
// This used to define its own five-tier colour table. It now maps the
// caseload's risk vocabulary (`AttentionTier`) onto the shared semantic tone
// table in `@/lib/statusTone`, so "at risk" is the same red here as it is on
// every other coach page. The public API (`riskTierStyle`, `progressTone`,
// `TierStyle`) is unchanged, so nothing importing from here has to change.
// ============================================================================
import { progressTone, toneStyle, type ToneStyle } from '@/lib/statusTone';
import type { AttentionTier } from './attention';

export type TierStyle = ToneStyle;

const TIER_TO_TONE = {
  critical: 'critical',
  attention: 'caution',
  upcoming: 'upcoming',
  'on-track': 'positive',
  inactive: 'neutral',
} as const;

export function riskTierStyle(tier: AttentionTier): TierStyle {
  return toneStyle(TIER_TO_TONE[tier]);
}

export { progressTone };

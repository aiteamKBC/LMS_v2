import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { AiSettings } from '@/mocks/ai-settings';
import { defaultAiSettings, AI_FEATURE_TOGGLES, AI_NEVER_ALLOWED_ACTIONS } from '@/mocks/ai-settings';

// ============================================================
// Types
// ============================================================

export type AiFeatureSlug =
  | 'proofreading'
  | 'reflection-quality'
  | 'ksb-suggestions'
  | 'evidence-checker'
  | 'revision-suggestions'
  | 'marking-suggestions'
  | 'otjh-risk'
  | 'coaching-summaries'
  | 'progress-review-drafts'
  | 'coaching-agenda'
  | 'report-summaries'
  | 'employer-summaries'
  | 'ofsted-summaries'
  | 'risk-patterns'
  | 'sar-qip'
  | 'quiz-generation'
  | 'xml-quiz';

export interface AiSettingsContextValue {
  /** The full AI settings configuration for the current tenant */
  settings: AiSettings;
  /** Is the master AI switch enabled at tenant level? */
  isAiGloballyEnabled: boolean;
  /** Is the user's session AI mode toggled on? */
  isUserAiOn: boolean;
  /** Combined: is AI actually available right now? (tenant enabled AND user toggled on) */
  isAiActive: boolean;
  /** Update the full settings object (admin use) */
  updateSettings: (partial: Partial<AiSettings>) => void;
  /** Toggle the master AI switch */
  toggleMasterAi: () => void;
  /** Toggle a specific AI feature on/off */
  toggleFeature: (slug: AiFeatureSlug) => void;
  /** Set user session AI mode */
  setUserAiMode: (on: boolean) => void;
  /** Check if a specific AI feature is currently usable */
  isFeatureUsable: (slug: AiFeatureSlug) => boolean;
  /** Get the label for an AI feature */
  getFeatureLabel: (slug: AiFeatureSlug) => string;
  /** Get the never-allowed actions list */
  neverAllowedActions: string[];
  /** Is the require-human-approval rule active? */
  requireHumanApproval: boolean;
}

// ============================================================
// Context
// ============================================================

const AiSettingsContext = createContext<AiSettingsContextValue | null>(null);

// ============================================================
// Provider
// ============================================================

export function AiSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AiSettings>({ ...defaultAiSettings });
  const [userAiOn, setUserAiOn] = useState(true);

  const isAiGloballyEnabled = settings.aiEnabled;

  // AI is only active if BOTH tenant has it on AND user has their session in AI mode
  const isAiActive = isAiGloballyEnabled && userAiOn;

  const updateSettings = useCallback((partial: Partial<AiSettings>) => {
    setSettings(prev => ({ ...prev, ...partial }));
  }, []);

  const toggleMasterAi = useCallback(() => {
    setSettings(prev => {
      const newEnabled = !prev.aiEnabled;
      // When turning AI off, all features conceptually become inactive
      return { ...prev, aiEnabled: newEnabled };
    });
  }, []);

  const toggleFeature = useCallback((slug: AiFeatureSlug) => {
    setSettings(prev => {
      const key = featureSlugToKey(slug);
      if (key && key in prev) {
        return { ...prev, [key]: !(prev as unknown as Record<string, boolean>)[key] };
      }
      return prev;
    });
  }, []);

  const setUserAiMode = useCallback((on: boolean) => {
    setUserAiOn(on);
  }, []);

  const isFeatureUsable = useCallback((slug: AiFeatureSlug): boolean => {
    if (!isAiActive) return false;
    if (slug === 'proofreading') return settings.proofreadingEnabled;
    if (slug === 'reflection-quality') return settings.reflectionQualityCheckEnabled;
    if (slug === 'ksb-suggestions') return settings.ksbSuggestionsEnabled;
    if (slug === 'evidence-checker') return settings.evidenceCheckerEnabled;
    if (slug === 'revision-suggestions') return settings.revisionSuggestionsEnabled;
    if (slug === 'marking-suggestions') return settings.markingSuggestionsEnabled;
    if (slug === 'otjh-risk') return settings.otjhRiskDetectionEnabled;
    if (slug === 'coaching-summaries') return settings.coachingSummariesEnabled;
    if (slug === 'progress-review-drafts') return settings.progressReviewDraftsEnabled;
    if (slug === 'coaching-agenda') return settings.coachingAgendaSuggestionsEnabled;
    if (slug === 'report-summaries') return settings.reportSummariesEnabled;
    if (slug === 'employer-summaries') return settings.employerSummaryDraftsEnabled;
    if (slug === 'ofsted-summaries') return settings.ofstedEvidenceSummariesEnabled;
    if (slug === 'risk-patterns') return settings.learnerRiskPatternSummariesEnabled;
    if (slug === 'sar-qip') return settings.sarQipEvidenceSummariesEnabled;
    if (slug === 'quiz-generation') return settings.quizGenerationEnabled;
    if (slug === 'xml-quiz') return settings.xmlQuizAssistantEnabled;
    return false;
  }, [isAiActive, settings]);

  const getFeatureLabel = useCallback((slug: AiFeatureSlug): string => {
    const feature = AI_FEATURE_TOGGLES.find(f => f.slug === slug);
    return feature?.label ?? slug;
  }, []);

  const value = useMemo<AiSettingsContextValue>(() => ({
    settings,
    isAiGloballyEnabled,
    isUserAiOn: userAiOn,
    isAiActive,
    updateSettings,
    toggleMasterAi,
    toggleFeature,
    setUserAiMode,
    isFeatureUsable,
    getFeatureLabel,
    neverAllowedActions: AI_NEVER_ALLOWED_ACTIONS,
    requireHumanApproval: settings.requireHumanApproval,
  }), [settings, isAiGloballyEnabled, userAiOn, isAiActive, updateSettings, toggleMasterAi, toggleFeature, setUserAiMode, isFeatureUsable, getFeatureLabel]);

  return (
    <AiSettingsContext.Provider value={value}>
      {children}
    </AiSettingsContext.Provider>
  );
}

// ============================================================
// Hook
// ============================================================

export function useAiSettings(): AiSettingsContextValue {
  const ctx = useContext(AiSettingsContext);
  if (!ctx) {
    throw new Error('useAiSettings must be used within an AiSettingsProvider');
  }
  return ctx;
}

// ============================================================
// Helpers
// ============================================================

function featureSlugToKey(slug: AiFeatureSlug): string {
  const map: Record<AiFeatureSlug, string> = {
    'proofreading': 'proofreadingEnabled',
    'reflection-quality': 'reflectionQualityCheckEnabled',
    'ksb-suggestions': 'ksbSuggestionsEnabled',
    'evidence-checker': 'evidenceCheckerEnabled',
    'revision-suggestions': 'revisionSuggestionsEnabled',
    'marking-suggestions': 'markingSuggestionsEnabled',
    'otjh-risk': 'otjhRiskDetectionEnabled',
    'coaching-summaries': 'coachingSummariesEnabled',
    'progress-review-drafts': 'progressReviewDraftsEnabled',
    'coaching-agenda': 'coachingAgendaSuggestionsEnabled',
    'report-summaries': 'reportSummariesEnabled',
    'employer-summaries': 'employerSummaryDraftsEnabled',
    'ofsted-summaries': 'ofstedEvidenceSummariesEnabled',
    'risk-patterns': 'learnerRiskPatternSummariesEnabled',
    'sar-qip': 'sarQipEvidenceSummariesEnabled',
    'quiz-generation': 'quizGenerationEnabled',
    'xml-quiz': 'xmlQuizAssistantEnabled',
  };
  return map[slug];
}

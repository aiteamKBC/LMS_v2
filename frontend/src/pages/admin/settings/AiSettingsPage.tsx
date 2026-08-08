import { useState } from 'react';
import { useAiSettings, type AiFeatureSlug } from '@/hooks/useAiSettings';
import { AI_FEATURE_TOGGLES, AI_NEVER_ALLOWED_ACTIONS, AI_FALLBACK_RULES } from '@/mocks/ai-settings';
import { mockAiAuditEntries, mockAiAuditStats } from '@/mocks/ai-audit';
import { AiSuggestion } from '@/components/feature/AiSuggestion';

// ============================================================
// Categories for grouping features
// ============================================================

const FEATURE_CATEGORIES: { key: string; label: string; icon: string; description: string }[] = [
  { key: 'learner-support', label: 'Learner Support', icon: 'ri-user-star-line', description: 'AI features that directly assist learners with evidence, reflections, and study.' },
  { key: 'staff-support', label: 'Staff Support', icon: 'ri-team-line', description: 'AI features that assist coaches, tutors, and delivery staff with their workflows.' },
  { key: 'reporting', label: 'Reporting & Summaries', icon: 'ri-bar-chart-box-line', description: 'AI features that assist with report generation and evidence summaries.' },
  { key: 'quiz-content', label: 'Quiz & Content', icon: 'ri-question-answer-line', description: 'AI features for generating and improving quiz and assessment content.' },
];

export default function AiSettingsPage() {
  const {
    settings,
    isAiGloballyEnabled,
    isAiActive,
    toggleMasterAi,
    toggleFeature,
    isFeatureUsable,
    neverAllowedActions,
    requireHumanApproval,
  } = useAiSettings();

  const [activeTab, setActiveTab] = useState<'toggles' | 'audit' | 'rules'>('toggles');

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-heading font-semibold text-foreground-950">AI Settings</h2>
          <p className="text-sm text-foreground-500 mt-1">
            Configure AI-assisted features for your tenant. All AI outputs require human validation before being accepted.
          </p>
        </div>
        {/* Master AI Toggle */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-foreground-500">Master AI Switch</span>
          <button
            onClick={toggleMasterAi}
            className={`relative w-12 h-6 rounded-full transition-smooth cursor-pointer ${
              isAiGloballyEnabled ? 'bg-emerald-500' : 'bg-background-300'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-smooth ${
                isAiGloballyEnabled ? 'left-6' : 'left-0.5'
              }`}
            ></span>
          </button>
        </div>
      </div>

      {/* Status banner */}
      <div className={`rounded-xl border p-4 ${isAiGloballyEnabled ? 'bg-emerald-50/50 border-emerald-200/60' : 'bg-background-100 border-foreground-200'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isAiGloballyEnabled ? 'bg-emerald-100 text-emerald-600' : 'bg-background-200 text-foreground-400'
          }`}>
            <AppIcon className={`text-lg ${isAiGloballyEnabled ? 'ri-sparkling-2-line' : 'ri-tools-line'}`}></AppIcon>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground-900">
              {isAiGloballyEnabled ? 'AI-Assisted Mode Active' : 'Manual Mode Active'}
            </p>
            <p className="text-xs text-foreground-500 mt-0.5">
              {isAiGloballyEnabled
                ? 'AI features are enabled at tenant level. Individual features can be toggled below. Users can switch between AI and Manual modes.'
                : 'AI is disabled completely. All workflows are manual. All AI buttons, labels, and suggestions are hidden across the platform.'
              }
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-background-100 rounded-lg p-0.5 w-fit">
        {[
          { key: 'toggles', label: 'Feature Toggles', icon: 'ri-toggle-line' },
          { key: 'audit', label: 'AI Audit Trail', icon: 'ri-history-line' },
          { key: 'rules', label: 'Governance Rules', icon: 'ri-shield-check-line' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`px-4 py-2 rounded-md text-xs font-medium transition-smooth flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === tab.key
                ? 'bg-background-50 text-foreground-900 shadow-sm'
                : 'text-foreground-500 hover:text-foreground-700'
            }`}
          >
            <AppIcon className={`${tab.icon} text-xs`}></AppIcon>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Feature Toggles Tab */}
      {activeTab === 'toggles' && (
        <div className="space-y-6">
          {/* Active features summary */}
          <div className="flex items-center gap-4 text-xs">
            <span className="text-foreground-500">
              <strong className="text-foreground-900">{AI_FEATURE_TOGGLES.filter(f => isFeatureUsable(f.slug as AiFeatureSlug)).length}</strong> of <strong className="text-foreground-900">{AI_FEATURE_TOGGLES.length}</strong> features active
            </span>
            <span className="w-1 h-1 rounded-full bg-foreground-300"></span>
            <span className="text-foreground-500">Human approval: <strong className="text-accent-700">always required</strong></span>
          </div>

          {FEATURE_CATEGORIES.map(category => {
            const features = AI_FEATURE_TOGGLES.filter(f => f.category === category.key);
            if (features.length === 0) return null;

            return (
              <div key={category.key} className="bg-background-50 rounded-xl border border-foreground-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-background-100">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                      <AppIcon className={`${category.icon} text-primary-600 text-sm`}></AppIcon>
                    </div>
                    <div>
                      <h3 className="text-sm font-heading font-semibold text-foreground-950">{category.label}</h3>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{category.description}</p>
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-background-100">
                  {features.map(feature => {
                    const isOn = isFeatureUsable(feature.slug as AiFeatureSlug);
                    const isDisabled = !isAiGloballyEnabled;

                    return (
                      <div key={feature.slug} className={`px-5 py-4 flex items-start justify-between gap-6 transition-smooth ${isDisabled ? 'opacity-50' : ''}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground-900">{feature.label}</p>
                            {isOn && !isDisabled && (
                              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 uppercase whitespace-nowrap">Active</span>
                            )}
                          </div>
                          <p className="text-xs text-foreground-500 mt-1">{feature.description}</p>
                          {/* Allowed & Forbidden */}
                          <div className="flex items-center gap-4 mt-2">
                            <div className="flex items-center gap-1 text-[10px] text-emerald-600">
                              <AppIcon className="ri-check-line"></AppIcon>
                              <span className="whitespace-nowrap">Can: {feature.allowedActions[0]}</span>
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-red-500">
                              <AppIcon className="ri-close-line"></AppIcon>
                              <span className="whitespace-nowrap">Never: {feature.forbiddenActions[0]}</span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => !isDisabled && toggleFeature(feature.slug as AiFeatureSlug)}
                          disabled={isDisabled}
                          className={`relative w-11 h-6 rounded-full transition-smooth shrink-0 ${
                            isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            isOn && !isDisabled ? 'bg-emerald-500' : 'bg-background-300'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-smooth ${
                              isOn && !isDisabled ? 'left-5' : 'left-0.5'
                            }`}
                          ></span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Audit Trail Tab */}
      {activeTab === 'audit' && <AiAuditTab />}

      {/* Governance Rules Tab */}
      {activeTab === 'rules' && <AiGovernanceTab />}
    </div>
  );
}

// ============================================================
// Audit Trail Tab
// ============================================================

function AiAuditTab() {
  const { settings } = useAiSettings();

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-5 gap-4">
        <StatCard label="Total Entries" value={mockAiAuditStats.totalEntries.toString()} icon="ri-history-line" />
        <StatCard label="This Month" value={mockAiAuditStats.thisMonth.toString()} icon="ri-calendar-line" />
        <StatCard label="Accepted" value={`${mockAiAuditStats.acceptedRate}%`} icon="ri-check-line" color="emerald" />
        <StatCard label="Edited" value={`${mockAiAuditStats.editedRate}%`} icon="ri-edit-line" color="accent" />
        <StatCard label="Rejected" value={`${mockAiAuditStats.rejectedRate}%`} icon="ri-close-line" color="red" />
      </div>

      {/* Settings */}
      <div className="bg-background-50 rounded-xl border border-foreground-200 p-5">
        <h3 className="text-sm font-heading font-semibold text-foreground-950 mb-4">Audit Trail Configuration</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-foreground-900">AI Audit Trail</p>
              <p className="text-[11px] text-foreground-400">Every AI suggestion is logged with input data, output, and user decision.</p>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 whitespace-nowrap">Always Enabled</span>
          </div>
          <div className="flex items-center justify-between py-2 border-t border-background-100">
            <div>
              <p className="text-sm font-medium text-foreground-900">Output History Visible to Tutor/Admin</p>
              <p className="text-[11px] text-foreground-400">Tutors and admins can review AI suggestion history for their learners.</p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
              settings.outputHistoryVisibleToTutorAdmin ? 'bg-emerald-50 text-emerald-700' : 'bg-background-100 text-foreground-500'
            }`}>
              {settings.outputHistoryVisibleToTutorAdmin ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      </div>

      {/* Top features */}
      <div className="bg-background-50 rounded-xl border border-foreground-200 p-5">
        <h3 className="text-sm font-heading font-semibold text-foreground-950 mb-4">Most Used AI Features</h3>
        <div className="space-y-2">
          {mockAiAuditStats.topFeatures.map((f, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-xs text-foreground-400 w-5">{i + 1}</span>
              <div className="flex-1 flex items-center justify-between">
                <span className="text-sm text-foreground-800">{f.feature}</span>
                <span className="text-xs font-semibold text-foreground-500">{f.count} uses</span>
              </div>
              <div className="w-24 h-1.5 rounded-full bg-background-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent-400"
                  style={{ width: `${(f.count / mockAiAuditStats.topFeatures[0].count) * 100}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent entries */}
      <div className="bg-background-50 rounded-xl border border-foreground-200 p-5">
        <h3 className="text-sm font-heading font-semibold text-foreground-950 mb-4">Recent Audit Entries</h3>
        <div className="space-y-3">
          {mockAiAuditEntries.slice(0, 5).map(entry => (
            <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg border border-background-100 hover:bg-background-50 transition-smooth">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                entry.userDecision === 'accepted' ? 'bg-emerald-100 text-emerald-600'
                : entry.userDecision === 'edited' ? 'bg-accent-100 text-accent-600'
                : 'bg-red-100 text-red-600'
              }`}>
                <AppIcon className={`text-sm ${
                  entry.userDecision === 'accepted' ? 'ri-check-line'
                  : entry.userDecision === 'edited' ? 'ri-edit-line'
                  : 'ri-close-line'
                }`}></AppIcon>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground-900">{entry.triggeredByUserName}</span>
                  <span className="text-[10px] text-foreground-400">{entry.triggeredByRole}</span>
                </div>
                <p className="text-xs text-foreground-500 mt-0.5">
                  <span className="text-accent-600 font-medium">{entry.aiFeatureLabel}</span> — {entry.inputDataSummary}
                </p>
                <div className="flex items-center gap-3 mt-2 text-[10px]">
                  <span className={`font-semibold uppercase ${
                    entry.userDecision === 'accepted' ? 'text-emerald-700'
                    : entry.userDecision === 'edited' ? 'text-accent-700'
                    : 'text-red-600'
                  }`}>
                    {entry.userDecision}
                  </span>
                  <span className="text-foreground-400">{new Date(entry.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span className="text-foreground-400">{entry.processingTimeMs}ms</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Governance Rules Tab
// ============================================================

function AiGovernanceTab() {
  const { neverAllowedActions, requireHumanApproval } = useAiSettings();

  return (
    <div className="space-y-6">
      {/* Human validation rule */}
      <div className="bg-background-50 rounded-xl border border-accent-200/60 p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-accent-100 flex items-center justify-center shrink-0">
            <AppIcon className="ri-shield-check-line text-accent-600 text-lg"></AppIcon>
          </div>
          <div>
            <h3 className="text-sm font-heading font-semibold text-foreground-950">Require Human Approval for AI Outputs</h3>
            <p className="text-xs text-foreground-500 mt-1">
              Every AI-generated suggestion, summary, draft, or recommendation must be reviewed and explicitly accepted, edited, or rejected by a human before it becomes an official record. This rule is mandatory and cannot be disabled.
            </p>
            <div className="mt-3">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 uppercase whitespace-nowrap">Always Enforced</span>
            </div>
          </div>
        </div>
      </div>

      {/* Never-allowed actions */}
      <div className="bg-background-50 rounded-xl border border-foreground-200 p-5">
        <h3 className="text-sm font-heading font-semibold text-foreground-950 mb-3">
          AI Must Never — Absolute Prohibitions
        </h3>
        <p className="text-xs text-foreground-500 mb-4">
          These actions are hardcoded into the platform and cannot be overridden by any setting. AI is strictly prohibited from performing these actions under any circumstances.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {neverAllowedActions.map((action, i) => (
            <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50/50 border border-red-100/50">
              <AppIcon className="ri-forbid-2-line text-red-400 text-sm mt-0.5 shrink-0"></AppIcon>
              <span className="text-xs text-red-700">{action}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Fallback rules */}
      <div className="bg-background-50 rounded-xl border border-foreground-200 p-5">
        <h3 className="text-sm font-heading font-semibold text-foreground-950 mb-3">AI Failure Fallback Rules</h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-background-100/50">
            <AppIcon className="ri-error-warning-line text-foreground-400 mt-0.5 shrink-0"></AppIcon>
            <div>
              <p className="text-xs font-medium text-foreground-900">When AI is disabled</p>
              <p className="text-[11px] text-foreground-500 mt-0.5">{AI_FALLBACK_RULES.whenDisabled}</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-background-100/50">
            <AppIcon className="ri-alert-line text-foreground-400 mt-0.5 shrink-0"></AppIcon>
            <div>
              <p className="text-xs font-medium text-foreground-900">When AI fails</p>
              <p className="text-[11px] text-foreground-500 mt-0.5">{AI_FALLBACK_RULES.whenFails}</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-background-100/50">
            <AppIcon className="ri-timer-line text-foreground-400 mt-0.5 shrink-0"></AppIcon>
            <div>
              <p className="text-xs font-medium text-foreground-900">Grace period</p>
              <p className="text-[11px] text-foreground-500 mt-0.5">{AI_FALLBACK_RULES.gracePeriod}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Stat card
// ============================================================

function StatCard({ label, value, icon, color = 'primary' }: { label: string; value: string; icon: string; color?: string }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    primary: { bg: 'bg-primary-100', text: 'text-primary-600' },
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600' },
    accent: { bg: 'bg-accent-100', text: 'text-accent-600' },
    red: { bg: 'bg-red-100', text: 'text-red-600' },
  };
  const c = colorMap[color] || colorMap.primary;

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-md ${c.bg} flex items-center justify-center`}>
          <AppIcon className={`${icon} ${c.text} text-xs`}></AppIcon>
        </div>
        <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-bold text-foreground-950 font-heading">{value}</p>
    </div>
  );
}
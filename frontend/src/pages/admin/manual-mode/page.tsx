import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { adminNavItems } from '@/mocks/navigation';

interface ManualOverride {
  id: string;
  feature: string;
  description: string;
  category: string;
  enabled: boolean;
  roles: string[];
  requiresApproval: boolean;
}

const MANUAL_OVERRIDES: ManualOverride[] = [
  { id: 'mo-01', feature: 'Bypass AI Validation', description: 'Allow manual override when AI rejects evidence or assignments', category: 'AI & Automation', enabled: false, roles: ['Tenant Admin', 'Compliance Officer'], requiresApproval: true },
  { id: 'mo-02', feature: 'Override Eligibility Checks', description: 'Manually approve eligibility where automated checks fail', category: 'Compliance', enabled: true, roles: ['Tenant Admin', 'Compliance Officer', 'QA Officer'], requiresApproval: true },
  { id: 'mo-03', feature: 'Force Enrolment', description: 'Force-enrol a learner bypassing onboarding workflow', category: 'Compliance', enabled: false, roles: ['Tenant Admin'], requiresApproval: true },
  { id: 'mo-04', feature: 'Manual OTJH Adjustment', description: 'Manually adjust OTJH hours for a learner', category: 'Evidence & OTJH', enabled: true, roles: ['Tenant Admin', 'Compliance Officer', 'Coach'], requiresApproval: false },
  { id: 'mo-05', feature: 'Manual KSB Validation', description: 'Override KSB validation status manually', category: 'Evidence & OTJH', enabled: true, roles: ['Tenant Admin', 'Coach', 'Tutor'], requiresApproval: false },
  { id: 'mo-06', feature: 'Override Attendance Records', description: 'Manually correct attendance entries', category: 'Attendance', enabled: true, roles: ['Tenant Admin', 'Coach', 'Engagement Manager'], requiresApproval: true },
  { id: 'mo-07', feature: 'Bypass Catch-up Rules', description: 'Skip automated catch-up scheduling for specific learners', category: 'Attendance', enabled: false, roles: ['Tenant Admin', 'Coach'], requiresApproval: true },
  { id: 'mo-08', feature: 'Manual Progress Review Adjustment', description: 'Edit completed progress review outcomes', category: 'Reviews', enabled: false, roles: ['Tenant Admin', 'QA Officer'], requiresApproval: true },
  { id: 'mo-09', feature: 'Override Gateway Readiness', description: 'Force gateway readiness status for EPA', category: 'Gateway & EPA', enabled: false, roles: ['Tenant Admin', 'QA Officer'], requiresApproval: true },
  { id: 'mo-10', feature: 'Manual Document Signature Bypass', description: 'Mark documents as signed without actual signature', category: 'Documents', enabled: false, roles: ['Tenant Admin'], requiresApproval: true },
  { id: 'mo-11', feature: 'Disable Automations', description: 'Pause all automated workflows globally', category: 'AI & Automation', enabled: true, roles: ['Tenant Admin'], requiresApproval: false },
  { id: 'mo-12', feature: 'Override Funding Calculations', description: 'Manually adjust funding band calculations', category: 'Finance', enabled: false, roles: ['Tenant Admin'], requiresApproval: true },
];

const categories = ['AI & Automation', 'Compliance', 'Evidence & OTJH', 'Attendance', 'Reviews', 'Gateway & EPA', 'Documents', 'Finance'];

const ALLOWED_ROLES = ['Tenant Admin', 'Compliance Officer', 'QA Officer', 'Senior Leader', 'Coach', 'Tutor', 'Engagement Manager'];

export default function ManualModeSettings() {
  const [overrides, setOverrides] = useState(MANUAL_OVERRIDES);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [globalManualMode, setGlobalManualMode] = useState(false);
  const [auditLogging, setAuditLogging] = useState(true);
  const [requireJustification, setRequireJustification] = useState(true);
  const [maxOverridePerDay, setMaxOverridePerDay] = useState(20);

  const filtered = activeCategory === 'all' ? overrides : overrides.filter(o => o.category === activeCategory);

  const toggleOverride = (id: string) => {
    setOverrides(prev => prev.map(o => o.id === id ? { ...o, enabled: !o.enabled } : o));
  };

  const enabledCount = overrides.filter(o => o.enabled).length;

  return (
    <WorkspaceShell role="admin" roleLabel="Admin" navItems={adminNavItems} pageTitle="Manual Mode Settings" pageSubtitle="Configure manual overrides and human-in-the-loop controls for all automated processes" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-tools-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Manual Mode Settings</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{overrides.length} manual overrides</strong> · {enabledCount} enabled · Configure human-in-the-loop controls
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{overrides.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Overrides</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-emerald-300">{enabledCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Enabled</p>
              </div>
            </div>
          </div>
        </div>

        {/* Global Settings */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Global Manual Mode Configuration</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-foreground-900">Global Manual Mode</p>
                <p className="text-[11px] text-foreground-400">Enable manual overrides across the entire platform</p>
              </div>
              <button onClick={() => setGlobalManualMode(!globalManualMode)} className={`relative w-12 h-6 rounded-full transition-smooth cursor-pointer ${globalManualMode ? 'bg-emerald-500' : 'bg-background-300'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-smooth ${globalManualMode ? 'left-6' : 'left-0.5'}`}></span>
              </button>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-background-100">
              <div>
                <p className="text-sm font-medium text-foreground-900">Audit Logging for Manual Actions</p>
                <p className="text-[11px] text-foreground-400">Every manual override is logged in the audit trail with timestamp and user</p>
              </div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Always Enabled</span>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-background-100">
              <div>
                <p className="text-sm font-medium text-foreground-900">Require Justification</p>
                <p className="text-[11px] text-foreground-400">Users must provide a reason when performing manual overrides</p>
              </div>
              <button onClick={() => setRequireJustification(!requireJustification)} className={`relative w-12 h-6 rounded-full transition-smooth cursor-pointer ${requireJustification ? 'bg-emerald-500' : 'bg-background-300'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-smooth ${requireJustification ? 'left-6' : 'left-0.5'}`}></span>
              </button>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-background-100">
              <div>
                <p className="text-sm font-medium text-foreground-900">Max Overrides Per Day</p>
                <p className="text-[11px] text-foreground-400">Limit the number of manual overrides per user per day</p>
              </div>
              <div className="flex items-center gap-2">
                <input type="range" min="0" max="100" value={maxOverridePerDay} onChange={e => setMaxOverridePerDay(Number(e.target.value))} className="w-24" />
                <span className="text-sm font-semibold text-foreground-900 w-8 text-right">{maxOverridePerDay}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Allowed Roles */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Roles Permitted to Use Manual Overrides</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {ALLOWED_ROLES.map(role => (
              <div key={role} className="flex items-center justify-between bg-background-100 rounded-lg border border-foreground-200/60 p-3 hover:border-background-300/60 transition-smooth">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-md bg-primary-100 text-primary-600 flex items-center justify-center">
                    <i className="ri-shield-user-line text-xs"></i>
                  </span>
                  <span className="text-[12px] font-medium text-foreground-900">{role}</span>
                </div>
                <input type="checkbox" defaultChecked={['Tenant Admin', 'Compliance Officer', 'QA Officer'].includes(role)} className="rounded border-background-300 cursor-pointer" />
              </div>
            ))}
          </div>
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setActiveCategory('all')} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${activeCategory === 'all' ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500 hover:bg-background-200'}`}>
            All ({overrides.length})
          </button>
          {categories.map(cat => {
            const count = overrides.filter(o => o.category === cat).length;
            return (
              <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${activeCategory === cat ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500 hover:bg-background-200'}`}>
                {cat} ({count})
              </button>
            );
          })}
        </div>

        {/* Override List */}
        <div className="space-y-3">
          {filtered.map(override => (
            <div key={override.id} className={`bg-background-50 rounded-xl border p-4 transition-smooth ${override.enabled ? 'border-emerald-200/50 bg-emerald-50/20' : 'border-foreground-200/60'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700 uppercase">{override.category}</span>
                    <p className="text-sm font-semibold text-foreground-900">{override.feature}</p>
                  </div>
                  <p className="text-[12px] text-foreground-500 mb-2">{override.description}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] text-foreground-400">Roles:</span>
                    {override.roles.map(role => (
                      <span key={role} className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-600 border border-primary-100">{role}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <span className={`text-[10px] font-medium ${override.requiresApproval ? 'text-amber-600' : 'text-foreground-400'}`}>
                      <i className={`${override.requiresApproval ? 'ri-shield-check-line text-amber-500' : 'ri-information-line'} mr-0.5`}></i>
                      {override.requiresApproval ? 'Requires secondary approval' : 'No secondary approval needed'}
                    </span>
                  </div>
                </div>
                <button onClick={() => toggleOverride(override.id)} className={`relative w-12 h-6 rounded-full transition-smooth shrink-0 cursor-pointer ${override.enabled ? 'bg-emerald-500' : 'bg-background-300'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-smooth ${override.enabled ? 'left-6' : 'left-0.5'}`}></span>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Save Button */}
        <div className="flex items-center gap-3 pt-2">
          <button className="px-5 py-2.5 bg-primary-500 text-white rounded-xl text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-save-line mr-1.5"></i> Save Configuration
          </button>
          <button className="px-5 py-2.5 bg-background-50 border border-background-200 rounded-xl text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
            Reset to Defaults
          </button>
        </div>
      </div>
    </WorkspaceShell>
  );
}
import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { BrandLockup } from '@/components/BrandLockup';
import { adminNavItems } from '@/mocks/navigation';
import RbacManagementPage from './RbacManagementPage';
import AiSettingsPage from './AiSettingsPage';

interface SettingsCategory {
  id: string;
  label: string;
  icon: string;
  group: string;
  href: string;
  description: string;
  items: number;
  configured: number;
}

const settingsCategories: SettingsCategory[] = [
  { id: 'branding', label: 'Branding & Theme', icon: 'ri-palette-line', group: 'Brand & Identity', href: '/admin/settings/branding', description: 'Logo, colours, terminology', items: 4, configured: 4 },
  { id: 'terminology', label: 'Terminology', icon: 'ri-font-size', group: 'Brand & Identity', href: '/admin/settings/terminology', description: 'Custom labels and language', items: 12, configured: 10 },
  { id: 'users', label: 'Users & Roles', icon: 'ri-shield-user-line', group: 'Users & Access', href: '/admin/settings/users', description: 'User management and roles', items: 15, configured: 15 },
  { id: 'rbac', label: 'RBAC Matrix', icon: 'ri-key-2-line', group: 'Users & Access', href: '/admin/settings/rbac', description: 'Permission matrix control', items: 20, configured: 20 },
  { id: 'permissions', label: 'Permission Settings', icon: 'ri-lock-password-line', group: 'Users & Access', href: '/admin/settings/permissions', description: 'Granular access control', items: 20, configured: 18 },
  { id: 'programmes', label: 'Programme Settings', icon: 'ri-book-2-line', group: 'Programme & Curriculum', href: '/admin/settings/programmes', description: 'Standards and frameworks', items: 8, configured: 8 },
  { id: 'ksb', label: 'KSB Framework', icon: 'ri-bar-chart-2-line', group: 'Programme & Curriculum', href: '/admin/settings/ksb', description: 'KSB mapping configuration', items: 6, configured: 5 },
  { id: 'policy', label: 'Policy Documents', icon: 'ri-file-text-line', group: 'Programme & Curriculum', href: '/admin/settings/policy', description: 'Safeguarding and E&D policies', items: 5, configured: 4 },
  { id: 'onboarding', label: 'Onboarding Settings', icon: 'ri-user-add-line', group: 'Onboarding & Eligibility', href: '/admin/settings/onboarding', description: 'Self-onboarding flow config', items: 8, configured: 8 },
  { id: 'eligibility', label: 'Eligibility Rules', icon: 'ri-checkbox-circle-line', group: 'Onboarding & Eligibility', href: '/admin/settings/eligibility', description: 'Funding and residency rules', items: 6, configured: 6 },
  { id: 'rpl', label: 'RPL Settings', icon: 'ri-refresh-line', group: 'Onboarding & Eligibility', href: '/admin/settings/rpl', description: 'Prior learning assessment', items: 4, configured: 4 },
  { id: 'attendance', label: 'Attendance Rules', icon: 'ri-calendar-check-line', group: 'Learning Delivery', href: '/admin/settings/attendance', description: 'Attendance thresholds and modes', items: 6, configured: 6 },
  { id: 'self-paced', label: 'Self-Paced Rules', icon: 'ri-speed-line', group: 'Learning Delivery', href: '/admin/settings/self-paced', description: 'Self-paced learning config', items: 4, configured: 3 },
  { id: 'catchup', label: 'Catch-Up Rules', icon: 'ri-loop-left-line', group: 'Learning Delivery', href: '/admin/settings/catchup', description: 'Catch-up scheduling rules', items: 5, configured: 5 },
  { id: 'otjh', label: 'OTJH Settings', icon: 'ri-time-line', group: 'Evidence & Assessment', href: '/admin/settings/otjh', description: 'Hours tracking and validation', items: 6, configured: 6 },
  { id: 'ksb-validation', label: 'KSB Validation', icon: 'ri-shield-check-line', group: 'Evidence & Assessment', href: '/admin/settings/ksb-validation', description: 'KSB assessment criteria', items: 4, configured: 4 },
  { id: 'monthly-cycle', label: 'Monthly Cycle', icon: 'ri-calendar-2-line', group: 'Evidence & Assessment', href: '/admin/settings/monthly-cycle', description: 'Monthly coaching and review', items: 6, configured: 6 },
  { id: 'progress-review', label: 'Progress Reviews', icon: 'ri-line-chart-line', group: 'Reviews & Coaching', href: '/admin/settings/progress-review', description: 'Review templates and SLAs', items: 5, configured: 5 },
  { id: 'coaching', label: 'Coaching Settings', icon: 'ri-user-heart-line', group: 'Reviews & Coaching', href: '/admin/settings/coaching', description: 'Coach assignment and meetings', items: 4, configured: 4 },
  { id: 'signatures', label: 'Digital Signatures', icon: 'ri-pen-nib-line', group: 'Compliance & QA', href: '/admin/settings/signatures', description: 'E-signature configuration', items: 3, configured: 3 },
  { id: 'templates', label: 'Document Templates', icon: 'ri-file-copy-line', group: 'Compliance & QA', href: '/admin/settings/templates', description: 'Letter and form templates', items: 10, configured: 9 },
  { id: 'qa', label: 'QA Workflows', icon: 'ri-search-eye-line', group: 'Compliance & QA', href: '/admin/settings/qa', description: 'Quality assurance process', items: 8, configured: 7 },
  { id: 'audit', label: 'Audit Settings', icon: 'ri-history-line', group: 'Compliance & QA', href: '/admin/settings/audit', description: 'Audit logging and retention', items: 4, configured: 4 },
  { id: 'retention', label: 'Data Retention', icon: 'ri-archive-line', group: 'Compliance & QA', href: '/admin/settings/retention', description: 'GDPR retention policies', items: 3, configured: 3 },
  { id: 'notifications', label: 'Notification Settings', icon: 'ri-notification-3-line', group: 'System & Integration', href: '/admin/settings/notifications', description: 'Channels and delivery rules', items: 10, configured: 10 },
  { id: 'ai', label: 'AI Settings', icon: 'ri-sparkling-2-line', group: 'System & Integration', href: '/admin/settings/ai', description: 'AI marking and assistant config', items: 8, configured: 6 },
  { id: 'manual-mode', label: 'Manual Mode', icon: 'ri-tools-line', group: 'System & Integration', href: '/admin/settings/manual-mode', description: 'Override and manual controls', items: 6, configured: 4 },
  { id: 'integrations', label: 'Integrations', icon: 'ri-plug-line', group: 'System & Integration', href: '/admin/settings/integrations', description: 'API keys and webhooks', items: 10, configured: 7 },
  { id: 'security', label: 'Security Settings', icon: 'ri-lock-line', group: 'System & Integration', href: '/admin/settings/security', description: 'Auth, SSO, and encryption', items: 6, configured: 5 },
  { id: 'reports', label: 'Report Templates', icon: 'ri-bar-chart-box-line', group: 'System & Integration', href: '/admin/settings/reports', description: 'Scheduled reports config', items: 12, configured: 12 },
];

const groups = ['Brand & Identity', 'Users & Access', 'Programme & Curriculum', 'Onboarding & Eligibility', 'Learning Delivery', 'Evidence & Assessment', 'Reviews & Coaching', 'Compliance & QA', 'System & Integration'];

const groupDescriptions: Record<string, string> = {
  'Brand & Identity': 'Visual identity, language, and branding configuration',
  'Users & Access': 'User roles, permissions, and access control',
  'Programme & Curriculum': 'Apprenticeship standards and KSB frameworks',
  'Onboarding & Eligibility': 'Enrolment, eligibility, and RPL settings',
  'Learning Delivery': 'Attendance, self-paced, and catch-up rules',
  'Evidence & Assessment': 'OTJH, KSB validation, and monthly cycle',
  'Reviews & Coaching': 'Progress reviews and coaching configuration',
  'Compliance & QA': 'Digital signatures, QA, audit, and retention',
  'System & Integration': 'Notifications, AI, integrations, and security',
};

export default function SettingsHub() {
  const [activeCategory, setActiveCategory] = useState('branding');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const totalItems = settingsCategories.reduce((a, b) => a + b.items, 0);
  const totalConfigured = settingsCategories.reduce((a, b) => a + b.configured, 0);
  const completionRate = Math.round((totalConfigured / totalItems) * 100);

  const filtered = settingsCategories.filter(c =>
    c.label.toLowerCase().includes(search.toLowerCase()) ||
    c.description.toLowerCase().includes(search.toLowerCase()) ||
    c.group.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <WorkspaceShell
      role="admin"
      roleLabel="Admin"
      navItems={adminNavItems}
      pageTitle="Settings Hub"
      pageSubtitle={`${settingsCategories.length} categories · ${totalItems} settings · ${completionRate}% configured`}
      userName="Admin User"
      userRole="Tenant Administrator"
    >
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden bg-foreground-950">
          <div className="absolute animate-liquid-blob-1 opacity-30" style={{ width: '35%', height: '50%', left: '-5%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.35) 0%, oklch(var(--accent-600) / 0.12) 35%, transparent 70%)', filter: 'blur(40px)' }} />
          <div className="absolute animate-liquid-blob-2 opacity-25" style={{ width: '30%', height: '45%', right: '-5%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.35) 0%, oklch(var(--primary-600) / 0.1) 40%, transparent 70%)', filter: 'blur(50px)' }} />
          <div className="absolute animate-liquid-blob-3 opacity-20" style={{ width: '25%', height: '40%', right: '25%', top: '10%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.25) 0%, oklch(var(--secondary-500) / 0.06) 40%, transparent 70%)', filter: 'blur(55px)' }} />
          <div className="absolute animate-liquid-blob-4 animate-blob-opacity-pulse opacity-30" style={{ width: '40%', height: '35%', left: '10%', bottom: '-8%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-300) / 0.25) 0%, oklch(var(--accent-400) / 0.1) 30%, oklch(var(--primary-300) / 0.04) 55%, transparent 75%)', filter: 'blur(45px)' }} />
          <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'linear-gradient(oklch(var(--background-100)) 1px, transparent 1px), linear-gradient(90deg, oklch(var(--background-100)) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-settings-3-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Settings Hub</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{settingsCategories.length} categories</strong> across {groups.length} groups. {totalItems} total settings. {completionRate}% fully configured.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{settingsCategories.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Categories</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalItems}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Settings</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{completionRate}%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Complete</p>
              </div>
            </div>
          </div>
        </div>

        {/* Completion Progress */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Overall Configuration Progress</h3>
            <span className="text-[13px] font-bold text-primary-600">{completionRate}%</span>
          </div>
          <div className="h-3 bg-background-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-smooth" style={{ width: `${completionRate}%` }}></div>
          </div>
          <div className="flex items-center justify-between mt-2 text-[11px] text-foreground-400">
            <span>{totalConfigured} of {totalItems} settings configured</span>
            <span>{totalItems - totalConfigured} remaining</span>
          </div>
        </div>

        {/* Search & View Toggle */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
            <input
              type="text"
              placeholder="Search settings categories..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth"
            />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            <button onClick={() => setViewMode('grid')} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-smooth cursor-pointer ${viewMode === 'grid' ? 'bg-white text-foreground-900' : 'text-foreground-500'}`}>
              <AppIcon className="ri-grid-line mr-1"></AppIcon> Grid
            </button>
            <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-smooth cursor-pointer ${viewMode === 'list' ? 'bg-white text-foreground-900' : 'text-foreground-500'}`}>
              <AppIcon className="ri-list-check mr-1"></AppIcon> List
            </button>
          </div>
        </div>

        {/* Settings Content */}
        <div className="flex h-full gap-6">
          {/* Categories Panel */}
          <div className="flex-1">
            {groups.map(group => {
              const groupCats = filtered.filter(c => c.group === group);
              if (groupCats.length === 0) return null;
              return (
                <div key={group} className="mb-6">
                  <div className="mb-3">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">{group}</h3>
                    <p className="text-[11px] text-foreground-400">{groupDescriptions[group]}</p>
                  </div>
                  {viewMode === 'grid' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {groupCats.map(cat => {
                        const pct = Math.round((cat.configured / cat.items) * 100);
                        const isComplete = pct === 100;
                        return (
                          <button
                            key={cat.id}
                            onClick={() => setActiveCategory(cat.id)}
                            className={`text-left p-4 rounded-xl border transition-smooth cursor-pointer ${activeCategory === cat.id ? 'border-primary-300 bg-primary-50/50 ring-1 ring-primary-200/50' : 'border-foreground-200/60 bg-background-50 hover:border-background-300/60'}`}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${activeCategory === cat.id ? 'bg-primary-100 text-primary-600' : 'bg-secondary-100 text-secondary-600'}`}>
                                <AppIcon className={`${cat.icon} text-sm`}></AppIcon>
                              </span>
                              {isComplete ? (
                                <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                                  <AppIcon className="ri-check-line text-emerald-600 text-xs"></AppIcon>
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold text-accent-600">{pct}%</span>
                              )}
                            </div>
                            <p className="text-[13px] font-semibold text-foreground-900 mb-0.5">{cat.label}</p>
                            <p className="text-[11px] text-foreground-400 mb-2">{cat.description}</p>
                            <div className="h-1 bg-background-200 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${isComplete ? 'bg-emerald-500' : 'bg-primary-500'}`} style={{ width: `${pct}%` }}></div>
                            </div>
                            <p className="text-[10px] text-foreground-400 mt-1">{cat.configured}/{cat.items} items</p>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {groupCats.map(cat => {
                        const pct = Math.round((cat.configured / cat.items) * 100);
                        return (
                          <button
                            key={cat.id}
                            onClick={() => setActiveCategory(cat.id)}
                            className={`w-full flex items-center gap-4 p-3 rounded-xl border text-left transition-smooth cursor-pointer ${activeCategory === cat.id ? 'border-primary-300 bg-primary-50/50 ring-1 ring-primary-200/50' : 'border-foreground-200/60 bg-background-50 hover:border-background-300/60'}`}
                          >
                            <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${activeCategory === cat.id ? 'bg-primary-100 text-primary-600' : 'bg-secondary-100 text-secondary-600'}`}>
                              <AppIcon className={`${cat.icon} text-sm`}></AppIcon>
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold text-foreground-900">{cat.label}</p>
                              <p className="text-[11px] text-foreground-400">{cat.description}</p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <div className="w-24">
                                <div className="h-1.5 bg-background-200 rounded-full overflow-hidden">
                                  <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }}></div>
                                </div>
                              </div>
                              <span className="text-[11px] font-semibold text-foreground-600 w-10 text-right">{pct}%</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Detail Panel */}
          <div className="w-[380px] shrink-0 bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit sticky top-6">
            {activeCategory === 'rbac' ? (
              <RbacManagementPage />
            ) : activeCategory === 'ai' || activeCategory === 'manual-mode' ? (
              <AiSettingsPage />
            ) : (
              <SettingsContent categoryId={activeCategory} />
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function SettingsContent({ categoryId }: { categoryId: string }) {
  const category = settingsCategories.find(c => c.id === categoryId);
  if (!category) return null;

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
            <AppIcon className={`${category.icon} text-primary-600 text-sm`}></AppIcon>
          </span>
          <h2 className="text-sm font-heading font-semibold text-foreground-950">{category.label}</h2>
        </div>
        <p className="text-[12px] text-foreground-500">{category.description} · {category.group}</p>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between text-[11px] text-foreground-500 mb-1">
          <span>Configuration</span>
          <span>{category.configured}/{category.items}</span>
        </div>
        <div className="h-2 bg-background-200 rounded-full overflow-hidden">
          <div className="h-full bg-primary-500 rounded-full" style={{ width: `${Math.round((category.configured / category.items) * 100)}%` }}></div>
        </div>
      </div>

      {categoryId === 'branding' && <BrandingSettingsContent />}
      {categoryId === 'users' && <UsersSettingsContent />}
      {categoryId === 'permissions' && <PermissionsSettingsContent />}
      {categoryId === 'programmes' && <ProgrammeSettingsContent />}
      {categoryId === 'ai' && <AiSettingsContent />}
      {categoryId === 'manual-mode' && <ManualModeContent />}
      {categoryId === 'integrations' && <IntegrationsSettingsContent />}
      {categoryId === 'notifications' && <NotificationsSettingsContent />}
      {categoryId === 'security' && <SecuritySettingsContent />}

      {(['branding', 'users', 'permissions', 'programmes', 'ai', 'manual-mode', 'integrations', 'notifications', 'security'].indexOf(categoryId) === -1) && (
        <GenericSettingsPlaceholder label={category.label} />
      )}
    </div>
  );
}

function GenericSettingsPlaceholder({ label }: { label: string }) {
  return (
    <div className="bg-background-100 rounded-xl border border-foreground-200/60 p-6 text-center">
      <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center mx-auto mb-3">
        <AppIcon className="ri-settings-3-line text-primary-500 text-lg"></AppIcon>
      </div>
      <h3 className="text-[13px] font-semibold text-foreground-900 mb-1">{label} Configuration</h3>
      <p className="text-[11px] text-foreground-500">
        This settings panel is ready for configuration. Customise {label.toLowerCase()} rules and defaults for your tenant.
      </p>
    </div>
  );
}

function BrandingSettingsContent() {
  return (
    <div className="space-y-4">
      <SettingsSection title="Logo & Identity">
        <div className="flex items-center gap-4">
          <BrandLockup size="default" />
          <div>
            <button className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-[12px] font-medium hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              Upload Logo
            </button>
            <p className="text-[10px] text-foreground-400 mt-1">256x256px PNG or SVG recommended</p>
          </div>
        </div>
        <div className="mt-3">
          <label className="block text-[11px] font-semibold text-foreground-600 mb-1">Tenant Name</label>
          <input type="text" defaultValue="Kent Business College" className="w-full px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth" />
        </div>
      </SettingsSection>

      <SettingsSection title="Theme Colours">
        <div className="grid grid-cols-2 gap-3">
          <ColorInput label="Primary" defaultValue="#6C2BD9" swatchClass="bg-primary-500" />
          <ColorInput label="Accent" defaultValue="#D4A017" swatchClass="bg-accent-500" />
          <ColorInput label="Secondary" defaultValue="#6B7280" swatchClass="bg-secondary-500" />
          <ColorInput label="Foreground" defaultValue="#111827" swatchClass="bg-foreground-950" />
        </div>
      </SettingsSection>

      <SettingsSection title="Terminology Overrides">
        <div className="space-y-2">
          <TermRow label="Learner" defaultValue="Apprentice Learner" />
          <TermRow label="Coach" defaultValue="Progress Coach" />
          <TermRow label="Tutor" defaultValue="Curriculum Tutor" />
          <TermRow label="Programme" defaultValue="Apprenticeship Programme" />
          <TermRow label="Evidence" defaultValue="Learning Evidence" />
        </div>
      </SettingsSection>
    </div>
  );
}

function ColorInput({ label, defaultValue, swatchClass }: { label: string; defaultValue: string; swatchClass: string }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-foreground-600 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-md border-2 border-background-200 ${swatchClass}`}></div>
        <input type="text" defaultValue={defaultValue} className="flex-1 px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth" />
      </div>
    </div>
  );
}

function UsersSettingsContent() {
  return (
    <div className="space-y-4">
      <SettingsSection title="Role Management">
        <div className="space-y-1">
          {[
            { name: 'Apprentice Learner', count: 7, color: 'primary' },
            { name: 'Progress Coach', count: 2, color: 'accent' },
            { name: 'Curriculum Tutor', count: 3, color: 'secondary' },
            { name: 'Employer / Line Manager', count: 5, color: 'accent' },
            { name: 'Engagement Manager', count: 1, color: 'primary' },
            { name: 'Compliance Officer', count: 1, color: 'secondary' },
            { name: 'QA Officer', count: 1, color: 'accent' },
            { name: 'Tenant Admin', count: 1, color: 'primary' },
          ].map(role => (
            <div key={role.name} className="flex items-center justify-between bg-background-100 rounded-lg border border-foreground-200/60 p-2.5 hover:border-background-300/60 transition-smooth cursor-pointer">
              <div className="flex items-center gap-2">
                <span className={`w-6 h-6 rounded-md flex items-center justify-center ${role.color === 'primary' ? 'bg-primary-100 text-primary-600' : role.color === 'accent' ? 'bg-accent-100 text-accent-600' : 'bg-secondary-100 text-secondary-600'}`}>
                  <AppIcon className="ri-shield-user-line text-xs"></AppIcon>
                </span>
                <span className="text-[12px] font-medium text-foreground-900">{role.name}</span>
              </div>
              <span className="text-[11px] text-foreground-400">{role.count} users</span>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}

function PermissionsSettingsContent() {
  const perms = [
    { perm: 'View Dashboard', learner: true, coach: true, tutor: true, employer: true, admin: true },
    { perm: 'Create Evidence', learner: true, coach: false, tutor: false, employer: false, admin: false },
    { perm: 'Validate Evidence', learner: false, coach: true, tutor: true, employer: false, admin: true },
    { perm: 'Claim OTJH', learner: true, coach: false, tutor: false, employer: false, admin: false },
    { perm: 'Validate OTJH', learner: false, coach: true, tutor: false, employer: false, admin: true },
    { perm: 'Assess KSB', learner: false, coach: true, tutor: true, employer: false, admin: true },
    { perm: 'Manage Coaching', learner: false, coach: true, tutor: false, employer: false, admin: true },
    { perm: 'Manage Users', learner: false, coach: false, tutor: false, employer: false, admin: true },
    { perm: 'Manage Settings', learner: false, coach: false, tutor: false, employer: false, admin: true },
  ];
  return (
    <div className="space-y-4">
      <SettingsSection title="Permission Matrix">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-background-200">
                <th className="text-left py-2 px-2 text-foreground-500 font-semibold">Permission</th>
                <th className="text-center py-2 px-1 text-foreground-500 font-semibold">LR</th>
                <th className="text-center py-2 px-1 text-foreground-500 font-semibold">CH</th>
                <th className="text-center py-2 px-1 text-foreground-500 font-semibold">TU</th>
                <th className="text-center py-2 px-1 text-foreground-500 font-semibold">EM</th>
                <th className="text-center py-2 px-1 text-foreground-500 font-semibold">AD</th>
              </tr>
            </thead>
            <tbody>
              {perms.map((row, i) => (
                <tr key={i} className="border-b border-background-100">
                  <td className="py-1.5 px-2 text-foreground-700 font-medium">{row.perm}</td>
                  {(['learner', 'coach', 'tutor', 'employer', 'admin'] as const).map(role => (
                    <td key={role} className="text-center py-1.5 px-1">
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded ${row[role] ? 'bg-emerald-100 text-emerald-600' : 'bg-background-100 text-foreground-300'}`}>
                        <AppIcon className={`${row[role] ? 'ri-check-line' : 'ri-subtract-line'} text-[10px]`}></AppIcon>
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>
    </div>
  );
}

function ProgrammeSettingsContent() {
  return (
    <div className="space-y-4">
      <SettingsSection title="Active Standards">
        <div className="space-y-1">
          {['Business Administrator L3', 'Digital Marketer L3', 'Data Analyst L4', 'Software Developer L4', 'Project Manager L4', 'Operations Manager L5'].map(std => (
            <div key={std} className="flex items-center justify-between bg-background-100 rounded-lg border border-foreground-200/60 p-2.5 hover:border-background-300/60 transition-smooth cursor-pointer">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-primary-100 flex items-center justify-center">
                  <AppIcon className="ri-book-2-line text-primary-600 text-xs"></AppIcon>
                </span>
                <span className="text-[12px] font-medium text-foreground-900">{std}</span>
              </div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/50">Active</span>
            </div>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection title="KSB Framework">
        <select className="w-full px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
          <option>Standard KSB Framework v2.1</option>
          <option>IfATE Standard Mapping</option>
          <option>Custom Framework</option>
        </select>
      </SettingsSection>
    </div>
  );
}

function AiSettingsContent() {
  return (
    <div className="space-y-4">
      <SettingsSection title="AI Assistant">
        <ToggleRow label="Enable AI Assistant" description="AI-powered Q&A and coaching support" value={true} />
        <ToggleRow label="AI Marking" description="Automated assignment marking assistance" value={true} />
        <ToggleRow label="Evidence Suggestions" description="AI suggests evidence for KSB claims" value={false} />
      </SettingsSection>
      <SettingsSection title="Model Settings">
        <div className="space-y-2">
          <div className="flex items-center justify-between py-1">
            <span className="text-[12px] text-foreground-600">Model</span>
            <select className="px-2 py-1 rounded-lg border border-background-200 bg-background-50 text-[12px] text-foreground-900 outline-none cursor-pointer">
              <option>GPT-4o</option>
              <option>GPT-4o-mini</option>
              <option>Claude 3.5</option>
            </select>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-[12px] text-foreground-600">Temperature</span>
            <input type="range" min="0" max="100" defaultValue="70" className="w-24" />
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

function ManualModeContent() {
  return (
    <div className="space-y-4">
      <SettingsSection title="Manual Overrides">
        <ToggleRow label="Enable Manual Mode" description="Allow manual override of automated processes" value={false} />
        <ToggleRow label="Bypass AI Validation" description="Skip AI validation on evidence submission" value={false} />
        <ToggleRow label="Disable Automations" description="Pause all automated workflows" value={false} />
      </SettingsSection>
      <SettingsSection title="Override Permissions">
        <div className="space-y-1">
          {['Tenant Admin', 'Compliance Officer', 'QA Officer', 'Senior Leader'].map(role => (
            <div key={role} className="flex items-center justify-between bg-background-100 rounded-lg p-2.5">
              <span className="text-[12px] text-foreground-700">{role}</span>
              <input type="checkbox" defaultChecked className="rounded border-background-300" />
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}

function IntegrationsSettingsContent() {
  return (
    <div className="space-y-4">
      <SettingsSection title="API Configuration">
        <div className="space-y-2">
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 mb-1">API Base URL</label>
            <input type="text" defaultValue="https://api.kbclearning.co.uk/v2" className="w-full px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 mb-1">Webhook Secret</label>
            <input type="password" defaultValue="whsec_••••••••••••••••" className="w-full px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth" />
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

function NotificationsSettingsContent() {
  return (
    <div className="space-y-4">
      <SettingsSection title="Channels">
        <ToggleRow label="In-app Notifications" description="Browser and mobile push notifications" value={true} />
        <ToggleRow label="Email Notifications" description="SMTP email delivery" value={true} />
        <ToggleRow label="WhatsApp Messages" description="WhatsApp Business API" value={true} />
      </SettingsSection>
    </div>
  );
}

function SecuritySettingsContent() {
  return (
    <div className="space-y-4">
      <SettingsSection title="Authentication">
        <ToggleRow label="Two-Factor Authentication" description="Require 2FA for admin roles" value={true} />
        <ToggleRow label="SSO / SAML" description="Enable single sign-on" value={false} />
        <ToggleRow label="IP Whitelist" description="Restrict access by IP address" value={false} />
      </SettingsSection>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-background-100 rounded-xl border border-foreground-200/60 p-4">
      <h3 className="text-[12px] font-heading font-semibold text-foreground-900 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function TermRow({ label, defaultValue }: { label: string; defaultValue: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 text-[11px] font-medium text-foreground-600 shrink-0">{label}</span>
      <input type="text" defaultValue={defaultValue} className="flex-1 px-3 py-1.5 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth" />
    </div>
  );
}

function ToggleRow({ label, description, value }: { label: string; description: string; value: boolean }) {
  const [on, setOn] = useState(value);
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-[12px] font-medium text-foreground-900">{label}</p>
        <p className="text-[10px] text-foreground-400">{description}</p>
      </div>
      <button
        onClick={() => setOn(!on)}
        className={`w-10 h-5 rounded-full transition-smooth relative cursor-pointer ${on ? 'bg-primary-500' : 'bg-background-200'}`}
      >
        <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-smooth" style={{ left: on ? '20px' : '2px' }}></span>
      </button>
    </div>
  );
}

import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const CATEGORIES = [
  { id: 'cat-1', name: 'Technical', description: 'Platform bugs, UI issues, system errors', tickets: 18, sla: '4h', active: true },
  { id: 'cat-2', name: 'Bug Report', description: 'Confirmed software defects requiring engineering', tickets: 14, sla: '8h', active: true },
  { id: 'cat-3', name: 'Data Issue', description: 'Incorrect data, missing records, sync errors', tickets: 10, sla: '12h', active: true },
  { id: 'cat-4', name: 'Complaint', description: 'Formal complaints about AI, staff, or process', tickets: 8, sla: '2h', active: true },
  { id: 'cat-5', name: 'Integration', description: 'Aptem, Teams, Outlook, DocuSign, CRM issues', tickets: 7, sla: '4h', active: true },
  { id: 'cat-6', name: 'Reporting', description: 'Report generation failures, incorrect data exports', tickets: 5, sla: '8h', active: true },
  { id: 'cat-7', name: 'Onboarding', description: 'New tenant provisioning, user setup issues', tickets: 4, sla: '24h', active: true },
  { id: 'cat-8', name: 'Notifications', description: 'Email, WhatsApp, SMS delivery failures', tickets: 4, sla: '6h', active: true },
  { id: 'cat-9', name: 'Access Request', description: 'Permission changes, role reassignments', tickets: 2, sla: '12h', active: false },
];

const SLA_RULES = [
  { id: 'sla-1', priority: 'urgent', firstResponse: '15m', resolution: '2h', escalationAfter: '1h', active: true },
  { id: 'sla-2', priority: 'high', firstResponse: '1h', resolution: '8h', escalationAfter: '4h', active: true },
  { id: 'sla-3', priority: 'medium', firstResponse: '4h', resolution: '24h', escalationAfter: '12h', active: true },
  { id: 'sla-4', priority: 'low', firstResponse: '8h', resolution: '72h', escalationAfter: '48h', active: true },
];

const AUTO_ASSIGN_RULES = [
  { id: 'aa-1', category: 'Technical', agent: 'Ahmed Khalil', condition: 'Tenant = KBC', active: true },
  { id: 'aa-2', category: 'Bug Report', agent: 'David Osei', condition: 'All tenants', active: true },
  { id: 'aa-3', category: 'Complaint', agent: 'Nadia Hussain', condition: 'All tenants', active: true },
  { id: 'aa-4', category: 'Integration', agent: 'Layla Moussa', condition: 'Priority = urgent | high', active: true },
  { id: 'aa-5', category: 'Data Issue', agent: 'Round Robin', condition: 'All tenants', active: false },
  { id: 'aa-6', category: 'Reporting', agent: 'Ahmed Khalil', condition: 'Tenant = MAN, LSA', active: true },
];

const AGENTS = ['Ahmed Khalil', 'Layla Moussa', 'David Osei', 'Nadia Hussain', 'Round Robin'];

export default function AdminSupportSettingsPage() {
  const [activeSection, setActiveSection] = useState<'categories' | 'sla' | 'auto-assign'>('categories');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingSla, setEditingSla] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<string | null>(null);

  const sections = [
    { key: 'categories' as const, label: 'Ticket Categories', icon: 'ri-price-tag-3-line' },
    { key: 'sla' as const, label: 'SLA Rules', icon: 'ri-timer-line' },
    { key: 'auto-assign' as const, label: 'Auto-Assignment', icon: 'ri-user-received-line' },
  ];

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Support Settings" pageSubtitle="Configure ticket categories, SLA policies, and auto-assignment rules" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-customer-service-2-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Support Configuration</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{CATEGORIES.filter(c => c.active).length} categories</strong> · {SLA_RULES.length} SLA rules · {AUTO_ASSIGN_RULES.filter(r => r.active).length} active assignment rules
              </p>
            </div>
          </div>
        </div>

        {/* Section Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-full p-1 w-fit">
          {sections.map(section => (
            <button
              key={section.key}
              onClick={() => setActiveSection(section.key)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-smooth whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                activeSection === section.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              <AppIcon className={`${section.icon} text-xs`}></AppIcon>
              {section.label}
            </button>
          ))}
        </div>

        {/* === TICKET CATEGORIES === */}
        {activeSection === 'categories' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-foreground-700">Manage ticket categories, SLAs, and visibility</p>
              <button className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-add-line mr-1"></AppIcon> Add Category
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {CATEGORIES.map(cat => (
                <div key={cat.id} className={`bg-background-50 rounded-xl border p-4 transition-smooth ${cat.active ? 'border-foreground-200/60' : 'border-background-100 opacity-60'}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded-lg bg-secondary-100 flex items-center justify-center">
                        <AppIcon className="ri-price-tag-3-line text-secondary-600 text-sm"></AppIcon>
                      </span>
                      <div>
                        <p className="text-[13px] font-semibold text-foreground-800">{cat.name}</p>
                        <p className="text-[10px] text-foreground-400">{cat.tickets} open tickets</p>
                      </div>
                    </div>
                    <span className={`w-2 h-2 rounded-full ${cat.active ? 'bg-emerald-500' : 'bg-foreground-300'}`}></span>
                  </div>
                  <p className="text-[11px] text-foreground-500 leading-relaxed mb-3">{cat.description}</p>

                  {editingCategory === cat.id ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input type="text" defaultValue={cat.name} className="flex-1 text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50" />
                        <select defaultValue={cat.sla} className="text-[11px] border border-background-200 rounded-lg px-2 py-1.5 bg-background-50 cursor-pointer">
                          <option>2h</option><option>4h</option><option>6h</option><option>8h</option><option>12h</option><option>24h</option><option>72h</option>
                        </select>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => setEditingCategory(null)} className="px-3 py-1.5 bg-emerald-500 text-white rounded-md text-[10px] font-semibold cursor-pointer whitespace-nowrap">Save</button>
                        <button onClick={() => setEditingCategory(null)} className="px-3 py-1.5 bg-background-100 text-foreground-600 rounded-md text-[10px] cursor-pointer whitespace-nowrap">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-foreground-400">Default SLA: <strong className="text-foreground-700">{cat.sla}</strong></span>
                      <button onClick={() => setEditingCategory(cat.id)} className="text-[11px] text-primary-600 hover:text-primary-700 cursor-pointer font-medium whitespace-nowrap">Edit</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === SLA RULES === */}
        {activeSection === 'sla' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-foreground-700">Define response and resolution times per priority level</p>
              <button className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-add-line mr-1"></AppIcon> Add SLA Rule
              </button>
            </div>

            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="grid grid-cols-7 gap-2 p-3 bg-background-100/70 border-b border-foreground-400/50 text-[10px] font-semibold text-foreground-500 uppercase tracking-wide">
                <span>Priority</span>
                <span>First Response</span>
                <span>Resolution</span>
                <span>Escalation</span>
                <span>Status</span>
                <span className="col-span-2">Actions</span>
              </div>
              {SLA_RULES.map(rule => (
                <div key={rule.id} className="grid grid-cols-7 gap-2 p-3 border-b border-background-100 last:border-0 items-center text-[12px]">
                  <span className={`font-semibold ${
                    rule.priority === 'urgent' ? 'text-red-600' : rule.priority === 'high' ? 'text-amber-600' : rule.priority === 'medium' ? 'text-blue-600' : 'text-foreground-500'
                  } capitalize`}>{rule.priority}</span>

                  {editingSla === rule.id ? (
                    <>
                      <select defaultValue={rule.firstResponse} className="text-[11px] border border-background-200 rounded-md px-1.5 py-1 bg-background-50 cursor-pointer">
                        <option>15m</option><option>30m</option><option>1h</option><option>2h</option><option>4h</option><option>8h</option>
                      </select>
                      <select defaultValue={rule.resolution} className="text-[11px] border border-background-200 rounded-md px-1.5 py-1 bg-background-50 cursor-pointer">
                        <option>2h</option><option>4h</option><option>8h</option><option>24h</option><option>48h</option><option>72h</option>
                      </select>
                      <select defaultValue={rule.escalationAfter} className="text-[11px] border border-background-200 rounded-md px-1.5 py-1 bg-background-50 cursor-pointer">
                        <option>1h</option><option>2h</option><option>4h</option><option>12h</option><option>24h</option><option>48h</option>
                      </select>
                    </>
                  ) : (
                    <>
                      <span className="text-foreground-600">{rule.firstResponse}</span>
                      <span className="text-foreground-600">{rule.resolution}</span>
                      <span className="text-foreground-600">{rule.escalationAfter}</span>
                    </>
                  )}
                  <span className={`w-2 h-2 rounded-full ${rule.active ? 'bg-emerald-500' : 'bg-foreground-300'}`}></span>
                  <span className="col-span-2 flex items-center gap-1.5">
                    {editingSla === rule.id ? (
                      <>
                        <button onClick={() => setEditingSla(null)} className="text-[10px] text-emerald-600 font-semibold cursor-pointer whitespace-nowrap">Save</button>
                        <button onClick={() => setEditingSla(null)} className="text-[10px] text-foreground-400 cursor-pointer whitespace-nowrap">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setEditingSla(rule.id)} className="text-[10px] text-primary-600 cursor-pointer whitespace-nowrap">Edit</button>
                        <button className="text-[10px] text-foreground-300 cursor-pointer whitespace-nowrap">
                          {rule.active ? 'Disable' : 'Enable'}
                        </button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === AUTO-ASSIGNMENT === */}
        {activeSection === 'auto-assign' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-foreground-700">Define rules for automatic ticket assignment</p>
              <button className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-add-line mr-1"></AppIcon> Add Rule
              </button>
            </div>

            <div className="space-y-2">
              {AUTO_ASSIGN_RULES.map(rule => (
                <div key={rule.id} className={`bg-background-50 rounded-xl border p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 transition-smooth ${rule.active ? 'border-foreground-200/60' : 'border-background-100 opacity-60'}`}>
                  <div className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center shrink-0">
                    <AppIcon className="ri-user-received-line text-accent-600 text-sm"></AppIcon>
                  </div>

                  <div className="flex-1 min-w-0">
                    {editingRule === rule.id ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <select defaultValue={rule.category} className="text-[11px] border border-background-200 rounded-md px-2 py-1 bg-background-50 cursor-pointer">
                            {CATEGORIES.map(c => <option key={c.id}>{c.name}</option>)}
                          </select>
                          <span className="text-[11px] text-foreground-400">→</span>
                          <select defaultValue={rule.agent} className="text-[11px] border border-background-200 rounded-md px-2 py-1 bg-background-50 cursor-pointer">
                            {AGENTS.map(a => <option key={a}>{a}</option>)}
                          </select>
                          <input type="text" defaultValue={rule.condition} className="text-[11px] border border-background-200 rounded-md px-2 py-1 bg-background-50 w-48" />
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => setEditingRule(null)} className="px-3 py-1.5 bg-emerald-500 text-white rounded-md text-[10px] font-semibold cursor-pointer whitespace-nowrap">Save</button>
                          <button onClick={() => setEditingRule(null)} className="px-3 py-1.5 bg-background-100 text-foreground-600 rounded-md text-[10px] cursor-pointer whitespace-nowrap">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-[13px] font-semibold text-foreground-800">
                          <span className="text-secondary-600">{rule.category}</span>
                          <span className="text-foreground-400 mx-1.5">→</span>
                          <span className="text-primary-600">{rule.agent}</span>
                        </p>
                        <p className="text-[10px] text-foreground-400 mt-0.5">When: {rule.condition}</p>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`w-2 h-2 rounded-full ${rule.active ? 'bg-emerald-500' : 'bg-foreground-300'}`}></span>
                    {editingRule !== rule.id && (
                      <>
                        <button onClick={() => setEditingRule(rule.id)} className="text-[10px] text-primary-600 cursor-pointer whitespace-nowrap">Edit</button>
                        <button className="text-[10px] text-foreground-300 cursor-pointer whitespace-nowrap">
                          {rule.active ? 'Disable' : 'Enable'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
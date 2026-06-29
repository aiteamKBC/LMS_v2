import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

// ---- Mock programme templates ----
const programmeTemplates = [
  { id: 'p1', name: 'Business Administrator L3', code: 'ST0070', level: 3, duration: '18 months', type: 'Apprenticeship Standard' },
  { id: 'p2', name: 'Digital Marketer L3', code: 'ST0122', level: 3, duration: '15 months', type: 'Apprenticeship Standard' },
  { id: 'p3', name: 'Data Analyst L4', code: 'ST0119', level: 4, duration: '24 months', type: 'Apprenticeship Standard' },
  { id: 'p4', name: 'Team Leader L3', code: 'ST0384', level: 3, duration: '15 months', type: 'Apprenticeship Standard' },
  { id: 'p5', name: 'Operations Manager L5', code: 'ST0385', level: 5, duration: '30 months', type: 'Apprenticeship Standard' },
  { id: 'p6', name: 'Software Developer L4', code: 'ST0116', level: 4, duration: '24 months', type: 'Apprenticeship Standard' },
  { id: 'p7', name: 'Accountancy Professional L7', code: 'ST0001', level: 7, duration: '36 months', type: 'Apprenticeship Standard' },
  { id: 'p8', name: 'Early Years Educator L3', code: 'ST0135', level: 3, duration: '18 months', type: 'Apprenticeship Standard' },
];

const planOptions = [
  { id: 'enterprise', name: 'Enterprise', price: 'Custom', features: ['All features', 'Unlimited users', 'Priority support', 'Custom integrations', 'Dedicated CSM'], icon: 'ri-building-4-line', color: 'primary' },
  { id: 'professional', name: 'Professional', price: '£1,200/mo', features: ['Core features', 'Up to 100 users', 'Email support', 'Standard integrations'], icon: 'ri-building-line', color: 'secondary' },
  { id: 'standard', name: 'Standard', price: '£600/mo', features: ['Essential features', 'Up to 30 users', 'Community support'], icon: 'ri-building-2-line', color: 'accent' },
  { id: 'trial', name: 'Trial (30 days)', price: 'Free', features: ['All features', 'Up to 10 users', 'No commitment'], icon: 'ri-timer-line', color: 'accent' },
];

interface OrgStructure {
  id: string;
  name: string;
  type: 'department' | 'employer' | 'partner';
  description: string;
}

export default function TenantOnboardingWizard() {
  const [step, setStep] = useState(1);
  const totalSteps = 5;

  // Step 1: Tenant Details
  const [tenantName, setTenantName] = useState('');
  const [tenantCode, setTenantCode] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactName, setContactName] = useState('');

  // Step 2: Organisation Structure
  const [orgs, setOrgs] = useState<OrgStructure[]>([
    { id: 'o1', name: 'Main Department', type: 'department', description: 'Default department for training delivery' },
  ]);

  // Step 3: Programmes
  const [selectedProgrammes, setSelectedProgrammes] = useState<string[]>([]);

  // Step 4: Default Configuration
  const [aiEnabled, setAiEnabled] = useState(true);
  const [manualModeAvailable, setManualModeAvailable] = useState(true);
  const [requireHumanApproval, setRequireHumanApproval] = useState(true);
  const [auditTrailEnabled, setAuditTrailEnabled] = useState(true);
  const [dataRetentionMonths, setDataRetentionMonths] = useState(36);
  const [rewardsEnabled, setRewardsEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [ofstedReadyMode, setOfstedReadyMode] = useState(true);

  // Step 5: Review
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const addOrg = () => {
    const newId = `o${orgs.length + 1}`;
    setOrgs([...orgs, { id: newId, name: '', type: 'department', description: '' }]);
  };

  const updateOrg = (id: string, field: keyof OrgStructure, value: string) => {
    setOrgs(orgs.map(o => o.id === id ? { ...o, [field]: value } : o));
  };

  const removeOrg = (id: string) => {
    if (orgs.length <= 1) return;
    setOrgs(orgs.filter(o => o.id !== id));
  };

  const toggleProgramme = (id: string) => {
    setSelectedProgrammes(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const handleSubmit = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setIsComplete(true);
    }, 2000);
  };

  const canProceed = () => {
    switch (step) {
      case 1: return tenantName.trim() && tenantCode.trim() && selectedPlan && contactEmail.trim();
      case 2: return orgs.every(o => o.name.trim());
      case 3: return selectedProgrammes.length > 0;
      case 4: return true;
      default: return false;
    }
  };

  if (isComplete) {
    return (
      <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Tenant Onboarding" pageSubtitle="Provision new tenants with full configuration" userName="Platform Admin" userRole="Super Administrator">
        <div className="p-3 md:p-6 flex items-center justify-center min-h-[60vh]">
          <div className="text-center max-w-md">
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5 animate-in zoom-in duration-500">
              <i className="ri-check-line text-emerald-600 text-3xl"></i>
            </div>
            <h2 className="text-xl font-heading font-bold text-foreground-900 mb-2">Tenant Provisioned Successfully</h2>
            <p className="text-sm text-foreground-500 mb-6">
              <strong>{tenantName}</strong> ({tenantCode}) has been created on the <strong>{planOptions.find(p => p.id === selectedPlan)?.name}</strong> plan with {orgs.length} organisation{orgs.length > 1 ? 's' : ''} and {selectedProgrammes.length} programme{selectedProgrammes.length > 1 ? 's' : ''}.
            </p>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 space-y-2 text-left mb-6">
              <CompletionRow label="Tenant Code" value={tenantCode} />
              <CompletionRow label="Plan" value={planOptions.find(p => p.id === selectedPlan)?.name || selectedPlan} />
              <CompletionRow label="Organisations" value={String(orgs.length)} />
              <CompletionRow label="Programmes" value={String(selectedProgrammes.length)} />
              <CompletionRow label="AI Mode" value={aiEnabled ? 'Enabled' : 'Disabled'} />
              <CompletionRow label="Data Retention" value={`${dataRetentionMonths} months`} />
              <CompletionRow label="Ofsted Mode" value={ofstedReadyMode ? 'Ready' : 'Standard'} />
            </div>
            <div className="flex items-center gap-3 justify-center">
              <a href="/admin/tenants" className="px-5 py-2.5 bg-primary-500 text-white rounded-xl text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <i className="ri-building-4-line mr-1.5"></i> View Tenants
              </a>
              <button onClick={() => { setIsComplete(false); setStep(1); setTenantName(''); setTenantCode(''); setSelectedPlan(''); setContactEmail(''); setContactName(''); setOrgs([{ id: 'o1', name: 'Main Department', type: 'department', description: 'Default department for training delivery' }]); setSelectedProgrammes([]); }} className="px-5 py-2.5 bg-background-50 border border-background-200 rounded-xl text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                <i className="ri-add-line mr-1.5"></i> Onboard Another
              </button>
            </div>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      role="admin"
      roleLabel={adminNav.label}
      navItems={adminNav.items}
      workspaceLabel={adminNav.workspaceLabel}
      pageTitle="Tenant Onboarding Wizard"
      pageSubtitle={`Step ${step} of ${totalSteps} — ${step === 1 ? 'Tenant Details' : step === 2 ? 'Organisation Structure' : step === 3 ? 'Programme Assignment' : step === 4 ? 'Default Configuration' : 'Review & Provision'}`}
      userName="Platform Admin"
      userRole="Super Administrator"
    >
      <div className="p-3 md:p-6">
        {/* Progress Bar */}
        <div className="mb-6 md:mb-8">
          <div className="flex items-center justify-between mb-3">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-heading font-bold transition-all duration-300 ${i + 1 < step ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20' : i + 1 === step ? 'bg-primary-500 text-white shadow-sm shadow-primary-500/20 ring-4 ring-primary-100' : 'bg-background-100 text-foreground-300'}`}>
                    {i + 1 < step ? <i className="ri-check-line"></i> : i + 1}
                  </div>
                  <span className={`text-[10px] font-semibold mt-1.5 text-center ${i + 1 <= step ? 'text-foreground-700' : 'text-foreground-300'}`}>
                    {['Details', 'Structure', 'Programmes', 'Config', 'Review'][i]}
                  </span>
                </div>
                {i < totalSteps - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 mt-[-16px] rounded-full transition-all duration-500 ${i + 1 < step ? 'bg-emerald-400' : i + 1 === step ? 'bg-primary-200' : 'bg-background-200'}`}></div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="max-w-3xl mx-auto">
          {/* ================================================================ */}
          {/* Step 1: Tenant Details */}
          {/* ================================================================ */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 md:p-6 space-y-4">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-bold">1</span>
                  Tenant Information
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-600 mb-1.5">Tenant Name <span className="text-red-500">*</span></label>
                    <input type="text" value={tenantName} onChange={e => setTenantName(e.target.value)} placeholder="e.g. Kent Business College" className="w-full px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-600 mb-1.5">Tenant Code <span className="text-red-500">*</span></label>
                    <input type="text" value={tenantCode} onChange={e => setTenantCode(e.target.value.toUpperCase())} placeholder="e.g. KBC" maxLength={8} className="w-full px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth uppercase" />
                    <p className="text-[10px] text-foreground-300 mt-1">Short unique identifier, max 8 chars</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-600 mb-1.5">Admin Contact Name <span className="text-red-500">*</span></label>
                    <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Full name" className="w-full px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-600 mb-1.5">Admin Email <span className="text-red-500">*</span></label>
                    <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="admin@organisation.ac.uk" className="w-full px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
                  </div>
                </div>
              </div>

              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 md:p-6 space-y-4">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-bold">2</span>
                  Select Plan
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {planOptions.map(plan => (
                    <button
                      key={plan.id}
                      onClick={() => setSelectedPlan(plan.id)}
                      className={`text-left p-4 rounded-xl border-2 transition-smooth cursor-pointer ${selectedPlan === plan.id ? `border-${plan.color === 'primary' ? 'primary' : plan.color === 'secondary' ? 'secondary' : 'accent'}-400 bg-${plan.color === 'primary' ? 'primary' : plan.color === 'secondary' ? 'secondary' : 'accent'}-50/30` : 'border-background-200 hover:border-background-300/60 bg-background-50'}`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`w-8 h-8 rounded-lg bg-${plan.color === 'primary' ? 'primary' : plan.color === 'secondary' ? 'secondary' : 'accent'}-100 flex items-center justify-center`}>
                          <i className={`${plan.icon} text-${plan.color === 'primary' ? 'primary' : plan.color === 'secondary' ? 'secondary' : 'accent'}-600 text-sm`}></i>
                        </span>
                        <div>
                          <p className="text-[13px] font-semibold text-foreground-900">{plan.name}</p>
                          <p className="text-[11px] text-foreground-500">{plan.price}</p>
                        </div>
                      </div>
                      <ul className="space-y-1">
                        {plan.features.map(f => (
                          <li key={f} className="text-[10px] text-foreground-500 flex items-center gap-1.5">
                            <i className="ri-check-line text-emerald-500 text-[9px]"></i> {f}
                          </li>
                        ))}
                      </ul>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* Step 2: Organisation Structure */}
          {/* ================================================================ */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 md:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-bold">2</span>
                    Organisation Structure
                  </h3>
                  <button onClick={addOrg} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-add-line mr-1"></i> Add Organisation
                  </button>
                </div>
                <p className="text-[12px] text-foreground-400">Define the organisational hierarchy for this tenant. Add departments, employer groups, and partner organisations.</p>

                <div className="space-y-3">
                  {orgs.map((org, idx) => (
                    <div key={org.id} className="bg-background-50/80 rounded-xl border border-foreground-200/60 p-4">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-foreground-300 w-5">{idx + 1}.</span>
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 flex-1">
                          <div className="sm:col-span-4">
                            <input
                              type="text"
                              value={org.name}
                              onChange={e => updateOrg(org.id, 'name', e.target.value)}
                              placeholder="Organisation name"
                              className="w-full px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-[12px] text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth"
                            />
                          </div>
                          <div className="sm:col-span-3">
                            <select
                              value={org.type}
                              onChange={e => updateOrg(org.id, 'type', e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-[12px] text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer"
                            >
                              <option value="department">Department</option>
                              <option value="employer">Employer Group</option>
                              <option value="partner">Partner Org</option>
                            </select>
                          </div>
                          <div className="sm:col-span-4">
                            <input
                              type="text"
                              value={org.description}
                              onChange={e => updateOrg(org.id, 'description', e.target.value)}
                              placeholder="Brief description"
                              className="w-full px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-[12px] text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth"
                            />
                          </div>
                        </div>
                        {orgs.length > 1 && (
                          <button onClick={() => removeOrg(org.id)} className="text-foreground-300 hover:text-red-500 transition-smooth cursor-pointer shrink-0">
                            <i className="ri-delete-bin-line"></i>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* Step 3: Programme Assignment */}
          {/* ================================================================ */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 md:p-6 space-y-4">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-bold">3</span>
                  Programme Assignment
                </h3>
                <p className="text-[12px] text-foreground-400">Select the apprenticeship programmes available to this tenant. Programmes can be managed later.</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {programmeTemplates.map(prog => (
                    <button
                      key={prog.id}
                      onClick={() => toggleProgramme(prog.id)}
                      className={`text-left p-3.5 rounded-xl border transition-smooth cursor-pointer flex items-start gap-3 ${selectedProgrammes.includes(prog.id) ? 'border-primary-300 bg-primary-50/30 ring-1 ring-primary-200/50' : 'border-background-200 hover:border-background-300/60 bg-background-50'}`}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-smooth ${selectedProgrammes.includes(prog.id) ? 'bg-primary-500 border-primary-500' : 'border-background-300'}`}>
                        {selectedProgrammes.includes(prog.id) && <i className="ri-check-line text-white text-[10px]"></i>}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-foreground-900">{prog.name}</p>
                        <p className="text-[10px] text-foreground-400 mt-0.5">{prog.code} · Level {prog.level} · {prog.duration}</p>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-foreground-400 pt-1">
                  {selectedProgrammes.length} programme{selectedProgrammes.length !== 1 ? 's' : ''} selected
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* Step 4: Default Configuration */}
          {/* ================================================================ */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 md:p-6 space-y-5">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-bold">4</span>
                  Default Platform Configuration
                </h3>
                <p className="text-[12px] text-foreground-400">Set the default configuration for this tenant. These can be adjusted later by the tenant admin.</p>

                <div className="space-y-3">
                  <ToggleRow label="AI-Assisted Features" desc="Enable AI features (marking suggestions, evidence checking, KSB mapping, etc.)" checked={aiEnabled} onChange={setAiEnabled} />
                  <ToggleRow label="Manual Mode Available" desc="Allow tenant admin to switch to full manual mode (disabling all AI)" checked={manualModeAvailable} onChange={setManualModeAvailable} />
                  <ToggleRow label="Require Human Approval for AI" desc="AI suggestions must be approved by a human before application" checked={requireHumanApproval} onChange={setRequireHumanApproval} />
                  <ToggleRow label="Audit Trail" desc="Log all AI actions and manual overrides for compliance" checked={auditTrailEnabled} onChange={setAuditTrailEnabled} />
                  <ToggleRow label="Rewards & Recognition" desc="Enable learner rewards, points, and recognition features" checked={rewardsEnabled} onChange={setRewardsEnabled} />
                  <ToggleRow label="Notifications" desc="Enable email, SMS, and WhatsApp notifications" checked={notificationsEnabled} onChange={setNotificationsEnabled} />
                  <ToggleRow label="Ofsted-Ready Mode" desc="Organise evidence under Ofsted EIF categories by default" checked={ofstedReadyMode} onChange={setOfstedReadyMode} />
                </div>

                <div className="border-t border-foreground-200/60 pt-4">
                  <label className="block text-[11px] font-semibold text-foreground-600 mb-1.5">Data Retention Period</label>
                  <div className="flex items-center gap-3">
                    <input type="range" min="6" max="84" step="6" value={dataRetentionMonths} onChange={e => setDataRetentionMonths(Number(e.target.value))} className="flex-1" />
                    <span className="text-sm font-semibold text-foreground-900 w-20 text-right">{dataRetentionMonths} months</span>
                  </div>
                  <p className="text-[10px] text-foreground-300 mt-1">How long learner evidence and records are retained after programme completion.</p>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* Step 5: Review & Provision */}
          {/* ================================================================ */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 md:p-6 space-y-5">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs font-bold">
                    <i className="ri-check-line"></i>
                  </span>
                  Review & Provision Tenant
                </h3>
                <p className="text-[12px] text-foreground-400">Verify all details below before provisioning the new tenant.</p>

                <div className="space-y-4">
                  <ReviewSection title="Tenant Information">
                    <ReviewRow label="Tenant Name" value={tenantName} />
                    <ReviewRow label="Tenant Code" value={tenantCode} />
                    <ReviewRow label="Plan" value={planOptions.find(p => p.id === selectedPlan)?.name || selectedPlan} />
                    <ReviewRow label="Admin Contact" value={`${contactName || '(not set)'} · ${contactEmail || '(not set)'}`} />
                  </ReviewSection>

                  <ReviewSection title="Organisation Structure">
                    {orgs.map((org, i) => (
                      <ReviewRow key={org.id} label={`Org ${i + 1}`} value={`${org.name || '(unnamed)'} — ${org.type} — ${org.description || '(no description)'}`} />
                    ))}
                  </ReviewSection>

                  <ReviewSection title="Programmes">
                    {selectedProgrammes.map(id => {
                      const prog = programmeTemplates.find(p => p.id === id);
                      return <ReviewRow key={id} label={prog?.code || id} value={prog ? `${prog.name} · Level ${prog.level} · ${prog.duration}` : id} />;
                    })}
                    {selectedProgrammes.length === 0 && <ReviewRow label="None selected" value="—" />}
                  </ReviewSection>

                  <ReviewSection title="Configuration">
                    <ReviewRow label="AI Features" value={aiEnabled ? 'Enabled' : 'Disabled'} />
                    <ReviewRow label="Manual Mode" value={manualModeAvailable ? 'Available' : 'Not Available'} />
                    <ReviewRow label="Human Approval" value={requireHumanApproval ? 'Required' : 'Not Required'} />
                    <ReviewRow label="Audit Trail" value={auditTrailEnabled ? 'Enabled' : 'Disabled'} />
                    <ReviewRow label="Rewards" value={rewardsEnabled ? 'Enabled' : 'Disabled'} />
                    <ReviewRow label="Notifications" value={notificationsEnabled ? 'Enabled' : 'Disabled'} />
                    <ReviewRow label="Ofsted Mode" value={ofstedReadyMode ? 'Ready' : 'Standard'} />
                    <ReviewRow label="Data Retention" value={`${dataRetentionMonths} months`} />
                  </ReviewSection>
                </div>

                <div className="border-t border-background-100 pt-4">
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="w-full px-5 py-3 bg-emerald-500 text-white rounded-xl text-[14px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <i className="ri-loader-4-line animate-spin"></i> Provisioning Tenant...
                      </>
                    ) : (
                      <>
                        <i className="ri-rocket-line mr-1"></i> Provision Tenant — {tenantName || 'New Tenant'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* Navigation Buttons */}
          {/* ================================================================ */}
          <div className="flex items-center justify-between mt-6">
            <button
              onClick={() => setStep(step - 1)}
              disabled={step === 1}
              className="px-4 py-2.5 bg-background-50 border border-background-200 rounded-xl text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <i className="ri-arrow-left-line mr-1.5"></i> Previous
            </button>

            <span className="text-[11px] text-foreground-300">Step {step} of {totalSteps}</span>

            {step < totalSteps ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!canProceed()}
                className="px-5 py-2.5 bg-primary-500 text-white rounded-xl text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <i className="ri-arrow-right-line ml-1.5"></i>
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="px-5 py-2.5 bg-emerald-500 text-white rounded-xl text-[13px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmitting ? (
                  <><i className="ri-loader-4-line animate-spin"></i> Provisioning...</>
                ) : (
                  <><i className="ri-rocket-line mr-1"></i> Provision Tenant</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}

/* ======================================================================== */
/* Sub-components                                                           */
/* ======================================================================== */

function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-background-100 last:border-0">
      <div className="flex-1 mr-4">
        <p className="text-[12px] font-medium text-foreground-900">{label}</p>
        <p className="text-[10px] text-foreground-400">{desc}</p>
      </div>
      <button onClick={() => onChange(!checked)} className={`relative w-11 h-6 rounded-full transition-smooth shrink-0 cursor-pointer ${checked ? 'bg-emerald-500' : 'bg-background-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-smooth ${checked ? 'left-[22px]' : 'left-0.5'}`}></span>
      </button>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-bold text-foreground-400 uppercase tracking-wider mb-2">{title}</h4>
      <div className="bg-background-100/80 rounded-lg divide-y divide-background-200/50">
        {children}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-[12px]">
      <span className="text-foreground-500">{label}</span>
      <span className="text-foreground-800 font-medium text-right ml-3">{value}</span>
    </div>
  );
}

function CompletionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-foreground-500">{label}</span>
      <span className="text-foreground-800 font-medium">{value}</span>
    </div>
  );
}
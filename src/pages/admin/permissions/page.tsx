import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const PERMISSION_CATEGORIES = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'learning', label: 'Learning' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'otjh', label: 'OTJH' },
  { id: 'ksb', label: 'KSB' },
  { id: 'coaching', label: 'Coaching' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'qa', label: 'QA' },
  { id: 'reports', label: 'Reports' },
  { id: 'users', label: 'Users' },
  { id: 'programmes', label: 'Programmes' },
  { id: 'curriculum', label: 'Curriculum' },
  { id: 'settings', label: 'Settings' },
  { id: 'finance', label: 'Finance' },
  { id: 'employer', label: 'Employer' },
  { id: 'ai', label: 'AI' },
  { id: 'admin', label: 'Admin' },
  { id: 'notifications', label: 'Notifications' },
];

const ROLES = ['Learner', 'Coach', 'Tutor', 'Employer', 'Admin', 'Compliance', 'QA', 'MIS', 'Engagement', 'Curriculum', 'Leadership', 'Finance', 'Auditor'];

const PERMISSION_MATRIX: Record<string, Record<string, boolean>> = {
  'View Dashboard': { Learner: true, Coach: true, Tutor: true, Employer: true, Admin: true, Compliance: true, QA: true, MIS: true, Engagement: true, Curriculum: true, Leadership: true, Finance: true, Auditor: true },
  'Create Evidence': { Learner: true, Coach: false, Tutor: false, Employer: false, Admin: false, Compliance: false, QA: false, MIS: false, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'Validate Evidence': { Learner: false, Coach: true, Tutor: true, Employer: false, Admin: true, Compliance: false, QA: true, MIS: false, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'Claim OTJH': { Learner: true, Coach: false, Tutor: false, Employer: false, Admin: false, Compliance: false, QA: false, MIS: false, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'Validate OTJH': { Learner: false, Coach: true, Tutor: false, Employer: false, Admin: true, Compliance: true, QA: true, MIS: false, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'Assess KSB': { Learner: false, Coach: true, Tutor: true, Employer: false, Admin: true, Compliance: false, QA: true, MIS: false, Engagement: false, Curriculum: true, Leadership: false, Finance: false, Auditor: false },
  'Manage Coaching': { Learner: false, Coach: true, Tutor: false, Employer: false, Admin: true, Compliance: false, QA: false, MIS: false, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'Sign Reviews': { Learner: false, Coach: true, Tutor: false, Employer: true, Admin: true, Compliance: false, QA: false, MIS: false, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'Manage Attendance': { Learner: false, Coach: false, Tutor: true, Employer: false, Admin: true, Compliance: false, QA: false, MIS: true, Engagement: true, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'QA Review': { Learner: false, Coach: false, Tutor: false, Employer: false, Admin: true, Compliance: false, QA: true, MIS: false, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'View Audit Trail': { Learner: false, Coach: false, Tutor: false, Employer: false, Admin: true, Compliance: true, QA: true, MIS: false, Engagement: false, Curriculum: false, Leadership: true, Finance: false, Auditor: true },
  'Create Reports': { Learner: false, Coach: false, Tutor: true, Employer: false, Admin: true, Compliance: true, QA: true, MIS: true, Engagement: true, Curriculum: false, Leadership: true, Finance: true, Auditor: true },
  'Manage Users': { Learner: false, Coach: false, Tutor: false, Employer: false, Admin: true, Compliance: false, QA: false, MIS: true, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'Manage Roles': { Learner: false, Coach: false, Tutor: false, Employer: false, Admin: true, Compliance: false, QA: false, MIS: false, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'Manage Settings': { Learner: false, Coach: false, Tutor: false, Employer: false, Admin: true, Compliance: false, QA: false, MIS: false, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'Manage Programmes': { Learner: false, Coach: false, Tutor: true, Employer: false, Admin: true, Compliance: false, QA: false, MIS: true, Engagement: false, Curriculum: true, Leadership: true, Finance: false, Auditor: false },
  'Manage Finance': { Learner: false, Coach: false, Tutor: false, Employer: false, Admin: true, Compliance: false, QA: false, MIS: false, Engagement: false, Curriculum: false, Leadership: true, Finance: true, Auditor: true },
  'Use AI Features': { Learner: true, Coach: true, Tutor: true, Employer: false, Admin: true, Compliance: false, QA: false, MIS: false, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'Manage AI Settings': { Learner: false, Coach: false, Tutor: false, Employer: false, Admin: true, Compliance: false, QA: false, MIS: false, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
  'Full Admin Access': { Learner: false, Coach: false, Tutor: false, Employer: false, Admin: true, Compliance: false, QA: false, MIS: false, Engagement: false, Curriculum: false, Leadership: false, Finance: false, Auditor: false },
};

export default function AdminPermissionsPage() {
  const [activeCategory, setActiveCategory] = useState('dashboard');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);

  const totalPerms = Object.keys(PERMISSION_MATRIX).length;
  const totalGrants = Object.values(PERMISSION_MATRIX).reduce((acc, row) => acc + Object.values(row).filter(Boolean).length, 0);

  const filteredPerms = Object.entries(PERMISSION_MATRIX).filter(([perm]) => perm.toLowerCase().includes(search.toLowerCase()));

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Permissions" pageSubtitle="Granular permission matrix across all roles and features" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-key-2-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Permission Matrix</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{totalPerms} permissions</strong> mapped across {ROLES.length} roles. {totalGrants} total grants configured.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalPerms}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Permissions</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{ROLES.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Roles</p>
              </div>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
            <input type="text" placeholder="Search permissions..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(!editing)} className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap ${editing ? 'bg-accent-500 text-white hover:bg-accent-600' : 'bg-primary-500 text-white hover:bg-primary-600'}`}>
              <i className={`${editing ? 'ri-save-line' : 'ri-pencil-line'} mr-1.5`}></i> {editing ? 'Save Changes' : 'Edit Matrix'}
            </button>
            <button className="px-4 py-2.5 bg-background-100 border border-background-200 rounded-xl text-sm font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-download-line mr-1.5"></i> Export
            </button>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {PERMISSION_CATEGORIES.map(cat => (
            <button key={cat.id} onClick={() => setActiveCategory(cat.id)} className={`px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-smooth cursor-pointer ${activeCategory === cat.id ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:bg-background-200'}`}>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Permission Matrix Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-foreground-400/50 bg-background-100/50">
                  <th className="text-left py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider w-[220px] sticky left-0 bg-background-100/50 z-10">Permission</th>
                  {ROLES.map(role => (
                    <th key={role} className="text-center py-3 px-2 text-[10px] font-semibold text-foreground-500 uppercase tracking-wider min-w-[60px]">{role}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredPerms.map(([perm, grants]) => (
                  <tr key={perm} className="border-b border-background-100 hover:bg-background-50 transition-smooth">
                    <td className="py-2.5 px-4 text-[12px] font-medium text-foreground-700 sticky left-0 bg-background-50 z-10">{perm}</td>
                    {ROLES.map(role => (
                      <td key={role} className="text-center py-2.5 px-2">
                        <button
                          disabled={!editing}
                          onClick={() => {}}
                          className={`inline-flex items-center justify-center w-6 h-6 rounded transition-smooth cursor-pointer ${grants[role] ? 'bg-emerald-100 text-emerald-600' : 'bg-background-100 text-foreground-300'} ${editing ? 'hover:ring-2 hover:ring-primary-300/50' : ''}`}
                        >
                          <i className={`${grants[role] ? 'ri-check-line' : 'ri-subtract-line'} text-[10px]`}></i>
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
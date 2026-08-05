import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const ROLES_DATA = [
  { id: 'r1', name: 'Apprentice Learner', description: 'Standard learner role with access to learning content, evidence submission, and coaching', users: 7, permissions: 12, color: 'primary' as const, system: true },
  { id: 'r2', name: 'Progress Coach', description: 'Coaching role with access to learner caseload, progress reviews, and evidence validation', users: 2, permissions: 24, color: 'accent' as const, system: true },
  { id: 'r3', name: 'Curriculum Tutor', description: 'Teaching role with access to sessions, assignments, marking, and KSB validation', users: 3, permissions: 28, color: 'secondary' as const, system: true },
  { id: 'r4', name: 'Employer / Line Manager', description: 'Employer role with access to apprentice progress, workplace confirmation, and reviews', users: 5, permissions: 14, color: 'accent' as const, system: true },
  { id: 'r5', name: 'Engagement Manager', description: 'Engagement role with access to attendance monitoring, absence management, and communications', users: 1, permissions: 18, color: 'primary' as const, system: true },
  { id: 'r6', name: 'Compliance Officer', description: 'Compliance role with access to eligibility, onboarding, and audit functions', users: 1, permissions: 22, color: 'secondary' as const, system: true },
  { id: 'r7', name: 'QA Officer', description: 'QA role with access to evidence QA, sampling, and quality review workflows', users: 1, permissions: 20, color: 'accent' as const, system: true },
  { id: 'r8', name: 'MIS User', description: 'MIS role with access to cohort allocation, timetables, and data management', users: 1, permissions: 16, color: 'primary' as const, system: true },
  { id: 'r9', name: 'Curriculum Developer', description: 'Curriculum role with access to programme builder, module builder, and KSB mapping', users: 1, permissions: 18, color: 'secondary' as const, system: true },
  { id: 'r10', name: 'Senior Leader', description: 'Leadership role with access to dashboards, trends, and strategic reports', users: 1, permissions: 16, color: 'accent' as const, system: true },
  { id: 'r11', name: 'Finance User', description: 'Finance role with access to funding, invoicing, and budget reports', users: 0, permissions: 10, color: 'primary' as const, system: true },
  { id: 'r12', name: 'Auditor', description: 'Audit role with read-only access to evidence, compliance, and audit trails', users: 0, permissions: 12, color: 'secondary' as const, system: true },
  { id: 'r13', name: 'Programme Manager', description: 'Programme management role with access to cohorts, performance, and curriculum oversight', users: 0, permissions: 20, color: 'accent' as const, system: true },
  { id: 'r14', name: 'Tenant Admin', description: 'Full tenant administration with access to all settings and configuration', users: 1, permissions: 48, color: 'primary' as const, system: true },
  { id: 'r15', name: 'Super Admin', description: 'Platform-level administration with cross-tenant access', users: 0, permissions: 64, color: 'secondary' as const, system: true },
];

export default function AdminRolesPage() {
  const [search, setSearch] = useState('');
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  const totalRoles = ROLES_DATA.length;
  const activeRoles = ROLES_DATA.filter(r => r.users > 0).length;
  const totalUsers = ROLES_DATA.reduce((a, b) => a + b.users, 0);
  const totalPermissions = ROLES_DATA.reduce((a, b) => a + b.permissions, 0);

  const filtered = ROLES_DATA.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

  const role = selectedRole ? ROLES_DATA.find(r => r.id === selectedRole) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Roles" pageSubtitle="Define and manage user roles with granular permissions" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-shield-check-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Role Management</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{totalRoles} roles</strong> defined — {activeRoles} in use. {totalUsers} total users across all roles.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalRoles}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Roles</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{activeRoles}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">In Use</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalPermissions}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Permissions</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Roles List */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
                <input type="text" placeholder="Search roles..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
              </div>
              <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-add-line mr-1.5"></AppIcon> New Role
              </button>
            </div>

            <div className="space-y-2">
              {filtered.map(r => {
                const colorBg = r.color === 'primary' ? 'bg-primary-100 text-primary-600' : r.color === 'accent' ? 'bg-accent-100 text-accent-600' : 'bg-secondary-100 text-secondary-600';
                return (
                  <div key={r.id} onClick={() => setSelectedRole(r.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedRole === r.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                    <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${colorBg}`}>
                      <AppIcon className="ri-shield-user-line text-sm"></AppIcon>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground-900">{r.name}</p>
                        {r.system && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-400 border border-foreground-200/60">System</span>}
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5 line-clamp-1">{r.description}</p>
                    </div>
                    <div className="flex items-center gap-4 text-[12px] text-foreground-500 shrink-0">
                      <span><AppIcon className="ri-user-line mr-1"></AppIcon>{r.users}</span>
                      <span><AppIcon className="ri-key-2-line mr-1"></AppIcon>{r.permissions}</span>
                    </div>
                    <AppIcon className={`ri-arrow-right-s-line text-foreground-300 ${selectedRole === r.id ? 'text-primary-500' : ''}`}></AppIcon>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Role Detail Panel */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {role ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{role.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">{role.description}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{role.users}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Users</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{role.permissions}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Permissions</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-[12px] font-semibold text-foreground-700 mb-2">Permission Categories</h4>
                  <div className="space-y-1.5">
                    {['Dashboard', 'Learning', 'Evidence', 'OTJH', 'KSB', 'Coaching', 'Reviews', 'Attendance', 'Compliance', 'QA', 'Reports', 'Users', 'Settings'].map(cat => (
                      <div key={cat} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-background-100 transition-smooth">
                        <span className="text-[12px] text-foreground-600">{cat}</span>
                        <span className={`w-4 h-4 rounded flex items-center justify-center ${Math.random() > 0.3 ? 'bg-emerald-100 text-emerald-600' : 'bg-background-100 text-foreground-300'}`}>
                          <AppIcon className={`${Math.random() > 0.3 ? 'ri-check-line' : 'ri-subtract-line'} text-[10px]`}></AppIcon>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 pt-2 border-t border-foreground-200/60">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit Role</button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">Clone</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <AppIcon className="ri-shield-user-line text-foreground-300 text-xl"></AppIcon>
                </div>
                <p className="text-sm text-foreground-500">Select a role to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
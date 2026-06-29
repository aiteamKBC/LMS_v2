import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { kbcUsers } from '@/mocks/users';
import { allRoles } from '@/mocks/users';

const adminNav = roleNavMap.admin;

const USER_DATA = [
  { id: 'u1', name: 'Sophie Williams', email: 'sophie.williams@kbc.ac.uk', roles: ['Apprentice Learner'], status: 'active', lastActive: 'Today, 10:23', programme: 'Business Admin L3', cohort: 'Cohort C' },
  { id: 'u2', name: 'James Okonkwo', email: 'james.okonkwo@kbc.ac.uk', roles: ['Apprentice Learner'], status: 'active', lastActive: 'Today, 09:15', programme: 'Digital Marketing L3', cohort: 'Cohort B' },
  { id: 'u3', name: 'Emily Watson', email: 'emily.watson@kbc.ac.uk', roles: ['Apprentice Learner'], status: 'active', lastActive: 'Yesterday', programme: 'Business Admin L3', cohort: 'Cohort A' },
  { id: 'u4', name: 'Med Maher', email: 'med.maher@kbc.ac.uk', roles: ['Progress Coach'], status: 'active', lastActive: 'Today, 11:45', programme: '-', cohort: '-' },
  { id: 'u5', name: 'Crispin Jones', email: 'crispin.jones@kbc.ac.uk', roles: ['Curriculum Tutor'], status: 'active', lastActive: 'Today, 08:30', programme: '-', cohort: '-' },
  { id: 'u6', name: 'Lauren Mitchell', email: 'lauren.mitchell@timhortons.co.uk', roles: ['Employer / Line Manager'], status: 'active', lastActive: 'Yesterday', programme: '-', cohort: '-' },
  { id: 'u7', name: 'Sarah Mitchell', email: 'sarah.mitchell@kbc.ac.uk', roles: ['QA Officer'], status: 'active', lastActive: 'Today, 07:50', programme: '-', cohort: '-' },
  { id: 'u8', name: 'David Chen', email: 'david.chen@kbc.ac.uk', roles: ['Apprentice Learner'], status: 'active', lastActive: '2 days ago', programme: 'Software Dev L4', cohort: 'Cohort D' },
  { id: 'u9', name: 'Liam Foster', email: 'liam.foster@kbc.ac.uk', roles: ['Apprentice Learner'], status: 'inactive', lastActive: '14 days ago', programme: 'Data Analyst L4', cohort: 'Cohort B' },
  { id: 'u10', name: 'Maya Kapoor', email: 'maya.kapoor@kbc.ac.uk', roles: ['Apprentice Learner'], status: 'active', lastActive: 'Today, 12:00', programme: 'Project Manager L4', cohort: 'Cohort E' },
  { id: 'u11', name: 'Rebecca Okonkwo', email: 'rebecca.okonkwo@unilever.co.uk', roles: ['Employer / Line Manager'], status: 'active', lastActive: '3 days ago', programme: '-', cohort: '-' },
  { id: 'u12', name: 'Admin User', email: 'admin@kbc.ac.uk', roles: ['Tenant Admin'], status: 'active', lastActive: 'Today, 13:10', programme: '-', cohort: '-' },
];

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());

  const activeCount = USER_DATA.filter(u => u.status === 'active').length;
  const inactiveCount = USER_DATA.filter(u => u.status === 'inactive').length;
  const learnerCount = USER_DATA.filter(u => u.roles.includes('Apprentice Learner')).length;
  const staffCount = USER_DATA.filter(u => !u.roles.includes('Apprentice Learner')).length;

  const filtered = USER_DATA.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || u.roles.some(r => r.toLowerCase().includes(roleFilter.toLowerCase()));
    const matchStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchSearch && matchRole && matchStatus;
  });

  const toggleSelect = (id: string) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Users" pageSubtitle="Manage all users across your tenant — learners, staff, and employers" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-user-settings-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">User Directory</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{USER_DATA.length} total users</strong> — {activeCount} active, {inactiveCount} inactive. {learnerCount} learners, {staffCount} staff & employers.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{USER_DATA.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Total</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{activeCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Active</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{learnerCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Learners</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters + Actions */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
            <input type="text" placeholder="Search users by name or email..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Roles</option>
              <option value="learner">Learners</option>
              <option value="coach">Coaches</option>
              <option value="tutor">Tutors</option>
              <option value="employer">Employers</option>
              <option value="admin">Admins</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-user-add-line mr-1.5"></i> Invite User
            </button>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground-400/50 bg-background-100/50">
                  <th className="text-left py-3 px-4 w-10">
                    <input type="checkbox" className="rounded border-background-300" onChange={e => {
                      if (e.target.checked) setSelectedUsers(new Set(filtered.map(u => u.id)));
                      else setSelectedUsers(new Set());
                    }} checked={filtered.length > 0 && selectedUsers.size === filtered.length} />
                  </th>
                  <th className="text-left py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">User</th>
                  <th className="text-left py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Roles</th>
                  <th className="text-left py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Programme</th>
                  <th className="text-left py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Cohort</th>
                  <th className="text-left py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Last Active</th>
                  <th className="text-right py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(user => (
                  <tr key={user.id} className="border-b border-background-100 hover:bg-background-50 transition-smooth">
                    <td className="py-3 px-4">
                      <input type="checkbox" className="rounded border-background-300" checked={selectedUsers.has(user.id)} onChange={() => toggleSelect(user.id)} />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center shrink-0 ring-1 ring-primary-200/50">
                          <span className="text-primary-700 text-xs font-semibold">{user.name.charAt(0)}</span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground-900">{user.name}</p>
                          <p className="text-[11px] text-foreground-400">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map(role => (
                          <span key={role} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700 border border-secondary-200/50">{role}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-foreground-700">{user.programme !== '-' ? user.programme : <span className="text-foreground-300">—</span>}</td>
                    <td className="py-3 px-4 text-[13px] text-foreground-700">{user.cohort !== '-' ? user.cohort : <span className="text-foreground-300">—</span>}</td>
                    <td className="py-3 px-4">
                      <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${user.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' : 'bg-background-100 text-foreground-500 border-foreground-200/60'}`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-foreground-500">{user.lastActive}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button className="w-8 h-8 rounded-lg hover:bg-background-100 flex items-center justify-center text-foreground-400 hover:text-foreground-700 transition-smooth cursor-pointer" title="Edit">
                          <i className="ri-pencil-line text-sm"></i>
                        </button>
                        <button className="w-8 h-8 rounded-lg hover:bg-background-100 flex items-center justify-center text-foreground-400 hover:text-foreground-700 transition-smooth cursor-pointer" title="View Profile">
                          <i className="ri-eye-line text-sm"></i>
                        </button>
                        <button className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-foreground-400 hover:text-red-500 transition-smooth cursor-pointer" title="Deactivate">
                          <i className="ri-forbid-line text-sm"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                <i className="ri-search-line text-foreground-300 text-xl"></i>
              </div>
              <p className="text-sm text-foreground-500">No users match your filters</p>
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-3 border-t border-foreground-200/60">
            <p className="text-[12px] text-foreground-400">{filtered.length} of {USER_DATA.length} users</p>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 rounded-lg border border-background-200 text-[12px] text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer">Previous</button>
              <button className="px-3 py-1.5 rounded-lg border border-background-200 text-[12px] text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer">Next</button>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
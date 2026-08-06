import { useState, useMemo } from 'react';
import { ALL_ROLES, ALL_PERMISSIONS, PERMISSION_LEVELS, ACCESS_SCOPES } from '@/mocks/rbac';
import type { RoleDef, PermissionDef, PermissionLevel, AccessScope } from '@/mocks/rbac';

// Group permissions by category
function groupByCategory(permissions: PermissionDef[]): Map<string, PermissionDef[]> {
  const map = new Map<string, PermissionDef[]>();
  for (const p of permissions) {
    const existing = map.get(p.category) || [];
    existing.push(p);
    map.set(p.category, existing);
  }
  return map;
}

export default function RbacManagementPage() {
  const [selectedRole, setSelectedRole] = useState<RoleDef>(ALL_ROLES[0]);
  const [viewMode, setViewMode] = useState<'role-detail' | 'full-matrix' | 'permission-list'>('role-detail');
  const [searchQuery, setSearchQuery] = useState('');

  const categoryGroups = useMemo(() => groupByCategory(ALL_PERMISSIONS), []);
  const categories = useMemo(() => Array.from(categoryGroups.keys()), [categoryGroups]);

  const filteredRoles = useMemo(() => {
    if (!searchQuery) return ALL_ROLES;
    const q = searchQuery.toLowerCase();
    return ALL_ROLES.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.slug.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-foreground-200 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-heading font-semibold text-foreground-950">Role-Based Access Control</h2>
            <p className="text-xs text-foreground-500 mt-0.5">
              {ALL_ROLES.length} roles · {ALL_PERMISSIONS.length} permissions · {PERMISSION_LEVELS.length} levels · {ACCESS_SCOPES.length} scopes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-background-100 rounded-lg p-0.5">
              {(['role-detail', 'full-matrix', 'permission-list'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth whitespace-nowrap ${
                    viewMode === mode
                      ? 'bg-background-50 text-foreground-900 shadow-sm'
                      : 'text-foreground-500 hover:text-foreground-700'
                  }`}
                >
                  {mode === 'role-detail' ? 'Role Detail' : mode === 'full-matrix' ? 'Full Matrix' : 'Permissions'}
                </button>
              ))}
            </div>
            <div className="relative">
              <AppIcon className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-300 text-xs"></AppIcon>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search roles..."
                className="w-48 pl-7 pr-3 py-1.5 rounded-lg border border-background-200 bg-background-50 text-xs text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Role sidebar */}
        <aside className="w-[260px] shrink-0 border-r border-foreground-200 overflow-y-auto py-2 px-2 bg-background-50">
          {filteredRoles.map(role => (
            <button
              key={role.id}
              onClick={() => { setSelectedRole(role); setViewMode('role-detail'); }}
              className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-smooth mb-0.5 ${
                selectedRole.id === role.id
                  ? 'bg-primary-50 border border-primary-200/50'
                  : 'hover:bg-background-100 border border-transparent'
              }`}
            >
              <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                role.category === 'learner' ? 'bg-emerald-100 text-emerald-600'
                  : role.category === 'delivery' ? 'bg-primary-100 text-primary-600'
                  : role.category === 'employer' ? 'bg-accent-100 text-accent-600'
                  : role.category === 'compliance' ? 'bg-amber-100 text-amber-600'
                  : role.category === 'management' ? 'bg-secondary-100 text-secondary-600'
                  : 'bg-red-100 text-red-600'
              }`}>
                <AppIcon className={`${
                  role.slug === 'super-admin' ? 'ri-shield-star-line'
                    : role.slug === 'tenant-admin' ? 'ri-shield-user-line'
                    : role.slug === 'auditor' ? 'ri-search-eye-line'
                    : 'ri-user-line'
                } text-xs`}></AppIcon>
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm truncate ${selectedRole.id === role.id ? 'text-primary-700 font-semibold' : 'text-foreground-800 font-medium'}`}>
                  {role.name}
                </p>
                <p className="text-[10px] text-foreground-400 mt-0.5 line-clamp-2">{role.description}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[9px] text-foreground-400 uppercase tracking-wider">{role.category}</span>
                  <span className="text-[9px] text-foreground-300">·</span>
                  <span className="text-[9px] text-foreground-400">{role.permissions.length} perms</span>
                </div>
              </div>
            </button>
          ))}
        </aside>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto p-6">
          {viewMode === 'role-detail' && <RoleDetailView role={selectedRole} />}
          {viewMode === 'full-matrix' && <FullMatrixView />}
          {viewMode === 'permission-list' && <PermissionListView />}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Role Detail View
// ============================================================

function RoleDetailView({ role }: { role: RoleDef }) {
  const permByCategory = useMemo(() => {
    const map = new Map<string, { perm: PermissionDef; assignment: { level: PermissionLevel; scope: AccessScope } }[]>();
    for (const assignment of role.permissions) {
      const permDef = ALL_PERMISSIONS.find(p => p.slug === assignment.permissionSlug);
      if (!permDef) continue;
      const cat = map.get(permDef.category) || [];
      cat.push({ perm: permDef, assignment: { level: assignment.level, scope: assignment.scope } });
      map.set(permDef.category, cat);
    }
    // Sort categories alphabetically
    return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }, [role]);

  const levelColor = (level: PermissionLevel) => {
    switch (level) {
      case 'none': return 'text-foreground-300 bg-background-100';
      case 'view': return 'text-blue-600 bg-blue-50';
      case 'create': return 'text-emerald-600 bg-emerald-50';
      case 'edit': return 'text-amber-600 bg-amber-50';
      case 'approve': return 'text-primary-600 bg-primary-50';
      case 'validate': return 'text-violet-600 bg-violet-50';
      case 'reject': return 'text-red-600 bg-red-50';
      case 'export': return 'text-cyan-600 bg-cyan-50';
      case 'delete': return 'text-orange-600 bg-orange-50';
      case 'archive': return 'text-slate-600 bg-slate-50';
      case 'manage_settings': return 'text-rose-600 bg-rose-50';
      case 'full_admin': return 'text-red-600 bg-red-50';
      default: return 'text-foreground-400 bg-background-100';
    }
  };

  const scopeColor = (scope: AccessScope) => {
    if (scope === 'global') return 'text-red-600 bg-red-50';
    if (scope === 'tenant') return 'text-primary-600 bg-primary-50';
    if (scope === 'organisation') return 'text-secondary-600 bg-secondary-50';
    return 'text-foreground-500 bg-background-100';
  };

  return (
    <div className="max-w-3xl">
      {/* Role header */}
      <div className="flex items-start gap-4 mb-6">
        <span className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
          role.category === 'learner' ? 'bg-emerald-100 text-emerald-600'
            : role.category === 'delivery' ? 'bg-primary-100 text-primary-600'
            : role.category === 'employer' ? 'bg-accent-100 text-accent-600'
            : role.category === 'compliance' ? 'bg-amber-100 text-amber-600'
            : role.category === 'management' ? 'bg-secondary-100 text-secondary-600'
            : 'bg-red-100 text-red-600'
        }`}>
          <AppIcon className="ri-shield-user-line text-lg"></AppIcon>
        </span>
        <div>
          <h3 className="text-xl font-heading font-semibold text-foreground-950">{role.name}</h3>
          <p className="text-sm text-foreground-500 mt-0.5">{role.description}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{role.category}</span>
            <span className="text-[10px] text-foreground-300">|</span>
            <span className="text-[10px] text-foreground-500">{role.permissions.length} permissions assigned</span>
            <span className="text-[10px] text-foreground-300">|</span>
            <span className={`text-[10px] font-medium ${role.isSystem ? 'text-amber-600' : 'text-emerald-600'}`}>
              {role.isSystem ? 'System Role' : 'Custom Role'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <MiniRbacStat label="Total Permissions" value={String(role.permissions.length)} color="primary" />
        <MiniRbacStat label="Full Admin" value={String(role.permissions.filter(p => p.level === 'full_admin').length)} color="red" />
        <MiniRbacStat label="Validate/Approve" value={String(role.permissions.filter(p => p.level === 'validate' || p.level === 'approve').length)} color="amber" />
        <MiniRbacStat label="Read-Only" value={String(role.permissions.filter(p => p.level === 'view').length)} color="slate" />
      </div>

      {/* Permissions by category */}
      <div className="space-y-4">
        {Array.from(permByCategory.entries()).map(([category, perms]) => (
          <div key={category} className="bg-background-50 rounded-xl border border-foreground-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-background-100 border-b border-foreground-400/50">
              <h4 className="text-xs font-semibold text-foreground-600 uppercase tracking-wider">{category}</h4>
            </div>
            <div className="divide-y divide-background-100">
              {perms.map(({ perm, assignment }) => (
                <div key={perm.slug} className="flex items-center justify-between px-4 py-2.5 hover:bg-background-50 transition-smooth">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground-800">{perm.name}</p>
                    <p className="text-[10px] text-foreground-400 mt-0.5 truncate">{perm.description}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${levelColor(assignment.level)}`}>
                      {assignment.level.replace('_', ' ')}
                    </span>
                    <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${scopeColor(assignment.scope)}`}>
                      {assignment.scope.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Full Matrix View
// ============================================================

function FullMatrixView() {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const categories = useMemo(() => ['All', ...Array.from(groupByCategory(ALL_PERMISSIONS).keys()).sort()], []);

  const displayRoles = ALL_ROLES.filter(r => r.slug !== 'super-admin');
  const displayPerms = useMemo(() => {
    if (selectedCategory === 'All') return ALL_PERMISSIONS;
    return ALL_PERMISSIONS.filter(p => p.category === selectedCategory);
  }, [selectedCategory]);

  return (
    <div>
      {/* Category filter */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-smooth whitespace-nowrap ${
              selectedCategory === cat
                ? 'bg-primary-100 text-primary-700'
                : 'bg-background-100 text-foreground-500 hover:bg-background-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Matrix table */}
      <div className="overflow-x-auto bg-background-50 rounded-xl border border-foreground-200">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-background-200 bg-background-100">
              <th className="text-left py-2.5 px-3 text-foreground-500 font-semibold uppercase tracking-wider sticky left-0 bg-background-100 min-w-[140px]">
                Permission
              </th>
              {displayRoles.map(role => (
                <th key={role.id} className="text-center py-2.5 px-2 text-foreground-500 font-semibold uppercase tracking-wider min-w-[80px]">
                  <span className="block truncate max-w-[70px] mx-auto text-[9px]">{role.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayPerms.map(perm => (
              <tr key={perm.id} className="border-b border-background-100 hover:bg-background-50 transition-smooth">
                <td className="py-2 px-3 sticky left-0 bg-background-50">
                  <p className="font-medium text-foreground-800 text-[10px]">{perm.name}</p>
                  <p className="text-foreground-400 text-[8px]">{perm.slug}</p>
                </td>
                {displayRoles.map(role => {
                  const assignment = role.permissions.find(p => p.permissionSlug === perm.slug);
                  if (!assignment) {
                    return (
                      <td key={role.id} className="text-center py-2 px-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-background-200"></span>
                      </td>
                    );
                  }

                  const levelColors: Record<string, string> = {
                    view: 'bg-blue-100 text-blue-700',
                    create: 'bg-emerald-100 text-emerald-700',
                    edit: 'bg-amber-100 text-amber-700',
                    approve: 'bg-primary-100 text-primary-700',
                    validate: 'bg-violet-100 text-violet-700',
                    reject: 'bg-red-100 text-red-700',
                    export: 'bg-cyan-100 text-cyan-700',
                    delete: 'bg-orange-100 text-orange-700',
                    archive: 'bg-slate-100 text-slate-700',
                    manage_settings: 'bg-rose-100 text-rose-700',
                    full_admin: 'bg-red-100 text-red-700',
                  };

                  return (
                    <td key={role.id} className="text-center py-2 px-2">
                      <span className={`inline-flex text-[8px] font-semibold px-1.5 py-0.5 rounded-full ${levelColors[assignment.level] || 'bg-background-100 text-foreground-500'}`}>
                        {assignment.level === 'manage_settings' ? 'Mng' : assignment.level === 'full_admin' ? 'Admin' : assignment.level === 'assigned_learners_only' ? 'Alo' : assignment.level.slice(0, 3)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 flex-wrap">
        <span className="text-[10px] text-foreground-400 font-medium">Legend:</span>
        {[
          { label: 'View', cls: 'bg-blue-100 text-blue-700' },
          { label: 'Create', cls: 'bg-emerald-100 text-emerald-700' },
          { label: 'Edit', cls: 'bg-amber-100 text-amber-700' },
          { label: 'Approve', cls: 'bg-primary-100 text-primary-700' },
          { label: 'Validate', cls: 'bg-violet-100 text-violet-700' },
          { label: 'Reject', cls: 'bg-red-100 text-red-700' },
          { label: 'Admin', cls: 'bg-red-100 text-red-700' },
          { label: 'None', cls: 'bg-background-100 text-foreground-400' },
        ].map(item => (
          <span key={item.label} className={`inline-flex items-center gap-1 text-[9px]`}>
            <span className={`w-2 h-2 rounded-full ${item.cls.split(' ')[0]}`}></span>
            <span className={item.cls.split(' ')[1]}>{item.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Permission List View
// ============================================================

function PermissionListView() {
  const categoryGroups = useMemo(() => groupByCategory(ALL_PERMISSIONS), []);
  const categories = useMemo(() => Array.from(categoryGroups.entries()).sort((a, b) => a[0].localeCompare(b[0])), [categoryGroups]);

  return (
    <div className="max-w-4xl space-y-4">
      {categories.map(([category, perms]) => (
        <div key={category} className="bg-background-50 rounded-xl border border-foreground-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-background-100 border-b border-foreground-400/50 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-foreground-600 uppercase tracking-wider">{category}</h4>
            <span className="text-[10px] text-foreground-400">{perms.length} permissions</span>
          </div>
          <div className="divide-y divide-background-100">
            {perms.map(perm => (
              <div key={perm.id} className="px-4 py-3 hover:bg-background-50 transition-smooth">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground-800">{perm.name}</p>
                      <code className="text-[10px] text-foreground-300 bg-background-100 px-1.5 py-0.5 rounded">{perm.slug}</code>
                    </div>
                    <p className="text-[10px] text-foreground-400 mt-1">{perm.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">
                      Default: {perm.defaultLevel.replace('_', ' ')}
                    </span>
                    {perm.isAdminBypass && (
                      <span className="text-[9px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        Admin Bypass
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {perm.allowedScopes.map(scope => (
                    <span key={scope} className="text-[8px] text-foreground-400 bg-background-100 px-1.5 py-0.5 rounded">
                      {scope.replace('_', ' ')}
                    </span>
                  ))}
                </div>
                {/* Show which roles have this permission */}
                <div className="mt-2 flex items-center gap-1 flex-wrap">
                  <span className="text-[9px] text-foreground-400">Assigned to:</span>
                  {ALL_ROLES.filter(r => r.permissions.some(p => p.permissionSlug === perm.slug)).map(r => (
                    <span key={r.id} className="text-[8px] font-medium text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                      {r.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Mini stat component
// ============================================================

function MiniRbacStat({ label, value, color }: { label: string; value: string; color: string }) {
  const bgMap: Record<string, string> = {
    primary: 'bg-primary-100 text-primary-600',
    red: 'bg-red-100 text-red-600',
    amber: 'bg-amber-100 text-amber-600',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200 p-3">
      <p className="text-lg font-heading font-semibold text-foreground-950">{value}</p>
      <p className="text-[10px] text-foreground-400 mt-0.5">{label}</p>
    </div>
  );
}
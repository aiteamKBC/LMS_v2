import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface RoleOption {
  slug: string;
  label: string;
  icon: string;
  workspacePath: string;
}

const ALL_ROLES: RoleOption[] = [
  { slug: 'learner', label: 'Learner', icon: 'ri-user-line', workspacePath: '/workspace/learner' },
  { slug: 'coach', label: 'Coach', icon: 'ri-user-heart-line', workspacePath: '/workspace/coach' },
  { slug: 'tutor', label: 'Tutor', icon: 'ri-presentation-line', workspacePath: '/workspace/tutor' },
  { slug: 'employer', label: 'Employer', icon: 'ri-building-2-line', workspacePath: '/workspace/employer' },
  { slug: 'compliance', label: 'Enrolment', icon: 'ri-user-add-line', workspacePath: '/users' },
  { slug: 'qa', label: 'QA Officer', icon: 'ri-search-eye-line', workspacePath: '/workspace/qa' },
  { slug: 'mis', label: 'MIS User', icon: 'ri-database-2-line', workspacePath: '/workspace/mis' },
  { slug: 'curriculum', label: 'Curriculum', icon: 'ri-book-2-line', workspacePath: '/workspace/curriculum' },
  { slug: 'engagement', label: 'Engagement', icon: 'ri-megaphone-line', workspacePath: '/workspace/engagement' },
  { slug: 'leadership', label: 'Leadership', icon: 'ri-vip-crown-line', workspacePath: '/workspace/leadership' },
  { slug: 'admin', label: 'Admin', icon: 'ri-settings-3-line', workspacePath: '/workspace/admin' },
  { slug: 'finance', label: 'Finance', icon: 'ri-money-pound-circle-line', workspacePath: '/workspace/finance' },
  { slug: 'auditor', label: 'Auditor', icon: 'ri-history-line', workspacePath: '/workspace/auditor' },
  { slug: 'support', label: 'Support', icon: 'ri-customer-service-2-line', workspacePath: '/workspace/support' },
  { slug: 'safeguarding', label: 'Safeguarding', icon: 'ri-shield-line', workspacePath: '/workspace/safeguarding' },
];

export function RoleSwitcher() {
  const { auth, isAdmin, switchRole } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  // Only show for admin/testing roles — hidden from learner and employer
  if (!auth.isAuthenticated) return null;
  const currentRoleSlug = auth.roles[0]?.slug;
  if (currentRoleSlug === 'learner' || currentRoleSlug === 'employer') return null;

  const handleSwitch = (role: RoleOption) => {
    switchRole(role.slug);
    setIsOpen(false);
    setTimeout(() => {
      navigate(role.workspacePath, { replace: true });
    }, 50);
  };

  const currentRole = ALL_ROLES.find(r => r.slug === currentRoleSlug);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-300/40 bg-amber-50/60 text-[11px] text-amber-800 font-medium hover:bg-amber-100/70 transition-smooth cursor-pointer whitespace-nowrap"
        title="Demo Role Switcher"
      >
        <AppIcon className="ri-exchange-line text-xs"></AppIcon>
        <span>{currentRole?.label || 'Switch Role'}</span>
        <AppIcon className={`ri-arrow-down-s-line text-[10px] transition-transform ${isOpen ? 'rotate-180' : ''}`}></AppIcon>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
          <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-background-50 rounded-xl border border-background-200 shadow-lg shadow-foreground-950/5 py-1.5 max-h-[380px] overflow-y-auto">
            <div className="px-3 py-1.5">
              <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-widest">Demo Role Switcher</span>
            </div>
            {ALL_ROLES.map((role) => (
              <button
                key={role.slug}
                onClick={() => handleSwitch(role)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-smooth cursor-pointer ${
                  currentRoleSlug === role.slug
                    ? 'bg-primary-50 text-primary-800 border-l-2 border-primary-500 font-medium'
                    : 'text-foreground-600 hover:bg-background-100 border-l-2 border-transparent'
                }`}
              >
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  currentRoleSlug === role.slug ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-400'
                }`}>
                  <AppIcon className={`${role.icon} text-xs`}></AppIcon>
                </span>
                <span>{role.label}</span>
                {currentRoleSlug === role.slug && (
                  <AppIcon className="ri-check-line text-primary-600 ml-auto text-sm"></AppIcon>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
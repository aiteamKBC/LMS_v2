// ============================================================================
// Where an account holding more than one access grant picks what to open.
//
// A coach who also tutors, an enrolment officer who is also a curriculum
// designer, an administrator who is also studying a programme — all of them
// have one account and several places to be. Landing them on the primary grant
// silently made the others effectively invisible: nothing on the page said the
// account could be anywhere else.
//
// The set of workspaces and each landing route come from the server
// (`accessWorkspaces` in login/identity.py). This page never derives a
// destination itself — the learner entry in particular points at that person's
// own enrolment record by id, which the SPA cannot work out on its own.
//
// Deliberately outside any workspace shell, like /access-required: at this
// point no workspace has been chosen, so there is no sidebar to draw.
// ============================================================================
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { AppIcon } from '@/components/feature/AppIcon';
import { BrandLockup } from '@/components/BrandLockup';
import { ACCESS_OPTIONS } from '@/api/staffUsers';
import { homeRouteFor, workspacesFor } from '@/lib/routeAccess';
import type { AccessWorkspace } from '@/api/auth';

/** How to describe the one workspace that is not an ACCESS_OPTIONS grant.
 *
 * `learner` is synthesised by the server for a staff member or administrator
 * who is also studying, so it has no entry in the access table — that table
 * lists grants an administrator can award, and nobody awards this one. */
const LEARNER_CARD = {
  label: 'Learner workspace',
  description: 'Your own programme — your plan, evidence, reviews and progress.',
  icon: 'ri-graduation-cap-line',
};

function describe(workspace: AccessWorkspace) {
  if (workspace.access === 'learner') return LEARNER_CARD;
  const option = ACCESS_OPTIONS.find(o => o.id === workspace.access);
  return {
    label: option?.label || workspace.access,
    description: option?.description || 'Open this workspace.',
    icon: option?.icon || 'ri-apps-line',
  };
}

export default function ChooseWorkspacePage() {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();

  const account = auth.account;
  const workspaces = workspacesFor(account);
  const name = account?.displayName || account?.email || '';

  // Nothing to choose between. Reached by typing the URL, by coming back to it
  // after an access grant was withdrawn, or by a session that ended — send them
  // wherever they actually belong rather than rendering an empty page.
  useEffect(() => {
    if (!account) {
      navigate('/login', { replace: true });
      return;
    }
    if (workspaces.length <= 1) {
      navigate(homeRouteFor(account), { replace: true });
    }
  }, [account, workspaces.length, navigate]);

  if (!account || workspaces.length <= 1) return null;

  return (
    <div className="min-h-screen bg-background-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="flex justify-center mb-6">
          <BrandLockup />
        </div>

        <div className="bg-background-50 rounded-2xl border border-foreground-200/60 overflow-hidden shadow-sm">
          <div className="px-6 md:px-9 pt-9 pb-6 text-center">
            <span className="w-16 h-16 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-5">
              <AppIcon className="ri-apps-line text-3xl"></AppIcon>
            </span>
            <h1 className="text-xl md:text-2xl font-heading font-bold text-foreground-900 mb-3">
              Choose your workspace
            </h1>
            <p className="text-[14px] text-foreground-500 leading-relaxed max-w-md mx-auto">
              {name ? <><strong className="text-foreground-700">{name}</strong>, your</> : 'Your'} account
              has access to {workspaces.length} workspaces. Pick where you want to start —
              you can switch at any time without signing in again.
            </p>
          </div>

          <div className="px-6 md:px-9 pb-8 grid gap-3 sm:grid-cols-2">
            {workspaces.map((workspace) => {
              const card = describe(workspace);
              return (
                <button
                  key={workspace.access}
                  onClick={() => navigate(workspace.home, { replace: true })}
                  className="group text-left p-4 rounded-xl border border-foreground-200/60 bg-background-50 hover:border-primary-300 hover:bg-primary-50/40 transition-smooth cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200"
                >
                  <span className="w-10 h-10 rounded-lg bg-background-100 text-foreground-600 group-hover:bg-primary-100 group-hover:text-primary-600 flex items-center justify-center mb-3 transition-smooth">
                    <AppIcon className={`${card.icon} text-lg`}></AppIcon>
                  </span>
                  <p className="text-[13px] font-semibold text-foreground-900 flex items-center gap-1.5">
                    {card.label}
                    <AppIcon className="ri-arrow-right-line text-foreground-300 group-hover:text-primary-500 transition-smooth"></AppIcon>
                  </p>
                  <p className="text-[11.5px] text-foreground-500 mt-1 leading-relaxed">
                    {card.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="text-center mt-5">
          <button
            onClick={logout}
            className="text-[12px] text-foreground-400 hover:text-foreground-600 transition-smooth cursor-pointer"
          >
            <AppIcon className="ri-logout-box-line mr-1"></AppIcon>Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

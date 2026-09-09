// ============================================================================
// Access editor — opened from the Accounts page by clicking an account's name
// or its Access badge.
//
// An account may hold SEVERAL accesses, so somebody who both coaches a caseload
// and teaches a group reaches both workspaces from one sign-in. Two things are
// saved: the set they hold, and which one is PRIMARY — the workspace they land
// in at sign-in.
//
// 'super-admin' is the exception. It already means "everything", so ticking it
// clears and disables the rest rather than sitting alongside grants it makes
// redundant.
//
// The write goes to the *staff record* (`updateStaffUser`), not the login
// account: the grant lives on enrolment."Staff_users"."Access", and the login
// account derives its role from it on every request. So changing it here takes
// effect on that person's next request, not their next sign-in.
//
// The server refuses a grant from anyone who is not an administrator, and
// refuses an admin reducing their *own* access — this panel mirrors those rules
// so the reason is visible before the click, but it does not enforce them.
// ============================================================================
import { useState } from 'react';
import { ACCESS_OPTIONS, updateStaffUser, type StaffAccess } from '@/api/staffUsers';
import type { PlatformAccount } from '@/api/platformAdmin';

const SUPER_ADMIN: StaffAccess = 'super-admin';

export function AccessPanel({
  account,
  isSelf,
  onClose,
  onSaved,
}: {
  account: PlatformAccount;
  /** True when this is the signed-in administrator's own account. */
  isSelf: boolean;
  onClose: () => void;
  onSaved: (access: string) => void;
}) {
  // The grants held, and which of them is the landing page. Seeded from the
  // account's own set, falling back to its primary for a row saved before
  // multi-access existed.
  const initialGranted = (
    account.accesses?.length ? account.accesses : [account.access].filter(Boolean)
  ) as StaffAccess[];
  const initialPrimary = (account.access as StaffAccess) || initialGranted[0] || '';

  const [granted, setGranted] = useState<StaffAccess[]>(initialGranted);
  const [primary, setPrimary] = useState<StaffAccess | ''>(initialPrimary);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Access only exists for staff. A learner or employer account has no grant to
  // edit — their permissions come from being a learner or an employer.
  const isStaff = account.subjectType === 'staff';
  const isSuperAdmin = granted.includes(SUPER_ADMIN);
  // Compared as sets: the order the boxes were ticked in is not a change.
  const sameSet = granted.length === initialGranted.length
    && granted.every(value => initialGranted.includes(value));
  const dirty = !sameSet || primary !== initialPrimary;
  // Mirrors the server rule: an admin may confirm themselves as super-admin but
  // not reduce their own access, or they could lock themselves out.
  const selfDemotion = isSelf && !isSuperAdmin;

  /** Tick or untick one grant.
   *
   * super-admin is exclusive — selecting it clears the rest, and selecting any
   * other clears it — because it already permits everything the others do. */
  function toggle(id: StaffAccess) {
    setGranted(current => {
      let next: StaffAccess[];
      if (id === SUPER_ADMIN) {
        next = current.includes(SUPER_ADMIN) ? [] : [SUPER_ADMIN];
      } else {
        next = current.includes(id)
          ? current.filter(value => value !== id)
          : [...current.filter(value => value !== SUPER_ADMIN), id];
      }
      // The landing page has to be a grant they actually hold, or they arrive
      // at a workspace that refuses them.
      setPrimary(prev => (prev && next.includes(prev) ? prev : next[0] || ''));
      return next;
    });
  }

  async function save() {
    if (!granted.length || !primary || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await updateStaffUser(String(account.subjectId), {
        access: primary,
        accesses: granted,
      });
      onSaved(primary);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the access.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background-50 rounded-2xl border border-background-200 max-w-xl w-full shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-foreground-200/60 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
            <span className="text-primary-700 text-[13px] font-semibold">
              {(account.displayName || account.email).charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-heading font-semibold text-foreground-900 truncate">
              {account.displayName || account.email}
            </h3>
            <p className="text-[12px] text-foreground-400 truncate">{account.email}</p>
          </div>
          <button onClick={onClose} className="text-foreground-300 hover:text-foreground-600 cursor-pointer shrink-0">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>

        {!isStaff ? (
          <div className="p-6">
            <div className="bg-background-100/70 border border-foreground-200/60 rounded-xl p-4 flex items-start gap-2.5">
              <AppIcon className="ri-information-line text-foreground-400 text-sm mt-0.5 shrink-0"></AppIcon>
              <p className="text-[12px] text-foreground-500 leading-relaxed">
                This is a <strong className="capitalize">{account.subjectType}</strong> account. Access levels
                apply to staff only — a {account.subjectType}&apos;s permissions come from their own record,
                not from a grant.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="p-6 space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-1">
                  Access levels
                </p>
                <p className="text-[12px] text-foreground-500 leading-relaxed">
                  What this person can reach. Tick more than one for somebody who works across two
                  areas — a coach who also tutors, say.
                </p>
              </div>

              <div className="space-y-2">
                {ACCESS_OPTIONS.map(option => {
                  const active = granted.includes(option.id);
                  // Everything else is redundant once super-admin is held, so
                  // it is shown greyed rather than silently ignored on save.
                  const blocked = isSuperAdmin && option.id !== SUPER_ADMIN;
                  return (
                    <label
                      key={option.id}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border transition-smooth ${
                        blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                      } ${
                        active
                          ? 'border-primary-400 bg-primary-50/60 ring-1 ring-primary-200/50'
                          : 'border-foreground-200/60 hover:bg-background-100/60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        name="access-level"
                        checked={active}
                        disabled={blocked}
                        onChange={() => toggle(option.id)}
                        className="accent-primary-500 mt-0.5 shrink-0"
                      />
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        active ? 'bg-primary-100 text-primary-600' : 'bg-background-200 text-foreground-400'
                      }`}>
                        <AppIcon className={`${option.icon} text-sm`}></AppIcon>
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-semibold text-foreground-900">{option.label}</span>
                        <span className="block text-[11px] text-foreground-500 leading-relaxed mt-0.5">
                          {option.description}
                        </span>
                        <span className="block text-[10px] text-foreground-400 mt-1">
                          <AppIcon className="ri-login-box-line mr-1"></AppIcon>
                          Signs in to <span className="font-mono">{option.home}</span>
                        </span>
                        {/* Only meaningful once more than one is held — with a
                            single grant there is nothing to choose between. */}
                        {active && granted.length > 1 && (
                          <span
                            className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-semibold text-primary-700"
                            onClick={event => event.preventDefault()}
                          >
                            <input
                              type="radio"
                              name="primary-access"
                              checked={primary === option.id}
                              onChange={() => setPrimary(option.id)}
                              className="accent-primary-500"
                            />
                            {primary === option.id ? 'Lands here at sign-in' : 'Land here instead'}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>

              {granted.length > 1 && (
                <div className="bg-primary-50/60 border border-primary-200/60 rounded-xl p-3 flex items-start gap-2.5">
                  <AppIcon className="ri-information-line text-primary-600 text-sm mt-0.5 shrink-0"></AppIcon>
                  <p className="text-[11px] text-primary-800 leading-relaxed">
                    Holds {granted.length} accesses. They sign in to the one marked
                    <strong> lands here</strong> and can switch to the others from the workspace menu.
                  </p>
                </div>
              )}

              {!account.access && (
                <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-3 flex items-start gap-2.5">
                  <AppIcon className="ri-alert-line text-amber-600 text-sm mt-0.5 shrink-0"></AppIcon>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    No access has been granted yet. Until one is set this account cannot reach the
                    enrolment or curriculum areas.
                  </p>
                </div>
              )}

              {selfDemotion && (
                <div className="bg-red-50 border border-red-200/60 rounded-xl p-3 flex items-start gap-2.5">
                  <AppIcon className="ri-error-warning-line text-red-600 text-sm mt-0.5 shrink-0"></AppIcon>
                  <p className="text-[11px] text-red-800 leading-relaxed">
                    This is your own account. You cannot reduce your own access — another administrator
                    has to do it, so nobody can lock themselves out of this console.
                  </p>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200/60 rounded-xl p-3 flex items-start gap-2.5">
                  <AppIcon className="ri-error-warning-line text-red-600 text-sm mt-0.5 shrink-0"></AppIcon>
                  <p className="text-[11px] text-red-800 leading-relaxed">{error}</p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-foreground-200/60 flex items-center gap-3 bg-background-100/40">
              <button
                onClick={save}
                disabled={!granted.length || !primary || !dirty || saving || selfDemotion}
                className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <AppIcon className={`${saving ? 'ri-loader-4-line animate-spin' : 'ri-check-line'} mr-1.5`}></AppIcon>
                {saving ? 'Saving…' : 'Save access'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2.5 bg-background-100 border border-background-200 rounded-xl text-[13px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer"
              >
                Cancel
              </button>
              {dirty && !selfDemotion && (
                <p className="text-[11px] text-foreground-400 ml-auto">
                  Takes effect on their next request.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

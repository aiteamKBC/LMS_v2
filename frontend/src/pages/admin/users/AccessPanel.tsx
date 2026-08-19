// ============================================================================
// Access editor — opened by clicking an account's name on the Accounts page.
//
// One access per account, because 'super-admin' already means "everything" and
// that is the only case combining them would serve.
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
  const [selected, setSelected] = useState<StaffAccess | ''>(
    (account.access as StaffAccess) || '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Access only exists for staff. A learner or employer account has no grant to
  // edit — their permissions come from being a learner or an employer.
  const isStaff = account.subjectType === 'staff';
  const dirty = selected !== ((account.access as StaffAccess) || '');
  // Mirrors the server rule: an admin may confirm themselves as super-admin but
  // not reduce their own access, or they could lock themselves out.
  const selfDemotion = isSelf && selected !== 'super-admin';

  async function save() {
    if (!selected || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await updateStaffUser(String(account.subjectId), { access: selected });
      onSaved(selected);
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
                  Access level
                </p>
                <p className="text-[12px] text-foreground-500 leading-relaxed">
                  Decides where this person lands after signing in, and what they can reach. One per account.
                </p>
              </div>

              <div className="space-y-2">
                {ACCESS_OPTIONS.map(option => {
                  const active = selected === option.id;
                  return (
                    <label
                      key={option.id}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-smooth ${
                        active
                          ? 'border-primary-400 bg-primary-50/60 ring-1 ring-primary-200/50'
                          : 'border-foreground-200/60 hover:bg-background-100/60'
                      }`}
                    >
                      <input
                        type="radio"
                        name="access-level"
                        checked={active}
                        onChange={() => setSelected(option.id)}
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
                      </span>
                    </label>
                  );
                })}
              </div>

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
                disabled={!selected || !dirty || saving || selfDemotion}
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

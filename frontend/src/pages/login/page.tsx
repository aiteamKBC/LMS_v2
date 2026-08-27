import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { BrandLockup } from '@/components/BrandLockup';
import { AuthError, apiAuthHealth, apiMicrosoftStart, type Role } from '@/api/auth';

/**
 * Where an account lands, in preference order.
 *
 * A staff account's `accessHome` wins: the backend derives it from the access
 * grant (ACCESS_HOME_ROUTES), so an enrolment officer opens the enrolment
 * console and a coach their own workspace. Falls back to the coarse role for
 * accounts with no access recorded, and for learners and employers.
 */
function homeFor(account: {
  role: Role;
  accessHome?: string | null;
  subjectId?: number | null;
}): string {
  if (account.role === 'employer' && account.subjectId) {
    return `/employers/${account.subjectId}`;
  }
  return account.accessHome || HOME_BY_ROLE[account.role];
}

const HOME_BY_ROLE: Record<Role, string> = {
  admin: '/workspace/admin',
  staff: '/users',
  employer: '/workspace/employer',
  learner: '/workspace/learner',
};

export default function LoginPage() {
  const { login, auth, isInitialized } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  // Undefined until the health check answers, so the button is not flashed in
  // and then taken away on a deployment that has no provider configured.
  const [ssoAvailable, setSsoAvailable] = useState<boolean | undefined>(undefined);

  // Where the user was heading before RequireAuth sent them here.
  const from = (location.state as { from?: string } | null)?.from;

  // A refused Microsoft sign-in comes back with ?sso_error=... . Lift it into
  // the form's error box, then strip it so a refresh cannot resurrect it.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ssoError = params.get('sso_error');
    if (!ssoError) return;
    setError(ssoError);
    params.delete('sso_error');
    const rest = params.toString();
    navigate({ pathname: location.pathname, search: rest ? `?${rest}` : '' }, { replace: true });
  }, [location.search, location.pathname, navigate]);

  // Only show Microsoft sign-in when the backend confirms it is configured.
  useEffect(() => {
    let cancelled = false;
    apiAuthHealth()
      .then((health) => { if (!cancelled) setSsoAvailable(!!health.microsoftSso?.configured); })
      .catch(() => { if (!cancelled) setSsoAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  // Bounce an already-signed-in visitor to their console after the server
  // session has been resolved.
  useEffect(() => {
    if (!isInitialized || !auth.isAuthenticated) return;
    const home = auth.account ? homeFor(auth.account) : '/home';
    navigate(from || home, { replace: true });
  }, [isInitialized, auth.isAuthenticated, auth.account, from, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }

    setIsLoading(true);
    try {
      const account = await login(email.trim(), password, rememberMe);
      navigate(from || homeFor(account), { replace: true });
    } catch (err) {
      setError(
        err instanceof AuthError
          ? err.message
          : 'Something went wrong signing in. Please try again.',
      );
      setIsLoading(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    setError('');
    setSsoLoading(true);
    try {
      // This is a full navigation so Microsoft can return to the callback that
      // creates the server session cookie.
      window.location.href = await apiMicrosoftStart(from);
    } catch (err) {
      setError(
        err instanceof AuthError
          ? err.message
          : 'Could not start sign-in with Microsoft. Please try again.',
      );
      setSsoLoading(false);
    }
  };

  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[#fbfaff] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      {/* Keep the page canvas quiet: only a few oversized lavender curves sit
          at the viewport edges, as in the supplied reference. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute -left-[20rem] -top-[24rem] h-[44rem] w-[44rem] rounded-full bg-primary-100/65" />
        <span className="absolute -left-[12rem] -top-[16rem] h-[34rem] w-[34rem] rounded-full border-[5rem] border-primary-50/90" />
        <span className="absolute -bottom-[26rem] -right-[20rem] h-[48rem] w-[48rem] rounded-full bg-primary-100/60" />
        <span className="absolute -bottom-[17rem] -right-[6rem] h-[34rem] w-[34rem] rounded-full border-[5rem] border-primary-50/90" />
      </div>

      <main className="relative z-10 flex w-full max-w-[1350px] flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_28px_80px_rgba(76,50,145,0.16)] animate-login-fade-in lg:h-[min(918px,calc(100vh-72px))] lg:min-h-[700px] lg:w-[86.5%] lg:block">
        {/* Form side */}
        <section className="relative z-20 flex min-h-[680px] w-full flex-col bg-white px-6 py-10 sm:px-10 sm:py-12 lg:h-full lg:w-[54%] lg:bg-transparent lg:px-10 lg:py-10 xl:px-[clamp(48px,5vw,72px)] xl:py-[54px]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 hidden lg:block"
            style={{
              background: 'linear-gradient(90deg, #ffffff 0%, #ffffff 75%, rgba(255,255,255,0.95) 86%, rgba(255,255,255,0) 100%)',
            }}
          />

          <div className="relative z-10 mx-auto flex w-full max-w-[424px] flex-1 flex-col">
            <BrandLockup size="default" className="mb-8 animate-login-slide-up" />

            <div className="mb-8 animate-login-slide-up" style={{ animationDelay: '140ms' }}>
              <h1 className="font-heading text-[32px] font-semibold leading-[1.08] tracking-tight text-foreground-950 xl:text-[38px]">
                Welcome back
              </h1>
              <p className="mt-3 text-[15px] text-foreground-500 xl:text-[16px]">
                Sign in to your workspace
              </p>
            </div>

            <form onSubmit={handleLogin} className="flex flex-col gap-6 animate-login-slide-up" style={{ animationDelay: '240ms' }}>
              <div>
                <label htmlFor="email" className="mb-2.5 block text-[13px] font-semibold text-foreground-700">
                  Email address
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-400">
                    <AppIcon className="ri-mail-line text-[18px]"></AppIcon>
                  </span>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(''); }}
                    placeholder="your.email@kbc.test"
                    className="h-[58px] w-full rounded-[14px] border border-background-200 bg-background-100/55 pl-12 pr-4 text-[14px] text-foreground-900 shadow-sm outline-none transition-all duration-200 placeholder:text-foreground-300 hover:border-background-300 focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-200/50"
                    required
                  />
                </div>
              </div>

              <div>
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <label htmlFor="password" className="block text-[13px] font-semibold text-foreground-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => navigate('/forgot-password')}
                    className="cursor-pointer text-[13px] font-medium text-primary-600 transition-colors hover:text-primary-700"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-400">
                    <AppIcon className="ri-lock-line text-[18px]"></AppIcon>
                  </span>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    placeholder="Enter your password"
                    className="h-[58px] w-full rounded-[14px] border border-background-200 bg-background-100/55 pl-12 pr-4 text-[14px] text-foreground-900 shadow-sm outline-none transition-all duration-200 placeholder:text-foreground-300 hover:border-background-300 focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-200/50"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => setRememberMe(!rememberMe)}
                  aria-pressed={rememberMe}
                  className="group flex cursor-pointer items-center gap-2.5"
                >
                  <span className={`flex h-[19px] w-[19px] items-center justify-center rounded-[4px] border transition-all duration-200 ${rememberMe ? 'border-primary-500 bg-primary-500' : 'border-foreground-300 bg-white group-hover:border-primary-300'}`}>
                    {rememberMe && <AppIcon className="ri-check-line text-[11px] text-white" />}
                  </span>
                  <span className="text-[13px] font-medium text-foreground-600">Remember me</span>
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-700" role="alert">
                  <AppIcon className="ri-error-warning-line shrink-0 text-sm"></AppIcon>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!email || !password || isLoading}
                className="flex h-[58px] w-full cursor-pointer items-center justify-center rounded-[14px] bg-gradient-to-r from-primary-600 to-primary-500 px-5 text-[16px] font-semibold text-white shadow-[0_10px_22px_rgba(100,62,230,0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:from-primary-700 hover:to-primary-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
                    Signing in...
                  </span>
                ) : (
                  'Sign in to Workspace'
                )}
              </button>

              {/* This invitation guidance is still the application's existing
                  message; it is simply placed beneath the primary action. */}
              <p className="-mt-3 text-center text-[11px] leading-relaxed text-foreground-400">
                First time here? Use the link in your invitation email to set a password.
              </p>
            </form>

            {/* Kept outside the form so Enter in the password field cannot
                accidentally start the Microsoft flow. */}
            {ssoAvailable && (
              <div className="mt-8 animate-login-slide-up" style={{ animationDelay: '360ms' }}>
                <div className="mb-6 flex items-center gap-4">
                  <div className="h-px flex-1 bg-background-200" />
                  <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-foreground-400">OR</span>
                  <div className="h-px flex-1 bg-background-200" />
                </div>

                <button
                  type="button"
                  onClick={handleMicrosoftLogin}
                  disabled={ssoLoading || isLoading}
                  className="flex h-[58px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-[14px] border border-background-200 bg-white px-4 text-[16px] font-semibold text-foreground-800 shadow-sm transition-all duration-200 hover:border-primary-200 hover:bg-primary-50/45 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {ssoLoading ? (
                    <>
                      <AppIcon className="ri-loader-4-line animate-spin" />
                      Redirecting to Microsoft...
                    </>
                  ) : (
                    <>
                      <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 21 21" aria-hidden="true">
                        <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                        <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                        <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                        <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                      </svg>
                      Sign in with Microsoft
                    </>
                  )}
                </button>

                <p className="mt-3 text-center text-[11px] leading-relaxed text-foreground-400">
                  Use your work account. You must already have access to this platform.
                </p>
              </div>
            )}

            <div className="mt-auto pt-10 animate-login-slide-up" style={{ animationDelay: '480ms' }}>
              <div className="border-t border-background-200 pt-7">
                <p className="flex items-center justify-center gap-2 text-[13px] text-foreground-400">
                  <AppIcon className="ri-shield-check-line text-[17px] text-primary-500" />
                  Secure sign-in
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* The hero panel is layered behind the white form edge so the purple
            circles create a soft transition instead of a straight divider. */}
        <aside className="relative order-2 hidden min-h-[350px] overflow-hidden bg-primary-100 md:block lg:absolute lg:inset-y-0 lg:right-0 lg:h-full lg:w-[58%] lg:overflow-visible">
          <span
            aria-hidden="true"
            className="absolute inset-0"
            style={{ background: 'linear-gradient(145deg, #eeeaff 0%, #c8b7ff 34%, #8e6cf5 72%, #7452e8 100%)' }}
          />
          <span aria-hidden="true" className="absolute -left-[48%] -top-[16%] h-[132%] w-[116%] rounded-full bg-[#e8e1ff]" />
          <span aria-hidden="true" className="absolute -left-[31%] top-[8%] h-[112%] w-[104%] rounded-full bg-gradient-to-br from-[#d0c1ff] to-[#a88dff]" />
          <span aria-hidden="true" className="absolute -left-[10%] top-[20%] h-[91%] w-[88%] rounded-full bg-gradient-to-br from-[#aa91ff] to-[#7a58ed]" />
          <span aria-hidden="true" className="absolute left-[13%] top-[31%] h-[70%] w-[69%] rounded-full bg-gradient-to-br from-[#7c5af0] to-[#6039d9]" />
          <span aria-hidden="true" className="absolute left-[30%] top-[40%] h-[53%] w-[52%] rounded-full bg-primary-950/20" />

          <span aria-hidden="true" className="absolute right-[13%] top-[8%] h-24 w-24 rounded-full bg-white/15 blur-2xl" />
          <span aria-hidden="true" className="absolute bottom-[12%] right-[8%] h-16 w-16 rounded-full bg-accent-300/30 blur-xl" />

          <div className="absolute left-[9%] top-1/2 z-10 h-[60%] w-[78%] -translate-y-1/2 overflow-hidden rounded-[24px] shadow-[0_26px_46px_rgba(35,15,100,0.32)] xl:left-[8%] xl:w-[79%]">
            <img
              src="/hero-clean.png"
              alt="Professional working beside the London skyline"
              className="absolute inset-0 h-full w-full object-cover object-[65%_center]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-primary-950/35 via-primary-800/5 to-primary-950/25" />
            <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-primary-950/60 to-transparent" />
          </div>
        </aside>
      </main>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { BrandLockup } from '@/components/BrandLockup';
import { AuthError, type Role } from '@/api/auth';

/** Where each backend role lands after signing in. */
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

  // Where the user was heading before RequireAuth sent them here.
  const from = (location.state as { from?: string } | null)?.from;

  // Bounce an already-signed-in visitor to their console. Waits for
  // isInitialized so it does not fire before the session has been resolved.
  useEffect(() => {
    if (!isInitialized || !auth.isAuthenticated) return;
    const home = auth.account ? HOME_BY_ROLE[auth.account.role] : '/';
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
      // Navigate straight away rather than relying on the effect above, so a
      // slow re-render cannot leave the form looking unresponsive.
      navigate(from || HOME_BY_ROLE[account.role], { replace: true });
    } catch (err) {
      // The server owns the wording — it distinguishes a bad password from a
      // locked account and from being rate-limited.
      setError(
        err instanceof AuthError
          ? err.message
          : 'Something went wrong signing in. Please try again.',
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-foreground-950">
      {/* ── Left: Image Background Panel ── */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] relative overflow-hidden">
        <img
          src="https://storage.readdy-site.link/project_files/618bc44b-5728-4a0b-8f4f-ee80cff7baf6/a4d6c15d-8e73-478b-bdf9-c01002333189_ChatGPT-Image-Jun-11-2026-05_01_27-AM.png"
          alt="London skyline professional background"
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
      </div>

      {/* ── Right: Login Form ── */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-8 lg:p-12 bg-background-50">
        <div className="w-full max-w-[420px] animate-login-fade-in">
          {/* Logo */}
          <BrandLockup size="default" className="mb-10 animate-login-slide-up" />

          <div className="mb-8 animate-login-slide-up" style={{ animationDelay: '200ms' }}>
            <h2 className="text-[32px] font-heading font-semibold text-foreground-950 mb-2 tracking-tight leading-tight">Welcome back</h2>
            <p className="text-[14px] text-foreground-500">
              Sign in to your workspace
            </p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-5 animate-login-slide-up" style={{ animationDelay: '300ms' }}>
            <div>
              <label htmlFor="email" className="block text-[12px] font-semibold text-foreground-600 mb-2">
                Email address
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400">
                  <AppIcon className="ri-mail-line text-[15px]"></AppIcon>
                </span>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  placeholder="your.email@kbc.test"
                  className="w-full pl-10 pr-3.5 py-3 rounded-xl border border-background-200 bg-background-50 text-[14px] text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-200/50 transition-all duration-200 outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="password" className="block text-[12px] font-semibold text-foreground-600">
                  Password
                </label>
                <button type="button" onClick={() => navigate('/forgot-password')} className="text-[11px] text-primary-600 hover:text-primary-700 font-medium cursor-pointer">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400">
                  <AppIcon className="ri-lock-line text-[15px]"></AppIcon>
                </span>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-3.5 py-3 rounded-xl border border-background-200 bg-background-50 text-[14px] text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-200/50 transition-all duration-200 outline-none"
                  required
                />
              </div>
              <p className="text-[11px] text-foreground-300 mt-1.5">
                First time here? Use the link in your invitation email to set a password.
              </p>
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRememberMe(!rememberMe)}
                className="flex items-center gap-2 cursor-pointer group"
              >
                <div className={`w-4 h-4 rounded border transition-all duration-200 flex items-center justify-center ${rememberMe ? 'bg-primary-500 border-primary-500' : 'border-background-300 bg-background-50 group-hover:border-background-400'}`}>
                  {rememberMe && <AppIcon className="ri-check-line text-[10px] text-white" />}
                </div>
                <span className="text-[12px] text-foreground-500 font-medium">Remember me</span>
              </button>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 px-3.5 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
                <AppIcon className="ri-error-warning-line text-sm shrink-0"></AppIcon>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!email || !password || isLoading}
              className="w-full py-3.5 rounded-xl bg-primary-500 text-white text-[14px] font-semibold hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 whitespace-nowrap shadow-md shadow-primary-500/15 cursor-pointer"
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
          </form>

          {/* Footer.
              The Google/Microsoft buttons that used to sit here were removed:
              no SSO provider is wired up, and a sign-in button that does
              nothing is worse than no button. Add them back alongside the
              provider. */}
          <div className="mt-8 pt-6 border-t border-background-200 animate-login-slide-up" style={{ animationDelay: '600ms' }}>
            <div className="flex items-center justify-center gap-2 flex-wrap mb-3">
              <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full font-medium border border-emerald-200/50">
                <AppIcon className="ri-shield-check-line text-[10px]"></AppIcon>
                Secure sign-in
              </span>
            </div>
            <p className="text-[11px] text-center text-foreground-300">
              KBC LearningOS &middot; Kent Business College
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

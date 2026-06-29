import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const DEMO_PASSWORD = 'Password123';

interface DemoAccount {
  slug: string;
  email: string;
  workspacePath: string;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  { slug: 'learner', email: 'learner@kbc.test', workspacePath: '/workspace/learner' },
  { slug: 'coach', email: 'coach@kbc.test', workspacePath: '/workspace/coach' },
  { slug: 'tutor', email: 'tutor@kbc.test', workspacePath: '/workspace/tutor' },
  { slug: 'employer', email: 'employer@kbc.test', workspacePath: '/workspace/employer' },
  { slug: 'compliance', email: 'compliance@kbc.test', workspacePath: '/workspace/compliance' },
  { slug: 'qa', email: 'qa@kbc.test', workspacePath: '/workspace/qa' },
  { slug: 'mis', email: 'mis@kbc.test', workspacePath: '/workspace/mis' },
  { slug: 'admin', email: 'admin@kbc.test', workspacePath: '/workspace/admin' },
  { slug: 'leadership', email: 'leadership@kbc.test', workspacePath: '/workspace/leadership' },
  { slug: 'finance', email: 'finance@kbc.test', workspacePath: '/workspace/finance' },
  { slug: 'auditor', email: 'auditor@kbc.test', workspacePath: '/workspace/auditor' },
];

export default function LoginPage() {
  const { login, auth } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Redirect already authenticated users via useEffect (not during render)
  useEffect(() => {
    if (auth.isAuthenticated) {
      const roleSlug = auth.roles[0]?.slug || 'learner';
      const account = DEMO_ACCOUNTS.find(a => a.slug === roleSlug);
      if (account) {
        navigate(account.workspacePath, { replace: true });
      }
    }
  }, [auth.isAuthenticated, auth.roles, navigate]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!email.trim()) {
      setError('Please enter your email address');
      setIsLoading(false);
      return;
    }

    if (password !== DEMO_PASSWORD) {
      setError('Invalid password');
      setIsLoading(false);
      return;
    }

    const matchedAccount = DEMO_ACCOUNTS.find(a => a.email === email.trim());
    if (!matchedAccount) {
      setError('Account not found. Please use a valid demo email address.');
      setIsLoading(false);
      return;
    }

    // login persists to localStorage and sets auth state
    // the useEffect above will handle navigation automatically
    login(matchedAccount.email);
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
          <div className="flex items-center gap-3 mb-10 animate-login-slide-up" style={{ animationDelay: '100ms' }}>
            <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center">
              <span className="text-white font-bold text-lg font-heading">K</span>
            </div>
            <div>
              <p className="text-foreground-900 font-heading text-lg font-semibold leading-tight">KBC LearningOS</p>
              <p className="text-[11px] text-foreground-400 tracking-wide">Kent Business College</p>
            </div>
          </div>

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
                  <i className="ri-mail-line text-[15px]"></i>
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
                  <i className="ri-lock-line text-[15px]"></i>
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
              <p className="text-[11px] text-foreground-300 mt-1.5">Demo password: <span className="font-mono text-foreground-500 font-semibold">Password123</span></p>
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRememberMe(!rememberMe)}
                className="flex items-center gap-2 cursor-pointer group"
              >
                <div className={`w-4 h-4 rounded border transition-all duration-200 flex items-center justify-center ${rememberMe ? 'bg-primary-500 border-primary-500' : 'border-background-300 bg-background-50 group-hover:border-background-400'}`}>
                  {rememberMe && <i className="ri-check-line text-[10px] text-white" />}
                </div>
                <span className="text-[12px] text-foreground-500 font-medium">Remember me</span>
              </button>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 px-3.5 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
                <i className="ri-error-warning-line text-sm shrink-0"></i>
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
                  <i className="ri-loader-4-line animate-spin"></i>
                  Signing in...
                </span>
              ) : (
                'Sign in to Workspace'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-8 animate-login-slide-up" style={{ animationDelay: '400ms' }}>
            <div className="flex-1 h-px bg-background-200"></div>
            <span className="text-[11px] text-foreground-400 font-medium">or continue with</span>
            <div className="flex-1 h-px bg-background-200"></div>
          </div>

          {/* Social / Demo hint */}
          <div className="flex items-center justify-center gap-3 animate-login-slide-up" style={{ animationDelay: '500ms' }}>
            <button type="button" className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-background-200 text-[13px] text-foreground-600 hover:bg-background-100 hover:border-background-300 transition-all duration-200 cursor-pointer">
              <i className="ri-google-fill text-[16px] text-foreground-500"></i>
              <span className="hidden sm:inline">Google</span>
            </button>
            <button type="button" className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-background-200 text-[13px] text-foreground-600 hover:bg-background-100 hover:border-background-300 transition-all duration-200 cursor-pointer">
              <i className="ri-microsoft-fill text-[16px] text-foreground-500"></i>
              <span className="hidden sm:inline">Microsoft</span>
            </button>
          </div>

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-background-200 animate-login-slide-up" style={{ animationDelay: '600ms' }}>
            <div className="flex items-center justify-center gap-2 flex-wrap mb-3">
              <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full font-medium border border-emerald-200/50">
                <i className="ri-shield-check-line text-[10px]"></i>
                Full RBAC Enabled
              </span>
              <span className="text-[10px] text-foreground-300">&middot; 11 roles &middot; 65+ permissions</span>
            </div>
            <p className="text-[11px] text-center text-foreground-300">
              KBC LearningOS v1.0 &middot; Kent Business College &middot; Demo Environment
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
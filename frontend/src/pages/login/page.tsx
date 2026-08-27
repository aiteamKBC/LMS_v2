import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { AuthError, apiAuthHealth, apiMicrosoftStart, type Role } from '@/api/auth';
import styles from './page.module.css';

/** Where each backend role lands after signing in. */
/**
 * Where an account lands, in preference order.
 *
 * A staff account's `accessHome` wins: the backend derives it from the access
 * grant (ACCESS_HOME_ROUTES), so an enrolment officer opens the enrolment
 * console and a coach their own workspace, rather than every non-admin landing
 * on the user directory. Falls back to the coarse role for accounts with no
 * access recorded, and for learners and employers, which have no grant.
 */
function homeFor(account: {
  role: Role;
  accessHome?: string | null;
  subjectId?: number | null;
}): string {
  // An employer's console is their own record, so the route needs their id —
  // there is no single static path to send them to. `subjectId` is the
  // employer's Employers.id, which is exactly what /employers/:employerId
  // names. The generic workspace dashboard stays the fallback for an account
  // with no usable subject id.
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
  const [showPassword, setShowPassword] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  // Undefined until the health check answers, so the button is not flashed in
  // and then taken away on a deployment that has no provider configured.
  const [ssoAvailable, setSsoAvailable] = useState<boolean | undefined>(undefined);

  // Where the user was heading before RequireAuth sent them here.
  const from = (location.state as { from?: string } | null)?.from;

  // A refused Microsoft sign-in comes back as a redirect to this page carrying
  // ?sso_error=..., because the callback is a browser navigation and cannot
  // answer with JSON. Lift it into the same error box the form uses, then strip
  // it from the URL so a reload does not resurrect a stale message.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ssoError = params.get('sso_error');
    if (!ssoError) return;
    setError(ssoError);
    params.delete('sso_error');
    const rest = params.toString();
    navigate({ pathname: location.pathname, search: rest ? `?${rest}` : '' }, { replace: true });
  }, [location.search, location.pathname, navigate]);

  // Is a Microsoft app registration actually wired up? A sign-in button that
  // cannot work is worse than no button — the same reasoning that had the
  // original Google/Microsoft buttons removed.
  useEffect(() => {
    let cancelled = false;
    apiAuthHealth()
      .then((health) => { if (!cancelled) setSsoAvailable(!!health.microsoftSso?.configured); })
      .catch(() => { if (!cancelled) setSsoAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  // Bounce an already-signed-in visitor to their console. Waits for
  // isInitialized so it does not fire before the session has been resolved.
  useEffect(() => {
    if (!isInitialized || !auth.isAuthenticated) return;
    // Never fall back to '/': this page *is* '/', so an authenticated session
    // with no resolved account would bounce here forever. /home is the public
    // launcher and always renders.
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
      // Navigate straight away rather than relying on the effect above, so a
      // slow re-render cannot leave the form looking unresponsive.
      navigate(from || homeFor(account), { replace: true });
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

  const handleMicrosoftLogin = async () => {
    setError('');
    setSsoLoading(true);
    try {
      // A full navigation, not a fetch: the browser has to visit Microsoft and
      // come back to the callback, which is what sets the session cookie.
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
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-heading">
        <div className={styles.formPanel}>
          <div className={styles.formContent}>
            <img
              src="/assets/kbc-logo.png"
              alt="Kent Business College"
              className={styles.logo}
            />

            <header className={styles.intro}>
              <h1 id="login-heading">Welcome back</h1>
              <p>Sign in to your workspace</p>
            </header>

            <form onSubmit={handleLogin} className={styles.form} noValidate={false}>
              <div className={styles.fieldGroup}>
                <label htmlFor="email">Email address</label>
                <div className={styles.inputShell}>
                  <AppIcon className={`ri-mail-line ${styles.inputIcon}`} aria-hidden="true" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(''); }}
                    placeholder="your.email@kbc.test"
                    autoComplete="email"
                    aria-invalid={!!error}
                    aria-describedby={error ? 'login-error' : undefined}
                    required
                  />
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <div className={styles.labelRow}>
                  <label htmlFor="password">Password</label>
                  <button type="button" onClick={() => navigate('/forgot-password')} className={styles.forgotButton}>
                    Forgot password?
                  </button>
                </div>
                <div className={styles.inputShell}>
                  <AppIcon className={`ri-lock-line ${styles.inputIcon}`} aria-hidden="true" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    aria-invalid={!!error}
                    aria-describedby={error ? 'login-error' : undefined}
                    required
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    <AppIcon className={showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                className={styles.rememberRow}
                aria-pressed={rememberMe}
                onClick={() => setRememberMe((remembered) => !remembered)}
              >
                <span className={styles.checkboxVisual} aria-hidden="true">
                  <AppIcon className="ri-check-line" />
                </span>
                <span>Remember me</span>
              </button>

              {error && (
                <div id="login-error" className={styles.error} role="alert" aria-live="polite">
                  <AppIcon className="ri-error-warning-line" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!email || !password || isLoading}
                className={styles.primaryButton}
              >
                {isLoading ? (
                  <span className={styles.loadingLabel}>
                    <AppIcon className="ri-loader-4-line animate-spin" aria-hidden="true" />
                    Signing in...
                  </span>
                ) : (
                  'Sign in to Workspace'
                )}
              </button>
            </form>

            {ssoAvailable && (
              <div className={styles.ssoBlock}>
                <div className={styles.divider} aria-hidden="true">
                  <span />
                  <strong>OR</strong>
                  <span />
                </div>

                <button
                  type="button"
                  onClick={handleMicrosoftLogin}
                  disabled={ssoLoading || isLoading}
                  className={styles.microsoftButton}
                >
                  {ssoLoading ? (
                    <>
                      <AppIcon className="ri-loader-4-line animate-spin" aria-hidden="true" />
                      Redirecting to Microsoft...
                    </>
                  ) : (
                    <>
                      <svg className={styles.microsoftMark} viewBox="0 0 21 21" aria-hidden="true">
                        <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                        <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                        <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                        <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                      </svg>
                      Sign in with Microsoft
                    </>
                  )}
                </button>

                <p className={styles.ssoHint}>
                  Use your work account. You must already have access to this platform.
                </p>
              </div>
            )}

            <footer className={styles.secureFooter}>
              <span>
                <AppIcon className="ri-shield-check-line" aria-hidden="true" />
                Secure sign-in
              </span>
            </footer>
          </div>
        </div>

        <aside className={styles.visualPanel} aria-label="Kent Business College digital workspace">
          <span className={styles.shapeRibbon} aria-hidden="true" />
          <span className={styles.shapeOrb} aria-hidden="true" />
          <span className={styles.shapeArc} aria-hidden="true" />

          <div className={styles.imageCard}>
            <img
              src="/login-workspace.png"
              alt="Learning management system workspace illustration"
            />
          </div>
        </aside>
      </section>
    </main>
  );
}

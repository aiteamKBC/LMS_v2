import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthError, apiForgotPassword } from '@/api/auth';
import loginStyles from '../login/page.module.css';
import styles from './page.module.css';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setSending(true);
    try {
      // Succeeds whether or not the address has an account — the backend does
      // not disclose which, so this screen must not either.
      setMessage(await apiForgotPassword(email.trim()));
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof AuthError ? err.message : 'Could not send the reset email. Please try again.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <main className={loginStyles.page}>
      <section className={loginStyles.card} aria-labelledby="forgot-password-heading">
        <span className={loginStyles.curveBand} aria-hidden="true" />
        <div className={loginStyles.formPanel}>
          <div className={loginStyles.formContent}>
            <img
              src="/assets/kbc-logo.png"
              alt="Kent Business College"
              className={loginStyles.logo}
            />

            <header className={loginStyles.intro}>
              <h1 id="forgot-password-heading">Reset your password</h1>
              <p>Enter your email address and we will send you a reset link</p>
            </header>

            {submitted ? (
              <div className={styles.successContent}>
                <div className={styles.successMessage} role="status" aria-live="polite">
                  <AppIcon className="ri-checkbox-circle-line" aria-hidden="true" />
                  <span>{message || 'If that address has an account, a reset link has been sent to it.'}</span>
                </div>
                <p className={styles.supportingText}>
                  The link can be used once and expires in an hour. Check your spam folder if it
                  does not arrive within a few minutes.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className={loginStyles.primaryButton}
                >
                  Back to Sign in
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className={loginStyles.form}>
                <div className={loginStyles.fieldGroup}>
                  <label htmlFor="email">Email address</label>
                  <div className={loginStyles.inputShell}>
                    <AppIcon className={`ri-mail-line ${loginStyles.inputIcon}`} aria-hidden="true" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(''); }}
                      placeholder="your.email@kbc.test"
                      autoComplete="email"
                      aria-invalid={!!error}
                      aria-describedby={error ? 'forgot-password-error' : undefined}
                      required
                    />
                  </div>
                </div>

                {error && (
                  <div id="forgot-password-error" className={loginStyles.error} role="alert" aria-live="polite">
                    <AppIcon className="ri-error-warning-line" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!email || sending}
                  className={loginStyles.primaryButton}
                >
                  {sending ? (
                    <span className={loginStyles.loadingLabel}>
                      <AppIcon className="ri-loader-4-line animate-spin" aria-hidden="true" />
                      Sending…
                    </span>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>
              </form>
            )}

            <footer className={`${loginStyles.secureFooter} ${styles.returnFooter}`}>
              <p>
                Remember your password?{' '}
                <button type="button" onClick={() => navigate('/login')}>
                  Sign in
                </button>
              </p>
            </footer>
          </div>
        </div>

        <aside className={loginStyles.visualPanel} aria-label="Kent Business College campus">
          <img
            className={loginStyles.campusImage}
            src="/kent-business-college-campus.png"
            alt="Kent Business College campus building at dusk"
          />
          <div className={loginStyles.visualShade} aria-hidden="true" />

          <div className={loginStyles.visualTopCard}>
            <span className={loginStyles.visualIcon} aria-hidden="true">
              <AppIcon className="ri-shield-check-line" />
            </span>
            <p>
              <span>Empowering learners.</span>
              <span>Building futures.</span>
            </p>
          </div>

          <div className={loginStyles.visualFooterCard}>
            <span className={loginStyles.footerBrand}>
              <AppIcon className="ri-shield-check-line" aria-hidden="true" />
              <span>
                <strong>Kent Business College</strong>
                <small>{'\u00a9'} 2026 All rights reserved.</small>
              </span>
            </span>
            <span className={loginStyles.supportLine}>
              <span>Need help?</span>
              <b>Contact support</b>
            </span>
          </div>
        </aside>
      </section>
    </main>
  );
}

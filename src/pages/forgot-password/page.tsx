import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setSubmitted(true);
  };

  return (
    <div className="min-h-screen flex bg-foreground-950">
      {/* Left: Image Background */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] relative overflow-hidden">
        <img
          src="https://storage.readdy-site.link/project_files/618bc44b-5728-4a0b-8f4f-ee80cff7baf6/a4d6c15d-8e73-478b-bdf9-c01002333189_ChatGPT-Image-Jun-11-2026-05_01_27-AM.png"
          alt="London skyline professional background"
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
      </div>

      {/* Right: Form */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-8 lg:p-12 bg-background-50">
        <div className="w-full max-w-[420px] animate-fade-in-up">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center">
              <span className="text-white font-bold text-lg font-heading">K</span>
            </div>
            <div>
              <p className="text-foreground-900 font-heading text-lg font-semibold leading-tight">KBC LearningOS</p>
              <p className="text-[11px] text-foreground-400 tracking-wide">Kent Business College</p>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-[28px] font-heading font-semibold text-foreground-950 mb-2 tracking-tight leading-tight">
              Reset your password
            </h2>
            <p className="text-[14px] text-foreground-500">
              Enter your email address and we will send you a reset link
            </p>
          </div>

          {submitted ? (
            <div className="space-y-6">
              <div className="flex items-center gap-2 px-3.5 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[13px] text-emerald-700">
                <i className="ri-checkbox-circle-line text-sm shrink-0" />
                <span>Reset link sent to your email address</span>
              </div>
              <p className="text-[13px] text-foreground-400 leading-relaxed">
                If an account exists with that email, you will receive instructions to reset your password shortly.
              </p>
              <button
                onClick={() => navigate('/login')}
                className="w-full py-3 rounded-xl bg-primary-500 text-white text-[14px] font-semibold hover:bg-primary-600 transition-all duration-200 whitespace-nowrap shadow-sm shadow-primary-500/20 cursor-pointer"
              >
                Back to Sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-[12px] font-semibold text-foreground-600 mb-2">
                  Email address
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400">
                    <i className="ri-mail-line text-[15px]" />
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

              {error && (
                <div className="flex items-center gap-2 px-3.5 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
                  <i className="ri-error-warning-line text-sm shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!email}
                className="w-full py-3.5 rounded-xl bg-primary-500 text-white text-[14px] font-semibold hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 whitespace-nowrap shadow-md shadow-primary-500/15 cursor-pointer"
              >
                Send Reset Link
              </button>
            </form>
          )}

          <div className="mt-8 pt-6 border-t border-background-200">
            <p className="text-[12px] text-center text-foreground-400">
              Remember your password?{' '}
              <button
                onClick={() => navigate('/login')}
                className="text-primary-600 hover:text-primary-700 font-semibold cursor-pointer"
              >
                Sign in
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { InclusionLoading } from './InclusionLoading';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const STORAGE_KEY = 'inclusion_sso_pending';

/** Remembers the destination through password and Microsoft sign-in. */
export function InclusionSignIn({ children }: { children?: ReactNode }) {
  const { auth, isInitialized, initializationError } = useAuth();
  const location = useLocation();
  const redirecting = useRef(false);
  const queryState = new URLSearchParams(location.search).get('inclusion_state');
  let pending = !!queryState && /^[a-f0-9]{64}$/.test(queryState);
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    pending ||= !!stored && stored.expires > Date.now() && /^[a-f0-9]{64}$/.test(stored.state);
  } catch { /* Ignore malformed browser state. */ }
  const [enteredWithPending] = useState(pending);
  useEffect(() => {
    const state = new URLSearchParams(location.search).get('inclusion_state');
    if (state && /^[a-f0-9]{64}$/.test(state)) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ state, expires: Date.now() + 600_000 }));
    }
    if (!isInitialized || !auth.account || redirecting.current) return;
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    sessionStorage.removeItem(STORAGE_KEY);
    try {
      const pending = JSON.parse(stored);
      if (pending.expires > Date.now() && /^[a-f0-9]{64}$/.test(pending.state)) {
        redirecting.current = true;
        window.location.replace(`/login_api/inclusion/authorize/?state=${encodeURIComponent(pending.state)}`);
      }
    } catch { /* Ignore malformed browser state. */ }
  }, [location.search, isInitialized, auth.account]);
  // Do not mount destination routes while resolving the SSO session: otherwise
  // their login forms and dashboard skeletons flash before the redirect.
  if ((pending || enteredWithPending) && !initializationError && (!isInitialized || auth.account)) return <InclusionLoading />;
  return <>{children}</>;
}

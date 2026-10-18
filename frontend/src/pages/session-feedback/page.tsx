import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PublicExternalFeedback } from '@/features/feedback/PublicExternalFeedback';

const PATH = '/session-feedback';
function tokenFrom(search: string, hash: string, state: unknown) {
  const stored = state && typeof state === 'object' && 'sessionFeedbackToken' in state && typeof state.sessionFeedbackToken === 'string' ? state.sessionFeedbackToken : '';
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') || new URLSearchParams(search).get('token') || stored;
}
export default function SessionFeedbackPage() {
  const location = useLocation();
  const [token] = useState(() => tokenFrom(location.search, location.hash, window.history.state));
  useEffect(() => { window.history.replaceState({ ...(window.history.state || {}), sessionFeedbackToken: token }, '', PATH); }, [token]);
  return <PublicExternalFeedback token={token} />;
}

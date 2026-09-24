import { useLocation, useNavigate } from 'react-router-dom';

export function hasUsableAppHistory(historyState: unknown): boolean {
  if (!historyState || typeof historyState !== 'object') return false;
  const index = (historyState as { idx?: unknown }).idx;
  return typeof index === 'number' && index > 0;
}

export function useSmartBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  return () => {
    if (location.key !== 'default' || hasUsableAppHistory(window.history.state)) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}

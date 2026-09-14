import { useLocation } from 'react-router-dom';

/** Keep a selected learner preview out of the staff directory while changing months. */
export function useRecordHref() {
  const { search } = useLocation();
  const preview = new URLSearchParams(search).get('workspace') === 'learner';
  return (path: string) => preview && path.startsWith('/old-otjh/coach/') ? `${path}?workspace=learner` : path;
}

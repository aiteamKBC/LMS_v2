import { useEffect } from 'react';
import { readWebPointPlan, type WebPointPlan } from '@/api/webWeekPoints';
import { useLiveLearnerRead } from './useLiveLearnerRead';

const peek = () => undefined;
export function useWebPointPlan(kind?: string, id?: string, hasNativeWeeks = true) {
  const learnerKind = kind === 'commercial' || kind === 'apprenticeship' ? kind : null;
  const enabled = !!learnerKind && !!id && /^\d+$/.test(id) && hasNativeWeeks;
  const result = useLiveLearnerRead<WebPointPlan>(learnerKind, id, enabled, readWebPointPlan, peek);
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('focus', result.refresh);
    window.addEventListener('web-points-updated', result.refresh);
    return () => {
      window.removeEventListener('focus', result.refresh);
      window.removeEventListener('web-points-updated', result.refresh);
    };
  }, [enabled, result.refresh]);
  return result;
}
